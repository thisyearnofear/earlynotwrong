/**
 * Delphi endgame policy — pure helpers for the last days of a P&L-only arena.
 *
 * Intentionally has no LLM / executor imports so GET /delphi/status can
 * report the live exit policy without loading the inference ladder.
 */

import { AGENT_CONFIG } from "../config.js";

export type ExitMode = "convergence" | "hold-to-settlement";

export interface TournamentGates {
  minPayoutMultiple: number;
  maxFillPrice: number;
}

const TST_DECIMALS = 1_000_000n;

/**
 * Which exit policy applies at `now`. Malformed / missing dates fail open
 * to convergence — a typo must not silently disable risk management later.
 */
export function exitModeAt(now: number, holdFromUtc?: string | null): ExitMode {
  if (!holdFromUtc) return "convergence";
  const from = Date.parse(holdFromUtc);
  if (!Number.isFinite(from)) return "convergence";
  return now >= from ? "hold-to-settlement" : "convergence";
}

/**
 * Can a position in this market settle and be redeemed before the snapshot?
 * Unknown / malformed `resolvesAt` passes so a missing date does not starve
 * the tape.
 */
export function resolvesBeforeDeadline(
  resolvesAt: string | null | undefined,
  windowClosesUtc: string,
  bufferMs: number,
): boolean {
  if (!resolvesAt) return true;
  const t = Date.parse(resolvesAt);
  if (!Number.isFinite(t)) return true;
  const close = Date.parse(windowClosesUtc);
  if (!Number.isFinite(close)) return true;
  return t + bufferMs <= close;
}

/** Hop-1 vs hop-2 gates from remaining cash (6-dec TST). */
export function tournamentGates(bankrollTokens: bigint): TournamentGates {
  const hop2 = BigInt(AGENT_CONFIG.delphi.hop2BankrollTst) * TST_DECIMALS;
  if (bankrollTokens >= hop2) {
    return {
      minPayoutMultiple: AGENT_CONFIG.delphi.hop2MinPayoutMultiple,
      maxFillPrice: AGENT_CONFIG.delphi.hop2MaxFillPrice,
    };
  }
  return {
    minPayoutMultiple: AGENT_CONFIG.delphi.minPayoutMultiple,
    maxFillPrice: AGENT_CONFIG.delphi.maxFillPrice,
  };
}

export function payoutMultiple(forecast: number, fillPrice: number): number {
  if (!(fillPrice > 0)) return 0;
  return forecast / fillPrice;
}

/**
 * Pick the highest `forecast / fillPrice` that clears the tournament gates.
 * Rank by multiple, not edge: a 0.80 vs 0.32 beats a 0.70 vs 0.55.
 */
export function selectTournamentCandidate<T extends { forecast: number; fillPrice: number }>(
  candidates: T[],
  gates: TournamentGates,
): T | null {
  let best: T | null = null;
  let bestMultiple = Number.NEGATIVE_INFINITY;
  for (const c of candidates) {
    if (!(c.fillPrice > 0) || c.fillPrice > gates.maxFillPrice + 1e-9) continue;
    const multiple = payoutMultiple(c.forecast, c.fillPrice);
    if (multiple < gates.minPayoutMultiple) continue;
    if (multiple > bestMultiple) {
      best = c;
      bestMultiple = multiple;
    }
  }
  return best;
}

/** Rank remaining candidates by multiple descending (retry after a skip). */
export function rankByMultiple<T extends { forecast: number; fillPrice: number }>(candidates: T[]): T[] {
  return [...candidates].sort(
    (a, b) => payoutMultiple(b.forecast, b.fillPrice) - payoutMultiple(a.forecast, a.fillPrice),
  );
}
