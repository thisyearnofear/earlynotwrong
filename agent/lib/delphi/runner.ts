/**
 * Delphi Runner — standalone prediction-market trading loop.
 *
 * Separate pm2 process from the BSC pipeline (see docs/DELPHI_AGENT_ARENA.md,
 * Phase 3). The loop:
 *
 *   1. Redeem settled markets (cash-out → redeploy)
 *   2. Discover open competition markets
 *   3. Estimate probabilities (LLM jury / injected estimator)
 *   4. Gate trades on edge vs. implied price + slippage + bankroll policy
 *   5. Execute through DelphiExecutor, log to disk, alert on Telegram
 *
 * The runner is deliberately small and boring: shared infrastructure lives
 * in executor.ts (execution), probability.ts (estimation + gate), and the
 * existing persistence/telegram modules. It exits the process when the
 * trading window closes (the competition ends 2026-08-24).
 *
 * Alpha stack (Phase 5):
 *   - Context injection: per-market Exa web briefing (web-search.ts) into
 *     the forecaster prompt — free via the Vercel AI Gateway promo.
 *   - Crypto vol baseline: threshold markets get a computed log-normal
 *     reference probability (vol-baseline.ts) blended into the LLM estimate.
 *   - Sell-into-convergence: open positions are re-priced every cycle and
 *     exited when the market converges to our forecast (or stops against us).
 *
 * State: JSONL trade ledger + a last-cycle snapshot under
 * `AGENT_DATA_DIR/delphi/` so a pm2 restart resumes cleanly.
 */

// Load agent/.env BEFORE any sibling module evaluates. The runner is its own
// pm2 entry point (dist/lib/delphi/runner.js) and does NOT go through
// index.ts — without this, keys that live only in .env (SOSOVALUE_API_KEY,
// VERCEL_AI_GATEWAY_API_KEY) would be invisible to the singletons imported
// below. Must stay the first import.
import "../env-bootstrap.js";

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_CONFIG } from "../config.js";
import { sendDelphiCycleSummary, sendErrorAlert } from "../telegram.js";
import { sosovalueClient } from "../data-providers.js";
import type { AnchorResult } from "../anchors/types.js";
import { DelphiExecutor, withTimeout, type DelphiMarket } from "./executor.js";
import { redeemAndLiquidate } from "./lifecycle.js";
import {
  anchorDelphiCycle,
  type DelphiAnchorFn,
  type DelphiDecisionRecord,
} from "./anchoring.js";
import {
  estimateProbability,
  evaluateProbabilitySignal,
  evaluateConvergenceExit,
  factAuthorityEstimate,
  perTradeBudget,
  quoteSharesForBudget,
  sizeSharesBudget,
  type ForecastProvenance,
  type MarketEstimate,
  type MarketEstimateInput,
  type ProbabilityConfig,
  type ProbabilitySignal,
} from "./probability.js";
import {
  exitModeAt,
  isForbiddenTournamentTicket,
  rankByMultiple,
  resolvesBeforeDeadline,
  tournamentGates,
  wealthMultiple,
} from "./endgame.js";
import {
  estimateDailyVolFromCloses,
  cryptoThresholdProbability,
  matchCryptoThresholdMarket,
} from "./vol-baseline.js";
import { DelphiWebSearch, type BriefingSource, type WebSearchBriefing, type WebSearchSource } from "./web-search.js";
import { runFactCheck, type FactCheck } from "./fact-check.js";
import { filterEvidencePlausibility } from "./evidence-filter.js";
import {
  applyVerificationToProbability,
  runAdversarialVerification,
  type VerificationInput,
  type VerificationResult,
} from "./verification.js";
import { appendForecastLog, resolveForecastLog } from "./forecast-log.js";
import type { ProbabilityForecast } from "conviction-core";

// =============================================================================
// Types
// =============================================================================

export interface DelphiRunnerConfig {
  executor?: DelphiExecutor;
  probability?: ProbabilityConfig;
  /** Override the data directory (tests). */
  dataDir?: string;
  /** Loop interval override (ms). Default: AGENT_CONFIG.delphi.loopIntervalMinutes. */
  loopIntervalMs?: number;
  /** Disable Telegram dispatch (tests). */
  telegramEnabled?: boolean;
  /**
   * Master enable switch. Default: DELPHI_ENABLED env var, checked at
   * cycle time (not construction) so tests can flip it per-case and a
   * pm2 env change takes effect without a rebuild.
   */
  enabled?: () => boolean;
  /**
   * Anchor function for publishing the cycle's thesis on-chain (Mantle +
   * Casper via the shared adapters). Default: the real `anchorAll`. Inject
   * a fake in tests; pass `() => Promise.resolve([])` to disable.
   */
  anchor?: DelphiAnchorFn;
  /**
   * Web-search briefing provider (Exa via the Vercel AI Gateway). Inject a
   * fake in tests; omit to construct the default (no-op without the
   * gateway key).
   */
  webSearch?: WebSearchSource;
  /**
   * Volatility fetcher for the crypto baseline. Inject a fake in tests;
   * omit to use SoSoValue daily klines (returns undefined when the symbol
   * isn't in the catalog or vol can't be estimated).
   */
  fetchVolBaseline?: (question: string, category: string | undefined, now: number) => Promise<number | undefined>;
  /**
   * Tier 1 — resolution-authority fact check (fact-check.ts). Inject a fake
   * in tests; omit for the registry (Wikimedia verifier registered by default).
   */
  factCheck?: (question: string, now: number) => Promise<FactCheck | null>;
  /**
   * Tier 4 — adversarial pre-entry verification (verification.ts). Inject a
   * fake in tests; omit for the real cross-family LLM verifier.
   */
  verify?: (input: VerificationInput) => Promise<VerificationResult>;
  /** Disable Tier 4 verification (kill switch). Default: AGENT_CONFIG. */
  verificationEnabled?: boolean;
  /** Injectable clock (tests). */
  now?: () => number;
  /**
   * Tournament sizer (P(top 5), one fat high-multiple entry). Default:
   * AGENT_CONFIG.delphi.tournamentMode. Tests of the Kelly-era loop pass false.
   */
  tournamentMode?: boolean;
  /**
   * Hold-to-settlement start instant. `null` forces convergence exits (tests).
   * Default: AGENT_CONFIG.delphi.endgameHoldFromUtc.
   */
  endgameHoldFromUtc?: string | null;
}

interface DelphiRunnerSnapshot {
  lastCycleAt: number | null;
  cyclesRun: number;
  tradesPlaced: number;
  marketsSeen: number;
  /** Cumulative alpha-stack counters for the dashboard (honest totals). */
  exitsConvergence: number;
  exitsStopped: number;
  briefingsFetched: number;
  volBaselines: number;
  /** Estimates served from the forecast cache across the process lifetime. */
  estimatesCached: number;
  /** Tier 1 — markets where a resolution authority produced facts/probability. */
  factChecks: number;
  /** Tier 4 — candidate entries the adversarial verifier reviewed. */
  verificationsRun: number;
  /** Tier 4 — candidate entries the verifier blocked (edge collapsed). */
  verificationBlocks: number;
  /** Dedup guard: last thesis hash we attempted to anchor (persists across
   *  pm2 restarts, same pattern as the BSC loop's `lastAnchoredThesisHash`). */
  lastAnchoredThesisHash: string | null;
  /** The most recent anchor outcome, for the dashboard + /delphi/status. */
  lastAnchor: {
    thesisHash: string;
    anchoredAt: number;
    convictionScore: number;
    results: AnchorResult[];
  } | null;
}

interface CycleResult {
  marketsEvaluated: number;
  estimatesProduced: number;
  tradesPlaced: number;
  redeemsAttempted: number;
  redeemsSucceeded: number;
  /** Settled markets closed as a known loss (resolution contradicted every
   * held outcome; redeem can never succeed, so retries stop). */
  redeemsLostClosed: number;
  liquidatesAttempted: number;
  liquidatesSucceeded: number;
  /** Entries skipped by the concentration/bankroll caps this cycle. */
  sizingSkips: number;
  /** True when the cycle's thesis was anchored this cycle (not deduped). */
  anchored: boolean;
  /** True when anchoring was skipped because the thesis hash was unchanged. */
  anchorDeduped: boolean;
  /** Per-adapter anchor results when a publish was attempted. */
  anchorResults: AnchorResult[];
  /** Open positions closed by sell-into-convergence (price reached forecast). */
  exitsConvergence: number;
  /** Open positions closed by the thesis stop (price moved against us). */
  exitsStopped: number;
  /** Open positions held this cycle under endgame hold-to-settlement. */
  exitsHeld: number;
  /** Web briefings fetched fresh this cycle (not served from cache). */
  briefingsFetched: number;
  /** Markets that got a computed crypto vol-baseline reference. */
  volBaselines: number;
  /** Estimates served from the forecast cache (zero inference cost). */
  estimatesCached: number;
  /** Tier 1 — markets where a resolution authority produced facts/probability. */
  factChecks: number;
  /** Tier 4 — candidate entries the adversarial verifier reviewed this cycle. */
  verificationsRun: number;
  /** Tier 4 — candidate entries blocked this cycle by verifier disagreement. */
  verificationBlocks: number;
}

// =============================================================================
// Persistence (AGENT_DATA_DIR/delphi/)
// =============================================================================

function getDelphiDataDir(override?: string): string {
  const dir = override ?? join(process.env.AGENT_DATA_DIR ?? join(process.cwd(), "data"), "delphi");
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // Fall back to cwd — better to run without persistence than crash.
      return process.cwd();
    }
  }
  return dir;
}

const EMPTY_SNAPSHOT: DelphiRunnerSnapshot = {
  lastCycleAt: null,
  cyclesRun: 0,
  tradesPlaced: 0,
  marketsSeen: 0,
  exitsConvergence: 0,
  exitsStopped: 0,
  briefingsFetched: 0,
  volBaselines: 0,
  estimatesCached: 0,
  factChecks: 0,
  verificationsRun: 0,
  verificationBlocks: 0,
  lastAnchoredThesisHash: null,
  lastAnchor: null,
};

