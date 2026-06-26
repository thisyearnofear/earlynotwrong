/**
 * Anchor adapter registry + orchestrator.
 *
 * The agent calls `anchorAll(record)` once per cycle. We iterate over the
 * adapters enabled in `AGENT_CONFIG.anchoring.adapters`, attempt each in
 * sequence (so a slow chain doesn't starve a fast one of submit time), and
 * return one AnchorResult per adapter — never throwing. The orchestrator is
 * the only entry point the loop needs to know about.
 *
 * Sequential, not parallel, on purpose: anchoring is non-critical to the
 * trading path and we'd rather log clean per-chain timings than race RPCs.
 */

import { AGENT_CONFIG } from "../config.js";
import type { AnchorAdapter, AnchorResult, ConvictionRecord } from "./types.js";
import { MantleAnchorAdapter } from "./mantle.js";
import { CasperAnchorAdapter } from "./casper.js";

const ADAPTER_REGISTRY: Record<string, () => AnchorAdapter> = {
  mantle: () => new MantleAnchorAdapter(),
  casper: () => new CasperAnchorAdapter(),
};

/** Lazily instantiated singletons — config-driven, no boot-time DI needed. */
const adapterInstances = new Map<string, AnchorAdapter>();

function getAdapter(name: string): AnchorAdapter | null {
  const cached = adapterInstances.get(name);
  if (cached) return cached;
  const factory = ADAPTER_REGISTRY[name];
  if (!factory) return null;
  const instance = factory();
  adapterInstances.set(name, instance);
  return instance;
}

/** Names of adapters enabled by config — surfaced for diagnostics + tests. */
export function enabledAdapterNames(): readonly string[] {
  return AGENT_CONFIG.anchoring?.adapters ?? (["mantle"] as const);
}

/**
 * Anchor a single record across every enabled adapter. The orchestrator is
 * the single source of truth for "which chains do we publish to" — callers
 * never decide per-chain.
 */
export async function anchorAll(record: ConvictionRecord): Promise<AnchorResult[]> {
  const results: AnchorResult[] = [];
  for (const name of enabledAdapterNames()) {
    const adapter = getAdapter(name);
    if (!adapter) {
      results.push({ adapter: name, status: "failed", error: `unknown adapter: ${name}` });
      continue;
    }
    if (!adapter.isAvailable()) {
      results.push({ adapter: name, status: "skipped", error: "adapter not configured (missing env)" });
      continue;
    }
    try {
      const result = await adapter.anchor(record);
      results.push(result);
    } catch (err) {
      results.push({
        adapter: name,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

// ─── Cross-chain read orchestration ──────────────────────────────────────────
//
// The MCP server's `cross_chain_lookup` tool — and any future paid read API —
// fans out a query across every enabled adapter. Sequential on purpose:
// per-chain timings stay clean in logs, and one slow RPC doesn't pile up
// parallel sockets on the agent process.

import type { AnchoredRecord, Bytes32Hex as Bytes32HexT } from "./types.js";

export interface CrossChainLookup {
  subjectHash: Bytes32HexT;
  records: AnchoredRecord[];
  byAdapter: Record<string, AnchoredRecord[]>;
}

export async function lookupSubjectCrossChain(subjectHash: Bytes32HexT): Promise<CrossChainLookup> {
  const byAdapter: Record<string, AnchoredRecord[]> = {};
  const all: AnchoredRecord[] = [];
  for (const name of enabledAdapterNames()) {
    const adapter = getAdapter(name);
    if (!adapter) continue;
    try {
      const history = await adapter.getSubjectHistory(subjectHash);
      byAdapter[name] = history;
      all.push(...history);
    } catch {
      byAdapter[name] = [];
    }
  }
  return { subjectHash, records: all, byAdapter };
}

export async function lookupLatestCrossChain(subjectHash: Bytes32HexT): Promise<Record<string, AnchoredRecord | null>> {
  const out: Record<string, AnchoredRecord | null> = {};
  for (const name of enabledAdapterNames()) {
    const adapter = getAdapter(name);
    if (!adapter) { out[name] = null; continue; }
    try {
      out[name] = await adapter.getLatestConviction(subjectHash);
    } catch {
      out[name] = null;
    }
  }
  return out;
}

export type { AnchorAdapter, AnchorResult, AnchoredRecord, ConvictionRecord, Bytes32Hex } from "./types.js";
export { computeSubjectHash, computeThesisHash } from "./hashes.js";
