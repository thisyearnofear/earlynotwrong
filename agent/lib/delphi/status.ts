/**
 * Delphi status reader — disk-backed view of the prediction-market runner.
 *
 * The Delphi loop runs in its own pm2 process (`earlynotwrong-delphi`) and
 * persists its state under `AGENT_DATA_DIR/delphi/` (snapshot.json,
 * positions.json, exposure.json, forecasts.jsonl, trades.jsonl). The main
 * HTTP server runs in a DIFFERENT process, so it can't reach the runner's
 * in-memory state — instead it reads the same files off disk. This keeps the
 * two processes loosely coupled and works across pm2 restarts.
 *
 * Read-only: never writes. Returns an honest empty shape when the runner has
 * never produced data (no fabricated defaults).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateCalibrationMetrics, type CalibrationMetrics } from "conviction-core";
import type { AnchorResult } from "../anchors/types.js";
import type { DelphiOpenPosition } from "./runner.js";

/** Resolved forecast (from forecasts.jsonl) — the calibration input. */
interface ResolvedForecast {
  id: string;
  forecast: number;
  forecastAt: number;
  outcome: 0 | 1;
  resolvedAt: number;
  marketAddress: string;
  outcomeIdx: number;
}

/** Scored row from forecasts-all.jsonl — same fields + observation count. */
interface ResolvedAllForecast extends ResolvedForecast {
  observations: number;
}

export interface DelphiStatus {
  /** Whether the runner has ever produced data (snapshot exists). */
  hasData: boolean;
  enabled: boolean;
  network: string;
  competition: {
    windowOpens: string;
    windowCloses: string;
    /** ms until the window closes (negative when over). */
    msRemaining: number;
  };
  snapshot: {
    lastCycleAt: number | null;
    cyclesRun: number;
    tradesPlaced: number;
    marketsSeen: number;
    /** Cumulative alpha-stack activity since the runner first produced data. */
    exitsConvergence: number;
    exitsStopped: number;
    briefingsFetched: number;
    volBaselines: number;
    estimatesCached: number;
    factChecks: number;
    verificationsRun: number;
    verificationBlocks: number;
    lastAnchoredThesisHash: string | null;
  } | null;
  /** Most recent on-chain anchor attempt (per-adapter results). */
  lastAnchor: {
    thesisHash: string;
    anchoredAt: number;
    convictionScore: number;
    results: AnchorResult[];
  } | null;
  /** Open forecasts the runner is currently holding. */
  openPositions: DelphiOpenPosition[];
  /** Total competition tokens currently at risk (18-dec string). */
  totalExposureTokens: string;
  /** Calibration metrics over every resolved forecast. */
  calibration: CalibrationMetrics & { totalForecasts: number };
  /**
   * Calibration over EVERY estimate the runner made (traded or not), scored
   * from forecasts-all.jsonl once markets settle. The unbiased forecaster
   * record — the traded-only `calibration` above only covers markets where
   * edge + sizing let us enter, so it can't answer "how good is the
   * forecaster overall". totalEstimates counts raw observations in
   * estimates.jsonl (the time series behind the scored rows). Zeroed when
   * the runner has produced no estimates yet.
   */
  allForecasts: CalibrationMetrics & { totalForecasts: number; totalEstimates: number; scoredMarkets: number; droppedMarkets: number };
}

function getDelphiDataDir(): string {
  return join(process.env.AGENT_DATA_DIR ?? join(process.cwd(), "data"), "delphi");
}

function readJsonOrNull<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function readJsonl<T>(path: string): T[] {
  try {
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf-8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as T);
  } catch {
    return [];
  }
}

interface DiskSnapshot {
  lastCycleAt: number | null;
  cyclesRun: number;
  tradesPlaced: number;
  marketsSeen: number;
  exitsConvergence?: number;
  exitsStopped?: number;
  briefingsFetched?: number;
  volBaselines?: number;
  estimatesCached?: number;
  factChecks?: number;
  verificationsRun?: number;
  verificationBlocks?: number;
  lastAnchoredThesisHash: string | null;
  lastAnchor: DelphiStatus["lastAnchor"];
}

/**
 * Build the full status view from disk. Pure reads — safe to call on every
 * dashboard poll.
 */
export function readDelphiStatus(config: { windowOpens: string; windowCloses: string; network: string; enabled: boolean }): DelphiStatus {
  const dir = getDelphiDataDir();
  const snapshot = readJsonOrNull<DiskSnapshot>(join(dir, "snapshot.json"));
  const positions = readJsonOrNull<Record<string, DelphiOpenPosition>>(join(dir, "positions.json")) ?? {};
  const exposure = readJsonOrNull<Record<string, string>>(join(dir, "exposure.json")) ?? {};
  const resolved = readJsonl<ResolvedForecast>(join(dir, "forecasts.jsonl"));
  const allResolved = readJsonl<ResolvedAllForecast>(join(dir, "forecasts-all.jsonl"));
  const estimatesLog = readJsonl<unknown>(join(dir, "estimates.jsonl"));
  const droppedMarkets = readJsonl<unknown>(join(dir, "forecasts-dropped.jsonl"));

  const totalExposure = Object.values(exposure).reduce((acc, v) => acc + BigInt(v ?? "0"), 0n);
  const metrics = calculateCalibrationMetrics(resolved);

  const allMetrics = calculateCalibrationMetrics(allResolved);
  const uniqueScoredMarkets = new Set(allResolved.map((r) => r.marketAddress)).size;

  return {
    hasData: snapshot !== null,
    enabled: config.enabled,
    network: config.network,
    competition: {
      windowOpens: config.windowOpens,
      windowCloses: config.windowCloses,
      msRemaining: new Date(config.windowCloses).getTime() - Date.now(),
    },
    snapshot: snapshot
      ? {
          lastCycleAt: snapshot.lastCycleAt,
          cyclesRun: snapshot.cyclesRun,
          tradesPlaced: snapshot.tradesPlaced,
          marketsSeen: snapshot.marketsSeen,
          // Older snapshots predate the alpha-stack counters — default to 0.
          exitsConvergence: snapshot.exitsConvergence ?? 0,
          exitsStopped: snapshot.exitsStopped ?? 0,
          briefingsFetched: snapshot.briefingsFetched ?? 0,
          volBaselines: snapshot.volBaselines ?? 0,
          estimatesCached: snapshot.estimatesCached ?? 0,
          factChecks: snapshot.factChecks ?? 0,
          verificationsRun: snapshot.verificationsRun ?? 0,
          verificationBlocks: snapshot.verificationBlocks ?? 0,
          lastAnchoredThesisHash: snapshot.lastAnchoredThesisHash,
        }
      : null,
    lastAnchor: snapshot?.lastAnchor ?? null,
    openPositions: Object.values(positions).sort((a, b) => b.openedAt - a.openedAt),
    totalExposureTokens: totalExposure.toString(),
    calibration: { ...metrics, totalForecasts: resolved.length },
    allForecasts: {
      ...allMetrics,
      totalForecasts: allResolved.length,
      totalEstimates: estimatesLog.length,
      scoredMarkets: uniqueScoredMarkets,
      droppedMarkets: droppedMarkets.length,
    },
  };
}
