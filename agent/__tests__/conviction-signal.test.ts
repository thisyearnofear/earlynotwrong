import { describe, it, expect } from "vitest";
import {
  scoreMarketRegime,
  scoreTokenConviction,
  evaluatePosition,
  accruePosition,
  openPosition,
  synthesizeRsi7d,
  volatilityPenaltyFraction,
  computeAdaptiveWeights,
} from "../lib/conviction-signal.js";
import type { TokenQuote } from "../lib/data-providers.js";

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

describe("computeAdaptiveWeights — regime-dependent weight shifts", () => {
  const makeRegime = (score: number, label: string, fearLevel: string) => ({
    score,
    label,
    fearGreedIndex: 50,
    fearLevel: fearLevel as any,
    ssiConfirmation: null,
  });

  it("increases contrarian weight in deep fear", () => {
    const w = computeAdaptiveWeights(makeRegime(85, "DEEP FEAR", "extreme-fear"));
    expect(w.contrarian).toBeGreaterThan(30);
    expect(w.regime).toBeGreaterThan(20);
  });

  it("increases quality weight in euphoria", () => {
    const w = computeAdaptiveWeights(makeRegime(20, "EUPHORIA", "extreme-greed"));
    expect(w.quality).toBeGreaterThan(20);
    expect(w.contrarian).toBeLessThan(30);
  });

  it("never returns negative weights", () => {
    for (const score of [0, 25, 45, 60, 80, 100]) {
      const w = computeAdaptiveWeights(makeRegime(score, "test", "neutral"));
      expect(w.contrarian).toBeGreaterThanOrEqual(0);
      expect(w.rsi).toBeGreaterThanOrEqual(0);
      expect(w.quality).toBeGreaterThanOrEqual(0);
      expect(w.regime).toBeGreaterThanOrEqual(0);
      expect(w.holders).toBeGreaterThanOrEqual(0);
      expect(w.volatilityPenaltyMax).toBeGreaterThanOrEqual(0);
      expect(w.newsMax).toBeGreaterThanOrEqual(0);
    }
  });

  it("surfaces active weights on the conviction signal", () => {
    const fearfulRegime = {
      score: 75,
      label: "FEAR",
      fearGreedIndex: 25,
      fearLevel: "fear" as const,
      ssiConfirmation: null,
    };
    const signal = scoreTokenConviction(
      makeQuote({ percentChange7d: -25 }),
      fearfulRegime
    );
    expect(signal.weights).toBeDefined();
    expect(signal.weights.contrarian).toBeGreaterThan(30);
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

  it("never takes profit early on a winner below the partial-profit threshold", () => {
    const verdict = evaluatePosition(base, 140); // +40%, below +50% partial threshold
    expect(verdict.action).toBe("HOLD");
    expect(verdict.reason).toMatch(/winner/i);
  });

  it("EXIT_TRAILs only after a big run gives back from the peak", () => {
    // Position ran to +120%, partial already taken, then gave back 30% from peak.
    const pos = { ...base, peakPriceUsd: 220, partialProfitTaken: true };
    const verdict = evaluatePosition(pos, 154); // 220 → 154 = −30% from peak
    expect(verdict.action).toBe("EXIT_TRAIL");
    expect(verdict.reason).toMatch(/asymmetry/i);
  });

  it("EXIT_PARTIAL at +50% gain — sell 33%, let the rest ride", () => {
    // Position ran to +60%, partial not yet taken; currently +55%.
    const pos = { ...base, peakPriceUsd: 160 };
    const verdict = evaluatePosition(pos, 155);
    expect(verdict.action).toBe("EXIT_PARTIAL");
    expect(verdict.sellFraction).toBeCloseTo(0.33, 1);
    expect(verdict.reason).toMatch(/33%/i);
    // The reason reports the CURRENT gain (+55%), not the peak (+60%).
    expect(verdict.reason).toMatch(/Up 55%/);
  });

  it("requires CURRENT gain for partial profit — a peaked-and-retraced position is not a winner", () => {
    // Peaked +55% intra-cycle, but sits at −10% by evaluation. Selling here
    // would realize a loss while calling it profit-taking.
    const pos = { ...base, peakPriceUsd: 155 };
    const verdict = evaluatePosition(pos, 90);
    expect(verdict.action).toBe("HOLD");
    expect(verdict.reason).toMatch(/drawdown/i);
  });

  it("HOLDs a big winner that has NOT yet given back from peak", () => {
    // Up 150%, partial already taken, still near peak — let it run.
    const pos = { ...base, peakPriceUsd: 250, partialProfitTaken: true };
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

describe("volatilityPenaltyFraction — penalizes erratic paths, not magnitude", () => {
  it("returns ~0 when the 24h move sits on the smooth 7d path", () => {
    // −40% over 7d moving ~−5.7% a day is a clean decline — the target trade.
    expect(volatilityPenaltyFraction(-40, -40 / 7)).toBe(0);
    expect(volatilityPenaltyFraction(-40, -5.7)).toBeLessThan(0.01);
    expect(volatilityPenaltyFraction(14, 2)).toBe(0);
  });

  it("returns the maximum (1) when the 24h move deviates 20pp+ from the daily drift", () => {
    // A −40% week bouncing +15% in the last 24h is a falling knife mid-bounce.
    expect(volatilityPenaltyFraction(-40, 15)).toBe(1);
    expect(volatilityPenaltyFraction(0, 20)).toBe(1);
  });

  it("penalizes a front-loaded dump (whole 7d move in the last 24h)", () => {
    // −20% 7d that ALL happened in the last day is abrupt, not smooth.
    expect(volatilityPenaltyFraction(-20, -20)).toBeGreaterThan(0.8);
  });

  it("scales linearly between 0 and 1", () => {
    const mid = volatilityPenaltyFraction(0, 10); // 10pp deviation from flat drift
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
    // Smooth path: down 20% over 7d, moving ~−3%/day → ~zero vol penalty
    const smooth = scoreTokenConviction(
      makeQuote({ percentChange7d: -20, percentChange24h: -3 }),
      fearfulRegime
    );
    // Erratic path: down 40% over 7d BUT up 15% in the last 24h — a bounce
    // ~21pp off the smooth daily drift → maximum vol penalty
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

  it("marks a stuck position as HOLD and stops exit attempts", () => {
    const stuckPos = openPosition({ symbol: "FAKE", entryPriceUsd: 1, amountUsd: 100, cycle: 1 });
    stuckPos.stuck = true;
    stuckPos.failedExitAttempts = 3;
    stuckPos.maxUnderwaterPercent = 25;
    const verdict = evaluatePosition(stuckPos, 0.5);
    expect(verdict.action).toBe("HOLD");
    expect(verdict.reason).toMatch(/stuck/);
    expect(verdict.heldThroughDrawdown).toBe(true);
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
