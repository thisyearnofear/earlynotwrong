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
  computeSubjectHash,
  type AnchoredRecord,
  type Bytes32Hex,
} from "../../lib/anchors/index.js";
import { MantleAnchorAdapter } from "../../lib/anchors/mantle.js";
import { CasperAnchorAdapter } from "../../lib/anchors/casper.js";
import { AGENT_CONFIG, AGENT_MODE } from "../../lib/config.js";
import { getBnbUsd, state as liveAgentState } from "../../lib/agent-state.js";
import type { ConvictionSignal, MarketRegime, SignalWeights } from "../../lib/conviction-signal.js";

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

// ─── Tool: get_agent_reputation (FREE) ───────────────────────────────────────
//
// Aggregate score over all anchored records for an agent's subject hash:
// total anchors, mean conviction score, time span, dual-chain presence.
// Designed to be a "should I trust this agent" one-shot for other agents —
// free, because the trust decision is the gateway to every paid lookup.

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

// ─── Tool: get_live_signals (PAID) ───────────────────────────────────────────
//
// The premium product: the agent's CURRENT-cycle conviction data — market
// regime, top token conviction signals with full factor breakdowns and
// rationale, and macro-pause status. Unlike the anchored-history tools above,
// this reads the live in-process agent state (the same `state` object the
// cycle runner mutates every cycle — the MCP server is mounted on the same
// Hono process, so no IPC needed). Acquired the same way tools.ts acquires
// its adapters: a module-level singleton import.
//
// In simulator mode or before the first cycle completes, the state fields are
// simply null/empty — the tool returns a well-formed response either way.

/** How many top conviction signals a paid call returns. */
const LIVE_SIGNALS_TOP_N = 5;

export interface LiveSignalEntry {
  symbol: string;
  /** 0–100 conviction to OPEN a position. */
  score: number;
  /** Per-factor score breakdown (contrarian, rsi, quality, regime, …). */
  breakdown: ConvictionSignal["breakdown"];
  /** Active factor weights for this regime — included when available. */
  weights?: SignalWeights;
  holderCount?: number | null;
  holderGrowthPercent?: number | null;
  newsSentiment?: number | null;
  /** Human-readable "why" behind the score. */
  rationale: string;
}

/** Legacy v0 core payload — superseded by {@link SignalsLiveV1} for delivery. */
export interface GetLiveSignalsResult {
  /** Cycle metadata — which run produced this data. */
  cycle: number;
  lastRunAt: number | null;
  /** Contrarian market regime: score, label, FGI, fear level, SSI confirmation. */
  regime: MarketRegime | null;
  /** Top conviction signals this cycle, ranked by score descending. */
  signals: LiveSignalEntry[];
  /** Macro event pause state — null when no macro data this cycle. */
  macroPause: {
    clear: boolean;
    skipEntries: boolean;
    sizeMultiplier: number;
    hoursUntilNext: number | null;
    reason: string;
  } | null;
}

export type SettlementRail = "mcp-x402" | "croo-cap";
export type LiveSignalsTool = "get_live_signals" | "signals-live";

/** Current delivery schema version and public JSON Schema URL (CAP Schema deliverables). */
export const SIGNALS_LIVE_SCHEMA = "signals-live/v1.1" as const;
export const SIGNALS_LIVE_SCHEMA_URL =
  "https://earlynotwrong.vercel.app/schemas/signals-live-v1.1.schema.json";

export interface GetLiveSignalsV1Options {
  settlementRail: SettlementRail;
  tool: LiveSignalsTool;
}

export interface SignalsProvenance {
  /** Most recent thesis hash anchored (or cached) this cycle. */
  latestThesisHash: Bytes32Hex | null;
  /** Unix ms when the thesis was last anchored, or last cycle if cached. */
  anchoredAt: number | null;
  /** How the latest thesis was published. */
  anchorMode: "on-chain" | "reverted" | "off-chain" | "simulator" | "cached" | null;
  /** In-process behavioral score from the agent's own trade ledger. */
  behavioral: {
    score: number;
    archetype: string;
    winRate: number;
    totalPositions: number;
    upsideCapture: number;
  } | null;
  /** Cross-chain anchor summary for this agent's subject hash. */
  reputation: {
    totalAnchors: number;
    meanConvictionScore: number;
    dualChain: boolean;
    latestArchetype: string | null;
  };
  /** Verify-on-chain links for auditors and buyer agents. */
  explorerUrls: {
    casper: string | null;
    mantle: string | null;
    dashboard: string;
    mcp: string;
  };
  /** Lightweight operational counters (not P&L marketing). */
  trackRecord: {
    totalTrades: number;
    entries: number;
    exits: number;
    activePositions: number;
  };
}

