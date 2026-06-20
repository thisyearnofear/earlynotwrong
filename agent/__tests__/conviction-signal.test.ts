import { describe, it, expect } from "vitest";
import {
  scoreMarketRegime,
  scoreTokenConviction,
  evaluatePosition,
  accruePosition,
  openPosition,
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
