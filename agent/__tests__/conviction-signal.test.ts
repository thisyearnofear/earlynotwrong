import { describe, it, expect } from "vitest";
import {
  scoreMarketRegime,
  scoreTokenConviction,
  evaluatePosition,
  accruePosition,
  openPosition,
  synthesizeRsi7d,
  volatilityPenaltyFraction,
} from "../lib/conviction-signal.js";
import type { TokenQuote } from "../lib/cmc-client.js";

const makeQuote = (overrides: Partial<TokenQuote> = {}): TokenQuote => ({
  symbol: "TWT",
  name: "Trust Wallet Token",
  price: 1.0,
  percentChange1h: 0,
  percentChange24h: -5,
  percentChange7d: -20,
  marketCap: 500_000_000,
  volume24h: 25_000_000,
  circulatingSupply: 500_000_000,
  maxSupply: null,
  cmcRank: 100,
  lastUpdated: new Date().toISOString(),
  ...overrides,
});

describe("scoreMarketRegime — contrarian lens", () => {
  it("scores extreme fear highest (contrarian opportunity)", () => {
    const regime = scoreMarketRegime(
      { fearGreedIndex: 10 } as any,
      { btcFundingRate: -0.02, ethFundingRate: -0.02 } as any
    );
    expect(regime.score).toBeGreaterThanOrEqual(90);
    expect(regime.fearLevel).toBe("extreme-fear");
  });

  it("scores extreme greed lowest", () => {
    const regime = scoreMarketRegime(
      { fearGreedIndex: 90 } as any,
      { btcFundingRate: 0.08, ethFundingRate: 0.08 } as any
    );
    expect(regime.score).toBeLessThanOrEqual(20);
    expect(regime.fearLevel).toBe("extreme-greed");
  });

  it("rewards negative funding (crowd short = contrarian-bullish)", () => {
    const fearful = scoreMarketRegime(
      { fearGreedIndex: 55 } as any,
      { btcFundingRate: -0.02, ethFundingRate: -0.02 } as any
    );
    const euphoric = scoreMarketRegime(
      { fearGreedIndex: 55 } as any,
      { btcFundingRate: 0.08, ethFundingRate: 0.08 } as any
    );
    expect(fearful.score).toBeGreaterThan(euphoric.score);
  });

  it("handles null data gracefully (returns neutral)", () => {
    const regime = scoreMarketRegime(null, null);
    expect(regime.score).toBeGreaterThanOrEqual(40);
    expect(regime.score).toBeLessThanOrEqual(60);
    expect(regime.fearLevel).toBe("unknown");
  });
});

describe("scoreTokenConviction — rewards weakness, not momentum", () => {
  const fearfulRegime = {
    score: 75,
    label: "FEAR",
    fearGreedIndex: 30,
    fearLevel: "fear" as const,
  };

  it("scores a deep-value token (down 25% on quality asset) higher than a momentum winner (up 25%)", () => {
    const weak = scoreTokenConviction(
      makeQuote({ percentChange7d: -25 }),
      fearfulRegime
    );
    const strong = scoreTokenConviction(
      makeQuote({ percentChange7d: 25 }),
      fearfulRegime
    );
    expect(weak.score).toBeGreaterThan(strong.score);
  });

  it("penalizes capitulation (down > 70%) as dying, not cheap", () => {
    const dip = scoreTokenConviction(
      makeQuote({ percentChange7d: -25 }),
      fearfulRegime
    );
    const capitulation = scoreTokenConviction(
      makeQuote({ percentChange7d: -80 }),
      fearfulRegime
    );
    expect(dip.score).toBeGreaterThan(capitulation.score);
  });

  it("rewards higher quality (liquidity + size)", () => {
    const quality = scoreTokenConviction(
      makeQuote({ marketCap: 10_000_000_000, volume24h: 500_000_000 }),
      fearfulRegime
    );
    const thin = scoreTokenConviction(
      makeQuote({ marketCap: 5_000_000, volume24h: 50_000 }),
      fearfulRegime
    );
    expect(quality.score).toBeGreaterThan(thin.score);
  });

  it("produces a human-readable rationale that names the behavior", () => {
    const signal = scoreTokenConviction(
      makeQuote({ percentChange7d: -20 }),
      fearfulRegime
    );
    expect(signal.rationale).toMatch(/early/i);
    expect(signal.rationale).toMatch(/fear/i);
  });
});

describe("evaluatePosition — cap losses, let winners run", () => {
  const base = openPosition({
    symbol: "TWT",
    entryPriceUsd: 100,
    amountUsd: 1000,
    cycle: 1,
  });

  it("HOLDs through ordinary drawdown (the thesis)", () => {
    const pos = { ...base, maxUnderwaterPercent: 20 };
    const verdict = evaluatePosition(pos, 85); // -15%
    expect(verdict.action).toBe("HOLD");
    expect(verdict.reason).toMatch(/early/i);
  });

  it("EXIT_STOPs when thesis invalidated (past −35%)", () => {
    const verdict = evaluatePosition(base, 60); // -40%
    expect(verdict.action).toBe("EXIT_STOP");
    expect(verdict.reason).toMatch(/thesis invalidated/i);
  });

  it("never takes profit early on a winner below trailing activation", () => {
    const verdict = evaluatePosition(base, 150); // +50%, below 100% activation
    expect(verdict.action).toBe("HOLD");
    expect(verdict.reason).toMatch(/winner/i);
  });

  it("EXIT_TRAILs only after a big run gives back from the peak", () => {
    // Position ran to +120%, then gave back 30% from peak.
    const pos = { ...base, peakPriceUsd: 220 };
    const verdict = evaluatePosition(pos, 154); // 220 → 154 = −30% from peak
    expect(verdict.action).toBe("EXIT_TRAIL");
    expect(verdict.reason).toMatch(/asymmetry/i);
  });

  it("HOLDs a big winner that has NOT yet given back from peak", () => {
    // Up 150%, still near peak — let it run.
    const pos = { ...base, peakPriceUsd: 250 };
    const verdict = evaluatePosition(pos, 245);
    expect(verdict.action).toBe("HOLD");
  });
});