export type BuyerRecommendedAction = "skip_entries" | "evaluate" | "wait";

export interface BuyerGuidance {
  /** What a hiring agent should do with this payload. */
  recommendedAction: BuyerRecommendedAction;
  /** Plain-language explanation for logs and automation. */
  reason: string;
  /** Highest-ranked symbol when action is evaluate, else null. */
  topCandidate: string | null;
  /** Apply to entry sizing when evaluate is allowed (macro dampening). */
  sizeMultiplier: number;
}

/** @deprecated Alias — use {@link SignalsLiveV1_1}. */
export type SignalsLiveV1 = SignalsLiveV1_1;

export interface SignalsLiveV1_1 {
  schema: typeof SIGNALS_LIVE_SCHEMA;
  generatedAt: string;
  agent: {
    name: "Early, Not Wrong";
    subjectHash: Bytes32Hex;
    mode: "live" | "simulator";
  };
  freshness: {
    cycle: number;
    lastRunAt: number | null;
    nextRunAt: number | null;
    cycleIntervalMs: number;
    stale: boolean;
    staleReason: string | null;
  };
  regime: MarketRegime | null;
  signals: LiveSignalEntry[];
  macroPause: GetLiveSignalsResult["macroPause"];
  /** Trust bundle — on-chain proof + behavioral score + track record. */
  provenance: SignalsProvenance;
  /** Action contract for cold Store buyers / allocator agents. */
  guidance: BuyerGuidance;
  meta: {
    topN: typeof LIVE_SIGNALS_TOP_N;
    settlementRail: SettlementRail;
    tool: LiveSignalsTool;
    schemaUrl: typeof SIGNALS_LIVE_SCHEMA_URL;
  };
}

function resolveCycleIntervalMs(): number {
  const { lastRunAt, nextRunAt } = liveAgentState;
  if (lastRunAt != null && nextRunAt != null && nextRunAt > lastRunAt) {
    return nextRunAt - lastRunAt;
  }
  const baseIntervalMs = AGENT_CONFIG.trading.loopIntervalMinutes * 60 * 1000;
  const cfg = AGENT_CONFIG.trading.bankroll;
  if (cfg.adaptiveInterval) {
    const bnbUsd = getBnbUsd(liveAgentState.portfolio);
    if (bnbUsd > 0 && bnbUsd < cfg.targetBnbUsd) {
      return baseIntervalMs * 2;
    }
  }
  return baseIntervalMs;
}

function buildFreshness(now: number, cycleIntervalMs: number): SignalsLiveV1_1["freshness"] {
  const { cycle, lastRunAt, nextRunAt } = liveAgentState;
  let stale = false;
  let staleReason: string | null = null;
  if (lastRunAt != null) {
    const ageMs = now - lastRunAt;
    if (ageMs > cycleIntervalMs * 1.5) {
      stale = true;
      const ageHours = ageMs / 3_600_000;
      staleReason =
        `Last cycle completed ${ageHours.toFixed(1)}h ago; agent may be degraded or between adaptive intervals`;
    }
  }
  return { cycle, lastRunAt, nextRunAt, cycleIntervalMs, stale, staleReason };
}

function buildProvenance(
  subjectHash: Bytes32Hex,
  reputation: GetAgentReputationResult,
): SignalsProvenance {
  const bm = liveAgentState.behavioralMetrics;
  const anchoring = liveAgentState.anchoring;
  const thesisHash =
    (liveAgentState.lastAnchoredThesisHash ??
      liveAgentState.lastAnchoredHash ??
      anchoring?.hash ??
      null) as Bytes32Hex | null;

  const casperHash = AGENT_CONFIG.casper.testnet.registryHash;
  const mantleAddr = AGENT_CONFIG.mantle.sepolia.registryAddress;

  return {
    latestThesisHash: thesisHash,
    anchoredAt: reputation.latestAnchor?.timestamp ?? liveAgentState.lastRunAt,
    anchorMode: anchoring?.mode ?? null,
    behavioral: bm
      ? {
          score: bm.score,
          archetype: bm.archetype,
          winRate: Math.round(bm.winRate * 10) / 10,
          totalPositions: bm.totalPositions,
          upsideCapture: Math.round(bm.upsideCapture * 10) / 10,
        }
      : null,
    reputation: {
      totalAnchors: reputation.totalAnchors,
      meanConvictionScore: reputation.meanConvictionScore,
      dualChain: reputation.dualChain,
      latestArchetype: reputation.latestAnchor?.archetype ?? null,
    },
    explorerUrls: {
      casper: casperHash
        ? `${AGENT_CONFIG.casper.testnet.explorerUrl}/contract-package/${casperHash}`
        : null,
      mantle: `${AGENT_CONFIG.mantle.sepolia.explorerUrl}/address/${mantleAddr}`,
      dashboard: "https://earlynotwrong.vercel.app/agent",
      mcp: "http://144.202.117.160:31777/mcp",
    },
    trackRecord: {
      totalTrades: liveAgentState.totalTrades,
      entries: liveAgentState.tradeStats.entriesCount,
      exits: liveAgentState.tradeStats.exitsCount,
      activePositions: liveAgentState.heldPositions.filter(
        (p) => !p.stuck,
      ).length,
    },
  };
}

