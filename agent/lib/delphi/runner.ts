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
 * State: JSONL trade ledger + a last-cycle snapshot under
 * `AGENT_DATA_DIR/delphi/` so a pm2 restart resumes cleanly.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_CONFIG } from "../config.js";
import { sendDelphiCycleSummary, sendErrorAlert } from "../telegram.js";
import type { AnchorResult } from "../anchors/types.js";
import { DelphiExecutor, type DelphiMarket } from "./executor.js";
import { redeemAndLiquidate } from "./lifecycle.js";
import {
  anchorDelphiCycle,
  type DelphiAnchorFn,
  type DelphiDecisionRecord,
} from "./anchoring.js";
import {
  estimateProbability,
  evaluateProbabilitySignal,
  perTradeBudget,
  sizeSharesBudget,
  type MarketEstimateInput,
  type ProbabilityConfig,
} from "./probability.js";
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
}

interface DelphiRunnerSnapshot {
  lastCycleAt: number | null;
  cyclesRun: number;
  tradesPlaced: number;
  marketsSeen: number;
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
// Market → EstimateInput mapping
// =============================================================================

/**
 * Build the estimator input from a discovered market + its current implied
 * probabilities. The runner derives implied probabilities from the LMSR
 * quotes: a 1-share quote for each outcome gives us the implied price per
 * outcome, which (on a well-formed binary market) sums to ~1.
 *
 * Binary markets only for Phase 2 — multi-outcome needs a sizing model.
 */
async function buildEstimateInput(
  market: DelphiMarket,
  executor: DelphiExecutor,
): Promise<MarketEstimateInput | null> {
  const question = market.question;
  if (!question) return null;

  // For the scaffold, assume binary (Yes/No). If the market lists outcomes
  // in its payload we'd use those; for now, probe outcomes 0 and 1.
  const outcomes = ["Yes", "No"];
  const impliedProbabilities = await executor.getImpliedProbabilities(market.id, outcomes.length);
  if (!impliedProbabilities) return null;

  return {
    marketAddress: market.id,
    question,
    category: market.category,
    impliedProbabilities,
    outcomes,
  };
}

// =============================================================================
// Runner
// =============================================================================

export class DelphiRunner {
  private readonly executor: DelphiExecutor;
  private readonly probability: ProbabilityConfig;
  private readonly dataDir: string;
  private readonly loopIntervalMs: number;
  private readonly telegramEnabled: boolean;
  private readonly enabledCheck: () => boolean;
  private readonly anchorFn?: DelphiAnchorFn;
  private snapshot: DelphiRunnerSnapshot;
  private running = false;

  constructor(config: DelphiRunnerConfig = {}) {
    this.executor = config.executor ?? new DelphiExecutor();
    this.probability = config.probability ?? {};
    this.dataDir = getDelphiDataDir(config.dataDir);
    this.loopIntervalMs =
      config.loopIntervalMs ?? AGENT_CONFIG.delphi.loopIntervalMinutes * 60_000;
    this.telegramEnabled = config.telegramEnabled ?? true;
    this.enabledCheck = config.enabled ?? (() => process.env.DELPHI_ENABLED === "1");
    this.anchorFn = config.anchor;
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
    };

    if (!this.enabledCheck()) {
      console.log("[delphi-runner] DELPHI_ENABLED is off — cycle skipped.");
      return result;
    }

    const health = await this.executor.healthCheck();
    if (!health.available) {
      const help = health.help ? ` (${health.help})` : "";
      throw new Error(`Delphi health check failed: ${health.diagnostics.join("; ")}${help}`);
    }

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
    } catch (err) {
      // Lifecycle sweep is best-effort: log and continue to discovery so a
      // buggy liquidation path can't freeze the whole cycle.
      console.warn(`[delphi-runner] lifecycle sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    }

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
    }> = [];

    for (const market of markets) {
      const input = await buildEstimateInput(market, this.executor);
      if (!input) continue;

      const estimate = await estimateProbability(input, this.probability);
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
          });
          entriesForSummary.push({
            question: signal.question,
            outcomeIdx: signal.outcomeIdx,
            effectivePrice: trade.effectivePrice,
            estimatedProbability: signal.estimatedProbability,
            edge: signal.edge,
            transactionHash: trade.transactionHash,
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
    };
    saveSnapshot(this.dataDir, this.snapshot);
    saveExposure(this.dataDir, exposure);
    savePositions(this.dataDir, positions);

    console.log(
      `[delphi-runner] cycle #${cycleNumber}: markets=${result.marketsEvaluated} estimates=${result.estimatesProduced} trades=${result.tradesPlaced} redeems=${result.redeemsSucceeded}/${result.redeemsAttempted} liquidates=${result.liquidatesSucceeded}/${result.liquidatesAttempted} sizingSkips=${result.sizingSkips}`,
    );
    return result;
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
        await this.runCycle(cycle);
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

if (process.argv[1] && process.argv[1].endsWith("runner.js")) {
  const runner = new DelphiRunner();
  runner.start().catch((err) => {
    console.error("[delphi-runner] fatal:", err);
    process.exit(1);
  });
}
