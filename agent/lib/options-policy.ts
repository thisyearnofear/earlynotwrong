/**
 * Options trading policy — the opinion.
 *
 * The cycle used to accumulate any contract scoring ≥40, never sell, and
 * size 100+ lots of sub-dollar weeklies. That is not a thesis. This module
 * is the options analog of the crypto agent's "early, not wrong":
 *
 *   - One view per underlier (one contract, one side).
 *   - Buy living premium, not lottery tickets (delta + min mid + DTE).
 *   - Side has to match the underlier (RSI / news), not just cheap IV.
 *   - HOLD ordinary drawdown. EXIT when the thesis is dead, the contract
 *     is dead, expiry is inside two days, or the asymmetry is already in
 *     hand. Collapse redundant strikes on the same name.
 *
 * Pure functions. The cycle calls these; tests pin the behaviour.
 */

import type { MarketSignal } from "./adapters/types.js";
import type { OptionsPosition } from "./options-state.js";

// =============================================================================
// Knobs
// =============================================================================

export const OPTIONS_POLICY = {
  minConviction: 45,
  minIv: 0.05,
  /** Per-share mid. Sub-$0.50 weeklies are lottery tickets, not a book. */
  minPremium: 0.5,
  minAbsDelta: 0.25,
  maxAbsDelta: 0.6,
  minDte: 7,
  maxDte: 45,
  /** Don't buy vol that is already rich vs realized. */
  maxIvToRealized: 1.1,
  maxPositions: 6,
  maxPerUnderlier: 1,
  maxContractsPerOrder: 5,
  targetSizeUsd: 1500,
  maxSizeUsd: 2500,
  maxSizeFrac: 0.025,
  cashSizeFrac: 0.15,
  /** Thesis invalidation — same bar as the crypto EXIT_STOP. */
  stopLossPercent: -35,
  /** Lock the asymmetry. Options don't trend like tokens; theta eats the rest. */
  takeProfitPercent: 50,
  expiryExitDte: 2,
  maxHoldMs: 5 * 24 * 60 * 60 * 1000,
  convictionDropForExit: 25,
  /** Marks at-or-below this are "no market", not a hold. */
  deadPrice: 0.02,
  callAvoidRsi: 70,
  putAvoidRsi: 30,
} as const;

export type OptionsExitReason =
  | "EXIT_DEAD"
  | "EXIT_EXPIRY"
  | "EXIT_STOP"
  | "EXIT_TAKE"
  | "EXIT_WRONG_SIDE"
  | "EXIT_DECAY"
  | "EXIT_MAX_HOLD"
  | "EXIT_REDUNDANT";

export interface EntryDecision {
  ok: boolean;
  reason: string;
}

export interface SizeDecision {
  ok: boolean;
  reason: string;
  quantity: number;
  sizeUsd: number;
}

export interface ExitSnapshot {
  symbol: string;
  underlyingSymbol: string;
  contractType: "call" | "put";
  expiry: string;
  quantity: number;
  avgEntryPrice: number;
  multiplier: number;
  currentPrice: number;
  bid?: number;
  unrealizedPnlPercent: number;
  peakUnrealizedPercent: number;
  entryConviction: number;
  currentConviction: number;
  rsi: number | null;
  delta: number;
  enteredAt: number;
  now: number;
}

export interface ExitPlan {
  symbol: string;
  action: "HOLD" | "EXIT";
  reason: OptionsExitReason | "HOLD";
  detail: string;
}

// =============================================================================
// Helpers
// =============================================================================

export function daysToExpiry(expiry: string, now: number = Date.now()): number {
  if (!expiry) return Number.POSITIVE_INFINITY;
  const t = new Date(`${expiry}T20:00:00Z`).getTime();
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return (t - now) / 86_400_000;
}

export function computeRsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = gains / period / avgLoss;
  return Math.round(100 - 100 / (1 + rs));
}

