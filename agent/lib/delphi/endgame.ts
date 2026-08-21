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

/** Forecast / fill — calibration quality, not the wealth jump. */
export function payoutMultiple(forecast: number, fillPrice: number): number {
  if (!(fillPrice > 0)) return 0;
  return forecast / fillPrice;
}

/**
 * Wealth multiple if the ticket pays 1.0: `1 / fillPrice`.
 * A 0.33 fill 3×s the stake; forecast/fill of 1.19 does not.
 */
export function wealthMultiple(fillPrice: number): number {
  if (!(fillPrice > 0)) return 0;
  return 1 / fillPrice;
}

/**
 * Tickets the tournament must never take even if they 12× on paper.
 * WTI settle-below YES with spot ~$87 on settlement day is ruin, not a longshot.
 */
export function isForbiddenTournamentTicket(
  question: string,
  outcomeIdx: number,
  outcomes?: readonly string[],
): boolean {
  const q = question.toLowerCase();
  const wtiBelow = /\bwti\b/.test(q) && /below\s*\$?\s*65/.test(q);
  if (!wtiBelow) return false;
  const label = (outcomes?.[outcomeIdx] ?? "").trim().toLowerCase();
  if (label === "yes") return true;
  if (label === "no") return false;
  // Default binary order is Yes, No.
  return outcomeIdx === 0;
}

/**
 * Pick the cheapest +EV that still 3×s the stake (`1/fill` ≥ min, fill ≤ max).
 * Tie-break on forecast/fill so a better-calibrated ticket of the same price wins.
 */
export function selectTournamentCandidate<T extends { forecast: number; fillPrice: number }>(
  candidates: T[],
  gates: TournamentGates,
): T | null {
  const ranked = rankByMultiple(
    candidates.filter((c) => clearsTournamentGates(c, gates)),
  );
  return ranked[0] ?? null;
}

export function clearsTournamentGates(
  c: { forecast: number; fillPrice: number },
  gates: TournamentGates,
): boolean {
  if (!(c.fillPrice > 0) || c.fillPrice > gates.maxFillPrice + 1e-9) return false;
  if (!(c.forecast > c.fillPrice)) return false;
  return wealthMultiple(c.fillPrice) + 1e-9 >= gates.minPayoutMultiple;
}

/** Rank remaining candidates by wealth multiple, then forecast/fill. */
export function rankByMultiple<T extends { forecast: number; fillPrice: number }>(candidates: T[]): T[] {
  return [...candidates].sort((a, b) => {
    const dw = wealthMultiple(b.fillPrice) - wealthMultiple(a.fillPrice);
    if (dw !== 0) return dw;
    return payoutMultiple(b.forecast, b.fillPrice) - payoutMultiple(a.forecast, a.fillPrice);
  });
}
