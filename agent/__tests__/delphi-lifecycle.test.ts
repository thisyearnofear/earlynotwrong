/**
 * Tests for Delphi position lifecycle (redeem/liquidate sweep) and the
 * sizing math the runner applies before each entry.
 */

import { describe, it, expect } from "vitest";
import { groupOutcomesByMarket, redeemAndLiquidate } from "../lib/delphi/lifecycle.js";
import { perTradeBudget, sizeSharesBudget } from "../lib/delphi/probability.js";
import { DelphiExecutor, type DelphiClientLike, type DelphiPosition } from "../lib/delphi/executor.js";

const T = 10n ** 6n;      // 1 TST, 6-dec — the real competition-token unit
const SHARE = 10n ** 18n; // 1 outcome share, 18-dec — what the gateway sizes

function baseClient(overrides: Partial<DelphiClientLike>): DelphiClientLike {
  return {
    health: async () => ({ status: "ok" }),
    listMarkets: async () => ({ markets: [] }),
    getMarket: async () => { throw new Error("unused"); },
    quoteBuy: async () => ({ tokensIn: 0n }),
    buyShares: async () => ({ transactionHash: "0x" }),
    redeemPositions: async () => ({ results: [], totalTokensOut: 0n }),
    getSigner: async () => ({ address: "0xW" }),
    getErc20Balance: async () => 0n,
    ensureTokenApproval: async () => ({ approvalNeeded: false, allowance: 0n }),
    listPositions: async () => ({ positions: [] }),
    liquidate: async () => ({ transactionHash: "0x" }),
    ...overrides,
  };
}

function pos(market: string, outcomeIdx: string, status: DelphiPosition["marketStatus"]): DelphiPosition {
  return { marketProxy: market, outcomeIdx, shares: "1000", marketStatus: status, redeemedOrLiquidated: false };
}

describe("groupOutcomesByMarket", () => {
  it("groups outcome indices per market, sorted and deduped", () => {
    const grouped = groupOutcomesByMarket([
      pos("0xA", "1", "expired"),
      pos("0xA", "0", "failed"),
      pos("0xA", "1", "expired"),
      pos("0xB", "0", "expired"),
    ]);
    expect(grouped.get("0xA")).toEqual([0, 1]);
    expect(grouped.get("0xB")).toEqual([0]);
  });

  it("skips positions with non-numeric outcome indices", () => {
    const grouped = groupOutcomesByMarket([
      { ...pos("0xA", "x", "expired") },
      pos("0xA", "0", "expired"),
    ]);
    expect(grouped.get("0xA")).toEqual([0]);
  });
});

describe("redeemAndLiquidate", () => {
  it("moves settled → redeem and expired/failed → liquidate", async () => {
    const liquidated: Array<{ marketAddress: string; outcomeIndices: number[] }> = [];
    const client = baseClient({
      listPositions: async () => ({
        positions: [
          pos("0xSettled", "0", "settled"),
          pos("0xExpired", "0", "expired"),
          pos("0xExpired", "1", "expired"),
          pos("0xOpen", "0", "open"),
        ],
      }),
      liquidate: async (p) => {
        liquidated.push(p);
        return { transactionHash: "0xL" };
      },
      redeemPositions: async ({ marketAddresses }) => ({
        results: marketAddresses.map((m) => ({ marketAddress: m, success: true, tokensOut: 5n * T })),
        totalTokensOut: 5n * T * BigInt(marketAddresses.length),
      }),
    });
    const executor = new DelphiExecutor({ apiKey: "k", retry: { maxRetries: 0 }, clientFactory: async () => client });
    const result = await redeemAndLiquidate(executor);

    expect(result.redeemAttempted).toBe(1);
    expect(result.redeemSucceeded).toBe(1);
    expect(result.liquidateAttempted).toBe(1);
    expect(result.liquidateSucceeded).toBe(1);
    expect(result.stillOpen).toBe(1);
    expect(liquidated).toEqual([{ marketAddress: "0xExpired", outcomeIndices: [0, 1] }]);
    expect(result.events.filter((e) => e.kind === "liquidate" && e.success)).toHaveLength(1);
  });

  it("captures a failed redemption without aborting the sweep", async () => {
    const client = baseClient({
      listPositions: async () => ({ positions: [pos("0xOk", "0", "settled"), pos("0xBad", "0", "settled")] }),
      redeemPositions: async ({ marketAddresses }) => ({
        results: marketAddresses.map((m) =>
          m === "0xOk"
            ? { marketAddress: m, success: true, tokensOut: T }
            : { marketAddress: m, success: false, error: "revert" },
        ),
        totalTokensOut: T,
      }),
    });
    const executor = new DelphiExecutor({ apiKey: "k", retry: { maxRetries: 0 }, clientFactory: async () => client });
    const result = await redeemAndLiquidate(executor);
    expect(result.redeemSucceeded).toBe(1);
    const failed = result.events.find((e) => !e.success);
    expect(failed?.marketAddress).toBe("0xBad");
    expect(failed?.error).toBe("revert");
  });

  it("liquidation failure is captured per-market", async () => {
    const client = baseClient({
      listPositions: async () => ({ positions: [pos("0xE", "0", "expired")] }),
      liquidate: async () => { throw new Error("gas"); },
    });
    const executor = new DelphiExecutor({ apiKey: "k", retry: { maxRetries: 0 }, clientFactory: async () => client });
    const result = await redeemAndLiquidate(executor);
    expect(result.liquidateAttempted).toBe(1);
    expect(result.liquidateSucceeded).toBe(0);
    expect(result.events[0].error).toBe("gas");
  });

  it("is a no-op in simulator mode", async () => {
    const executor = new DelphiExecutor({ apiKey: "" });
    const result = await redeemAndLiquidate(executor);
    expect(result.events).toHaveLength(0);
  });
});

