/**
 * Delphi on-chain anchoring — the prediction-market analog of the BSC
 * loop's thesis anchor (cycle-runner.ts step 8).
 *
 * Every cycle, the runner produces a set of probability decisions (estimate
 * vs. implied, buy or skip per outcome). This module quantizes those
 * decisions into a stable digest, hashes it with the shared conviction-core
 * scheme, and publishes it through the existing anchor adapters (Mantle +
 * Casper) — same registries, same hash functions, so a consumer reading the
 * chain sees one agent with two trading venues.
 *
 * Quantization (mirrors `computeDeliberationDigest` in llm-jury.ts) absorbs
 * LLM output jitter so the thesis-hash dedup in the runner only re-anchors on
 * a *meaningful* view shift, not every cycle on noise:
 *   - edges bucketed to the nearest 0.05 (the trade gate is 0.08, so a
 *     bucket boundary is never straddled by jitter alone)
 *   - outcomes the forecaster is neutral on (bucket 0) are dropped
 *   - decisions sorted by market + outcome for stable ordering
 */

import { computeSubjectHash, computeThesisHash } from "../anchors/hashes.js";
import type { AnchorResult, Bytes32Hex, ConvictionRecord } from "../anchors/types.js";
import { AGENT_CONFIG } from "../config.js";

// =============================================================================
// Types
// =============================================================================

/** One forecast-vs-price decision the runner made this cycle. */
export interface DelphiDecisionRecord {
  marketAddress: string;
  outcomeIdx: number;
  decision: "buy" | "skip";
  /** Signed edge: estimatedProbability − impliedProbability. */
  edge: number;
}

/** The anchor step's inputs: what the forecaster saw and decided. */
export interface DelphiAnchorInput {
  /** Every gated decision this cycle (buys + informative skips). */
  decisions: DelphiDecisionRecord[];
  /** Number of entries actually executed this cycle. */
  tradesPlaced: number;
  /** Number of markets evaluated this cycle. */
  marketsEvaluated: number;
}

export interface DelphiAnchorOutcome {
  subjectHash: Bytes32Hex;
  thesisHash: Bytes32Hex;
  /** The quantized digest that produced the thesis hash (audit trail). */
  digest: string;
  /** Conviction score in the record: % of evaluated markets with buy signals. */
  convictionScore: number;
  results: AnchorResult[];
}

// =============================================================================
// Digest + hashing
// =============================================================================

/**
 * Bucket an edge to the nearest 0.05. The gate trades at |edge| ≥ 0.08
 * (after slippage), so ±0.02 of LLM jitter stays inside one bucket and the
 * digest only moves on a real view shift.
 */
export function quantizeEdge(edge: number): number {
  return Math.round(edge / 0.05) * 0.05;
}

/**
 * Compact, deterministic digest of the cycle's decisions. Neutral outcomes
 * (quantized edge 0 — the forecaster agrees with the market) are dropped:
 * "no edge here" is not a thesis claim worth anchoring, and dropping them
 * keeps small jitter from moving the hash.
 */
export function computeDelphiDigest(input: DelphiAnchorInput): string {
  // NOTE: input.tradesPlaced is deliberately NOT hashed. The thesis is the
  // forecaster's VIEW (estimates vs implied prices); execution count is a
  // downstream consequence. With the one-thesis-per-market guard, cycle N+1
  // re-derives an identical view but executes 0 trades (position already
  // held) — that must dedupe, not re-anchor (production fix 2026-08-15).
  const compact = {
    m: input.marketsEvaluated,
    d: input.decisions
      .map((d) => ({
        mk: d.marketAddress,
        o: d.outcomeIdx,
        e: Math.round(quantizeEdge(d.edge) * 100) / 100,
        b: d.decision === "buy" ? 1 : 0,
      }))
      .filter((d) => d.e !== 0)
      .sort((a, b) => a.mk.localeCompare(b.mk) || a.o - b.o),
  };
  return JSON.stringify(compact);
}

/** Subject identity for Delphi anchors: the competition gateway contract. */
export function delphiSubjectHash(): Bytes32Hex {
  return computeSubjectHash("delphi", AGENT_CONFIG.delphi.competitionGateway);
}

/** Build the full anchor record from a cycle's decisions. */
export function buildDelphiRecord(input: DelphiAnchorInput): ConvictionRecord & { digest: string } {
  const digest = computeDelphiDigest(input);
  const thesisHash = computeThesisHash({ venue: "delphi", digest });
  // Conviction score = % of evaluated markets that produced at least one buy
  // signal (0–100). A cycle that sees edge everywhere scores high; a cycle
  // that agrees with every market scores low.
  const marketsWithBuy = new Set(
    input.decisions.filter((d) => d.decision === "buy").map((d) => d.marketAddress),
  );
  const convictionScore =
    input.marketsEvaluated > 0
      ? Math.round((marketsWithBuy.size / input.marketsEvaluated) * 100)
      : 0;
  return {
    subjectHash: delphiSubjectHash(),
    thesisHash,
    convictionScore,
    archetype: "DELPHI FORECASTER",
    timestamp: Date.now(),
    digest,
  };
}

// =============================================================================
// Anchor step (called by the runner; failures never break the cycle)
// =============================================================================

/** Anchor function signature — injectable for tests. */
export type DelphiAnchorFn = (record: ConvictionRecord) => Promise<AnchorResult[]>;

/**
 * Default anchor: the shared `anchorAll` orchestrator (Mantle + Casper),
 * lazily imported so the runner's module graph stays light in tests and
 * simulator mode never loads the chain SDKs.
 */
async function defaultAnchor(record: ConvictionRecord): Promise<AnchorResult[]> {
  const { anchorAll } = await import("../anchors/index.js");
  return anchorAll(record);
}

/**
 * Anchor this cycle's thesis, deduped against the last anchored hash.
 *
 * Returns null when the digest is unchanged since the last successful (or
 * attempted) anchor — same spend-saving pattern as the BSC loop's
 * `lastAnchoredThesisHash` dedup.
 */
export async function anchorDelphiCycle(params: {
  input: DelphiAnchorInput;
  lastAnchoredThesisHash: string | null;
  anchor?: DelphiAnchorFn;
}): Promise<{ outcome: DelphiAnchorOutcome | null; deduped: boolean; thesisHash: Bytes32Hex }> {
  const record = buildDelphiRecord(params.input);
  if (params.lastAnchoredThesisHash === record.thesisHash) {
    return { outcome: null, deduped: true, thesisHash: record.thesisHash };
  }
  const anchorFn = params.anchor ?? defaultAnchor;
  let results: AnchorResult[];
  try {
    results = await anchorFn(record);
  } catch (err) {
    // Anchoring is non-critical: log + continue. The cycle's trading stands.
    console.warn(
      `[delphi-anchor] anchor failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    results = [{ adapter: "orchestrator", status: "failed", error: err instanceof Error ? err.message : String(err) }];
  }
  return {
    outcome: {
      subjectHash: record.subjectHash,
      thesisHash: record.thesisHash,
      digest: record.digest,
      convictionScore: record.convictionScore,
      results,
    },
    deduped: false,
    thesisHash: record.thesisHash,
  };
}
