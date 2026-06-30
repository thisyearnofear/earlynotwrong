/**
 * End-to-end cycle integration test.
 *
 * Drives the trading loop through one full pass against mocked clients —
 * fetchMarketData → analyzeConviction → manageOpenPositions →
 * createTradeProposals → checkTradeGuardrails → executeTrades — and asserts
 * the cross-module contract:
 *
 *   - SoSoValue + CMC market data merges into the regime score
 *   - SSI index confirmation is folded into MarketRegime
 *   - News sentiment lands on the conviction breakdown for the right symbol
 *   - A high-conviction, liquid token passes guardrails and is bought
 *   - The held position appears in state.heldPositions with the entry price
 *   - state.totalTrades increments and gas accrues
 *
 * The agent runs in SIMULATOR mode under tests (no TWAK_ACCESS_ID set), so
 * twakExecutor returns synthetic swap results without touching the network.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { state } from "../lib/agent-state.js";
import * as dataProviders from "../lib/data-providers.js";
import { twakExecutor } from "../lib/twak-executor.js";
import { guardrails } from "../lib/risk-guardrails.js";
import {
  fetchMarketData,
  analyzeConviction,
  manageOpenPositions,
  createTradeProposals,
  checkTradeGuardrails,
  executeTrades,
} from "../lib/cycle-runner.js";

/** A liquid, deeply contrarian quote that should pass guardrails. */
const CANDIDATE_QUOTE = {
  id: 1,
  name: "Trust Wallet Token",
  symbol: "TWT",
  slug: "trust-wallet-token",
  price: 1.0,
  volume24h: 50_000_000,
  marketCap: 500_000_000,
  percentChange1h: -0.2,
  percentChange24h: -3,
  percentChange7d: -25,
  lastUpdated: "",
};

const CMC_MARKET_FIXTURE = {
  globalMetrics: {
    totalMarketCapUsd: 2_000_000_000_000,
    btcDominance: 50,
    ethDominance: 17,
    fearGreedIndex: 15,
    totalVolumeUsd: 100_000_000_000,
    lastUpdated: Date.now(),
  },
  derivatives: {
    totalOpenInterestUsd: 0,
    totalVolume24hUsd: 0,
    btcFundingRate: -0.01,
    ethFundingRate: -0.005,
    liquidationData: null,
    lastUpdated: Date.now(),
  },
  tokenPrices: [CANDIDATE_QUOTE],
  tokenHolders: [],
  trendingNarratives: [],
};

const SIMULATOR_PORTFOLIO = {
  totalValueUsd: 1_000,
  positions: [
    { token: "BNB", symbol: "BNB", balance: "1.5", valueUsd: 900, chain: "bsc" },
    { token: "USDC", symbol: "USDC", balance: "100", valueUsd: 100, chain: "bsc" },
  ],
  chains: ["bsc"],
  lastUpdated: Date.now(),
};

function resetState(): void {
  state.cycle = 1;
  state.status = "running";
  state.totalTrades = 0;
  state.totalVolumeUsd = 0;
  state.totalGasSpentUsd = 0;
  state.realizedPnlUsd = 0;
  state.errors = [];
  state.marketData = null;
  state.portfolio = null;
  state.executedTrades = [];
  state.guardrailResults = [];
  state.heldPositions = [];
  state.positionVerdicts = [];
  state.convictionSignals = [];
  state.marketRegime = null;
  state.regimeScore = null;
  state.sentimentLabel = null;
  state.macroPause = null;
}

