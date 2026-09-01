/**
 * Options Domain State
 *
 * Separate state container for the options cycle so it can run in parallel
 * with the crypto agent without conflicting on shared state fields.
 *
 * The harness loop uses this module's state for all options-domain operations.
 * The crypto agent uses `agent-state.ts`. They share the same loop, LLM
 * ladder, jury, verification, self-analysis, and anchoring — but each has
 * its own portfolio, positions, trades, and conviction signals.
 */

import type {
  Kline,
  MarketSignal,
  ConvictionResult,
  AdapterPosition,
  Portfolio as HarnessPortfolio,
  RiskCheck,
  TradeResult,
  SignalWithScore,
} from "./adapters/types.js";
import type { AnchorResult } from "./anchors/index.js";
import type { JuryDeliberation } from "./llm-jury.js";
import type { MacroPauseSignal } from "./sosovalue-signals.js";
import type { CasperEcosystemContext } from "./casper-mcp-client.js";
import type { CycleExecutionSnapshot } from "./cycle-execution.js";
import type { CycleObservabilitySnapshot } from "./agent-state.js";
import type { LedgerEntry } from "conviction-core";

// =============================================================================
// Types
// =============================================================================

/** A conviction-scored options entry. */
export interface OptionsSignal {
  signal: MarketSignal;
  conviction: ConvictionResult;
  klines: Kline[];
}

/** An open options position (contract-level). */
export interface OptionsPosition {
  symbol: string;
  contractId: string; // Alpaca order ID or contract symbol
  underlyingSymbol: string;
  contractType: "call" | "put";
  strike: number;
  expiry: string;
  entryPrice: number;
  avgEntryPrice: number;
  quantity: number; // number of contracts
  multiplier: number; // shares per contract (100 for US equity options)
  entryCycle: number;
  /** Epoch ms when the position was first tracked (time-based max-hold). */
  enteredAt: number;
  /** Conviction score at entry — used for the conviction-decay exit. */
  entryConviction: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPercent: number;
  /** High-water unrealized % — reserved for a trailing exit if we re-arm it. */
  peakUnrealizedPercent: number;
  stuck: boolean;
  failedExitAttempts: number;
  ledgerEntry?: LedgerEntry;
}

// =============================================================================
// State
// =============================================================================

export const optionsState = {
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
  },
  errors: [] as string[],
  portfolio: null as HarnessPortfolio | null,
  convictionSignals: [] as OptionsSignal[],
  executedTrades: [] as TradeResult[],
  positionVerdicts: [] as { action: string; reason: string; symbol: string }[],
  heldPositions: [] as OptionsPosition[],
  regimeScore: null as number | null,
  sentimentLabel: null as string | null,
  lastAnchoredHash: null as string | null,
  lastAnchoredThesisHash: null as string | null,
  anchoring: null as AnchorResult[] | null,
  /** OpenTelemetry snapshot from the last completed cycle (matches CycleObservabilitySnapshot). */
  lastCycleObservability: null as {
    cycle: number;
    completedAt: number;
    durationMs: number;
    traceId: string | null;
    spanId: string | null;
    otelEnabled: boolean;
    portfolioUsd: number;
    drawdownPercent: number;
    activePositions: number;
    regimeScore: number | null;
    tradesSucceeded: number;
    tradesFailed: number;
    guardrailsRejected: number;
    anchorOutcomes: Array<{ adapter: string; status: string }>;
    pipelineSteps: Array<{
      id: string;
      label: string;
      durationMs: number;
      status: "ok" | "warn" | "error" | "skipped";
    }>;
  } | null,
  macroPause: null as MacroPauseSignal | null,
  llmDeliberation: null as JuryDeliberation | null,
  casperEcosystemContext: null as CasperEcosystemContext | null,
  anchorResults: [] as AnchorResult[],
  /** Canonical ledger for self-analysis (shared format with crypto agent). */
  ledger: [] as LedgerEntry[],
  /** Per-cycle execution snapshot (signals-live/v1.2). */
  cycleExecutionDraft: {} as CycleExecutionSnapshot,
  /** Ring buffer of last 20 cycle summaries for the dashboard. */
  cycleHistory: [] as Array<{
    cycle: number;
    timestamp: number;
    durationMs: number;
    tradesExecuted: number;
    portfolioValueUsd: number;
    drawdownPercent: number;
    regimeScore: number | null;
  }>,
};