function sideMatchesUnderlier(
  contractType: "call" | "put",
  rsi: number | null,
  newsSentiment: string,
): { ok: boolean; reason: string } {
  if (contractType === "call") {
    if (newsSentiment === "bearish") {
      return { ok: false, reason: "call against bearish underlier news" };
    }
    if (rsi !== null && rsi >= OPTIONS_POLICY.callAvoidRsi) {
      return { ok: false, reason: `call into overbought RSI ${rsi}` };
    }
    return { ok: true, reason: "call side ok" };
  }
  if (newsSentiment === "bullish") {
    return { ok: false, reason: "put against bullish underlier news" };
  }
  if (rsi !== null && rsi <= OPTIONS_POLICY.putAvoidRsi) {
    return { ok: false, reason: `put into oversold RSI ${rsi}` };
  }
  return { ok: true, reason: "put side ok" };
}

function heldUnderliers(held: readonly OptionsPosition[]): Set<string> {
  return new Set(held.filter((p) => !p.stuck).map((p) => p.underlyingSymbol));
}

function heldSymbols(held: readonly OptionsPosition[]): Set<string> {
  return new Set(held.filter((p) => !p.stuck).map((p) => p.symbol));
}

function isDeadMark(price: number, bid?: number): boolean {
  if (price <= OPTIONS_POLICY.deadPrice) return true;
  if (bid !== undefined && bid <= OPTIONS_POLICY.deadPrice && price <= 0.05) return true;
  return false;
}

// =============================================================================
// Entry
// =============================================================================

export function evaluateEntry(args: {
  signal: MarketSignal;
  score: number;
  rsi: number | null;
  held: readonly OptionsPosition[];
  now?: number;
}): EntryDecision {
  const { signal, score, rsi, held } = args;
  const now = args.now ?? Date.now();
  const meta = signal.metadata ?? {};
  const p = OPTIONS_POLICY;

  const active = held.filter((h) => !h.stuck);
  if (active.length >= p.maxPositions) {
    return { ok: false, reason: `position cap ${active.length}/${p.maxPositions}` };
  }

  if (score < p.minConviction) {
    return { ok: false, reason: `conviction ${score} < ${p.minConviction}` };
  }

  const iv = (meta.impliedVolatility as number) ?? 0;
  if (iv < p.minIv) {
    return { ok: false, reason: `degenerate IV ${iv.toFixed(3)}` };
  }

  const bid = (meta.bid as number) ?? 0;
  const ask = (meta.ask as number) ?? 0;
  if (bid <= p.deadPrice || ask <= bid) {
    return { ok: false, reason: "no two-sided living quote" };
  }
  if (signal.price < p.minPremium) {
    return { ok: false, reason: `premium $${signal.price.toFixed(2)} < $${p.minPremium} lotto filter` };
  }

  const delta = Math.abs((meta.delta as number) ?? 0);
  if (delta < p.minAbsDelta || delta > p.maxAbsDelta) {
    return { ok: false, reason: `|delta| ${delta.toFixed(2)} outside ${p.minAbsDelta}–${p.maxAbsDelta}` };
  }

  const expiry = (meta.expiry as string) ?? "";
  const dte = daysToExpiry(expiry, now);
  if (dte < p.minDte || dte > p.maxDte) {
    return { ok: false, reason: `DTE ${dte.toFixed(1)} outside ${p.minDte}–${p.maxDte}` };
  }

  const ivToRealized = (meta.ivToRealized as number) ?? 0;
  if (ivToRealized > p.maxIvToRealized) {
    return { ok: false, reason: `IV/RV ${ivToRealized.toFixed(2)} rich (max ${p.maxIvToRealized})` };
  }

  const contractType = ((meta.contractType as string) ?? "call") === "put" ? "put" : "call";
  const news = (meta.newsSentiment as string) ?? "neutral";
  const side = sideMatchesUnderlier(contractType, rsi, news);
  if (!side.ok) return side;

  const symbol = signal.symbol;
  if (heldSymbols(held).has(symbol)) {
    return { ok: false, reason: `already holding ${symbol} (one thesis)` };
  }
  const underlier = (meta.underlyingSymbol as string) ?? "";
  if (underlier && heldUnderliers(held).has(underlier)) {
    return { ok: false, reason: `already have a thesis on ${underlier}` };
  }

  return { ok: true, reason: "entry eligible" };
}

/**
 * Dollar-risk sizing. Never force a 1-lot that blows the budget, never
 * scale a 13¢ weekly to 100+ contracts.
 */