describe("cycle integration — one full pass under simulator", () => {
  beforeEach(() => {
    resetState();

    // Market data — SoSoValue offline so CMC is the only source.
    vi.spyOn(dataProviders.sosovalueClient, "fetchMarketData").mockResolvedValue({
      globalMetrics: null,
      derivatives: null,
      tokenPrices: [],
      tokenHolders: [],
      trendingNarratives: [],
    });
    vi.spyOn(dataProviders.cmcClient, "fetchMarketData").mockResolvedValue(CMC_MARKET_FIXTURE);

    // SoSoValue augmentations — SSI confirms fear (roi_7d -0.10 = -10%),
    // featured news bullish on TWT via matchedCurrencies tag.
    vi.spyOn(dataProviders.sosovalueClient, "fetchIndexSnapshot").mockResolvedValue({
      roi_7d: -0.10,
    } as any);
    vi.spyOn(dataProviders.sosovalueClient, "fetchHotNews").mockResolvedValue([] as any);
    vi.spyOn(dataProviders.sosovalueClient, "fetchFeaturedNews").mockResolvedValue([
      {
        id: "f1",
        title: "TWT adoption milestone — partnership announced",
        matchedCurrencies: [{ id: "x", fullName: "Trust Wallet Token", name: "TWT" }],
      },
    ] as any);
    vi.spyOn(dataProviders.sosovalueClient, "fetchMacroEvents").mockResolvedValue([]);

    // Twak — simulator returns synthetic results. Force liquidity and balances.
    vi.spyOn(twakExecutor, "getPortfolio").mockResolvedValue(SIMULATOR_PORTFOLIO as any);
    vi.spyOn(twakExecutor, "checkLiquidity").mockResolvedValue(true);
    vi.spyOn(twakExecutor, "getBalance").mockResolvedValue({
      token: "BNB",
      symbol: "BNB",
      balance: "1.5",
      valueUsd: 900,
      chain: "bsc",
    } as any);
    vi.spyOn(twakExecutor, "resolveAddress").mockResolvedValue(null);
    vi.spyOn(twakExecutor, "executeSwap").mockResolvedValue({
      success: true,
      txHash: "0xSIM_TEST_0001",
      tokenIn: "BNB",
      tokenOut: "TWT",
      amountIn: "150",
      amountOut: "150",
      feeUsd: 0.42,
      timestamp: Date.now(),
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("scores regime with SSI confirmation, includes news sentiment in conviction, and lands a held position", async () => {
    state.portfolio = SIMULATOR_PORTFOLIO as any;

    // Step 2: market data
    await fetchMarketData();
    expect(state.marketData?.tokenPrices.length).toBeGreaterThan(0);
    expect(state.marketData?.globalMetrics?.fearGreedIndex).toBe(15);

    // Step 3: regime + conviction (with SSI + news augmentations)
    const { regime, convictionSignals } = await analyzeConviction();

    expect(regime.fearGreedIndex).toBe(15);
    expect(regime.ssiConfirmation).not.toBeNull();
    // SSI index down 10% → confirmation +0.66, FGI=15 → 100 contrarian. Score should be strong.
    expect(regime.score).toBeGreaterThan(70);
    expect(state.marketRegime?.ssiConfirmation).toBe(regime.ssiConfirmation);

    const twtSignal = convictionSignals.find((s) => s.symbol === "TWT");
    expect(twtSignal).toBeDefined();
    // Positive news on a contrarian winner should add to conviction.
    expect(twtSignal!.newsSentiment).toBe(1);
    expect(twtSignal!.breakdown.news).toBeGreaterThan(0);
    // -25% 7d on a fearful regime should clear the 58 conviction floor.
    expect(twtSignal!.score).toBeGreaterThanOrEqual(58);

    // Step 4: no open positions yet → no verdicts
    await manageOpenPositions();
    expect(state.positionVerdicts.length).toBe(0);

    // Step 5: proposals
    const proposals = await createTradeProposals();
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals[0].tokenSymbol).toBe("TWT");

    // Step 6: guardrails
    const { passed, rejected } = await checkTradeGuardrails(proposals);
    expect(passed.length).toBeGreaterThan(0);
    expect(rejected.length).toBe(0);

    // Step 7: execute
    const results = await executeTrades(passed);
    expect(results.length).toBe(passed.length);
    expect(results.every((r) => r.success)).toBe(true);

    // ── Cross-module contract assertions ──
    expect(state.heldPositions.length).toBe(1);
    expect(state.heldPositions[0].symbol).toBe("TWT");
    expect(state.heldPositions[0].entryPriceUsd).toBe(CANDIDATE_QUOTE.price);
    expect(state.totalTrades).toBeGreaterThan(0);
    // Real gas captured from feeUsd, not the $1.50 buffer.
    expect(state.totalGasSpentUsd).toBeCloseTo(0.42, 5);
  });

  it("skips entries entirely when a high-impact macro event is within 4h", async () => {
    state.portfolio = SIMULATOR_PORTFOLIO as any;
    // Real SoSoValue shape: `{date, events: string[]}` per day; impact inferred
    // from event-name keywords. CPI today @ 12 UTC anchor.
    const today = new Date().toISOString().slice(0, 10);
    const nowAtTen = new Date(`${today}T10:00:00Z`);
    vi.setSystemTime(nowAtTen);
    vi.spyOn(dataProviders.sosovalueClient, "fetchMacroEvents").mockResolvedValue([
      { date: today, events: ["US CPI YoY"] },
    ] as any);

    await fetchMarketData();
    await analyzeConviction();
    const proposals = await createTradeProposals();
    const { passed } = await checkTradeGuardrails(proposals);
    const results = await executeTrades(passed);

    expect(results.length).toBe(0);
    expect(state.heldPositions.length).toBe(0);
    expect(state.macroPause?.skipEntries).toBe(true);
    expect(state.macroPause?.triggeringEvent?.name).toContain("CPI");
    vi.useRealTimers();
  });
});
