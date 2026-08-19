/**
 * All-forecasts log — unbiased calibration over every estimate, not just
 * traded forecasts.
 *
 * The traded-only ledger (forecasts.jsonl, fed by the redemption sweep) has
 * a selection-bias problem: it only scores markets where edge cleared the
 * gate AND sizing produced shares. If we ever sell prediction signals the
 * honest question is "how calibrated is the forecaster overall?", and the
 * traded-only record can't answer it (the markets we declined are exactly
 * the ones that test the gate's false-negative rate).
 *
 * This module fixes that cheaply:
 *   - `appendForecastLog` runs in the discovery loop: every estimate every
 *     cycle (traded or not) is appended to estimates.jsonl as a time series.
 *   - `resolveForecastLog` runs once per cycle: for each distinct logged
 *     market it fetches the market status (one REST call per market), and
 *     when the market is settled it writes the LAST forecast made per
 *     (market, outcomeIdx) into forecasts-all.jsonl — one calibration row
 *     per outcome view, exactly matching the traded-ledger semantics.
 *     Expired/failed markets are dropped (no ground truth — same rule as
 *     the traded ledger's liquidation path).
 *
 * Idempotency: a market is resolved at most once — presence in
 * forecasts-all.jsonl (scored) or forecasts-dropped.jsonl (no ground truth)
 * short-circuits future cycles.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProbabilityForecast } from "conviction-core";
import type { MarketEstimate } from "./probability.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One estimate observation — a point on the forecast time series. */
export interface ForecastLogEntry {
  marketAddress: string;
  outcomeIdx: number;
  question: string;
  category?: string;
  /** Our estimated probability for this outcome, 0-1. */
  forecast: number;
  /** Market-implied probability at estimate time, 0-1 (undefined when the
   *  input didn't carry it, e.g. authority-direct estimates). */
  impliedProbability?: number;
  /** When the estimate was produced (ms epoch). */
  estimatedAt: number;
  model?: string;
  provider?: string;
  /** Provenance snapshot (the evidence behind this estimate). */
  provenance?: {
    factAuthority?: string;
    webEvidence?: boolean;
    corroborated?: boolean;
    volAnchor?: number;
    samples?: number;
  };
}

/** A scored calibration row — the LAST forecast for (market, outcome). */
export interface ResolvedAllForecast extends ProbabilityForecast {
  marketAddress: string;
  outcomeIdx: number;
  /** Total estimate observations logged for this (market, outcome) pair —
   *  lets the post-mortem see how long a view was held before resolution. */
  observations: number;
}

/** Resolution details needed from the market provider. */
export interface ForecastLogMarketDetails {
  status: string;
  winningOutcomeIdx?: number | string | null;
}

// ---------------------------------------------------------------------------
// Persistence helpers (same JSONL discipline as the traded ledger)
// ---------------------------------------------------------------------------

const ESTIMATES_FILE = "estimates.jsonl";
const SCORED_FILE = "forecasts-all.jsonl";
const DROPPED_FILE = "forecasts-dropped.jsonl";

function readJsonlRows<T>(dir: string, name: string): T[] {
  try {
    const path = join(dir, name);
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf-8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as T);
  } catch {
    return [];
  }
}