export function sizeContracts(args: {
  price: number;
  multiplier?: number;
  portfolioUsd: number;
  cashUsd: number;
}): SizeDecision {
  const p = OPTIONS_POLICY;
  const multiplier = args.multiplier && args.multiplier > 0 ? args.multiplier : 100;
  const contractCost = args.price * multiplier;
  if (!(contractCost > 0)) {
    return { ok: false, reason: "no contract cost", quantity: 0, sizeUsd: 0 };
  }

  const sizeUsd = Math.min(
    p.maxSizeUsd,
    p.targetSizeUsd,
    args.portfolioUsd * p.maxSizeFrac,
    args.cashUsd * p.cashSizeFrac,
  );
  if (sizeUsd < contractCost) {
    return {
      ok: false,
      reason: `1 lot costs $${contractCost.toFixed(0)} > size cap $${sizeUsd.toFixed(0)}`,
      quantity: 0,
      sizeUsd,
    };
  }

  const raw = Math.floor(sizeUsd / contractCost);
  const quantity = Math.min(raw, p.maxContractsPerOrder);
  if (quantity < 1) {
    return { ok: false, reason: "quantity rounded to 0", quantity: 0, sizeUsd };
  }
  return { ok: true, reason: "sized", quantity, sizeUsd: quantity * contractCost };
}

// =============================================================================
// Exits
// =============================================================================

function standaloneExit(pos: ExitSnapshot): ExitPlan | null {
  const p = OPTIONS_POLICY;
  const dte = daysToExpiry(pos.expiry, pos.now);

  if (isDeadMark(pos.currentPrice, pos.bid)) {
    return {
      symbol: pos.symbol,
      action: "EXIT",
      reason: "EXIT_DEAD",
      detail: `mark ${pos.currentPrice.toFixed(4)} / bid ${pos.bid ?? "n/a"} — no market`,
    };
  }
  if (dte <= p.expiryExitDte) {
    return {
      symbol: pos.symbol,
      action: "EXIT",
      reason: "EXIT_EXPIRY",
      detail: `DTE ${dte.toFixed(1)} ≤ ${p.expiryExitDte}`,
    };
  }
  if (pos.unrealizedPnlPercent <= p.stopLossPercent) {
    return {
      symbol: pos.symbol,
      action: "EXIT",
      reason: "EXIT_STOP",
      detail: `P&L ${pos.unrealizedPnlPercent.toFixed(1)}% ≤ ${p.stopLossPercent}% thesis stop`,
    };
  }
  if (pos.unrealizedPnlPercent >= p.takeProfitPercent) {
    return {
      symbol: pos.symbol,
      action: "EXIT",
      reason: "EXIT_TAKE",
      detail: `P&L ${pos.unrealizedPnlPercent.toFixed(1)}% ≥ ${p.takeProfitPercent}% lock asymmetry`,
    };
  }
  if (pos.contractType === "call" && pos.rsi !== null && pos.rsi >= p.callAvoidRsi) {
    return {
      symbol: pos.symbol,
      action: "EXIT",
      reason: "EXIT_WRONG_SIDE",
      detail: `holding call into RSI ${pos.rsi}`,
    };
  }
  if (pos.contractType === "put" && pos.rsi !== null && pos.rsi <= p.putAvoidRsi) {
    return {
      symbol: pos.symbol,
      action: "EXIT",
      reason: "EXIT_WRONG_SIDE",
      detail: `holding put into RSI ${pos.rsi}`,
    };
  }
  const drop = pos.entryConviction - pos.currentConviction;
  if (drop >= p.convictionDropForExit) {
    return {
      symbol: pos.symbol,
      action: "EXIT",
      reason: "EXIT_DECAY",
      detail: `conviction ${pos.entryConviction} → ${pos.currentConviction}`,
    };
  }
  if (pos.enteredAt > 0 && pos.now - pos.enteredAt >= p.maxHoldMs) {
    return {
      symbol: pos.symbol,
      action: "EXIT",
      reason: "EXIT_MAX_HOLD",
      detail: `held ${((pos.now - pos.enteredAt) / 86_400_000).toFixed(1)}d`,
    };
  }
  return null;
}

