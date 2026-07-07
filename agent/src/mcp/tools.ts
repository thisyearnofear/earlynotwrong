/**
 * Reputation tool implementations — shared by the MCP server and the CROO
 * CAP adapter.
 *
 * These are pure functions over the AnchorAdapter interface, intentionally
 * decoupled from any transport protocol. The MCP server (`server.ts`) and the
 * CAP handler (`../cap/server.ts`) both call these functions; payment is
 * enforced by each transport's own middleware before the tool runs.
 *
 * The tools read from the SAME adapters the agent writes through — single
 * source of truth across the read and write paths.
 */

import {
  lookupLatestCrossChain,
  lookupSubjectCrossChain,
  type AnchoredRecord,
  type Bytes32Hex,
} from "../../lib/anchors/index.js";
import { MantleAnchorAdapter } from "../../lib/anchors/mantle.js";
import { CasperAnchorAdapter } from "../../lib/anchors/casper.js";
import { AGENT_CONFIG } from "../../lib/config.js";

// Two adapter instances are sufficient — they're stateless wrappers; the
// CasperAnchorAdapter caches reads internally. We don't reach into the
// registry in `lib/anchors/index.ts` because the tools sometimes want a
// specific chain (`get_by_thesis` searches both, returning the first hit).
const mantle = new MantleAnchorAdapter();
const casper = new CasperAnchorAdapter();

const ALL_ADAPTERS = [casper, mantle] as const;

// ─── Tool: get_latest_conviction ─────────────────────────────────────────────
//
// Returns the most recent record across both chains. Cheap and read-only —
// kept in the free tier so any agent / curious developer can confirm the
// service is live before paying.

export interface GetLatestConvictionInput {
  subjectHash: Bytes32Hex;
  preferChain?: "mantle" | "casper";
}

export interface GetLatestConvictionResult {
  subjectHash: Bytes32Hex;
  /** Adapter that produced the result. */
  source: "mantle" | "casper" | "none";
  record: AnchoredRecord | null;
}

export async function getLatestConviction(
  input: GetLatestConvictionInput,
): Promise<GetLatestConvictionResult> {
  const latest = await lookupLatestCrossChain(input.subjectHash);
  // If the caller specified a preferred chain, honor that. Otherwise pick
  // whichever chain has a record (Casper first since it's the buildathon's
  // primary surface).
  const order = input.preferChain
    ? [input.preferChain, input.preferChain === "casper" ? "mantle" : "casper"]
    : ["casper", "mantle"];
  for (const chain of order) {
    const r = latest[chain];
    if (r) return { subjectHash: input.subjectHash, source: chain as "mantle" | "casper", record: r };
  }
  return { subjectHash: input.subjectHash, source: "none", record: null };
}

// ─── Tool: get_subject_history (PAID) ────────────────────────────────────────
//
// Full chronological history across BOTH chains, sorted by timestamp (Mantle
// records carry block.timestamp; Casper events don't, so we fall back to
// insertion order within each chain).

export interface GetSubjectHistoryInput {
  subjectHash: Bytes32Hex;
}

export interface GetSubjectHistoryResult {
  subjectHash: Bytes32Hex;
  /** Combined chronological list — Mantle records ordered by block timestamp,
   *  Casper records appended in event-log order at the end. */
  records: AnchoredRecord[];
  /** Per-chain split so callers can inspect each side separately. */
  byAdapter: Record<string, AnchoredRecord[]>;
}

export async function getSubjectHistory(
  input: GetSubjectHistoryInput,
): Promise<GetSubjectHistoryResult> {
  const lookup = await lookupSubjectCrossChain(input.subjectHash);
  // Mantle entries first (have real timestamps), then Casper appended.
  // The agent emits Casper anchors immediately after Mantle in each cycle, so
  // log order is a reliable proxy for time.
  const mantleSorted = (lookup.byAdapter.mantle ?? []).slice().sort((a, b) => a.timestamp - b.timestamp);
  const casperOrdered = lookup.byAdapter.casper ?? [];
  return {
    subjectHash: input.subjectHash,
    records: [...mantleSorted, ...casperOrdered],
    byAdapter: lookup.byAdapter,
  };
}

// ─── Tool: get_by_thesis ─────────────────────────────────────────────────────
//
// Point lookup by thesis hash — returns the record from whichever chain it
// lives on. Useful for "did this specific analysis ever get anchored?".

export interface GetByThesisInput {
  thesisHash: Bytes32Hex;
}

