/**
 * Options policy — entry gates, sizing, and exits.
 *
 * Pins the opinion: one thesis per underlier, living premium only,
 * HOLD ordinary drawdown, EXIT when the thesis (or the contract) is dead.
 */

import { describe, it, expect } from "vitest";
import type { MarketSignal } from "../lib/adapters/types.js";
import type { OptionsPosition } from "../lib/options-state.js";
import {
  OPTIONS_POLICY,
  computeRsi,
  daysToExpiry,
  evaluateEntry,
  planExits,
  sizeContracts,
  underlierCostUsd,
  snapshotFromPosition,
  type ExitSnapshot,
} from "../lib/options-policy.js";

function makeSignal(overrides: Partial<MarketSignal> = {}, meta: Record<string, unknown> = {}): MarketSignal {
  return {
    symbol: "NVDA260918C00180000",
    name: "NVDA CALL 180 2026-09-18",
    price: 4.5,
    priceChange24hPercent: -2,
    priceChange7dPercent: -4,
    volume24h: 50_000,
    marketCap: 0,
    metadata: {
      underlyingSymbol: "NVDA",
      contractType: "call",
      strike: 180,
      expiry: "2026-09-18",
      impliedVolatility: 0.35,
      ivAvailable: true,
      ivToRealized: 0.8,
      delta: 0.4,
      bid: 4.4,
      ask: 4.6,
      newsSentiment: "neutral",
      multiplier: 100,
      ...meta,
    },
    ...overrides,
  };
}

function makeHeld(overrides: Partial<OptionsPosition> = {}): OptionsPosition {
  return {
    symbol: "AAPL260918C00250000",
    contractId: "AAPL260918C00250000",
    underlyingSymbol: "AAPL",
    contractType: "call",
    strike: 250,
    expiry: "2026-09-18",
    entryPrice: 5,
    avgEntryPrice: 5,
    quantity: 2,
    multiplier: 100,
    entryCycle: 1,
    enteredAt: Date.now() - 86400000,
    entryConviction: 55,
    unrealizedPnlUsd: 0,
    unrealizedPnlPercent: 0,
    peakUnrealizedPercent: 0,
    stuck: false,
    failedExitAttempts: 0,
    ...overrides,
  };
}

function snap(overrides: Partial<ExitSnapshot> = {}): ExitSnapshot {
  const now = Date.parse("2026-09-01T14:00:00Z");
  return {
    symbol: "NVDA260911C00230000",
    underlyingSymbol: "NVDA",
    contractType: "call",
    expiry: "2026-09-11",
    quantity: 20,
    avgEntryPrice: 1.29,
    multiplier: 100,
    currentPrice: 1.41,
    bid: 1.4,
    unrealizedPnlPercent: 9,
    peakUnrealizedPercent: 13,
    entryConviction: 50,
    currentConviction: 44,
    rsi: 55,
    delta: 0.35,
    enteredAt: now - 86400000,
    now,
    ...overrides,
  };
}

describe("daysToExpiry / RSI", () => {
  it("computes DTE from an expiry date", () => {
    const now = Date.parse("2026-09-01T14:00:00Z");
    expect(daysToExpiry("2026-09-11", now)).toBeGreaterThan(9);
    expect(daysToExpiry("2026-09-11", now)).toBeLessThan(11);
  });

  it("returns null RSI without enough closes", () => {
    expect(computeRsi([1, 2, 3])).toBeNull();
  });
});

describe("evaluateEntry", () => {
  const now = Date.parse("2026-09-01T14:00:00Z");

  it("accepts a living, mid-delta, cheap-vol call with room in the book", () => {
    const d = evaluateEntry({ signal: makeSignal(), score: 52, rsi: 48, held: [], now });
    expect(d.ok).toBe(true);
  });

  it("rejects lottery-ticket premium", () => {
    const d = evaluateEntry({
      signal: makeSignal({ price: 0.13 }, { bid: 0.12, ask: 0.14, delta: 0.08 }),
      score: 60,
      rsi: 40,
      held: [],
      now,
    });
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/lotto|premium/i);
  });

  it("rejects far-OTM (low delta) even if premium clears the floor", () => {
    const d = evaluateEntry({
      signal: makeSignal({ price: 0.8 }, { bid: 0.75, ask: 0.85, delta: 0.12 }),
      score: 55,
      rsi: 40,
      held: [],
      now,
    });
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/delta/i);
  });

  it("rejects a second contract on an underlier already held", () => {
    const d = evaluateEntry({
      signal: makeSignal(),
      score: 60,
      rsi: 40,
      held: [makeHeld({ underlyingSymbol: "NVDA", symbol: "NVDA260911C00200000" })],
      now,
    });
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/thesis on NVDA/);
  });

  it("rejects averaging into the same OSI symbol", () => {
    const signal = makeSignal();
    const d = evaluateEntry({
      signal,
      score: 60,
      rsi: 40,
      held: [makeHeld({ symbol: signal.symbol, underlyingSymbol: "SPY" })],
      now,
    });
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/already holding/);
  });

  it("rejects a call into overbought RSI", () => {
    const d = evaluateEntry({ signal: makeSignal(), score: 60, rsi: 78, held: [], now });
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/overbought/);
  });

  it("rejects a call against bearish news", () => {
    const d = evaluateEntry({
      signal: makeSignal({}, { newsSentiment: "bearish" }),
      score: 60,
      rsi: 45,
      held: [],
      now,
    });
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/bearish/);
  });

  it("rejects rich IV/RV", () => {
    const d = evaluateEntry({
      signal: makeSignal({}, { ivToRealized: 1.8 }),
      score: 60,
      rsi: 45,
      held: [],
      now,
    });
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/rich/);
  });

  it("rejects short-dated contracts", () => {
    const d = evaluateEntry({
      signal: makeSignal({}, { expiry: "2026-09-03" }),
      score: 60,
      rsi: 45,
      held: [],
      now,
    });
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/DTE/);
  });
});