/** Rank for "which expression of this underlier do we keep?" Higher wins. */
function keepScore(pos: ExitSnapshot): number {
  const living = isDeadMark(pos.currentPrice, pos.bid) ? 0 : 1_000_000;
  const absDelta = Math.abs(pos.delta);
  const deltaFit = absDelta >= OPTIONS_POLICY.minAbsDelta && absDelta <= OPTIONS_POLICY.maxAbsDelta ? 200 : 0;
  return living + pos.currentConviction * 10 + pos.unrealizedPnlPercent + deltaFit + absDelta * 10;
}

/**
 * Plan exits for the whole book. Standalone stops/takes/dead/expiry first,
 * then collapse to one living contract per underlier.
 */
export function planExits(positions: readonly ExitSnapshot[]): ExitPlan[] {
  const standalone = new Map<string, ExitPlan>();
  const survivors: ExitSnapshot[] = [];

  for (const pos of positions) {
    const hit = standaloneExit(pos);
    if (hit) standalone.set(pos.symbol, hit);
    else survivors.push(pos);
  }

  const byUnderlier = new Map<string, ExitSnapshot[]>();
  for (const pos of survivors) {
    const list = byUnderlier.get(pos.underlyingSymbol) ?? [];
    list.push(pos);
    byUnderlier.set(pos.underlyingSymbol, list);
  }

  const redundant = new Map<string, ExitPlan>();
  for (const [, group] of byUnderlier) {
    if (group.length <= OPTIONS_POLICY.maxPerUnderlier) continue;
    const ranked = [...group].sort((a, b) => keepScore(b) - keepScore(a));
    const kept = ranked[0];
    for (const extra of ranked.slice(1)) {
      redundant.set(extra.symbol, {
        symbol: extra.symbol,
        action: "EXIT",
        reason: "EXIT_REDUNDANT",
        detail: `keeping ${kept.symbol} as the ${extra.underlyingSymbol} thesis`,
      });
    }
  }

  return positions.map((pos) => {
    const planned = standalone.get(pos.symbol) ?? redundant.get(pos.symbol);
    if (planned) return planned;
    return {
      symbol: pos.symbol,
      action: "HOLD",
      reason: "HOLD",
      detail: `P&L ${pos.unrealizedPnlPercent.toFixed(1)}% — ordinary drawdown`,
    };
  });
}

export function snapshotFromPosition(
  pos: OptionsPosition,
  extras: {
    currentPrice: number;
    bid?: number;
    currentConviction: number;
    rsi: number | null;
    delta: number;
    now: number;
  },
): ExitSnapshot {
  const multiplier = pos.multiplier || 100;
  const currentPrice = extras.currentPrice;
  const costBasis = pos.quantity * pos.avgEntryPrice * multiplier;
  const marketValue = pos.quantity * currentPrice * multiplier;
  const unrealizedPnl = marketValue - costBasis;
  const unrealizedPnlPercent = costBasis > 0 ? (unrealizedPnl / costBasis) * 100 : pos.unrealizedPnlPercent;
  return {
    symbol: pos.symbol,
    underlyingSymbol: pos.underlyingSymbol,
    contractType: pos.contractType,
    expiry: pos.expiry,
    quantity: pos.quantity,
    avgEntryPrice: pos.avgEntryPrice,
    multiplier,
    currentPrice,
    bid: extras.bid,
    unrealizedPnlPercent,
    peakUnrealizedPercent: Math.max(pos.peakUnrealizedPercent ?? 0, unrealizedPnlPercent),
    entryConviction: pos.entryConviction ?? 50,
    currentConviction: extras.currentConviction,
    rsi: extras.rsi,
    delta: extras.delta,
    enteredAt: pos.enteredAt ?? 0,
    now: extras.now,
  };
}

/** Cost-basis (not mark) exposure — decaying losers must still count. */
export function underlierCostUsd(
  positions: Array<{ symbol: string; quantity: number; avgEntryPrice: number; valueUsd: number; metadata?: Record<string, unknown> }>,
  underlier: string,
): number {
  return positions
    .filter((p) => {
      const u = (p.metadata?.underlyingSymbol as string | undefined) ?? "";
      return u === underlier || p.symbol.startsWith(underlier);
    })
    .reduce((sum, p) => {
      const multiplier = (p.metadata?.multiplier as number) ?? 100;
      const cost = p.quantity * p.avgEntryPrice * multiplier;
      return sum + Math.max(cost, p.valueUsd);
    }, 0);
}