function loadSnapshot(dir: string): DelphiRunnerSnapshot {
  try {
    const path = join(dir, "snapshot.json");
    if (!existsSync(path)) return { ...EMPTY_SNAPSHOT };
    // Merge over defaults so snapshots written before the anchor fields
    // existed still load cleanly.
    return { ...EMPTY_SNAPSHOT, ...(JSON.parse(readFileSync(path, "utf-8")) as Partial<DelphiRunnerSnapshot>) };
  } catch {
    return { ...EMPTY_SNAPSHOT };
  }
}

function saveSnapshot(dir: string, snapshot: DelphiRunnerSnapshot): void {
  try {
    writeFileSync(join(dir, "snapshot.json"), JSON.stringify(snapshot, null, 2), "utf-8");
  } catch (err) {
    console.warn("[delphi-runner] snapshot write failed:", err instanceof Error ? err.message : String(err));
  }
}

function appendTradeLedger(dir: string, record: Record<string, unknown>): void {
  try {
    appendFileSync(join(dir, "trades.jsonl"), JSON.stringify({ ...record, timestamp: Date.now() }) + "\n", "utf-8");
  } catch (err) {
    console.warn("[delphi-runner] trade ledger write failed:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Read the trade ledger (JSONL, tolerant of malformed lines). Used by chain
 * reconciliation to recover entry metadata for orphan positions.
 */
function readTradeLedger(dir: string): Array<Record<string, unknown>> {
  try {
    const path = join(dir, "trades.jsonl");
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((r): r is Record<string, unknown> => r !== null);
  } catch {
    return [];
  }
}

// =============================================================================
// Thesis-stop re-entry cooldown (serial re-entry guard)
// =============================================================================
//
// Production incident 2026-08-15..18: the Chess-pageviews market was
// stopped out twice in four days and re-bought within hours each time — the
// one-thesis-per-market guard only applies while a position is TRACKED, and
// an exit frees the market for the very next cycle. Same thesis, same
// "underpriced" edge, four entries, net −89 TST. After a thesis stop the
// market needs time (or a strictly better signal) before we trust the same
// view again.

/** The most recent thesis stop on a market, recovered from the trade ledger. */
export interface MarketStopRecord {
  timestamp: number;
  /** Entry-time edge of the stopped thesis (drives the "edge improved" gate). */
  edge: number;
}

/**
 * Latest `exit-stop` per market from the trade ledger, with the stopped
 * thesis's entry edge attached.
 *
 * Edge resolution order: the stop record's own `edge` field → the most
 * recent matching `entry` record's edge → Infinity. Infinity is the
 * fail-closed choice for legacy stops with no edge anywhere: the new signal
 * can never beat it, so only the full cooldown (never an "improved edge")
 * re-opens the market. The ledger is append-only and survives restarts, so
 * this needs no extra state file.
 */
export function latestStopsByMarket(
  ledger: Array<Record<string, unknown>>,
): Map<string, MarketStopRecord> {
  // Latest entry edge per market — the fallback source for legacy stops.
  const entryEdge = new Map<string, { timestamp: number; edge: number }>();
  for (const r of ledger) {
    if (r.type !== "entry") continue;
    const market = typeof r.marketAddress === "string" ? r.marketAddress : null;
    const ts = typeof r.timestamp === "number" ? r.timestamp : null;
    const edge = typeof r.edge === "number" ? r.edge : null;
    if (!market || ts === null || edge === null) continue;
    const prev = entryEdge.get(market);
    if (!prev || ts >= prev.timestamp) entryEdge.set(market, { timestamp: ts, edge });
  }

  const stops = new Map<string, MarketStopRecord>();
  for (const r of ledger) {
    if (r.type !== "exit-stop") continue;
    const market = typeof r.marketAddress === "string" ? r.marketAddress : null;
    const ts = typeof r.timestamp === "number" ? r.timestamp : null;
    if (!market || ts === null) continue;
    const prev = stops.get(market);
    if (prev && ts < prev.timestamp) continue; // keep only the latest stop
    const edge =
      typeof r.edge === "number"
        ? r.edge
        : (entryEdge.get(market)?.edge ?? Number.POSITIVE_INFINITY);
    stops.set(market, { timestamp: ts, edge });
  }
  return stops;
}

/**
 * Should a new buy signal be allowed on a market that carries a thesis stop?
 *
 * Allow when the cooldown has elapsed OR the new signal's edge strictly
 * beats the stopped thesis's edge (a meaningfully stronger view, not LLM
 * jitter). Pure function — the runner supplies config + clock.
 */
export function evaluateStopReentryGate(params: {
  stoppedAt: number;
  stoppedEdge: number;
  newEdge: number;
  now: number;
  cooldownMs: number;
}): { allow: boolean; reason: string } {
  const { stoppedAt, stoppedEdge, newEdge, now, cooldownMs } = params;
  const ageMs = now - stoppedAt;
  if (ageMs >= cooldownMs) {
    return { allow: true, reason: "stop cooldown elapsed" };
  }
  // Strictly better, above float jitter (0.4 + 0.15 − 0.4 is
  // 0.15000000000000002 in IEEE754 — jitter must not count as an improved
  // thesis; the market needs a genuinely stronger signal to re-open early).
  const EDGE_EPS = 1e-9;
  if (newEdge > stoppedEdge + EDGE_EPS) {
    return {
      allow: true,
      reason: `edge improved ${stoppedEdge.toFixed(2)} → ${newEdge.toFixed(2)} within cooldown`,
    };
  }
  const remainH = ((cooldownMs - ageMs) / 3_600_000).toFixed(1);
  return {
    allow: false,
    reason: `thesis stopped ${(ageMs / 3_600_000).toFixed(1)}h ago (edge ${stoppedEdge === Number.POSITIVE_INFINITY ? "unknown" : stoppedEdge.toFixed(2)}, new ${newEdge.toFixed(2)}) — cooldown ${remainH}h remaining`,
  };
}

// =============================================================================
// Exposure ledger (per-market token exposure, for concentration caps)
// =============================================================================

/** marketAddress → TST currently at risk (6-dec token units, string). */
type ExposureLedger = Record<string, string>;

function loadExposure(dir: string): ExposureLedger {
  try {
    const path = join(dir, "exposure.json");
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf-8")) as ExposureLedger;
  } catch {
    return {};
  }
}

function saveExposure(dir: string, exposure: ExposureLedger): void {
  try {
    writeFileSync(join(dir, "exposure.json"), JSON.stringify(exposure, null, 2), "utf-8");
  } catch (err) {
    console.warn("[delphi-runner] exposure write failed:", err instanceof Error ? err.message : String(err));
  }
}

function addExposure(exposure: ExposureLedger, market: string, tokens: bigint): void {
  const current = BigInt(exposure[market] ?? "0");
  exposure[market] = (current + tokens).toString();
}

function totalExposure(exposure: ExposureLedger): bigint {
  return Object.values(exposure).reduce((acc, v) => acc + BigInt(v ?? "0"), 0n);
}

/** Drop stale markets (redeem-lost / matured) so they cannot shrink the tournament budget. */
function syncExposureToPositions(
  exposure: ExposureLedger,
  positions: Record<string, DelphiOpenPosition>,
): void {
  for (const market of Object.keys(exposure)) delete exposure[market];
  for (const p of Object.values(positions)) {
    addExposure(exposure, p.marketAddress, BigInt(p.tokensIn ?? "0"));
  }
}

// =============================================================================
// Open-position ledger + calibration forecasts
// =============================================================================
//
// Every executed entry is recorded in positions.json (open forecast:
// market, outcome, estimate, stake). When a market settles and we redeem,
// the forecast is resolved (tokensOut > 0 → the held outcome happened) and
// appended to forecasts.jsonl — the input to conviction-core's calibration
// metrics (Brier, log-loss, reliability). Expired/failed markets are
// liquidated without resolution: there's no ground-truth outcome to score.

/** Position/forecast id: `${market}:${outcomeIdx}`. */
function forecastId(marketAddress: string, outcomeIdx: number): string {
  return `${marketAddress}:${outcomeIdx}`;
}

/** An open entry the runner is tracking (stake + forecast, unresolved). */
export interface DelphiOpenPosition {
  id: string;
  marketAddress: string;
  outcomeIdx: number;
  question: string;
  /** Estimated true probability at entry (the forecast being scored).
   *  Optional: positions adopted by chain reconciliation may have no entry
   *  metadata (ledger lost too) — they're managed + redeemed but never
   *  scored for calibration. */
  forecast?: number;
  /** Market-implied probability at entry. */
  impliedProbability: number;
  edge: number;
  /** Shares bought (18-dec string). */
  shares: string;
  /** Tokens spent (18-dec string). */
  tokensIn: string;
  openedAt: number;
  transactionHash?: string;
  /** Provenance — how the forecast was produced (surfaced on the card).
   *  Optional: positions persisted before Phase 4c have no provenance. */
  model?: string;
  samples?: number;
  webEvidence?: boolean;
  /** Which search rung supplied the briefing (firecrawl/parallel/exa). */
  webSource?: BriefingSource;
  /** Tier 3 — a second search rung deterministically corroborated the briefing. */
  corroborated?: boolean;
  /** Tier 1 — the resolution-authority verifier that answered this market. */
  factAuthority?: string;
  /** Tier 4 — the adversarial verifier reviewed this entry pre-trade. */
  verified?: boolean;
  /** Tier 4 — which model ran the adversarial verification. */
  verifierModel?: string;
  volAnchor?: number;
}

function loadPositions(dir: string): Record<string, DelphiOpenPosition> {
  try {
    const path = join(dir, "positions.json");
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, DelphiOpenPosition>;
  } catch {
    return {};
  }
}

function savePositions(dir: string, positions: Record<string, DelphiOpenPosition>): void {
  try {
    writeFileSync(join(dir, "positions.json"), JSON.stringify(positions, null, 2), "utf-8");
  } catch (err) {
    console.warn("[delphi-runner] positions write failed:", err instanceof Error ? err.message : String(err));
  }
}

/** Append a resolved forecast to the calibration ledger (JSONL). */
function appendCalibration(dir: string, forecast: ProbabilityForecast & { marketAddress: string; outcomeIdx: number }): void {
  try {
    appendFileSync(join(dir, "forecasts.jsonl"), JSON.stringify(forecast) + "\n", "utf-8");
  } catch (err) {
    console.warn("[delphi-runner] calibration write failed:", err instanceof Error ? err.message : String(err));
  }
}

/** Every forecast ever resolved, from the calibration ledger. */
export function loadCalibrationLedger(dir: string): Array<ProbabilityForecast & { marketAddress: string; outcomeIdx: number }> {
  try {
    const path = join(dir, "forecasts.jsonl");
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf-8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l)) as Array<ProbabilityForecast & { marketAddress: string; outcomeIdx: number }>;
  } catch {
    return [];
  }
}

// =============================================================================
// Crypto vol baseline (default SoSoValue implementation)
// =============================================================================

/**
 * Compute the quantitative reference probability for a crypto threshold
 * market: P(close > threshold at expiry) from realized daily volatility
 * (SoSoValue klines) and the current spot price. Returns undefined for
 * non-threshold markets, unknown symbols, or when klines/spot are missing —
 * the LLM estimate then stands alone (no blend).
 *
 * Pure policy on top of real data sources; an injected fake replaces it in tests.
 */
async function fetchVolBaselineFromSoSoValue(
  question: string,
  category: string | undefined,
  now: number,
): Promise<number | undefined> {
  const match = matchCryptoThresholdMarket(question, category, now);
  if (!match) return undefined;
  if (!sosovalueClient.isAvailable()) return undefined;

  // Realized daily vol over the last 30 closes + the current spot from the
  // live quote (klines lag; the quote client gives the freshest price).
  const klines = await sosovalueClient.fetchKlinesBySymbol(match.symbol, "1d", 30);
  const closes = klines.map((k) => k.close).filter((c) => Number.isFinite(c) && c > 0);
  const volDaily = estimateDailyVolFromCloses(closes);
  if (volDaily === null) return undefined;

  let spot = await sosovalueClient.fetchTokenPrice(match.symbol);
  if (!(spot > 0)) spot = closes[closes.length - 1] ?? 0; // last daily close fallback
  if (!(spot > 0)) return undefined;

  const p = cryptoThresholdProbability({
    spotPrice: spot,
    volDaily,
    daysToExpiry: match.daysToExpiry,
    threshold: match.threshold,
  });
  if (p === null) return undefined;
  // p is always P(close ABOVE threshold). For "below"-phrased questions the
  // Yes outcome is the complement — blend the correct side.
  const pYes = match.direction === "below" ? 1 - p : p;
  console.log(
    `  [delphi-vol] ${match.symbol} ${match.direction} ${match.threshold.toLocaleString("en-US")} in ${match.daysToExpiry.toFixed(1)}d: vol=${(volDaily * 100).toFixed(2)}%/d spot=${spot.toLocaleString("en-US")} → P(Yes)=${pYes.toFixed(3)}`,
  );
  return pYes;
}

// =============================================================================
// Market → EstimateInput mapping
// =============================================================================

/**
 * Build the estimator input from a discovered market + its current implied
 * probabilities. The runner derives implied probabilities from the LMSR
 * quotes: a 1-share quote for each outcome gives us the implied price per
 * outcome, which (on a well-formed binary market) sums to ~1.
 *
 * Alpha context is attached here:
 *   - webBriefing: Exa-sourced evidence for the forecaster prompt
 *   - volBaseline: the computed crypto reference (blended mechanically
 *     after sampling — never shown to the LLM, keeps samples independent)
 *
 * Binary markets only for Phase 2 — multi-outcome needs a sizing model.
 */
async function buildEstimateInput(
  market: DelphiMarket,
  executor: DelphiExecutor,
  ctx: {
    webBriefing?: WebSearchBriefing;
    volBaseline?: number;
    authorityFacts?: string;
    factAuthority?: string;
  },
): Promise<MarketEstimateInput | null> {
  const question = market.question;
  if (!question) return null;

  // Real outcome labels from the market (binary Yes/No is the common case,
  // but band markets have 4+). Fall back to the binary assumption only when
  // the market carries no outcome metadata at all.
  const outcomes = market.outcomes?.length ? market.outcomes : ["Yes", "No"];
  const impliedProbabilities = await executor.getImpliedProbabilities(market.id, outcomes.length);
  if (!impliedProbabilities) return null;

  return {
    marketAddress: market.id,
    question,
    category: market.category,
    impliedProbabilities,
    outcomes,
    closesAt: market.resolvesAt ?? undefined,
    webBriefing: ctx.webBriefing,
    volBaselineProbability: ctx.volBaseline,
    authorityFacts: ctx.authorityFacts,
    factAuthority: ctx.factAuthority,
  };
}

// =============================================================================
// Forecast cache — inference efficiency between hourly cycles
// =============================================================================

/** Cheap stable fingerprint of a briefing text (for cache keys). */
function briefingFingerprint(text: string | undefined): string {
  if (!text) return "-";
  // FNV-1a over the text — not cryptographic, just collision-resistant enough
  // that a genuinely new briefing invalidates the cache.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Bucket an estimate for the forecast cache: market address + implied
 * probabilities quantized to 2¢ + a fingerprint of the injected briefing.
 * An estimate stays valid while its inputs are unchanged — same evidence,
 * same price, same answer. Markets with a vol-baseline anchor bypass the
 * cache entirely (the blend is baked into the estimate and the anchor moves
 * with the spot price every cycle).
 */
export function forecastCacheKey(
  marketAddress: string,
  impliedProbabilities: number[],
  briefingText?: string,
): string {
  const quantized = impliedProbabilities.map((p) => Math.round(p * 100) / 100);
  return `${marketAddress}:${quantized.join(",")}:${briefingFingerprint(briefingText)}`;
}

/** Drop cache entries older than ttlMs. Exported for tests. */
export function pruneForecastCache(
  cache: Map<string, { estimate: MarketEstimate; fetchedAt: number }>,
  ttlMs: number,
  now: number,
): void {
  for (const [key, entry] of cache) {
    if (now - entry.fetchedAt > ttlMs) cache.delete(key);
  }
}

// =============================================================================
// Runner
// =============================================================================

/**
 * Hard wall-clock cap for an entire cycle (belt and braces over the
 * per-call SDK timeouts in the executor). Generous on purpose: a cold cycle
 * after restart that re-estimates every market on a slow free tier is the
 * realistic upper bound; anything longer is a hang and the hourly loop must
 * move on without it.
 */
const CYCLE_WATCHDOG_MS = 50 * 60_000;

export class DelphiRunner {
  private readonly executor: DelphiExecutor;
  private readonly probability: ProbabilityConfig;
  private readonly dataDir: string;
  private readonly loopIntervalMs: number;
  private readonly telegramEnabled: boolean;
  private readonly enabledCheck: () => boolean;
  private readonly anchorFn?: DelphiAnchorFn;
  private readonly webSearch: WebSearchSource;
  private readonly fetchVolBaseline: (
    question: string,
    category: string | undefined,
    now: number,
  ) => Promise<number | undefined>;
  private readonly factCheck: (question: string, now: number) => Promise<FactCheck | null>;
  private readonly verify: (input: VerificationInput) => Promise<VerificationResult>;
  private readonly verificationEnabled: boolean;
  private readonly clock: () => number;
  private readonly tournamentMode: boolean;
  private readonly endgameHoldFromUtc: string | undefined;
  private readonly maxNewEntriesPerCycle: number;
  private snapshot: DelphiRunnerSnapshot;
  private running = false;
  /**
   * In-process forecast cache: market+bucketed-price → ensemble estimate.
   * Hourly cycles re-see the same markets; when the implied probabilities
   * haven't moved ≥1¢, the previous estimate is still the correct input and
   * we reuse it at zero inference cost. Pruned each cycle by TTL. Deliberately
   * NOT persisted — a restart should re-estimate fresh, and cross-restart
   * reuse would mask model/provider changes.
   */
  private readonly forecastCache = new Map<string, { estimate: MarketEstimate; fetchedAt: number }>();

  constructor(config: DelphiRunnerConfig = {}) {
    this.executor = config.executor ?? new DelphiExecutor();
    this.probability = config.probability ?? {};
    this.dataDir = getDelphiDataDir(config.dataDir);
    this.loopIntervalMs =
      config.loopIntervalMs ?? AGENT_CONFIG.delphi.loopIntervalMinutes * 60_000;
    this.telegramEnabled = config.telegramEnabled ?? true;
    this.enabledCheck = config.enabled ?? (() => process.env.DELPHI_ENABLED === "1");
    this.anchorFn = config.anchor;
    this.webSearch =
      config.webSearch ??
      new DelphiWebSearch({
        maxCallsPerCycle: AGENT_CONFIG.delphi.webSearchMaxCallsPerCycle,
        // 12h: competition markets resolve at most daily; a briefing fresher
        // than half a day is still accurate and halves the Exa call count.
        cacheTtlMs: 12 * 60 * 60 * 1000,
        corroborate: AGENT_CONFIG.delphi.webCorroborationEnabled,
      });
    this.fetchVolBaseline = config.fetchVolBaseline ?? fetchVolBaselineFromSoSoValue;
    this.factCheck = config.factCheck ?? runFactCheck;
    this.verify = config.verify ?? runAdversarialVerification;
    this.verificationEnabled = config.verificationEnabled ?? AGENT_CONFIG.delphi.verificationEnabled;
    this.clock = config.now ?? (() => Date.now());
    this.tournamentMode = config.tournamentMode ?? AGENT_CONFIG.delphi.tournamentMode;
    this.endgameHoldFromUtc =
      config.endgameHoldFromUtc === undefined
        ? AGENT_CONFIG.delphi.endgameHoldFromUtc
        : config.endgameHoldFromUtc ?? undefined;
    this.maxNewEntriesPerCycle = AGENT_CONFIG.delphi.maxNewEntriesPerCycle;
    this.snapshot = loadSnapshot(this.dataDir);
  }

  /** Data directory — exposed so /delphi/status can read the ledgers. */
  get dataDirectory(): string {
    return this.dataDir;
  }

  /** Run one cycle. Returns per-cycle counters for observability. */
  async runCycle(cycleNumber: number): Promise<CycleResult> {
    const result: CycleResult = {
      marketsEvaluated: 0,
      estimatesProduced: 0,
      tradesPlaced: 0,
      redeemsAttempted: 0,
      redeemsSucceeded: 0,
      redeemsLostClosed: 0,
      liquidatesAttempted: 0,
      liquidatesSucceeded: 0,
      sizingSkips: 0,
      anchored: false,
      anchorDeduped: false,
      anchorResults: [],
      exitsConvergence: 0,
      exitsStopped: 0,
      exitsHeld: 0,
      briefingsFetched: 0,
      volBaselines: 0,
      estimatesCached: 0,
      factChecks: 0,
      verificationsRun: 0,
      verificationBlocks: 0,
    };

    if (!this.enabledCheck()) {
      console.log("[delphi-runner] DELPHI_ENABLED is off — cycle skipped.");
      return result;
    }

    // Inference efficiency: drop stale forecast-cache entries before the
    // discovery pass so a long-lived process doesn't grow the map unbounded.
    pruneForecastCache(
      this.forecastCache,
      AGENT_CONFIG.delphi.forecastCacheTtlMinutes * 60_000,
      this.clock(),
    );

    const health = await this.executor.healthCheck();
    if (!health.available) {
      const help = health.help ? ` (${health.help})` : "";
      throw new Error(`Delphi health check failed: ${health.diagnostics.join("; ")}${help}`);
    }

    // Fresh Exa budget per cycle — the cache serves repeats within a cycle.
    this.webSearch.resetCycleBudget();

    // ── 1. Redeem settled + liquidate expired/failed (cash-out → redeploy) ─
    let bankrollTokens = 0n;
    const exposure = loadExposure(this.dataDir);
    const positions = loadPositions(this.dataDir);
    // Chain is the source of truth: adopt any on-chain position the tracked
    // ledger lost (e.g. a pm2 reload between trade and persistence). Runs
    // before the sweep so adopted positions are eligible for redemption.
    await this.reconcileWithChain(positions, exposure);
    try {
      const sweep = await redeemAndLiquidate(this.executor);
      result.redeemsAttempted = sweep.redeemAttempted;
      result.redeemsSucceeded = sweep.redeemSucceeded;
      result.redeemsLostClosed = sweep.redeemLostClosed;
      result.liquidatesAttempted = sweep.liquidateAttempted;
      result.liquidatesSucceeded = sweep.liquidateSucceeded;
      for (const ev of sweep.events) {
        appendTradeLedger(this.dataDir, {
          type: ev.kind,
          marketAddress: ev.marketAddress,
          success: ev.success,
          tokensOut: ev.tokensOut,
          error: ev.error,
          ...(ev.winningOutcomeIdx !== undefined ? { winningOutcomeIdx: ev.winningOutcomeIdx } : {}),
        });
        // Clear exposure for markets we exited successfully.
        if (ev.success) delete exposure[ev.marketAddress];
        // Resolve tracked forecasts for this market. A redeem-lost close is
        // a redeem resolution with zero payout: the held outcome lost.
        if (ev.success) {
          const resolveKind = ev.kind === "redeem-lost" ? "redeem" : ev.kind;
          const tokensOut = ev.kind === "redeem-lost" ? "0" : ev.tokensOut;
          this.resolvePositions(positions, ev.marketAddress, resolveKind, tokensOut);
          if (ev.kind === "redeem-lost") {
            console.warn(
              `  [delphi-redeem] ${ev.marketAddress} resolved against us (winner=${ev.winningOutcomeIdx}) — closed as a loss, stopped retrying the redeem`,
            );
          }
        }
      }
      bankrollTokens = BigInt(await this.executor.getTokenBalance());
      // Operational visibility: the agent must log its bankroll every cycle —
      // sizing is the downstream consumer and was previously a blind spot
      // (production: 25 cycles sized 0 with no way to see the balance read).
      console.log(
        `[delphi-runner] bankroll=${(Number(bankrollTokens) / 1e6).toFixed(2)} TST (${bankrollTokens} raw)`,
      );
    } catch (err) {
      // Lifecycle sweep is best-effort: log and continue to discovery so a
      // buggy liquidation path can't freeze the whole cycle.
      console.warn(`[delphi-runner] lifecycle sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // ── 1a. Resolve the all-forecasts log (traded + untraded estimates) ──
    // The traded-ledger calibration (forecasts.jsonl) only scores markets we
    // entered — selection-biased. The all-forecasts log (estimates.jsonl)
    // scores every estimate once its market settles, giving the honest
    // forecaster-level calibration report.
    try {
      await resolveForecastLog(this.dataDir, {
        getMarketDetails: (addr) => this.executor.getMarket(addr),
        clock: this.clock,
        log: (msg) => console.log(msg),
      });
    } catch (err) {
      console.warn(`[delphi-runner] forecast-log resolution failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // ── 1b. Sell-into-convergence exit pass over tracked open positions ────
    //
    // Markets that resolved were already closed by the redeem sweep above;
    // what remains are positions in still-open markets. Re-price each one
    // against its entry forecast: take profit when the price converged,
    // stop when the market moved against the thesis.
    const exits = await this.convergenceExitPass(positions, exposure);
    result.exitsConvergence = exits.convergence;
    result.exitsStopped = exits.stopped;
    result.exitsHeld = exits.held;
    // Exit pass may drop matured positions without touching exposure.json
    // (Botafogo 97 TST ghost, 2026-08-21). Rebuild from what's still tracked
    // before tournament sizing, or 95% of cash becomes 95% of cash-minus-ghosts.
    syncExposureToPositions(exposure, positions);

    // ── 2. Discover + estimate + gate + trade ─────────────────────────────
    const windowClosed =
      this.clock() > new Date(AGENT_CONFIG.delphi.tradingWindowCloses).getTime();
    const decisions: DelphiDecisionRecord[] = [];
    const stopMap = latestStopsByMarket(readTradeLedger(this.dataDir));
    const marketsEnteredThisCycle = new Set<string>();
    const entriesForSummary: Array<{
      question: string;
      outcomeIdx: number;
      effectivePrice?: number;
      estimatedProbability?: number;
      edge: number;
      transactionHash?: string;
      model?: string;
      webEvidence?: boolean;
      webSource?: BriefingSource;
      corroborated?: boolean;
      factAuthority?: string;
      verified?: boolean;
      volAnchor?: number;
    }> = [];
    const tournamentCandidates: Array<{
      signal: ProbabilitySignal;
      verifiedProb: number;
      verification?: VerificationResult;
    }> = [];

    if (windowClosed) {
      console.log("[delphi-runner] window closed — redeem-only cycle (no discovery, no entries).");
    } else {
    const markets = await this.executor.listOpenMarkets({ limit: 25 });
    result.marketsEvaluated = markets.length;

    for (const market of markets) {
      if (
        !resolvesBeforeDeadline(
          market.resolvesAt,
          AGENT_CONFIG.delphi.tradingWindowCloses,
          AGENT_CONFIG.delphi.entryResolveBufferHours * 3_600_000,
        )
      ) {
        console.log(
          `  [delphi-market] skip "${(market.question ?? "").slice(0, 50)}" — resolves ${market.resolvesAt}, after the redeem deadline`,
        );
        continue;
      }

      // ── Tier 1: deterministic resolution authorities (fact-check.ts) ──
      // Runs FIRST: when a matched authority's data already covers the
      // resolution window it returns a direct probability and the market
      // needs neither the search budget nor an LLM sample. Evidence-only
      // facts (window still open) get injected into the estimate instead.
      let fact: FactCheck | null = null;
      try {
        fact = await this.factCheck(market.question ?? "", this.clock());
        if (fact) result.factChecks++;
      } catch (err) {
        console.warn(`  [delphi-fact] check error: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Alpha context: web briefing (capped, cached) + vol baseline (crypto
      // threshold markets only). Both are best-effort — a failure degrades
      // to the plain LLM estimate, never blocks the market. An authority
      // DIRECT answer skips the briefing: ground truth already won, and
      // spending search budget can't improve it.
      let webBriefing: WebSearchBriefing | undefined;
      if (fact?.probability === undefined) {
        try {
          const briefing = await this.webSearch.briefing(market.question ?? "");
          if (briefing?.text) {
            // ── Tier 2: deterministic plausibility filter (evidence-filter.ts)
            // Stale passages (e.g. a 1986 price table in a 2026 crude-oil
            // market) are stripped BEFORE prompt injection. An emptied
            // briefing means "inject nothing".
            const filtered = filterEvidencePlausibility(market.question ?? "", briefing.text, this.clock());
            if (filtered.dropped > 0) {
              console.log(
                `  [delphi-evidence] dropped ${filtered.dropped} implausible passage(s) for "${(market.question ?? "").slice(0, 50)}"`,
              );
            }
            webBriefing = filtered.empty ? undefined : { ...briefing, text: filtered.text };
            if (webBriefing && !briefing.cached) result.briefingsFetched++;
          }
        } catch (err) {
          console.warn(`  [delphi-search] briefing error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      let volBaseline: number | undefined;
      try {
        volBaseline = await this.fetchVolBaseline(market.question ?? "", market.category, this.clock());
        if (volBaseline !== undefined) result.volBaselines++;
      } catch (err) {
        console.warn(`  [delphi-vol] baseline error: ${err instanceof Error ? err.message : String(err)}`);
      }

      const input = await buildEstimateInput(market, this.executor, {
        webBriefing,
        volBaseline,
        authorityFacts: fact?.facts,
        factAuthority: fact?.authority,
      });
      if (!input) continue;

      // Estimate selection:
      //   1. Authority direct probability → deterministic estimate, zero
      //      inference (Tier 1).
      //   2. Vol-anchored or authority-evidence markets bypass the forecast
      //      cache — their inputs move with live data (spot / trailing days).
      //   3. Everything else: cache or fresh LLM ensemble.
      let estimate: MarketEstimate | null;
      if (fact?.probability !== undefined) {
        estimate = factAuthorityEstimate(input, fact.probability, fact.authority, fact.facts, this.clock());
        console.log(
          `  [delphi-fact] "${(market.question ?? "").slice(0, 50)}" → direct probability ${fact.probability.toFixed(2)} from ${fact.authority}`,
        );
      } else if (volBaseline !== undefined || fact) {
        estimate = await estimateProbability(input, this.probability);
      } else {
        // Forecast cache: an estimate's inputs are the question, the injected
        // briefing (fingerprinted in the key — its own 6h cache keeps the
        // fingerprint stable across hourly cycles), and the implied
        // probabilities (bucketed to 2¢). When nothing moved, the prior
        // ensemble is still the right answer — reuse it at zero gateway cost.
        const cacheKey = forecastCacheKey(input.marketAddress, input.impliedProbabilities, input.webBriefing?.text);
        const cached = this.forecastCache.get(cacheKey);
        if (cached) {
          estimate = { ...cached.estimate, estimatedAt: this.clock() };
          result.estimatesCached++;
        } else {
          estimate = await estimateProbability(input, this.probability);
          if (estimate) {
            this.forecastCache.set(cacheKey, { estimate, fetchedAt: this.clock() });
          }
        }
      }
      if (!estimate) continue;
      result.estimatesProduced++;
      // All-forecasts ledger: log EVERY estimate (traded or not) so the
      // calibration report isn't selection-biased toward markets where the
      // edge gate + sizing let us enter. Resolved at settlement by
      // resolveForecastLog() — the scored row is the last view we held.
      appendForecastLog(this.dataDir, estimate, input.impliedProbabilities);

      const signals = evaluateProbabilitySignal(estimate, input.impliedProbabilities, this.probability);
      for (const signal of signals) {
        // Record the decision for the on-chain thesis anchor up front — the
        // anchor hash quantizes ALL gated decisions this cycle. A Tier-4
        // block mutates this record in place (buy → skip) before the anchor
        // step runs, so the anchored view is the view we actually held.
        const decisionRecord: DelphiDecisionRecord = {
          marketAddress: signal.marketAddress,
          outcomeIdx: signal.outcomeIdx,
          decision: signal.decision,
          edge: signal.edge,
        };
        decisions.push(decisionRecord);
        // Tournament: any strictly +EV side is a candidate. The Kelly 8–14¢
        // gate starved the ranker on 2026-08-21 (Gemini/WTI/UAP all skipped
        // before placeTournamentEntries, so there was no TAKE/skip log).
        const tournamentPlusEv = this.tournamentMode && signal.edge > 0;
        if (!tournamentPlusEv && signal.decision !== "buy") continue;

        // One thesis per market. Production incident 2026-08-15: the same
        // Typhoon market was bought YES in cycle #27 (edge 0.64) and NO in
        // cycle #29 (edge 0.24) — opposite forecasts 1.5h apart, 193 TST of
        // locked capital hedging itself to a guaranteed loss minus fees.
        // Skip when we already track a position in this market or entered
        // it earlier this cycle.
        const heldHere = Object.values(positions).some(
          (p) => p.marketAddress === signal.marketAddress,
        );
        if (heldHere || marketsEnteredThisCycle.has(signal.marketAddress)) {
          console.log(
            `  [delphi-signal] skip "${signal.question.slice(0, 50)}" outcome=${signal.outcomeIdx} — already hold a thesis in this market`,
          );
          continue;
        }

        // Thesis-stop cooldown: a market stopped out recently needs time (or
        // a strictly stronger signal) before we re-buy it — see
        // latestStopsByMarket/evaluateStopReentryGate and the Chess-market
        // serial re-entry incident (4 entries in 4 days, net −89 TST).
        const stop = stopMap.get(signal.marketAddress);
        if (stop) {
          const gate = evaluateStopReentryGate({
            stoppedAt: stop.timestamp,
            stoppedEdge: stop.edge,
            newEdge: signal.edge,
            now: this.clock(),
            cooldownMs: AGENT_CONFIG.delphi.stopReentryCooldownHours * 3_600_000,
          });
          if (!gate.allow) {
            console.log(
              `  [delphi-signal] skip "${signal.question.slice(0, 50)}" outcome=${signal.outcomeIdx} — ${gate.reason}`,
            );
            continue;
          }
          console.log(
            `  [delphi-signal] re-entry allowed on "${signal.question.slice(0, 50)}": ${gate.reason}`,
          );
        }

        if (
          this.tournamentMode &&
          isForbiddenTournamentTicket(signal.question, signal.outcomeIdx, input.outcomes)
        ) {
          console.log(
            `  [delphi-tournament] skip "${signal.question.slice(0, 50)}" outcome=${signal.outcomeIdx} — forbidden ticket`,
          );
          continue;
        }

        // ── Tier 4: adversarial pre-entry verification (verification.ts) ──
        // Fires only for signals that cleared EVERY other gate — the cost is
        // one LLM call per candidate entry, not per market. A cross-family
        // verifier attacks the thesis; when it flags overconfidence beyond
        // the disagreement threshold, the estimate is discounted toward the
        // verifier's number and the edge gate re-runs. If the edge collapses
        // → skip + ledger. Verification that can't run ({ran:false}) never
        // blocks: it's a quality gate, not an availability gate.
        let verifiedProb = signal.estimatedProbability;
        let verification: VerificationResult | undefined;
        let finalSignal = signal;
        // Ground truth trumps opinion: when a Tier-1 authority already
        // produced a direct probability (its data covers the resolution
        // window), an LLM verifier must not be able to veto or dilute it.
        if (this.verificationEnabled && fact?.probability === undefined) {
          verification = await this.verify({
            question: signal.question,
            category: estimate.category,
            closesAt: market.resolvesAt ?? undefined,
            outcomeIdx: signal.outcomeIdx,
            outcomeLabel: input.outcomes[signal.outcomeIdx] ?? String(signal.outcomeIdx),
            estimatedProbability: signal.estimatedProbability,
            impliedProbability: signal.impliedProbability,
            webEvidenceText: input.webBriefing?.text,
            authorityFacts: fact?.facts,
            estimateProvider: estimate.provider,
          });
          result.verificationsRun++;
          const adjustment = applyVerificationToProbability(signal.estimatedProbability, verification);
          if (adjustment.adjusted) {
            verifiedProb = adjustment.probability;
            // Re-run the exact gate logic with the adjusted probability.
            const adjustedEstimate: MarketEstimate = {
              ...estimate,
              outcomes: estimate.outcomes.map((o) =>
                o.outcomeIdx === signal.outcomeIdx
                  ? { ...o, probability: verifiedProb, reasoning: `${o.reasoning} [verifier: ${adjustment.reason}]` }
                  : o,
              ),
              provenance: {
                ...estimate.provenance,
                // Provenance may be absent (injected fixtures) — rebuild
                // the required provider/model fields from the estimate.
                provider: estimate.provenance?.provider ?? estimate.provider,
                model: estimate.provenance?.model ?? estimate.model,
                verified: verification.ran,
                verifierModel: verification.model,
              },
            };
            const reGated = evaluateProbabilitySignal(adjustedEstimate, input.impliedProbabilities, this.probability);
            const gated = reGated.find((s) => s.outcomeIdx === signal.outcomeIdx);
            const stillPlusEv = verifiedProb > signal.impliedProbability;
            const blocked = this.tournamentMode
              ? !stillPlusEv
              : !gated || gated.decision !== "buy";
            if (blocked) {
              result.verificationBlocks++;
              // Mutate the anchored record: the thesis we publish is the one
              // we actually held after verification, not the pre-check view.
              decisionRecord.decision = "skip";
              decisionRecord.edge = gated?.edge ?? verifiedProb - signal.impliedProbability;
              appendTradeLedger(this.dataDir, {
                type: "verification-blocked",
                marketAddress: signal.marketAddress,
                outcomeIdx: signal.outcomeIdx,
                question: signal.question,
                estimatedProbability: signal.estimatedProbability,
                adjustedProbability: verifiedProb,
                impliedProbability: signal.impliedProbability,
                edge: gated?.edge ?? verifiedProb - signal.impliedProbability,
                verdict: verification.verdict,
                verifierModel: verification.model,
                verifierReasoning: verification.reasoning,
                reason: adjustment.reason,
              });
              console.log(
                `  [delphi-verify] BLOCKED "${signal.question.slice(0, 50)}" outcome=${signal.outcomeIdx}: ${adjustment.reason}`,
              );
              continue;
            }
            finalSignal = gated ?? { ...signal, estimatedProbability: verifiedProb, edge: verifiedProb - signal.impliedProbability };
            console.log(
              `  [delphi-verify] "${signal.question.slice(0, 50)}" outcome=${signal.outcomeIdx}: ${adjustment.reason}`,
            );
          }
        }
        // Record the buy decision's post-verification edge in the anchored
        // thesis (the record itself was pushed before the gate loop).
        decisionRecord.edge = finalSignal.edge;

        if (this.tournamentMode) {
          tournamentCandidates.push({ signal: finalSignal, verifiedProb, verification });
          continue;
        }

        await this.placeKellyEntry({
          signal: finalSignal,
          verifiedProb,
          verification,
          bankrollTokens,
          positions,
          exposure,
          result,
          marketsEnteredThisCycle,
          entriesForSummary,
        });
      }
    }

    if (this.tournamentMode) {
      await this.placeTournamentEntries({
        candidates: tournamentCandidates,
        bankrollTokens,
        positions,
        exposure,
        result,
        marketsEnteredThisCycle,
        entriesForSummary,
      });
    }

    // ── 3. Anchor the cycle's thesis on-chain (deduped, non-critical) ─────
    const anchor = await anchorDelphiCycle({
      input: {
        decisions,
        tradesPlaced: result.tradesPlaced,
        marketsEvaluated: result.marketsEvaluated,
      },
      lastAnchoredThesisHash: this.snapshot.lastAnchoredThesisHash,
      anchor: this.anchorFn,
    });
    result.anchorDeduped = anchor.deduped;
    if (!anchor.deduped) {
      result.anchored = true;
      result.anchorResults = anchor.outcome?.results ?? [];
      // Record the attempt even when adapters skipped/failed — the dedup
      // guard exists to stop redundant SPEND, and a skipped publish (e.g.
      // low Casper balance) must not retry every cycle for the same thesis.
      this.snapshot.lastAnchoredThesisHash = anchor.thesisHash;
      this.snapshot.lastAnchor = {
        thesisHash: anchor.thesisHash,
        anchoredAt: Date.now(),
        convictionScore: anchor.outcome?.convictionScore ?? 0,
        results: result.anchorResults,
      };
      const anchorSummary =
        result.anchorResults.length > 0
          ? result.anchorResults.map((r) => `${r.adapter}=${r.status}`).join(", ")
          : "no adapters";
      console.log(
        `[delphi-runner] thesis ${anchor.thesisHash.slice(0, 18)}... anchor: ${anchorSummary}`,
      );
    }
    } // window still open — discovery + entries + anchor

    if (this.telegramEnabled) {
      await sendDelphiCycleSummary({
        cycle: cycleNumber,
        marketsEvaluated: result.marketsEvaluated,
        estimatesProduced: result.estimatesProduced,
        tradesPlaced: result.tradesPlaced,
        redeemsSucceeded: result.redeemsSucceeded + result.liquidatesSucceeded,
        exits: { convergence: result.exitsConvergence, stopped: result.exitsStopped },
        alpha: {
          briefings: result.briefingsFetched,
          volBaselines: result.volBaselines,
          cached: result.estimatesCached,
          factChecks: result.factChecks,
          verifications: result.verificationsRun,
          verificationBlocks: result.verificationBlocks,
        },
        entries: entriesForSummary,
      });
    }

    // ── 4. Snapshot + exposure + positions persistence ────────────────────
    this.snapshot = {
      ...this.snapshot,
      lastCycleAt: Date.now(),
      cyclesRun: this.snapshot.cyclesRun + 1,
      tradesPlaced: this.snapshot.tradesPlaced + result.tradesPlaced,
      marketsSeen: this.snapshot.marketsSeen + result.marketsEvaluated,
      exitsConvergence: this.snapshot.exitsConvergence + result.exitsConvergence,
      exitsStopped: this.snapshot.exitsStopped + result.exitsStopped,
      briefingsFetched: this.snapshot.briefingsFetched + result.briefingsFetched,
      volBaselines: this.snapshot.volBaselines + result.volBaselines,
      estimatesCached: this.snapshot.estimatesCached + result.estimatesCached,
      factChecks: this.snapshot.factChecks + result.factChecks,
      verificationsRun: this.snapshot.verificationsRun + result.verificationsRun,
      verificationBlocks: this.snapshot.verificationBlocks + result.verificationBlocks,
    };
    saveSnapshot(this.dataDir, this.snapshot);
    saveExposure(this.dataDir, exposure);
    savePositions(this.dataDir, positions);

    console.log(
      `[delphi-runner] cycle #${cycleNumber}: markets=${result.marketsEvaluated} estimates=${result.estimatesProduced} cached=${result.estimatesCached} trades=${result.tradesPlaced} exits=${result.exitsConvergence + result.exitsStopped} (converged ${result.exitsConvergence}, stopped ${result.exitsStopped}, held ${result.exitsHeld}) redeems=${result.redeemsSucceeded}/${result.redeemsAttempted} lostClosed=${result.redeemsLostClosed} liquidates=${result.liquidatesSucceeded}/${result.liquidatesAttempted} sizingSkips=${result.sizingSkips} briefings=${result.briefingsFetched} volBaselines=${result.volBaselines} factChecks=${result.factChecks} verifications=${result.verificationsRun} blocked=${result.verificationBlocks}`,
    );
    return result;
  }

  private async placeKellyEntry(ctx: {
    signal: ProbabilitySignal;
    verifiedProb: number;
    verification?: VerificationResult;
    bankrollTokens: bigint;
    positions: Record<string, DelphiOpenPosition>;
    exposure: ExposureLedger;
    result: CycleResult;
    marketsEnteredThisCycle: Set<string>;
    entriesForSummary: CycleResult extends never ? never : Array<{
      question: string;
      outcomeIdx: number;
      effectivePrice?: number;
      estimatedProbability?: number;
      edge: number;
      transactionHash?: string;
      model?: string;
      webEvidence?: boolean;
      webSource?: BriefingSource;
      corroborated?: boolean;
      factAuthority?: string;
      verified?: boolean;
      volAnchor?: number;
    }>;
  }): Promise<void> {
    const budget = perTradeBudget({
      bankrollTokens: ctx.bankrollTokens,
      existingExposureTokens: totalExposure(ctx.exposure),
      marketExposureTokens: BigInt(ctx.exposure[ctx.signal.marketAddress] ?? "0"),
      maxPositionFraction: AGENT_CONFIG.delphi.maxPositionFraction,
      maxMarketFraction: AGENT_CONFIG.delphi.maxMarketFraction,
    });
    const price = ctx.signal.impliedProbability;
    const shares = sizeSharesBudget(budget, price);
    if (shares <= 0n) {
      ctx.result.sizingSkips++;
      console.warn(
        `  [delphi-sizing] skip "${ctx.signal.question.slice(0, 50)}" outcome=${ctx.signal.outcomeIdx} price=${price.toFixed(3)} budget=${budget} bankroll=${ctx.bankrollTokens}`,
      );
      return;
    }
    await this.executeBuy({ ...ctx, shares, price });
  }

  private async placeTournamentEntries(ctx: {
    candidates: Array<{ signal: ProbabilitySignal; verifiedProb: number; verification?: VerificationResult }>;
    bankrollTokens: bigint;
    positions: Record<string, DelphiOpenPosition>;
    exposure: ExposureLedger;
    result: CycleResult;
    marketsEnteredThisCycle: Set<string>;
    entriesForSummary: Parameters<DelphiRunner["placeKellyEntry"]>[0]["entriesForSummary"];
  }): Promise<void> {
    if (ctx.candidates.length === 0) {
      console.log("  [delphi-tournament] no +EV candidates this cycle");
      return;
    }
    const gates = tournamentGates(ctx.bankrollTokens);
    const ranked = rankByMultiple(
      ctx.candidates.map((c) => ({
        ...c,
        forecast: c.verifiedProb,
        fillPrice: c.signal.impliedProbability,
      })),
    );
    let placed = 0;
    for (const candidate of ranked) {
      if (placed >= this.maxNewEntriesPerCycle) break;
      const fill = candidate.signal.impliedProbability;
      const wealth = wealthMultiple(fill);
      const plusEv = candidate.verifiedProb > fill;
      if (
        !plusEv ||
        wealth < gates.minPayoutMultiple ||
        fill > gates.maxFillPrice
      ) {
        console.log(
          `  [delphi-tournament] skip "${candidate.signal.question.slice(0, 50)}" outcome=${candidate.signal.outcomeIdx} — wealth ${wealth.toFixed(2)}× fill ${fill.toFixed(2)} fc ${candidate.verifiedProb.toFixed(2)} (need ≥${gates.minPayoutMultiple}× @ ≤${gates.maxFillPrice}, +EV)`,
        );
        continue;
      }
      const budget = perTradeBudget({
        bankrollTokens: ctx.bankrollTokens,
        existingExposureTokens: totalExposure(ctx.exposure),
        marketExposureTokens: BigInt(ctx.exposure[candidate.signal.marketAddress] ?? "0"),
        // Tournament-only ruin-accepted caps — NOT the Kelly-lite
        // maxPositionFraction/maxMarketFraction, which stay sane for
        // normal mode (2026-08-25 post-competition restore).
        maxPositionFraction: AGENT_CONFIG.delphi.tournamentPositionFraction,
        maxMarketFraction: AGENT_CONFIG.delphi.tournamentMarketFraction,
      });
      const sized = await quoteSharesForBudget({
        budgetTokens: budget,
        topOfBookPrice: candidate.signal.impliedProbability,
        maxFillPrice: gates.maxFillPrice,
        quoteBuy: (shares) =>
          this.executor.quoteBuy(candidate.signal.marketAddress, candidate.signal.outcomeIdx, shares),
      });
      if (!sized) {
        ctx.result.sizingSkips++;
        console.warn(
          `  [delphi-tournament] skip "${candidate.signal.question.slice(0, 50)}" — quote-at-size missed budget=${budget} maxFill=${gates.maxFillPrice}`,
        );
        continue;
      }
      console.log(
        `  [delphi-tournament] TAKE "${candidate.signal.question.slice(0, 50)}" outcome=${candidate.signal.outcomeIdx} fc=${candidate.verifiedProb.toFixed(2)} fill=${sized.fillPrice.toFixed(2)} wealth=${(1 / sized.fillPrice).toFixed(2)}× shares=${sized.shares} tokens=${sized.tokensIn}`,
      );
      const ok = await this.executeBuy({
        signal: candidate.signal,
        verifiedProb: candidate.verifiedProb,
        verification: candidate.verification,
        bankrollTokens: ctx.bankrollTokens,
        positions: ctx.positions,
        exposure: ctx.exposure,
        result: ctx.result,
        marketsEnteredThisCycle: ctx.marketsEnteredThisCycle,
        entriesForSummary: ctx.entriesForSummary,
        shares: sized.shares,
        price: sized.fillPrice,
      });
      if (ok) placed++;
    }
  }

  private async executeBuy(ctx: {
    signal: ProbabilitySignal;
    verifiedProb: number;
    verification?: VerificationResult;
    bankrollTokens: bigint;
    positions: Record<string, DelphiOpenPosition>;
    exposure: ExposureLedger;
    result: CycleResult;
    marketsEnteredThisCycle: Set<string>;
    entriesForSummary: Parameters<DelphiRunner["placeKellyEntry"]>[0]["entriesForSummary"];
    shares: bigint;
    price: number;
  }): Promise<boolean> {
    const { signal: finalSignal, verifiedProb, verification, shares, price } = ctx;
    const trade = await this.executor.buyShares({
      marketAddress: finalSignal.marketAddress,
      outcomeIdx: finalSignal.outcomeIdx,
      sharesOut: shares,
      estimatedProbability: verifiedProb,
    });
    if (trade.success) {
      ctx.result.tradesPlaced++;
      ctx.marketsEnteredThisCycle.add(finalSignal.marketAddress);
      addExposure(ctx.exposure, finalSignal.marketAddress, BigInt(trade.tokensIn ?? "0"));
      const entryProvenance: ForecastProvenance = {
        ...finalSignal.estimate.provenance,
        provider: finalSignal.estimate.provenance?.provider ?? finalSignal.estimate.provider,
        model: finalSignal.estimate.provenance?.model ?? finalSignal.estimate.model,
        verified: verification?.ran,
        verifierModel: verification?.model,
      };
      ctx.positions[forecastId(finalSignal.marketAddress, finalSignal.outcomeIdx)] = {
        id: forecastId(finalSignal.marketAddress, finalSignal.outcomeIdx),
        marketAddress: finalSignal.marketAddress,
        outcomeIdx: finalSignal.outcomeIdx,
        question: finalSignal.question,
        forecast: verifiedProb,
        impliedProbability: finalSignal.impliedProbability,
        edge: finalSignal.edge,
        shares: trade.sharesOut ?? "0",
        tokensIn: trade.tokensIn ?? "0",
        openedAt: Date.now(),
        transactionHash: trade.transactionHash,
        model: entryProvenance.model,
        samples: entryProvenance.samples,
        webEvidence: entryProvenance.webEvidence,
        webSource: entryProvenance.webSource,
        corroborated: entryProvenance.corroborated,
        factAuthority: entryProvenance.factAuthority,
        verified: entryProvenance.verified,
        verifierModel: entryProvenance.verifierModel,
        volAnchor: entryProvenance.volAnchor,
      };
      savePositions(this.dataDir, ctx.positions);
      saveExposure(this.dataDir, ctx.exposure);
      appendTradeLedger(this.dataDir, {
        type: "entry",
        marketAddress: finalSignal.marketAddress,
        outcomeIdx: finalSignal.outcomeIdx,
        question: finalSignal.question,
        estimatedProbability: verifiedProb,
        impliedProbability: finalSignal.impliedProbability,
        edge: finalSignal.edge,
        shares: trade.sharesOut,
        tokensIn: trade.tokensIn,
        effectivePrice: trade.effectivePrice,
        transactionHash: trade.transactionHash,
        reason: finalSignal.reason,
        provenance: entryProvenance,
        verification: verification?.ran
          ? {
              verdict: verification.verdict,
              verifierProbability: verification.verifierProbability,
              crossFamily: verification.crossFamily,
              provider: verification.provider,
              model: verification.model,
              reasoning: verification.reasoning,
            }
          : undefined,
      });
      ctx.entriesForSummary.push({
        question: finalSignal.question,
        outcomeIdx: finalSignal.outcomeIdx,
        effectivePrice: trade.effectivePrice,
        estimatedProbability: verifiedProb,
        edge: finalSignal.edge,
        transactionHash: trade.transactionHash,
        model: entryProvenance.model,
        webEvidence: entryProvenance.webEvidence,
        webSource: entryProvenance.webSource,
        corroborated: entryProvenance.corroborated,
        factAuthority: entryProvenance.factAuthority,
        verified: entryProvenance.verified,
        volAnchor: entryProvenance.volAnchor,
      });
      return true;
    }
    console.warn(
      `  [delphi-trade] BUY FAILED "${finalSignal.question.slice(0, 50)}" outcome=${finalSignal.outcomeIdx} shares=${shares} price=${price.toFixed(3)}: ${trade.error}`,
    );
    appendTradeLedger(this.dataDir, {
      type: "entry-failed",
      marketAddress: finalSignal.marketAddress,
      outcomeIdx: finalSignal.outcomeIdx,
      question: finalSignal.question,
      estimatedProbability: verifiedProb,
      impliedProbability: finalSignal.impliedProbability,
      edge: finalSignal.edge,
      error: trade.error,
    });
    return false;
  }

  /**
   * Sell-into-convergence exit pass.
   *
   * For every tracked open position, re-quote the realizable sell price of
   * the held shares and apply the pure exit policy (probability.ts
   * `evaluateConvergenceExit`): take profit when the market price converged
   * to within tolerance of our entry forecast, stop when it moved a full
   * `thesisStopEdge` against the entry price.
   *
   * Notes:
   *   - Positions are scored only at settlement (resolvePositions). A
   *     position we exit early never joins the calibration ledger — honest
   *     by design: there's no ground-truth outcome to score yet.
   *   - Quote the FULL position (quoteSell) so the decision uses the actual
   *     realizable average price, including LMSR depth impact.
   *   - Failures are per-position; a broken sell never aborts the cycle.
   */
  private async convergenceExitPass(
    positions: Record<string, DelphiOpenPosition>,
    exposure: ExposureLedger,
  ): Promise<{ convergence: number; stopped: number; held: number }> {
    const counts = { convergence: 0, stopped: 0, held: 0 };
    if (Object.keys(positions).length === 0) return counts;
    const mode = exitModeAt(this.clock(), this.endgameHoldFromUtc);

    for (const position of Object.values(positions)) {
      const shares = BigInt(position.shares ?? "0");
      if (shares <= 0n) {
        // Dust position (partial fill rounded to zero shares) — drop it.
        delete positions[position.id];
        continue;
      }
      try {
        // ── Stale-subgraph guard: check if market is still open ──────
        // Runs even for adopted orphans (no forecast): a matured market
        // must leave the exposure ledger so tournament sizing is not
        // pinned by ghost TST.
        let marketIsOpen = true;
        try {
          const market = await this.executor.getMarket(position.marketAddress);
          if (market.resolvesAt) {
            const resolvesAtTime = new Date(market.resolvesAt).getTime();
            if (resolvesAtTime > 0 && this.clock() > resolvesAtTime + 30_000) {
              console.log(
                `  [delphi-exit] market ${position.id} resolved at ${market.resolvesAt} — dropping from tracking for redemption`,
              );
              delete positions[position.id];
              marketIsOpen = false;
            }
          }
        } catch (err) {
          console.warn(
            `  [delphi-exit] market status check failed for ${position.id}, holding: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        if (!marketIsOpen) continue;

        // Adopted orphans (chain reconciliation found shares but no entry
        // record) have no forecast to converge toward or stop against —
        // hold them to settlement, where redemption cashes them out.
        if (position.forecast === undefined) continue;

        let quote;
        try {
          quote = await this.executor.quoteSell(position.marketAddress, position.outcomeIdx, shares);
        } catch (err) {
          // Stale-subgraph guard: the SDK's subgraph may not yet report the
          // market as settled, so quoteSellExactIn reverts. Viem's BaseError
          // implements toString() which produces the full multi-line output
          // (we see "Error: MarketNotOpen()" in logs). Check that.
          const full = err instanceof Error ? err.toString() : String(err);
          if (full.toLowerCase().includes("marketnotopen")) {
            console.log(
              `  [delphi-exit] market ${position.id} settled (MarketNotOpen) — dropping from tracking for redemption`,
            );
            delete positions[position.id];
            continue;
          }
          // Hold the position — re-evaluate next cycle. Never sell blind.
          console.warn(
            `  [delphi-exit] sell quote failed for ${position.id}, holding: ${err instanceof Error ? err.message : String(err)}`,
          );
          continue;
        }
        const exit = mode === "hold-to-settlement"
          ? { action: "hold" as const, reason: "endgame: holding to settlement (P&L-only scoring)" }
          : evaluateConvergenceExit({
              forecast: position.forecast,
              entryPrice: position.impliedProbability,
              currentPrice: quote.pricePerShare,
            });
        if (exit.action === "hold") {
          if (mode === "hold-to-settlement") {
            counts.held++;
            console.log(
              `  [delphi-exit] HOLD ${position.id} @ ${quote.pricePerShare.toFixed(2)} (fc ${position.forecast.toFixed(2)}, entry ${position.impliedProbability.toFixed(2)}) — ${exit.reason}`,
            );
          }
          continue;
        }

        let trade;
        let tradeError: unknown;
        try {
          trade = await this.executor.sellShares({
            marketAddress: position.marketAddress,
            outcomeIdx: position.outcomeIdx,
            sharesIn: shares,
          });
        } catch (err) {
          tradeError = err;
          console.warn(`  [delphi-exit] sell threw for ${position.id}: ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }
        if (!trade.success) {
          // sellExactIn reverted — check if it's because the market is settled
          // (the subgraph hasn't caught up yet). Use the same walk helper.
          const isMarketNotOpenSell = (tradeError as any).walk?.(
            (e: any) =>
              e?.shortMessage?.toLowerCase().includes("marketnotopen") ||
              e?.message?.toLowerCase().includes("marketnotopen"),
          ) ?? false;
          if (isMarketNotOpenSell) {
            console.log(
              `  [delphi-exit] market ${position.id} settled on sell (MarketNotOpen) — dropping from tracking for redemption`,
            );
            delete positions[position.id];
            continue;
          }
          console.warn(`  [delphi-exit] sell failed for ${position.id}: ${trade.error}`);
          continue;
        }

        // Release the entry-time exposure for this position.
        const marketExposure = BigInt(exposure[position.marketAddress] ?? "0");
        const released = BigInt(position.tokensIn ?? "0");
        const remaining = marketExposure - released;
        if (remaining > 0n) exposure[position.marketAddress] = remaining.toString();
        else delete exposure[position.marketAddress];
        delete positions[position.id];

        if (exit.action === "sell-convergence") counts.convergence++;
        else counts.stopped++;

        appendTradeLedger(this.dataDir, {
          type: exit.action === "sell-convergence" ? "exit-convergence" : "exit-stop",
          marketAddress: position.marketAddress,
          outcomeIdx: position.outcomeIdx,
          question: position.question,
          forecast: position.forecast,
          // Entry-time edge of the exited thesis — the stop re-entry gate
          // (latestStopsByMarket) compares a new signal against it to decide
          // whether a stronger view justifies re-entering before the cooldown.
          edge: position.edge,
          entryPrice: position.impliedProbability,
          exitPrice: quote.pricePerShare,
          shares: position.shares,
          tokensOut: trade.tokensIn, // tokens received on the sell
          transactionHash: trade.transactionHash,
          reason: exit.reason,
        });
        console.log(
          `  [delphi-exit] ${exit.action === "sell-convergence" ? "converged" : "stopped"}: "${position.question.slice(0, 50)}" @ ${quote.pricePerShare.toFixed(2)} (${exit.reason})`,
        );
      } catch (err) {
        console.warn(`  [delphi-exit] pass error for ${position.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return counts;
  }

  /**
   * Resolve tracked forecasts when their market exits.
   *
   * - `redeem` (settled): the payout tells us whether our outcome won. We
   *   only resolve when attribution is unambiguous — exactly one tracked
   *   position in the market and a tokensOut reading (0 = lost, >0 = won).
   *   With multiple held outcomes we can't tell which one paid, so we close
   *   them out without scoring them (better no calibration point than a
   *   fabricated one).
   * - `liquidate` (expired/failed): no ground truth exists — the market
   *   never resolved. Positions are closed without a forecast record.
   */
  private resolvePositions(
    positions: Record<string, DelphiOpenPosition>,
    marketAddress: string,
    kind: "redeem" | "liquidate",
    tokensOut?: string,
  ): void {
    const inMarket = Object.values(positions).filter((p) => p.marketAddress === marketAddress);
    if (inMarket.length === 0) return;

    if (kind === "redeem" && inMarket.length === 1) {
      const p = inMarket[0];
      // Adopted-orphan guard: a position reconciled from the chain without
      // entry metadata has no forecast to score — close it, don't fabricate
      // a calibration point.
      if (p.forecast !== undefined) {
        const payout = BigInt(tokensOut ?? "0");
        appendCalibration(this.dataDir, {
          id: p.id,
          forecast: p.forecast,
          forecastAt: p.openedAt,
          outcome: payout > 0n ? 1 : 0,
          resolvedAt: Date.now(),
          marketAddress,
          outcomeIdx: p.outcomeIdx,
        });
      }
    }
    for (const p of inMarket) delete positions[p.id];
  }

  /**
   * Reconcile the tracked-position ledger against the chain (source of truth).
   *
   * The chain is the only ledger that never lies: a pm2 reload mid-cycle
   * (production incident 2026-08-15) can land a buy on-chain and in the
   * append-only trade ledger, then kill the process before positions.json /
   * exposure.json are written. The next cycle would then re-size the market
   * as if nothing were at risk — and forget the orphan entirely.
   *
   * For every open on-chain position we don't track: adopt it. Entry
   * metadata (forecast, edge, price, timestamp, tx) is recovered from the
   * trade ledger when an `entry` record matches; otherwise the position is
   * tracked without a forecast (managed + redeemed, never scored — see
   * resolvePositions). Exposure is corrected to the sum of adopted stakes.
   *
   * Failures are non-fatal: reconciliation is a safety net, and a broken
   * listPositions must not block the discovery pass.
   */
  private async reconcileWithChain(
    positions: Record<string, DelphiOpenPosition>,
    exposure: ExposureLedger,
  ): Promise<void> {
    let onChain;
    try {
      onChain = await this.executor.getOpenPositions();
    } catch (err) {
      console.warn(`[delphi-runner] reconcile: chain read failed (${err instanceof Error ? err.message : String(err)})`);
      return;
    }

    const ledger = readTradeLedger(this.dataDir);
    let adopted = 0;
    for (const chainPos of onChain.open) {
      const id = forecastId(chainPos.marketProxy, Number(chainPos.outcomeIdx));
      if (positions[id]) continue; // already tracked

      // Recover entry metadata from the trade ledger (last matching entry).
      const entry = [...ledger]
        .reverse()
        .find(
          (r) =>
            r.type === "entry" &&
            r.marketAddress === chainPos.marketProxy &&
            Number(r.outcomeIdx) === Number(chainPos.outcomeIdx),
        );

      positions[id] = {
        id,
        marketAddress: chainPos.marketProxy,
        outcomeIdx: Number(chainPos.outcomeIdx),
        question: typeof entry?.question === "string" ? entry.question : "unknown (reconciled from chain)",
        forecast: typeof entry?.estimatedProbability === "number" ? entry.estimatedProbability : undefined,
        impliedProbability: typeof entry?.impliedProbability === "number" ? entry.impliedProbability : 0,
        edge: typeof entry?.edge === "number" ? entry.edge : 0,
        shares: chainPos.shares,
        tokensIn: typeof entry?.tokensIn === "string" ? entry.tokensIn : "0",
        openedAt: typeof entry?.timestamp === "number" ? entry.timestamp : Date.now(),
        transactionHash: typeof entry?.transactionHash === "string" ? entry.transactionHash : undefined,
      };
      adopted++;
    }

    // Deliberately adopt-only: we never DROP a tracked position merely
    // because the subgraph doesn't list it — subgraph lag could delete a
    // live holding and free its exposure for a double entry. Settled
    // markets are cleaned up by the redeem sweep (resolvePositions), and
    // exposure is recomputed conservatively below (a stale tracked
    // position over-estimates exposure, shrinking sizing — the safe side).
    const openIds = new Set(onChain.open.map((p) => forecastId(p.marketProxy, Number(p.outcomeIdx))));

    // Recompute exposure from the tracked ledger: adoption may have added
    // stakes. Only shrink — tracked positions the subgraph doesn't (yet)
    // list keep their exposure counted (see adopt-only note above).
    for (const market of Object.keys(exposure)) delete exposure[market];
    for (const p of Object.values(positions)) {
      addExposure(exposure, p.marketAddress, BigInt(p.tokensIn ?? "0"));
    }

    if (adopted > 0) {
      console.warn(
        `[delphi-runner] reconcile: adopted ${adopted} orphan position(s) from the chain (tracked=${Object.keys(positions).length}, open on-chain: ${openIds.size})`,
      );
      savePositions(this.dataDir, positions);
      saveExposure(this.dataDir, exposure);
    }
  }

  /** Start the loop. Exits when the trading window closes. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    let cycle = this.snapshot.cyclesRun;
    const windowCloses = new Date(AGENT_CONFIG.delphi.tradingWindowCloses).getTime();
    const loopUntil = windowCloses + AGENT_CONFIG.delphi.postCloseGraceHours * 3_600_000;

    for (;;) {
      if (Date.now() > loopUntil) {
        console.log("[delphi-runner] post-close grace elapsed — exiting.");
        break;
      }
      cycle++;
      try {
        // Cycle watchdog: every SDK call has its own timeout, but if some
        // unforeseen await still hangs, the hourly loop must not die with it
        // (production incident 2026-08-15: one hung SDK call froze the
        // runner for ~13.5h). A timed-out cycle is abandoned (it keeps
        // unwinding in the background, bounded by its own per-call timeouts)
        // and the loop moves on.
        await withTimeout(this.runCycle(cycle), CYCLE_WATCHDOG_MS, `delphi cycle #${cycle}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[delphi-runner] cycle #${cycle} failed: ${message}`);
        if (this.telegramEnabled) {
          await sendErrorAlert({ cycle, error: message, stack: err instanceof Error ? err.stack : undefined });
        }
      }
      if (process.env.DELPHI_SINGLE_CYCLE === "1") break;
      await new Promise((r) => setTimeout(r, this.loopIntervalMs));
    }
    this.running = false;
  }
}

// =============================================================================
// Entry point
// =============================================================================

// Main-module detection that works under BOTH plain node and pm2.
//
// The naive `process.argv[1].endsWith("runner.js")` guard (and even the
// ESM-standard `import.meta.url === pathToFileURL(argv[1]).href` check)
// fails under pm2: the child's argv[1] is pm2's launcher container
// (…/pm2/lib/ProcessContainerFork.js), which dynamic-imports the target
// script — so argv[1] never names runner.js, the guard never fires, and the
// runner imports, skips start(), and idles silently. That is exactly what
// happened on the VPS (process online, zero logs, zero cycles).
//
// Under pm2 the ProcessContainerFork dynamic-imports exactly one module —
// this one — so "argv[1] is the pm2 container" is a valid entry signal.
// Test runners (vitest) and library imports never fork via that container,
// so the guard stays false there.
import { pathToFileURL } from "node:url";

const argv1 = process.argv[1];
const isDirectRun = argv1 !== undefined && pathToFileURL(argv1).href === import.meta.url;
const isPm2Run = argv1 !== undefined && argv1.includes("ProcessContainerFork");
const isMainEntry = isDirectRun || isPm2Run;

if (isMainEntry) {
  const runner = new DelphiRunner();
  runner.start().catch((err) => {
    console.error("[delphi-runner] fatal:", err);
    process.exit(1);
  });
}