function appendJsonl(dir: string, name: string, rows: unknown[]): void {
  if (rows.length === 0) return;
  try {
    appendFileSync(join(dir, name), rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8");
  } catch (err) {
    console.warn(`[delphi-forecast-log] ${name} append failed:`, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Append the cycle's estimates (one row per outcome) to estimates.jsonl.
 * Called from the discovery loop AFTER the estimate is final (post-ensemble,
 * cached estimates included — a cached estimate is still the view we held).
 */
export function appendForecastLog(
  dir: string,
  estimate: MarketEstimate,
  impliedProbabilities: number[],
): void {
  const rows: ForecastLogEntry[] = estimate.outcomes.map((o) => ({
    marketAddress: estimate.marketAddress,
    outcomeIdx: o.outcomeIdx,
    question: estimate.question,
    category: estimate.category,
    forecast: o.probability,
    impliedProbability: Array.isArray(impliedProbabilities) ? impliedProbabilities[o.outcomeIdx] : undefined,
    estimatedAt: estimate.estimatedAt,
    model: estimate.model,
    provider: estimate.provider,
    provenance: estimate.provenance
      ? {
          factAuthority: estimate.provenance.factAuthority,
          webEvidence: estimate.provenance.webEvidence,
          corroborated: estimate.provenance.corroborated,
          volAnchor: estimate.provenance.volAnchor,
          samples: estimate.provenance.samples,
        }
      : undefined,
  }));
  appendJsonl(dir, ESTIMATES_FILE, rows);
}

/** Distinct markets already resolved-or-dropped (idempotency key). */
function terminalMarkets(dir: string): Set<string> {
  const done = new Set<string>();
  for (const row of readJsonlRows<ResolvedAllForecast>(dir, SCORED_FILE)) done.add(row.marketAddress);
  for (const row of readJsonlRows<{ marketAddress: string }>(dir, DROPPED_FILE)) done.add(row.marketAddress);
  return done;
}

/**
 * Resolve settled markets in the estimate log.
 *
 * For every distinct logged market not yet terminal: fetch market details;
 * if settled → score the LAST forecast per (market, outcomeIdx) into
 * forecasts-all.jsonl (outcome 1 for the winner, 0 for the rest); if
 * expired/failed → drop the market from further checks (no ground truth).
 * Unsettled markets stay pending and are re-checked next cycle.
 *
 * Cost: one getMarket call per pending market per cycle (≤ ~15 on the
 * competition schedule). All failures are non-fatal — the pass retries next
 * cycle.
 */
export async function resolveForecastLog(
  dir: string,
  opts: {
    getMarketDetails: (marketAddress: string) => Promise<ForecastLogMarketDetails>;
    clock?: () => number;
    log?: (msg: string) => void;
  },
): Promise<{ scored: number; dropped: number; pending: number }> {
  const clock = opts.clock ?? Date.now;
  const rows = readJsonlRows<ForecastLogEntry>(dir, ESTIMATES_FILE);
  if (rows.length === 0) return { scored: 0, dropped: 0, pending: 0 };

  const terminal = terminalMarkets(dir);
  const pendingMarkets = [...new Set(rows.map((r) => r.marketAddress).filter((m) => !terminal.has(m)))];
  const result = { scored: 0, dropped: 0, pending: 0 };

  for (const marketAddress of pendingMarkets) {
    let details: ForecastLogMarketDetails;
    try {
      details = await opts.getMarketDetails(marketAddress);
    } catch (err) {
      // Transient REST failure — try again next cycle.
      opts.log?.(`  [delphi-forecast-log] market lookup failed for ${marketAddress.slice(0, 10)}…: ${err instanceof Error ? err.message : String(err)}`);
      result.pending++;
      continue;
    }

    const marketRows = rows.filter((r) => r.marketAddress === marketAddress);

    if (details.status === "expired" || details.status === "failed") {
      // No ground truth — same rule as the traded ledger's liquidation path.
      const q = marketRows[0]?.question ?? "unknown";
      appendJsonl(dir, DROPPED_FILE, [{ marketAddress, question: q, status: details.status, droppedAt: clock() }]);
      result.dropped++;
      opts.log?.(`  [delphi-forecast-log] ${marketAddress.slice(0, 10)}… ${details.status} — forecast log closed without scoring`);
      continue;
    }

    if (details.status !== "settled") {
      result.pending++;
      continue;
    }

    const winnerRaw = details.winningOutcomeIdx;
    if (winnerRaw === null || winnerRaw === undefined || winnerRaw === "") {
      // Status says settled but the winner index hasn't propagated through
      // the REST index yet — retry next cycle.
      result.pending++;
      continue;
    }
    const winner = typeof winnerRaw === "number" ? winnerRaw : parseInt(winnerRaw, 10);
    if (!Number.isInteger(winner) || winner < 0) {
      result.pending++;
      continue;
    }

    // Score the LAST forecast per outcome per market — the view we held
    // going into settlement (the traded ledger's one-row-per-position rule).
    const lastByOutcome = new Map<number, { latest: ForecastLogEntry; observations: number }>();
    for (const r of marketRows) {
      const cur = lastByOutcome.get(r.outcomeIdx);
      if (cur) cur.observations++;
      if (!cur || r.estimatedAt >= cur.latest.estimatedAt) {
        lastByOutcome.set(r.outcomeIdx, { latest: r, observations: (cur?.observations ?? 0) || 1 });
      }
    }

    const resolvedAt = clock();
    const scored: ResolvedAllForecast[] = [...lastByOutcome.entries()].map(([outcomeIdx, { latest, observations }]) => ({
      id: `${marketAddress}:${outcomeIdx}`,
      forecast: latest.forecast,
      forecastAt: latest.estimatedAt,
      outcome: outcomeIdx === winner ? 1 : 0,
      resolvedAt,
      marketAddress,
      outcomeIdx,
      observations,
    }));
    appendJsonl(dir, SCORED_FILE, scored);
    result.scored++;
    opts.log?.(
      `  [delphi-forecast-log] ${marketAddress.slice(0, 10)}… settled (winner=idx${winner}) — scored ${scored.length} outcome forecasts (${marketRows.length} observations)`,
    );
  }

  return result;
}

/** Every resolved forecast from the all-forecasts ledger. */
export function loadAllForecastsLedger(dir: string): ResolvedAllForecast[] {
  return readJsonlRows<ResolvedAllForecast>(dir, SCORED_FILE);
}

/** Count of logged estimate observations (for snapshot/status surfacing). */
export function countForecastLogEntries(dir: string): number {
  return readJsonlRows<ForecastLogEntry>(dir, ESTIMATES_FILE).length;
}

/** Test hook: wipe the ledger files (used by tests that need a clean dir). */
export function resetForecastLogForTests(dir: string): void {
  for (const name of [ESTIMATES_FILE, SCORED_FILE, DROPPED_FILE]) {
    const p = join(dir, name);
    if (existsSync(p)) writeFileSync(p, "", "utf-8");
  }
}

// (no DelphiMarket re-export — import it from executor.js directly)