export interface GetByThesisResult {
  thesisHash: Bytes32Hex;
  source: "mantle" | "casper" | "none";
  record: AnchoredRecord | null;
}

export async function getByThesis(input: GetByThesisInput): Promise<GetByThesisResult> {
  for (const adapter of ALL_ADAPTERS) {
    try {
      const r = await adapter.getByThesis(input.thesisHash);
      if (r) return { thesisHash: input.thesisHash, source: adapter.name as "mantle" | "casper", record: r };
    } catch {
      // try next adapter
    }
  }
  return { thesisHash: input.thesisHash, source: "none", record: null };
}

// ─── Tool: cross_chain_lookup (PAID) ─────────────────────────────────────────
//
// Side-by-side view of what each chain holds for a subject. The headline value
// proposition of the dual-chain architecture: same hash, two settlement layers,
// independently verifiable.

export interface CrossChainLookupInput {
  subjectHash: Bytes32Hex;
}

export interface CrossChainLookupResult {
  subjectHash: Bytes32Hex;
  chains: {
    mantle: { count: number; latest: AnchoredRecord | null; explorerBase: string };
    casper: { count: number; latest: AnchoredRecord | null; explorerBase: string };
  };
  /** True if both chains hold at least one anchor for this subject. */
  bothChains: boolean;
  /** True if both chains hold the same most-recent thesis hash. */
  inSync: boolean;
}

export async function crossChainLookup(
  input: CrossChainLookupInput,
): Promise<CrossChainLookupResult> {
  const [latest, history] = await Promise.all([
    lookupLatestCrossChain(input.subjectHash),
    lookupSubjectCrossChain(input.subjectHash),
  ]);
  const mantleLatest = latest.mantle ?? null;
  const casperLatest = latest.casper ?? null;
  const bothChains = !!mantleLatest && !!casperLatest;
  const inSync = bothChains && mantleLatest!.thesisHash.toLowerCase() === casperLatest!.thesisHash.toLowerCase();
  return {
    subjectHash: input.subjectHash,
    chains: {
      mantle: {
        count: history.byAdapter.mantle?.length ?? 0,
        latest: mantleLatest,
        explorerBase: `${AGENT_CONFIG.mantle.sepolia.explorerUrl}/address/${AGENT_CONFIG.mantle.sepolia.registryAddress}`,
      },
      casper: {
        count: history.byAdapter.casper?.length ?? 0,
        latest: casperLatest,
        explorerBase: `${AGENT_CONFIG.casper.testnet.explorerUrl}/contract-package/${AGENT_CONFIG.casper.testnet.registryHash || ""}`,
      },
    },
    bothChains,
    inSync,
  };
}

// ─── Tool: get_agent_reputation (PAID) ───────────────────────────────────────
//
// Aggregate score over all anchored records for an agent's subject hash:
// total anchors, mean conviction score, time span, dual-chain presence.
// Designed to be a "should I trust this agent" one-shot for other agents.

export interface GetAgentReputationInput {
  subjectHash: Bytes32Hex;
}

export interface GetAgentReputationResult {
  subjectHash: Bytes32Hex;
  /** Number of anchors total across both chains. */
  totalAnchors: number;
  /** Mean conviction score (0-100) across all anchors. */
  meanConvictionScore: number;
  /** Most recent anchor across both chains, or null if no anchors found. */
  latestAnchor: AnchoredRecord | null;
  /** Is the agent anchoring to both chains (signals operator commitment)? */
  dualChain: boolean;
  /** Distinct archetypes the agent has anchored. */
  archetypes: string[];
}

export async function getAgentReputation(
  input: GetAgentReputationInput,
): Promise<GetAgentReputationResult> {
  const history = await lookupSubjectCrossChain(input.subjectHash);
  const totalAnchors = history.records.length;
  const meanConvictionScore =
    totalAnchors === 0
      ? 0
      : history.records.reduce((s, r) => s + r.convictionScore, 0) / totalAnchors;
  const archetypes = [...new Set(history.records.map((r) => r.archetype))].sort();
  const sortedByTs = [...history.records].sort((a, b) => b.timestamp - a.timestamp);
  const latestAnchor = sortedByTs[0] ?? null;
  const dualChain =
    (history.byAdapter.mantle?.length ?? 0) > 0 &&
    (history.byAdapter.casper?.length ?? 0) > 0;
  return {
    subjectHash: input.subjectHash,
    totalAnchors,
    meanConvictionScore: Math.round(meanConvictionScore * 10) / 10,
    latestAnchor,
    dualChain,
    archetypes,
  };
}