describe("sizeContracts", () => {
  it("caps cheap weeklies at maxContractsPerOrder, not 100+ lots", () => {
    const d = sizeContracts({ price: 0.13, portfolioUsd: 100_000, cashUsd: 70_000 });
    // 0.13 * 100 = $13/lot; without the cap this would be ~115 lots.
    expect(d.ok).toBe(true);
    expect(d.quantity).toBe(OPTIONS_POLICY.maxContractsPerOrder);
  });

  it("skips a 1-lot that blows the dollar cap (no Math.max(1) override)", () => {
    const d = sizeContracts({ price: 37.15, portfolioUsd: 100_000, cashUsd: 70_000 });
    expect(d.ok).toBe(false);
    expect(d.quantity).toBe(0);
    expect(d.reason).toMatch(/1 lot costs/);
  });

  it("sizes a mid-priced contract to a handful of lots", () => {
    const d = sizeContracts({ price: 4.5, portfolioUsd: 100_000, cashUsd: 70_000 });
    expect(d.ok).toBe(true);
    expect(d.quantity).toBeGreaterThanOrEqual(1);
    expect(d.quantity).toBeLessThanOrEqual(OPTIONS_POLICY.maxContractsPerOrder);
    expect(d.sizeUsd).toBeLessThanOrEqual(OPTIONS_POLICY.maxSizeUsd);
  });
});

describe("planExits", () => {
  it("HOLDs ordinary drawdown (the brand)", () => {
    const plans = planExits([snap({ unrealizedPnlPercent: -18 })]);
    expect(plans[0].action).toBe("HOLD");
  });

  it("EXIT_STOP at −35%", () => {
    const plans = planExits([snap({ unrealizedPnlPercent: -39 })]);
    expect(plans[0].reason).toBe("EXIT_STOP");
  });

  it("EXIT_TAKE at +50%", () => {
    const plans = planExits([snap({ unrealizedPnlPercent: 55 })]);
    expect(plans[0].reason).toBe("EXIT_TAKE");
  });

  it("EXIT_DEAD on a zero bid", () => {
    const plans = planExits([snap({ currentPrice: 0, bid: 0, unrealizedPnlPercent: -100 })]);
    expect(plans[0].reason).toBe("EXIT_DEAD");
  });

  it("EXIT_EXPIRY inside two days", () => {
    const now = Date.parse("2026-09-01T14:00:00Z");
    const plans = planExits([snap({ expiry: "2026-09-02", now })]);
    expect(plans[0].reason).toBe("EXIT_EXPIRY");
  });

  it("EXIT_WRONG_SIDE when holding a call into RSI 75", () => {
    const plans = planExits([snap({ rsi: 75, unrealizedPnlPercent: -5 })]);
    expect(plans[0].reason).toBe("EXIT_WRONG_SIDE");
  });

  it("collapses redundant NVDA strikes to the best living expression", () => {
    const kept = snap({
      symbol: "NVDA260911C00230000",
      currentPrice: 1.41,
      unrealizedPnlPercent: 9,
      currentConviction: 44,
      delta: 0.35,
    });
    const lotto = snap({
      symbol: "NVDA260909C00245000",
      currentPrice: 0.14,
      bid: 0.13,
      unrealizedPnlPercent: -24,
      currentConviction: 40,
      delta: 0.08,
    });
    const otm = snap({
      symbol: "NVDA260911C00245000",
      currentPrice: 0.15,
      unrealizedPnlPercent: -18,
      currentConviction: 41,
      delta: 0.11,
    });
    const plans = planExits([kept, lotto, otm]);
    const bySymbol = Object.fromEntries(plans.map((p) => [p.symbol, p]));
    expect(bySymbol[kept.symbol].action).toBe("HOLD");
    expect(bySymbol[lotto.symbol].reason).toBe("EXIT_REDUNDANT");
    expect(bySymbol[otm.symbol].reason).toBe("EXIT_REDUNDANT");
  });

  it("dead marks beat redundant — the $0 contract is EXIT_DEAD, not HOLD", () => {
    const dead = snap({
      symbol: "NVDA260909C00245000",
      currentPrice: 0,
      bid: 0,
      unrealizedPnlPercent: -100,
    });
    const living = snap({ symbol: "NVDA260911C00230000" });
    const plans = planExits([dead, living]);
    expect(plans.find((p) => p.symbol === dead.symbol)?.reason).toBe("EXIT_DEAD");
    expect(plans.find((p) => p.symbol === living.symbol)?.action).toBe("HOLD");
  });
});

describe("underlierCostUsd", () => {
  it("counts cost basis so a decaying mark cannot free concentration room", () => {
    const cost = underlierCostUsd(
      [
        {
          symbol: "NVDA260909C00245000",
          quantity: 142,
          avgEntryPrice: 0.134,
          valueUsd: 0,
          metadata: { underlyingSymbol: "NVDA", multiplier: 100 },
        },
      ],
      "NVDA",
    );
    expect(cost).toBeGreaterThan(1800);
    expect(cost).toBeCloseTo(142 * 0.134 * 100, 0);
  });
});

describe("snapshotFromPosition", () => {
  it("recomputes P&L from the current mark", () => {
    const pos = makeHeld({ quantity: 10, avgEntryPrice: 2, multiplier: 100 });
    const s = snapshotFromPosition(pos, {
      currentPrice: 1,
      bid: 0.95,
      currentConviction: 40,
      rsi: 50,
      delta: 0.3,
      now: Date.now(),
    });
    expect(s.unrealizedPnlPercent).toBeCloseTo(-50, 5);
  });
});
