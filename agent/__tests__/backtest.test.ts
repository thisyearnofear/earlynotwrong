/**
 * Tests for the backtest harness.
 *
 * Regression focus: positions must be marked to MARKET, not carried at cost
 * basis. The old harness valued every open position at its cost basis and
 * computed sale proceeds from the basis too, so every exit realized exactly
 * −slippage and returns/win-rate/Sharpe were meaningless for all variants.
 */

import { describe, it, expect } from "vitest";
import { runBacktestVariant, type BacktestConfig, type BacktestDay } from "../lib/backtest.js";
import { scoreMarketRegime, type MarketRegime } from "../lib/conviction-signal.js";
import type { TokenQuote } from "../lib/data-providers.js";

function makeQuote(symbol: string, price: number, change7d: number): TokenQuote {
  return {
    id: 0,
    name: symbol,
    symbol: symbol.toUpperCase(),
    slug: symbol.toLowerCase(),
    price,
    volume24h: 25_000_000,
    marketCap: 500_000_000,
    percentChange1h: 0,
    percentChange24h: change7d / 7,
    percentChange7d: change7d,
    lastUpdated: "",
  };
}

function fearRegime(): MarketRegime {
  return scoreMarketRegime(
    {
      fearGreedIndex: 15,
      totalMarketCapUsd: 2_000_000_000_000,
      btcDominance: 50,
      ethDominance: 15,
      totalVolumeUsd: 50_000_000_000,
      lastUpdated: Date.now(),
    } as any,
    {
      totalOpenInterestUsd: 0,
      totalVolume24hUsd: 0,
      btcFundingRate: -0.01,
      ethFundingRate: -0.01,
      liquidationData: null,
      lastUpdated: Date.now(),
    } as any,
  );
}

/** One symbol: dips −20% on day 1 (contrarian entry), then rises ~10%/day. */
function risingPathDays(dayCount: number): BacktestDay[] {
  const msPerDay = 24 * 60 * 60 * 1000;
  const start = new Date("2026-01-01T00:00:00Z").getTime();
  const days: BacktestDay[] = [];
  let price = 1.0;
  for (let i = 0; i < dayCount; i++) {
    const change7d = i === 0 ? -20 : Math.min(50, i * 10);
    days.push({
      date: new Date(start + i * msPerDay).toISOString().slice(0, 10),
      timestamp: start + i * msPerDay,
      quotes: [makeQuote("TWT", price, change7d)],
      regime: fearRegime(),
    });
    price *= 1.1;
  }
  return days;
}

const BASE_CFG: BacktestConfig = {
  startDate: "2026-01-01",
  endDate: "2026-01-12",
  initialBnbUsd: 100,
  initialCashUsd: 0,
  symbols: ["TWT"],
  adaptiveWeights: false,
  honeypotGate: false,
  slippageBps: 100,
  gasUsd: 0.5,
  maxOpenPositions: 3,
  minConvictionScore: 0,
  maxTradeFractionOfBnb: 0.5,
  minBnbReserveUsd: 2.5,
  stopLossPercent: 35,
  partialProfitGainPercent: 50,
  trailingActivationGainPercent: 100,
  trailingStopPercent: 30,
};

describe("runBacktestVariant — marks positions to market", () => {
  it("a rising price path produces a positive strategy return", () => {
    const days = risingPathDays(12);
    const result = runBacktestVariant(days, BASE_CFG, "rising");

    // Entered near $1, price ~2.85x by the end — both the open remainder
    // (valued at market) and the partial exit must show the gain.
    expect(result.totalReturnPercent).toBeGreaterThan(0);
    expect(result.finalValueUsd).toBeGreaterThan(result.initialValueUsd);
  });

  it("exit proceeds are marked to market: the partial exit realizes a gain, not −slippage", () => {
    const days = risingPathDays(12);
    const result = runBacktestVariant(days, BASE_CFG, "rising");

    const partial = result.tradeLog.find((t) => t.type === "exit_partial");
    expect(partial).toBeDefined();
    // Old bug: pnl was always ≈ basis × fraction × (−slippage) < 0.
    expect(partial!.pnlUsd).toBeGreaterThan(0);
  });

  it("a falling price path that stops out realizes a loss", () => {
    const msPerDay = 24 * 60 * 60 * 1000;
    const start = new Date("2026-01-01T00:00:00Z").getTime();
    const days: BacktestDay[] = [];
    let price = 1.0;
    for (let i = 0; i < 6; i++) {
      days.push({
        date: new Date(start + i * msPerDay).toISOString().slice(0, 10),
        timestamp: start + i * msPerDay,
        quotes: [makeQuote("TWT", price, -20)],
        regime: fearRegime(),
      });
      price *= 0.85; // −15%/day → stop (−35%) hits within a few days
    }
    const result = runBacktestVariant(days, BASE_CFG, "falling");

    const stop = result.tradeLog.find((t) => t.type === "exit_stop");
    expect(stop).toBeDefined();
    expect(stop!.pnlUsd).toBeLessThan(0);
    expect(result.totalReturnPercent).toBeLessThan(0);
  });

  it("is deterministic across runs (seeded PRNG, no Math.random)", () => {
    const cfg = { ...BASE_CFG, honeypotGate: true, honeypotRate: 0.5 };
    const a = runBacktestVariant(risingPathDays(12), cfg, "det");
    const b = runBacktestVariant(risingPathDays(12), cfg, "det");
    expect(a.finalValueUsd).toBe(b.finalValueUsd);
    expect(a.trades).toBe(b.trades);
    expect(a.tradeLog).toEqual(b.tradeLog);
  });
});