describe("sizeSharesBudget", () => {
  it("budget / price → 18-dec shares, bridged across the 6-dec token", () => {
    // 0.4 TST budget at 0.40 price → exactly 1 share (1e18 raw).
    expect(sizeSharesBudget((4n * T) / 10n, 0.4)).toBe(SHARE);
  });
  it("matches the production incident math: 100 TST at 0.313", () => {
    // 100 TST / 0.313 ≈ 319.49 shares. Pre-fix this returned 0n (the unit
    // skew made every buy round down to nothing) — that is what kept 25
    // funded cycles from placing a single trade.
    const shares = sizeSharesBudget(100n * T, 0.313);
    expect(shares).toBeGreaterThan(319n * SHARE);
    expect(shares).toBeLessThanOrEqual(320n * SHARE);
  });
  it("returns 0 for out-of-bounds price", () => {
    expect(sizeSharesBudget(T, 1.0)).toBe(0n);
    expect(sizeSharesBudget(T, 0)).toBe(0n);
  });
  it("returns 0 for a zero budget", () => {
    expect(sizeSharesBudget(0n, 0.5)).toBe(0n);
  });
});

describe("perTradeBudget — concentration caps", () => {
  const caps = { maxPositionFraction: 0.1, maxMarketFraction: 0.25 };
  it("caps a single position at maxPositionFraction*bankroll", () => {
    const budget = perTradeBudget({
      bankrollTokens: 1000n * T,
      existingExposureTokens: 0n,
      marketExposureTokens: 0n,
      ...caps,
    });
    expect(budget).toBe(100n * T);
  });
  it("caps a market at maxMarketFraction*bankroll minus existing market exposure", () => {
    const budget = perTradeBudget({
      bankrollTokens: 1000n * T,
      existingExposureTokens: 200n * T, // same market below
      marketExposureTokens: 200n * T,
      maxPositionFraction: 1.0, // make position cap loose so market governs
      maxMarketFraction: 0.25,
    });
    expect(budget).toBe(50n * T);
  });
  it("never exceeds remaining unexposed bankroll", () => {
    const budget = perTradeBudget({
      bankrollTokens: 1000n * T,
      existingExposureTokens: 800n * T,
      marketExposureTokens: 0n,
      maxPositionFraction: 0.5, // loose
      maxMarketFraction: 1.0,  // loose
    });
    expect(budget).toBe(200n * T);
  });
  it("never returns a negative budget", () => {
    const budget = perTradeBudget({
      bankrollTokens: 100n * T,
      existingExposureTokens: 150n * T,
      marketExposureTokens: 150n * T,
      ...caps,
    });
    expect(budget).toBe(0n);
  });
  it("zero bankroll → zero budget", () => {
    expect(perTradeBudget({ bankrollTokens: 0n, existingExposureTokens: 0n, marketExposureTokens: 0n, ...caps })).toBe(0n);
  });
});