describe("accruePosition — tracks peak and max underwater", () => {
  it("updates peak and max-underwater correctly across cycles", () => {
    let pos = openPosition({
      symbol: "TWT",
      entryPriceUsd: 100,
      amountUsd: 1000,
      cycle: 1,
    });
    pos = accruePosition(pos, 90);  // -10%
    pos = accruePosition(pos, 80);  // -20% — new max underwater
    pos = accruePosition(pos, 110); // +10% — new peak
    pos = accruePosition(pos, 105); // +5% from entry

    expect(pos.peakPriceUsd).toBe(110);
    expect(pos.maxUnderwaterPercent).toBe(20);
    expect(pos.cyclesHeld).toBe(4);
  });

  it("does not crash on zero price (stale feed)", () => {
    const pos = openPosition({
      symbol: "TWT",
      entryPriceUsd: 100,
      amountUsd: 1000,
      cycle: 1,
    });
    const next = accruePosition(pos, 0);
    expect(next.cyclesHeld).toBe(1);
    expect(next.maxUnderwaterPercent).toBe(0);
  });
});

describe("synthesizeRsi7d — RSI-like timing from a single 7d return", () => {
  it("returns ~50 for flat return", () => {
    expect(synthesizeRsi7d(0)).toBe(50);
  });

  it("returns oversold (< 35) for a meaningful 7d dip", () => {
    expect(synthesizeRsi7d(-25)).toBeLessThan(35);
    expect(synthesizeRsi7d(-35)).toBeLessThan(35);
  });

  it("returns overbought (> 70) for a meaningful 7d run", () => {
    expect(synthesizeRsi7d(25)).toBeGreaterThan(70);
  });

  it("is monotonic in the 7d return", () => {
    const weak = synthesizeRsi7d(-30);
    const neutral = synthesizeRsi7d(0);
    const strong = synthesizeRsi7d(30);
    expect(weak).toBeLessThan(neutral);
    expect(neutral).toBeLessThan(strong);
  });

  it("clamps catastrophic collapse (−95%) without crashing", () => {
    const rsi = synthesizeRsi7d(-95);
    expect(rsi).toBeGreaterThanOrEqual(0);
    expect(rsi).toBeLessThan(10);
  });
});

describe("volatilityPenaltyFraction — penalizes erratic paths", () => {
  it("returns 0 when 7d and 24h agree (smooth path)", () => {
    expect(volatilityPenaltyFraction(-20, -20)).toBe(0);
    expect(volatilityPenaltyFraction(10, 10)).toBe(0);
  });

  it("returns the maximum (1) when divergence is 50pp+", () => {
    expect(volatilityPenaltyFraction(-40, 15)).toBe(1);
    expect(volatilityPenaltyFraction(50, 0)).toBe(1);
  });

  it("scales linearly between 0 and 1", () => {
    const mid = volatilityPenaltyFraction(-25, 0); // 25pp divergence
    expect(mid).toBeCloseTo(0.5, 2);
  });
});

describe("scoreTokenConviction — integrated formula", () => {
  const fearfulRegime = {
    score: 75,
    label: "FEAR",
    fearGreedIndex: 25,
    fearLevel: "fear" as const,
  };

  it("awards a bonus to a smooth-path oversold token vs a choppy-path equally-down token", () => {
    // Smooth path: down 20% over 7d AND down 20% over 24h → low vol penalty
    const smooth = scoreTokenConviction(
      makeQuote({ percentChange7d: -20, percentChange24h: -20 }),
      fearfulRegime
    );
    // Erratic path: down 40% over 7d BUT up 15% in the last 24h → 55pp divergence
    const erratic = scoreTokenConviction(
      makeQuote({ percentChange7d: -40, percentChange24h: 15 }),
      fearfulRegime
    );
    // Smooth should score meaningfully higher due to the vol penalty on erratic
    expect(smooth.score).toBeGreaterThan(erratic.score);
    expect(erratic.breakdown.volatilityPenalty).toBeGreaterThan(
      smooth.breakdown.volatilityPenalty
    );
  });

  it("surfaces RSI and volatility in the breakdown and rationale", () => {
    const signal = scoreTokenConviction(
      makeQuote({ percentChange7d: -25, percentChange24h: -5 }),
      fearfulRegime
    );
    expect(signal.breakdown.rsi).toBeGreaterThanOrEqual(0);
    expect(typeof signal.breakdown.volatilityPenalty).toBe("number");
    expect(signal.rationale).toMatch(/RSI|oversold|erratic|fear/i);
  });
});
