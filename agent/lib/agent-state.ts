/**
 * Agent State — shared mutable state for the Early, Not Wrong trading agent.
 *
 * Extracted from agent/index.ts to break the monolith into composable modules.
 * Imported by both index.ts (entry point, orchestrator) and cycle-runner.ts
 * (step functions).
 */

import type {
  LedgerEntry,
  LedgerPosition,
  BehavioralMetrics,
  Subject,
} from "conviction-core";
import type { CmcMarketData } from "./data-providers.js";
import type { SwapResult, TwakPortfolio } from "./twak-executor.js";
import type { GuardrailResult } from "./risk-guardrails.js";
import type {
  ConvictionSignal,
  HeldPosition,
  MarketRegime,
  PositionVerdict,
} from "./conviction-signal.js";
import type { AnchorResult } from "./anchors/index.js";
import type { MarketNarrative } from "./market-narrative.js";
import type { MacroPauseSignal } from "./sosovalue-signals.js";
import type { CycleExecutionSnapshot } from "./cycle-execution.js";
import type { JuryDeliberation } from "./llm-jury.js";
import type { CasperEcosystemContext } from "./casper-mcp-client.js";
import { emptyCycleExecution } from "./cycle-execution.js";
import { AGENT_CONFIG } from "./config.js";

// =============================================================================
// Shared Type Definitions
// =============================================================================

/** Alias to the shared ledger entry type. */
export type TokenTransaction = LedgerEntry;

/** Alias to the shared ledger position type. */
export type TokenPosition = LedgerPosition;

/** Alias to the shared behavioral metrics type. */
export type ReputationMetrics = BehavioralMetrics;

/** A prepared trade ready for execution. */
export interface TradeExecution {
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  minAmountOut: number;
  slippageBps: number;
  timestamp: number;
}

/** Snapshot of the full portfolio at a point in time. */
export interface PortfolioState {
  totalValueUsd: number;
  positions: PortfolioPosition[];
  drawdownPercent: number;
  peakValueUsd: number;
}

/** A single position within a portfolio snapshot. */
export interface PortfolioPosition {
  tokenSymbol: string;
  tokenAddress: string;
  amount: number;
  valueUsd: number;
  percentOfPortfolio: number;
}

/** Risk guardrail configuration for the trading engine. */
export interface RiskGuardrails {
  maxDrawdownPercent: number;
  maxPerTradeUsd: number;
  maxDailyTrades: number;
  maxPositionConcentrationPercent: number;
  minConvictionScore: number;
  tokenAllowlist: string[];
}

/**
 * Generic data provider interface. Both CmcClient and SosovalueClient
 * implement this so the conviction engine can swap providers transparently.
 */
export interface MarketDataProvider {
  name: "cmc" | "helius" | "birdeye" | "sosovalue";
  fetchTokenPrice(address: string): Promise<number>;
  fetchFearGreedIndex(): Promise<number>;
  fetchFundingRates(): Promise<Record<string, number>>;
}

/** Aggregate trade performance statistics. */
export interface TradeStats {
  entriesCount: number;
  exitsCount: number;
  winningExitsCount: number;
  losingExitsCount: number;
  totalWinsUsd: number;
  totalLossesUsd: number;
  largestWinUsd: number;
  largestLossUsd: number;
}

/** Serializable state published via the MCP server. */
export interface AgentState {
  cycle: number;
  status: "idle" | "running" | "paused" | "error";
  lastRunAt: number | null;
  nextRunAt: number | null;
  totalTrades: number;
  totalVolumeUsd: number;
  currentDrawdown: number;
  peakValueUsd: number;
  errors: string[];
}

// =============================================================================
// Constants
// =============================================================================

/** Gas cost estimate per BSC swap (~$1.50 at current gas prices). */
export const GAS_BUFFER_USD = 1.5;

// =============================================================================
// Agent State
// =============================================================================