export function buildBuyerGuidance(
  macro: GetLiveSignalsResult["macroPause"],
  signals: LiveSignalEntry[],
  stale: boolean,
): BuyerGuidance {
  const sizeMultiplier = macro?.sizeMultiplier ?? 1;
  if (stale) {
    return {
      recommendedAction: "wait",
      reason: "Signal data is stale; wait for the next agent cycle before acting",
      topCandidate: null,
      sizeMultiplier: 0,
    };
  }
  if (macro?.skipEntries) {
    return {
      recommendedAction: "skip_entries",
      reason: macro.reason,
      topCandidate: signals[0]?.symbol ?? null,
      sizeMultiplier,
    };
  }
  if (signals.length === 0) {
    return {
      recommendedAction: "wait",
      reason: "No conviction candidates ranked this cycle",
      topCandidate: null,
      sizeMultiplier,
    };
  }
  const top = signals[0];
  return {
    recommendedAction: "evaluate",
    reason:
      `Top candidate ${top.symbol} (conviction ${top.score}/100) — apply your sizing and risk rules`,
    topCandidate: top.symbol,
    sizeMultiplier,
  };
}

/** Wrap a v0 core payload in the versioned signals-live/v1.1 envelope. */
export function wrapLiveSignalsV1(
  core: GetLiveSignalsResult,
  options: GetLiveSignalsV1Options,
  extras: { provenance: SignalsProvenance; guidance: BuyerGuidance },
  now = Date.now(),
): SignalsLiveV1_1 {
  const cycleIntervalMs = resolveCycleIntervalMs();
  const freshness = buildFreshness(now, cycleIntervalMs);
  return {
    schema: SIGNALS_LIVE_SCHEMA,
    generatedAt: new Date(now).toISOString(),
    agent: {
      name: "Early, Not Wrong",
      subjectHash: computeSubjectHash("bsc", AGENT_CONFIG.competition.identityRegistry),
      mode: AGENT_MODE,
    },
    freshness,
    regime: core.regime,
    signals: core.signals,
    macroPause: core.macroPause,
    provenance: extras.provenance,
    guidance: extras.guidance,
    meta: {
      topN: LIVE_SIGNALS_TOP_N,
      settlementRail: options.settlementRail,
      tool: options.tool,
      schemaUrl: SIGNALS_LIVE_SCHEMA_URL,
    },
  };
}

export async function getLiveSignals(): Promise<GetLiveSignalsResult> {
  const signals = [...liveAgentState.convictionSignals]
    .sort((a, b) => b.score - a.score)
    .slice(0, LIVE_SIGNALS_TOP_N)
    .map((s) => ({
      symbol: s.symbol,
      score: s.score,
      breakdown: s.breakdown,
      weights: s.weights,
      holderCount: s.holderCount,
      holderGrowthPercent: s.holderGrowthPercent,
      newsSentiment: s.newsSentiment,
      rationale: s.rationale,
    }));
  const macro = liveAgentState.macroPause;
  return {
    cycle: liveAgentState.cycle,
    lastRunAt: liveAgentState.lastRunAt,
    regime: liveAgentState.marketRegime,
    signals,
    macroPause: macro
      ? {
          clear: macro.clear,
          skipEntries: macro.skipEntries,
          sizeMultiplier: macro.sizeMultiplier,
          hoursUntilNext: macro.hoursUntilNext,
          reason: macro.reason,
        }
      : null,
  };
}

/** Premium delivery shape for MCP x402 and CROO CAP signals-live. */
export async function getLiveSignalsV1(
  options: GetLiveSignalsV1Options,
): Promise<SignalsLiveV1_1> {
  const core = await getLiveSignals();
  const subjectHash = computeSubjectHash("bsc", AGENT_CONFIG.competition.identityRegistry);
  const reputation = await getAgentReputation({ subjectHash });
  const cycleIntervalMs = resolveCycleIntervalMs();
  const freshness = buildFreshness(Date.now(), cycleIntervalMs);
  const provenance = buildProvenance(subjectHash, reputation);
  const guidance = buildBuyerGuidance(core.macroPause, core.signals, freshness.stale);
  return wrapLiveSignalsV1(core, options, { provenance, guidance });
}
