/**
 * Per-cycle execution ledger for signals-live/v1.2.
 *
 * Records what the agent ranked vs what it actually entered/exited/skipped
 * so paid payloads can show alignment between guidance and live book actions.
 */

import type { ConvictionSignal } from "./conviction-signal.js";
import { state } from "./agent-state.js";

/** Must match LIVE_SIGNALS_TOP_N in agent/src/mcp/tools.ts */
const RANKED_TOP_N = 5;

export type ExecutionSkipStage =
  | "proposal"
  | "guardrail"
  | "macro"
  | "bankroll"
  | "execution"
  | "capacity";

export interface CycleExecutionEntry {
  symbol: string;
  amountUsd: number;
  convictionScore: number;
  success: boolean;
  txHash: string | null;
}

export interface CycleExecutionExit {
  symbol: string;
  action: string;
  amountUsd: number;
  success: boolean;
}

export interface CycleExecutionSkip {
  symbol: string;
  reason: string;
  stage: ExecutionSkipStage;
}

export interface CycleExecutionRankedCandidate {
  rank: number;
  symbol: string;
  score: number;
}

export interface CycleExecutionAlignment {
  topRankedSymbol: string | null;
  topRankedEntered: boolean;
  enteredSymbols: string[];
}

export interface CycleExecutionSnapshot {
  cycle: number;
  rankedCandidates: CycleExecutionRankedCandidate[];
  entries: CycleExecutionEntry[];
  exits: CycleExecutionExit[];
  skips: CycleExecutionSkip[];
  alignment: CycleExecutionAlignment;
}

function emptyAlignment(): CycleExecutionAlignment {
  return {
    topRankedSymbol: null,
    topRankedEntered: false,
    enteredSymbols: [],
  };
}

export function emptyCycleExecution(cycle: number): CycleExecutionSnapshot {
  return {
    cycle,
    rankedCandidates: [],
    entries: [],
    exits: [],
    skips: [],
    alignment: emptyAlignment(),
  };
}

function computeAlignment(
  rankedCandidates: CycleExecutionRankedCandidate[],
  entries: CycleExecutionEntry[],
): CycleExecutionAlignment {
  const topRankedSymbol = rankedCandidates[0]?.symbol ?? null;
  const enteredSymbols = [
    ...new Set(
      entries.filter((e) => e.success).map((e) => e.symbol.toUpperCase()),
    ),
  ];
  const topRankedEntered =
    topRankedSymbol != null &&
    enteredSymbols.includes(topRankedSymbol.toUpperCase());
  return { topRankedSymbol, topRankedEntered, enteredSymbols };
}

export function resetCycleExecution(cycle: number): void {
  state.cycleExecutionDraft = emptyCycleExecution(cycle);
}

export function setRankedCandidates(signals: ConvictionSignal[]): void {
  const ranked = [...signals]
    .sort((a, b) => b.score - a.score)
    .slice(0, RANKED_TOP_N)
    .map((s, i) => ({
      rank: i + 1,
      symbol: s.symbol,
      score: s.score,
    }));
  state.cycleExecutionDraft.rankedCandidates = ranked;
  state.cycleExecutionDraft.alignment = computeAlignment(
    ranked,
    state.cycleExecutionDraft.entries,
  );
}

export function recordExecutionSkip(
  symbol: string,
  reason: string,
  stage: ExecutionSkipStage,
): void {
  state.cycleExecutionDraft.skips.push({ symbol, reason, stage });
}

export function recordExecutionEntry(params: {
  symbol: string;
  amountUsd: number;
  convictionScore: number;
  success: boolean;
  txHash?: string;
}): void {
  state.cycleExecutionDraft.entries.push({
    symbol: params.symbol,
    amountUsd: params.amountUsd,
    convictionScore: params.convictionScore,
    success: params.success,
    txHash: params.txHash ?? null,
  });
  state.cycleExecutionDraft.alignment = computeAlignment(
    state.cycleExecutionDraft.rankedCandidates,
    state.cycleExecutionDraft.entries,
  );
}

export function recordExecutionExit(params: {
  symbol: string;
  action: string;
  amountUsd: number;
  success: boolean;
}): void {
  state.cycleExecutionDraft.exits.push({
    symbol: params.symbol,
    action: params.action,
    amountUsd: params.amountUsd,
    success: params.success,
  });
}

export function finalizeCycleExecution(): CycleExecutionSnapshot {
  const draft = state.cycleExecutionDraft;
  draft.alignment = computeAlignment(draft.rankedCandidates, draft.entries);
  state.lastCycleExecution = { ...draft };
  return state.lastCycleExecution;
}

/** Payload helper — prefer finalized snapshot for the current cycle. */
export function getCycleExecutionForSignals(): CycleExecutionSnapshot {
  const { cycle, cycleExecutionDraft, lastCycleExecution } = state;
  if (lastCycleExecution?.cycle === cycle) {
    return lastCycleExecution;
  }
  if (cycleExecutionDraft.cycle === cycle) {
    return {
      ...cycleExecutionDraft,
      alignment: computeAlignment(
        cycleExecutionDraft.rankedCandidates,
        cycleExecutionDraft.entries,
      ),
    };
  }
  if (lastCycleExecution) {
    return lastCycleExecution;
  }
  return emptyCycleExecution(cycle);
}
