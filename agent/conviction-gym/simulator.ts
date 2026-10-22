/**
 * Conviction Gym — simulator (physics only).
 *
 * Ported from agent/lib/backtest.ts's SimState mechanics, minus the baked-in
 * policy. The simulator marks positions to market, executes entries/exits
 * with slippage + gas, enforces bankroll constraints, and can auto-apply the
 * production risk tiers (assisted mode) — but it never CHOOSES a trade.
 */

import {
  accruePosition,
  evaluatePosition,
  openPosition,
  type HeldPosition,
} from "../lib/conviction-signal.js";
import type { EnvConfig, GymTrade } from "./types.js";

export interface SimPosition extends HeldPosition {}

export interface SimState {
  cashUsd: number;
  bnbUsd: number;
  positions: SimPosition[];
  gasSpentUsd: number;
  realizedPnlUsd: number;
  peakValueUsd: number;
  prevValueUsd: number;
  dailyValues: number[];
}

export function initialSimState(cfg: EnvConfig): SimState {
  const v = cfg.initialCashUsd + cfg.initialBnbUsd;
  return {
    cashUsd: cfg.initialCashUsd,
    bnbUsd: cfg.initialBnbUsd,
    positions: [],
    gasSpentUsd: 0,
    realizedPnlUsd: 0,
    peakValueUsd: v,
    prevValueUsd: v,
    dailyValues: [],
  };
}

/**
 * Mark a position to market: `amountUsd` is the cost BASIS, so the current
 * value is the basis scaled by price appreciation since entry.
 */
export function positionValueUsd(p: SimPosition, price: number): number {
  return p.entryPriceUsd > 0 && price > 0
    ? p.amountUsd * (price / p.entryPriceUsd)
    : p.amountUsd;
}

export function totalValue(state: SimState, priceMap: Map<string, number>): number {
  return (
    state.cashUsd +
    state.bnbUsd +
    state.positions.reduce(
      (s, p) => s + positionValueUsd(p, priceMap.get(p.symbol.toUpperCase()) ?? 0),
      0,
    )
  );
}

/** Max USD that may be deployed into a single new position this step. */
export function maxEntryUsd(state: SimState, cfg: EnvConfig, portfolioValue: number): number {
  const tradeableBnb = Math.max(0, state.bnbUsd - cfg.minBnbReserveUsd);
  return Math.min(
    portfolioValue * cfg.maxPositionFraction,
    tradeableBnb * cfg.maxTradeFractionOfBnb,
  );
}

/**
 * Execute an entry. Returns the position opened, or null when the bankroll
 * constraints reject it (insufficient BNB above reserve, below dust).
 */
export function executeEntry(
  state: SimState,
  cfg: EnvConfig,
  symbol: string,
  price: number,
  sizeUsd: number,
  day: string,
  cycle: number,
  timestamp: number,
  trades: GymTrade[],
): SimPosition | null {
  if (price <= 0 || sizeUsd <= 0) return null;
  if (state.positions.length >= cfg.maxOpenPositions) return null;
  const entryUsd = Math.min(sizeUsd, Math.max(0, state.bnbUsd - cfg.minBnbReserveUsd));
  if (entryUsd < 2) return null;

  const pos = openPosition({
    symbol,
    entryPriceUsd: price,
    amountUsd: entryUsd,
    cycle,
    now: timestamp,
  });
  state.positions.push(pos);
  state.bnbUsd -= entryUsd;
  state.gasSpentUsd += cfg.gasUsd;
  trades.push({
    day, symbol, type: "entry",
    amountUsd: entryUsd, pnlUsd: 0, priceUsd: price, actor: "agent",
  });
  return pos;
}

/**
 * Execute a (possibly fractional) exit. Proceeds come from CURRENT market
 * value; P&L is measured against the cost basis of the slice sold.
 * Returns realized P&L (USD).
 */
