/**
 * Exit-path and fail-closed tests for the cycle runner (LIVE mode).
 *
 * Regression focus (Bug: basis-denominated exits): `twak swap --usd` sells
 * dollars at the CURRENT price, but positions record their USD cost basis.
 * A "full" exit sized at basis on a 2.5x winner sold only 40% of the tokens,
 * dropped the position from the ledger (stranding the rest untracked), and
 * recorded ~$0 P&L. Exits must be denominated in current market value and
 * P&L measured against the cost basis of the slice sold.
 *
 * AGENT_MODE is forced to "live" via the config mock so closePosition takes
 * the real execution path (getBalance + executeSwap) instead of the
 * simulator branch. All executor calls are mocked.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/config.js")>();
  return { ...actual, AGENT_MODE: "live" };
});

vi.mock("../lib/telegram.js", () => ({
  sendErrorAlert: vi.fn().mockResolvedValue(undefined),
  sendExitAlert: vi.fn().mockResolvedValue(undefined),
  sendGuardrailBlocked: vi.fn().mockResolvedValue(undefined),
}));

import { state } from "../lib/agent-state.js";
import * as dataProviders from "../lib/data-providers.js";
import { twakExecutor } from "../lib/twak-executor.js";
import { openPosition } from "../lib/conviction-signal.js";
import {
  manageOpenPositions,
  createTradeProposals,
  checkTradeGuardrails,
  executeTrades,
} from "../lib/cycle-runner.js";

function setMarketPrice(symbol: string, price: number): void {
  state.marketData = {
    globalMetrics: null,
    derivatives: null,
    tokenPrices: [
      {
        id: 1,
        name: symbol,
        symbol,
        slug: symbol.toLowerCase(),
        price,
        volume24h: 50_000_000,
        marketCap: 500_000_000,
        percentChange1h: 0,
        percentChange24h: -3,
        percentChange7d: -25,
        lastUpdated: "",
      },
    ],
    tokenHolders: [],
    trendingNarratives: [],
  } as any;
}

function resetState(): void {
  state.cycle = 1;
  state.status = "running";
  state.totalTrades = 0;
  state.totalVolumeUsd = 0;
  state.totalGasSpentUsd = 0;
  state.realizedPnlUsd = 0;
  state.tradeStats = {
    entriesCount: 0,
    exitsCount: 0,
    winningExitsCount: 0,
    losingExitsCount: 0,
    totalWinsUsd: 0,
    totalLossesUsd: 0,
    largestWinUsd: 0,
    largestLossUsd: 0,
  };
  state.errors = [];
  state.marketData = null;
  state.portfolio = null;
  state.executedTrades = [];
  state.guardrailResults = [];
  state.heldPositions = [];
  state.positionVerdicts = [];
  state.convictionSignals = [];
  state.marketRegime = null;
  state.macroPause = null;
}

describe("closePosition — exits denominated in current market value (live)", () => {
  beforeEach(() => {
    resetState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a 2.5x winner full exit sells the full market value and records the full positive pnl", async () => {
    // Entry $10 at $1.00; now $2.50 → position worth $25. Peak $3.60 with the
    // partial already taken → trailing stop fires a FULL exit (sellFraction 1).
    const pos = openPosition({ symbol: "TWT", entryPriceUsd: 1.0, amountUsd: 10, cycle: 1 });
    pos.partialProfitTaken = true;
    pos.peakPriceUsd = 3.6;
    state.heldPositions = [pos];
    setMarketPrice("TWT", 2.5);

    // Live wallet confirms the position is worth $25 on-chain.
    vi.spyOn(twakExecutor, "getBalance").mockResolvedValue({
      token: "TWT",
      symbol: "TWT",
      balance: "10",
      valueUsd: 25,
      chain: "bsc",
    } as any);
    const swapSpy = vi.spyOn(twakExecutor, "executeSwap").mockResolvedValue({
      success: true,
      txHash: "0xEXIT_WINNER",
      tokenIn: "TWT",
      tokenOut: "BNB",
      amountIn: "25.00",
      amountOut: "24.60",
      feeUsd: 0.3,
      timestamp: Date.now(),
    } as any);

    await manageOpenPositions();

    // The swap must sell $25 of current value — NOT the $10 cost basis.
    expect(swapSpy).toHaveBeenCalledTimes(1);
    expect(swapSpy.mock.calls[0][0].amountIn).toBe("25.00");
    expect(swapSpy.mock.calls[0][0].tokenIn).toBe("TWT");
    expect(swapSpy.mock.calls[0][0].tokenOut).toBe("BNB");

    // Position fully closed, and P&L = proceeds − cost basis ≈ +$14.60,
    // not ≈ $0 (the old basis-vs-basis bug).
    expect(state.heldPositions).toHaveLength(0);
    expect(state.realizedPnlUsd).toBeCloseTo(24.6 - 10, 5);
    expect(state.tradeStats.winningExitsCount).toBe(1);
    expect(state.tradeStats.totalWinsUsd).toBeCloseTo(14.6, 5);
  });

  it("a partial exit sells 33% of current value and reduces the COST BASIS by 33%", async () => {
    // Entry $10 at $1.00; now $1.60 (+60%) → worth $16. Partial fires: sell
    // 33% of $16 = $5.28; the basis drops by 33% of $10 = $3.30.
    const pos = openPosition({ symbol: "TWT", entryPriceUsd: 1.0, amountUsd: 10, cycle: 1 });
    state.heldPositions = [pos];
    setMarketPrice("TWT", 1.6);

    vi.spyOn(twakExecutor, "getBalance").mockResolvedValue({
      token: "TWT",
      symbol: "TWT",
      balance: "10",
      valueUsd: 16,
      chain: "bsc",
    } as any);
    const swapSpy = vi.spyOn(twakExecutor, "executeSwap").mockResolvedValue({
      success: true,
      txHash: "0xEXIT_PARTIAL",
      tokenIn: "TWT",
      tokenOut: "BNB",
      amountIn: "5.28",
      amountOut: "5.28",
      feeUsd: 0.3,
      timestamp: Date.now(),
    } as any);

    await manageOpenPositions();

    expect(swapSpy).toHaveBeenCalledTimes(1);
    expect(swapSpy.mock.calls[0][0].amountIn).toBe("5.28");

    // Remainder keeps riding with the basis reduced by the fraction sold —
    // NOT by the sell proceeds (which would understate the remaining stake).
    expect(state.heldPositions).toHaveLength(1);
    expect(state.heldPositions[0].partialProfitTaken).toBe(true);
    expect(state.heldPositions[0].amountUsd).toBeCloseTo(6.7, 5);
    // P&L on the slice: $5.28 proceeds − $3.30 basis sold ≈ +$1.98.
    expect(state.realizedPnlUsd).toBeCloseTo(5.28 - 3.3, 5);
  });
});

describe("guardrails fail CLOSED when portfolio data is missing", () => {
  beforeEach(() => {
    resetState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("checkTradeGuardrails rejects every proposal when state.portfolio is null", async () => {
    state.portfolio = null;
    const proposals = [{ tokenSymbol: "TWT", convictionScore: 85, amountInUsd: 10 }];

    const { passed, rejected } = await checkTradeGuardrails(proposals);

    expect(passed).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatch(/fail closed/i);
  });

  it("createTradeProposals skips all new entries when state.portfolio is null", async () => {
    state.portfolio = null;
    setMarketPrice("TWT", 1.0);
    state.convictionSignals = [];

    const proposals = await createTradeProposals();

    expect(proposals).toHaveLength(0);
  });
});

describe("executeTrades — buys require a known entry price", () => {
  beforeEach(() => {
    resetState();
    vi.spyOn(dataProviders.sosovalueClient, "fetchMacroEvents").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips a buy (before spending BNB) when the price map has no entry price", async () => {
    state.portfolio = {
      totalValueUsd: 1000,
      positions: [{ token: "BNB", symbol: "BNB", balance: "1.5", valueUsd: 900, chain: "bsc" }],
      chains: ["bsc"],
      lastUpdated: Date.now(),
    } as any;
    // Market data covers TWT only — FET has no price this cycle.
    setMarketPrice("TWT", 1.0);
    vi.spyOn(twakExecutor, "getBalance").mockResolvedValue({
      token: "BNB",
      symbol: "BNB",
      balance: "1.5",
      valueUsd: 900,
      chain: "bsc",
    } as any);
    const swapSpy = vi.spyOn(twakExecutor, "executeSwap");

    const results = await executeTrades([
      { tokenSymbol: "FET", convictionScore: 80, amountInUsd: 10 },
    ]);

    // No swap executed, no orphaned holding, no phantom ledger entry.
    expect(swapSpy).not.toHaveBeenCalled();
    expect(results).toHaveLength(0);
    expect(state.heldPositions).toHaveLength(0);
  });
});
