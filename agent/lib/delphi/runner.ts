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
  perTradeBudget,
  sizeSharesBudget,
  type MarketEstimate,
  type MarketEstimateInput,
  type ProbabilityConfig,
} from "./probability.js";
import {
  estimateDailyVolFromCloses,
  cryptoThresholdProbability,
  matchCryptoThresholdMarket,
} from "./vol-baseline.js";
import { DelphiWebSearch, type WebSearchBriefing, type WebSearchSource } from "./web-search.js";
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
  /** Injectable clock (tests). */
  now?: () => number;
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
  /** Web briefings fetched fresh this cycle (not served from cache). */
  briefingsFetched: number;
  /** Markets that got a computed crypto vol-baseline reference. */
  volBaselines: number;
  /** Estimates served from the forecast cache (zero inference cost). */
  estimatesCached: number;
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

// =============================================================================
// Exposure ledger (per-market token exposure, for concentration caps)
// =============================================================================

/** marketAddress → tokens currently at risk (18-dec string). */
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
  /** Estimated true probability at entry (the forecast being scored). */
  forecast: number;
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
  ctx: { webBriefing?: WebSearchBriefing; volBaseline?: number },
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
  private readonly clock: () => number;
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
      });
    this.fetchVolBaseline = config.fetchVolBaseline ?? fetchVolBaselineFromSoSoValue;
    this.clock = config.now ?? (() => Date.now());
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
      liquidatesAttempted: 0,
      liquidatesSucceeded: 0,
      sizingSkips: 0,
      anchored: false,
      anchorDeduped: false,
      anchorResults: [],
      exitsConvergence: 0,
      exitsStopped: 0,
      briefingsFetched: 0,
      volBaselines: 0,
      estimatesCached: 0,
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
    try {
      const sweep = await redeemAndLiquidate(this.executor);
      result.redeemsAttempted = sweep.redeemAttempted;
      result.redeemsSucceeded = sweep.redeemSucceeded;
      result.liquidatesAttempted = sweep.liquidateAttempted;
      result.liquidatesSucceeded = sweep.liquidateSucceeded;
      for (const ev of sweep.events) {
        appendTradeLedger(this.dataDir, { type: ev.kind, marketAddress: ev.marketAddress, success: ev.success, tokensOut: ev.tokensOut, error: ev.error });
        // Clear exposure for markets we exited successfully.
        if (ev.success) delete exposure[ev.marketAddress];
        // Resolve tracked forecasts for this market.
        if (ev.success) {
          this.resolvePositions(positions, ev.marketAddress, ev.kind, ev.tokensOut);
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

    // ── 1b. Sell-into-convergence exit pass over tracked open positions ────
    //
    // Markets that resolved were already closed by the redeem sweep above;
    // what remains are positions in still-open markets. Re-price each one
    // against its entry forecast: take profit when the price converged,
    // stop when the market moved against the thesis.
    const exits = await this.convergenceExitPass(positions, exposure);
    result.exitsConvergence = exits.convergence;
    result.exitsStopped = exits.stopped;

    // ── 2. Discover + estimate + gate + trade ─────────────────────────────
    const markets = await this.executor.listOpenMarkets({ limit: 25 });
    result.marketsEvaluated = markets.length;
    const decisions: DelphiDecisionRecord[] = [];
    const entriesForSummary: Array<{
      question: string;
      outcomeIdx: number;
      effectivePrice?: number;
      estimatedProbability?: number;
      edge: number;
      transactionHash?: string;
      model?: string;
      webEvidence?: boolean;
      volAnchor?: number;
    }> = [];

    for (const market of markets) {
      // Alpha context: web briefing (capped, cached) + vol baseline (crypto
      // threshold markets only). Both are best-effort — a failure degrades
      // to the plain LLM estimate, never blocks the market.
      let webBriefing: WebSearchBriefing | undefined;
      try {
        const briefing = await this.webSearch.briefing(market.question ?? "");
        if (briefing) {
          webBriefing = briefing;
          if (!briefing.cached) result.briefingsFetched++;
        }
      } catch (err) {
        console.warn(`  [delphi-search] briefing error: ${err instanceof Error ? err.message : String(err)}`);
      }
      let volBaseline: number | undefined;
      try {
        volBaseline = await this.fetchVolBaseline(market.question ?? "", market.category, this.clock());
        if (volBaseline !== undefined) result.volBaselines++;
      } catch (err) {
        console.warn(`  [delphi-vol] baseline error: ${err instanceof Error ? err.message : String(err)}`);
      }

      const input = await buildEstimateInput(market, this.executor, { webBriefing, volBaseline });
      if (!input) continue;

      // Forecast cache: an estimate's inputs are the question, the injected
      // briefing (fingerprinted in the key — its own 6h cache keeps the
      // fingerprint stable across hourly cycles), and the implied
      // probabilities (bucketed to 2¢). When nothing moved, the prior
      // ensemble is still the right answer — reuse it at zero gateway cost.
      // Markets with a vol-baseline anchor are NEVER cached: the blend is
      // baked into the estimate and the anchor tracks the live spot price.
      let estimate: MarketEstimate | null;
      if (volBaseline !== undefined) {
        estimate = await estimateProbability(input, this.probability);
      } else {
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

      const signals = evaluateProbabilitySignal(estimate, input.impliedProbabilities, this.probability);
      for (const signal of signals) {
        decisions.push({
          marketAddress: signal.marketAddress,
          outcomeIdx: signal.outcomeIdx,
          decision: signal.decision,
          edge: signal.edge,
        });
        if (signal.decision !== "buy") continue;

        // ── Sizing: bankroll fraction → shares, with concentration caps ──
        const budget = perTradeBudget({
          bankrollTokens,
          existingExposureTokens: totalExposure(exposure),
          marketExposureTokens: BigInt(exposure[signal.marketAddress] ?? "0"),
          maxPositionFraction: AGENT_CONFIG.delphi.maxPositionFraction,
          maxMarketFraction: AGENT_CONFIG.delphi.maxMarketFraction,
        });
        const price = signal.impliedProbability;
        const shares = sizeSharesBudget(budget, price);
        if (shares <= 0n) {
          result.sizingSkips++;
          // Diagnostic: a skip with bankroll but zero budget means a cap;
          // a skip with zero bankroll means the balance read failed.
          console.warn(
            `  [delphi-sizing] skip "${signal.question.slice(0, 50)}" outcome=${signal.outcomeIdx} price=${price.toFixed(3)} budget=${budget} bankroll=${bankrollTokens}`,
          );
          continue;
        }

        const trade = await this.executor.buyShares({
          marketAddress: signal.marketAddress,
          outcomeIdx: signal.outcomeIdx,
          sharesOut: shares,
          estimatedProbability: signal.estimatedProbability,
        });
        if (trade.success) {
          result.tradesPlaced++;
          addExposure(exposure, signal.marketAddress, BigInt(trade.tokensIn ?? "0"));
          // Track the open forecast so redemption resolves it for calibration.
          positions[forecastId(signal.marketAddress, signal.outcomeIdx)] = {
            id: forecastId(signal.marketAddress, signal.outcomeIdx),
            marketAddress: signal.marketAddress,
            outcomeIdx: signal.outcomeIdx,
            question: signal.question,
            forecast: signal.estimatedProbability,
            impliedProbability: signal.impliedProbability,
            edge: signal.edge,
            shares: trade.sharesOut ?? "0",
            tokensIn: trade.tokensIn ?? "0",
            openedAt: Date.now(),
            transactionHash: trade.transactionHash,
            // Provenance for the dashboard card + audit trail.
            model: signal.estimate.provenance?.model,
            samples: signal.estimate.provenance?.samples,
            webEvidence: signal.estimate.provenance?.webEvidence,
            volAnchor: signal.estimate.provenance?.volAnchor,
          };
          appendTradeLedger(this.dataDir, {
            type: "entry",
            marketAddress: signal.marketAddress,
            outcomeIdx: signal.outcomeIdx,
            question: signal.question,
            estimatedProbability: signal.estimatedProbability,
            impliedProbability: signal.impliedProbability,
            edge: signal.edge,
            shares: trade.sharesOut,
            tokensIn: trade.tokensIn,
            effectivePrice: trade.effectivePrice,
            transactionHash: trade.transactionHash,
            reason: signal.reason,
            provenance: signal.estimate.provenance,
          });
          entriesForSummary.push({
            question: signal.question,
            outcomeIdx: signal.outcomeIdx,
            effectivePrice: trade.effectivePrice,
            estimatedProbability: signal.estimatedProbability,
            edge: signal.edge,
            transactionHash: trade.transactionHash,
            // Provenance tags for the Telegram entry line.
            model: signal.estimate.provenance?.model,
            webEvidence: signal.estimate.provenance?.webEvidence,
            volAnchor: signal.estimate.provenance?.volAnchor,
          });
        }
      }
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

    if (this.telegramEnabled) {
      await sendDelphiCycleSummary({
        cycle: cycleNumber,
        marketsEvaluated: result.marketsEvaluated,
        estimatesProduced: result.estimatesProduced,
        tradesPlaced: result.tradesPlaced,
        redeemsSucceeded: result.redeemsSucceeded + result.liquidatesSucceeded,
        exits: { convergence: result.exitsConvergence, stopped: result.exitsStopped },
        alpha: { briefings: result.briefingsFetched, volBaselines: result.volBaselines, cached: result.estimatesCached },
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
    };
    saveSnapshot(this.dataDir, this.snapshot);
    saveExposure(this.dataDir, exposure);
    savePositions(this.dataDir, positions);

    console.log(
      `[delphi-runner] cycle #${cycleNumber}: markets=${result.marketsEvaluated} estimates=${result.estimatesProduced} cached=${result.estimatesCached} trades=${result.tradesPlaced} exits=${result.exitsConvergence + result.exitsStopped} (converged ${result.exitsConvergence}, stopped ${result.exitsStopped}) redeems=${result.redeemsSucceeded}/${result.redeemsAttempted} liquidates=${result.liquidatesSucceeded}/${result.liquidatesAttempted} sizingSkips=${result.sizingSkips} briefings=${result.briefingsFetched} volBaselines=${result.volBaselines}`,
    );
    return result;
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
  ): Promise<{ convergence: number; stopped: number }> {
    const counts = { convergence: 0, stopped: 0 };
    if (Object.keys(positions).length === 0) return counts;

    for (const position of Object.values(positions)) {
      const shares = BigInt(position.shares ?? "0");
      if (shares <= 0n) {
        // Dust position (partial fill rounded to zero shares) — drop it.
        delete positions[position.id];
        continue;
      }
      try {
        let quote;
        try {
          quote = await this.executor.quoteSell(position.marketAddress, position.outcomeIdx, shares);
        } catch (err) {
          // Quote failed (e.g. market paused, client without sell support).
          // Hold the position — re-evaluate next cycle. Never sell blind.
          console.warn(
            `  [delphi-exit] sell quote failed for ${position.id}, holding: ${err instanceof Error ? err.message : String(err)}`,
          );
          continue;
        }
        const exit = evaluateConvergenceExit({
          forecast: position.forecast,
          entryPrice: position.impliedProbability,
          currentPrice: quote.pricePerShare,
        });
        if (exit.action === "hold") continue;

        let trade;
        try {
          trade = await this.executor.sellShares({
            marketAddress: position.marketAddress,
            outcomeIdx: position.outcomeIdx,
            sharesIn: shares,
          });
        } catch (err) {
          console.warn(`  [delphi-exit] sell threw for ${position.id}: ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }
        if (!trade.success) {
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
    for (const p of inMarket) delete positions[p.id];
  }

  /** Start the loop. Exits when the trading window closes. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    let cycle = this.snapshot.cyclesRun;
    const windowCloses = new Date(AGENT_CONFIG.delphi.tradingWindowCloses).getTime();

    for (;;) {
      if (Date.now() > windowCloses) {
        console.log("[delphi-runner] trading window closed — exiting.");
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