export const state = {
  cycle: 0,
  status: "idle" as "idle" | "running" | "paused" | "error",
  lastRunAt: null as number | null,
  nextRunAt: null as number | null,
  totalTrades: 0,
  totalVolumeUsd: 0,
  totalGasSpentUsd: 0,
  realizedPnlUsd: 0,
  tradeStats: {
    entriesCount: 0,
    exitsCount: 0,
    winningExitsCount: 0,
    losingExitsCount: 0,
    totalWinsUsd: 0,
    totalLossesUsd: 0,
    largestWinUsd: 0,
    largestLossUsd: 0,
  } as TradeStats,
  errors: [] as string[],

  // Cached market data for this cycle
  marketData: null as CmcMarketData | null,
  portfolio: null as TwakPortfolio | null,

  // Cycle results
  guardrailResults: [] as GuardrailResult[],
  executedTrades: [] as SwapResult[],
  marketRegime: null as MarketRegime | null,
  convictionSignals: [] as ConvictionSignal[],
  positionVerdicts: [] as PositionVerdict[],
  heldPositions: [] as HeldPosition[],
  regimeScore: null as number | null,
  sentimentLabel: null as string | null,
  lastAnchoredHash: null as string | null,
  // Last thesis hash that was (or would have been) anchored. Used to skip
  // redundant on-chain anchors when the conviction thesis hasn't changed.
  lastAnchoredThesisHash: null as string | null,
  anchoring: null as {
    hash: string;
    mode: "on-chain" | "reverted" | "off-chain" | "simulator" | "cached";
    blockNumber?: number;
    gasUsed?: string;
  } | null,
  narrative: null as MarketNarrative | null,
  macroPause: null as MacroPauseSignal | null,
  /** LLM conviction jury deliberation for the current cycle (7th factor). */
  llmDeliberation: null as JuryDeliberation | null,
  /** Casper ecosystem context fetched via MCP (CSPR.trade + blockchain MCP). */
  casperEcosystemContext: null as CasperEcosystemContext | null,
  anchorResults: [] as AnchorResult[],
  /** Self-analysis behavioral metrics, computed after each cycle's exits. */
  behavioralMetrics: null as BehavioralMetrics | null,
  /** Canonical ledger of all agent entries and exits for self-analysis. */
  ledger: [] as LedgerEntry[],
  /** In-progress execution ledger for the current cycle (signals-live/v1.2). */
  cycleExecutionDraft: emptyCycleExecution(0),
  /** Finalized execution snapshot from the last completed cycle step. */
  lastCycleExecution: null as CycleExecutionSnapshot | null,
};

// =============================================================================
// Helper Maps (mutable, shared across cycles)
// =============================================================================

/**
 * Track consecutive concentration-limit guardrail rejections per token.
 * Used for adaptive sizing: each rejection reduces the proposed trade size
 * by 20% so the next cycle's proposal is more likely to pass.
 */
export const concentrationRejectionCount = new Map<string, number>();

/**
 * Per-token cooldown for tokens that fail the harvest ladder. Prevents
 * the same broken token from being tried every cycle.
 */
export const unharvestableTokens = new Map<string, number>();

/**
 * Symbols that have been permanently marked as stuck/unexitable (e.g., honeypots
 * or broken tax tokens). Prevents re-entry and stops exit retries.
 */
export const stuckSymbols = new Set<string>();

export function tickUnharvestableCooldowns(): void {
  for (const [sym, count] of unharvestableTokens.entries()) {
    if (count <= 1) unharvestableTokens.delete(sym);
    else unharvestableTokens.set(sym, count - 1);
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Pull the live BNB USD value out of the cycle's TWAK portfolio snapshot.
 */
export function getBnbUsd(portfolio: TwakPortfolio | null): number {
  if (!portfolio) return 0;
  const bnb = portfolio.positions.find(
    (p) => p.symbol?.toUpperCase() === "BNB" || p.token?.toUpperCase() === "BNB"
  );
  return bnb?.valueUsd ?? 0;
}

/**
 * Conservative size cap for a single trade, derived from BNB availability.
 */
export function computeBankrollCap(bnbUsd: number): {
  tradeableBnb: number;
  maxByBnb: number;
  canTrade: boolean;
  reason?: string;
} {
  const cfg = AGENT_CONFIG.trading.bankroll;
  const tradeableBnb = Math.max(0, bnbUsd - cfg.minBnbReserveUsd);
  const maxByBnb = tradeableBnb * cfg.maxTradeFractionOfBnb;

  if (bnbUsd < cfg.entrySkipBelowBnbUsd) {
    return {
      tradeableBnb,
      maxByBnb,
      canTrade: false,
      reason: `BNB ($${bnbUsd.toFixed(2)}) below entry floor ($${cfg.entrySkipBelowBnbUsd}) — focus on harvest + exits`,
    };
  }
  if (maxByBnb < 0.5) {
    return {
      tradeableBnb,
      maxByBnb,
      canTrade: false,
      reason: `Tradeable BNB ($${maxByBnb.toFixed(2)}) below minimum trade size — defer`,
    };
  }

  return { tradeableBnb, maxByBnb, canTrade: true };
}

/**
 * Build a SYMBOL → current USD price map from this cycle's market data.
 */
export function buildPriceMap(): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of state.marketData?.tokenPrices ?? []) {
    if (t.price > 0) map.set(t.symbol.toUpperCase(), t.price);
  }
  return map;
}