export function executeExit(
  state: SimState,
  cfg: EnvConfig,
  p: SimPosition,
  price: number,
  day: string,
  type: GymTrade["type"],
  fraction: number,
  actor: GymTrade["actor"],
  trades: GymTrade[],
): number {
  const sellValue = positionValueUsd(p, price) * fraction * (1 - cfg.slippageBps / 10000);
  const costBasisSold = p.amountUsd * fraction;
  const pnl = sellValue - costBasisSold;
  state.bnbUsd += sellValue;
  state.realizedPnlUsd += pnl;
  state.gasSpentUsd += cfg.gasUsd;
  trades.push({
    day, symbol: p.symbol, type,
    amountUsd: sellValue, pnlUsd: pnl, priceUsd: price, actor,
  });
  p.amountUsd *= 1 - fraction;
  if (type === "exit_partial") p.partialProfitTaken = true;
  return pnl;
}

/**
 * Assisted-mode physics: apply the production risk tiers to every position.
 * Returns realized P&L from env-forced exits this step.
 *
 * The tiers are the live agent's exit policy: stop at −35% (thesis
 * invalidated), partial 33% at +50% (capital recycling), trail at +100%
 * peak / 30% give-back (lock the asymmetry). In "full-control" mode the
 * caller skips this and the agent owns every exit.
 */
export function applyRiskTiers(
  state: SimState,
  cfg: EnvConfig,
  priceMap: Map<string, number>,
  day: string,
  trades: GymTrade[],
): number {
  let pnl = 0;
  for (const pos of state.positions) {
    const price = priceMap.get(pos.symbol.toUpperCase()) ?? 0;
    if (price <= 0) continue;
    const verdict = evaluatePosition(pos, price);
    if (verdict.action === "HOLD") continue;
    const type: GymTrade["type"] =
      verdict.action === "EXIT_STOP" ? "exit_stop" :
      verdict.action === "EXIT_TRAIL" ? "exit_trail" : "exit_partial";
    pnl += executeExit(state, cfg, pos, price, day, type, verdict.sellFraction, "env", trades);
  }
  state.positions = state.positions.filter((p) => p.amountUsd > 0.01);
  return pnl;
}

/**
 * Accrue one day of price history onto every position (peak, underwater
 * max, cycles held). Pure accounting — no decisions.
 */
export function accrueAll(state: SimState, priceMap: Map<string, number>): void {
  for (const p of state.positions) {
    const price = priceMap.get(p.symbol.toUpperCase()) ?? 0;
    if (price > 0) Object.assign(p, accruePosition(p, price));
  }
}

/**
 * Auto-harvest: when BNB is critically low or the book is full, sell the
 * weakest position by current value. Mirrors the live agent's harvest rule.
 */
export function autoHarvest(
  state: SimState,
  cfg: EnvConfig,
  priceMap: Map<string, number>,
  day: string,
  trades: GymTrade[],
): void {
  const lowBnb = state.bnbUsd < cfg.initialBnbUsd * cfg.harvestBelowFraction;
  const atCap = state.positions.length >= cfg.maxOpenPositions;
  if ((!lowBnb && !atCap) || state.positions.length === 0) return;
  const victim = [...state.positions].sort(
    (a, b) =>
      positionValueUsd(a, priceMap.get(a.symbol.toUpperCase()) ?? 0) -
      positionValueUsd(b, priceMap.get(b.symbol.toUpperCase()) ?? 0),
  )[0];
  const price = priceMap.get(victim.symbol.toUpperCase()) ?? 0;
  if (price <= 0) return;
  executeExit(state, cfg, victim, price, day, "exit_harvest", 1, "env", trades);
  state.positions = state.positions.filter((p) => p.symbol !== victim.symbol);
}

/** End-of-day bookkeeping: record value, update peak. */
export function settleDay(state: SimState, value: number): void {
  state.dailyValues.push(value);
  if (value > state.peakValueUsd) state.peakValueUsd = value;
  state.prevValueUsd = value;
}
