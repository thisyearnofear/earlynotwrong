/**
 * Delphi Position Lifecycle — settle/liquidate scanning + position tracking.
 *
 * The executor owns the chain-facing calls; this module owns the policy:
 * reading positions for the wallet, splitting them by market status, and
 * routing each to the right exit (redeem vs. liquidate). The runner calls a
 * single `redeemAndLiquidate()` and records the results.
 *
 * Why separate from executor.ts: the executor is a thin, stable wrapper over
 * the SDK; lifecycle policy changes (e.g. choosing a max gas-per-redeem
 * ceiling, batching, or skipping low-value redemptions) live here and are
 * tested without a chain. The trade ledger (runner.ts) appends the results.
 */

import type { DelphiExecutor, DelphiPosition } from "./executor.js";

// =============================================================================
// Types
// =============================================================================

export interface LifecycleSweepResult {
  /** Settled markets we attempted to redeem. */
  redeemAttempted: number;
  /** Settled markets that redeemed successfully. */
  redeemSucceeded: number;
  /** Expired/failed markets we attempted to liquidate. */
  liquidateAttempted: number;
  /** Expired/failed markets that liquidated successfully. */
  liquidateSucceeded: number;
  /** Distinct markets still open after the sweep (informational). */
  stillOpen: number;
  /** Per-market outcomes for the audit ledger. */
  events: LifecycleEvent[];
}

export interface LifecycleEvent {
  kind: "redeem" | "liquidate";
  marketAddress: string;
  success: boolean;
  tokensOut?: string;
  error?: string;
  timestamp: number;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Group positions by their market address → the set of outcome indices we
 * hold. Needed for liquidation, which takes explicit outcome indices.
 */
export function groupOutcomesByMarket(positions: DelphiPosition[]): Map<string, number[]> {
  const byMarket = new Map<string, Set<number>>();
  for (const p of positions) {
    const idx = parseInt(p.outcomeIdx, 10);
    if (!Number.isInteger(idx) || idx < 0) continue;
    const set = byMarket.get(p.marketProxy) ?? new Set<number>();
    set.add(idx);
    byMarket.set(p.marketProxy, set);
  }
  return new Map([...byMarket].map(([k, v]) => [k, [...v].sort((a, b) => a - b)]));
}

/**
 * Sweep the wallet's open positions: redeem every settled market, liquidate
 * every expired/failed one. Failures are captured per-market and never
 * abort the sweep — one broken market shouldn't strand the rest.
 *
 * Returns counters + per-market events the caller can persist.
 */
export async function redeemAndLiquidate(executor: DelphiExecutor): Promise<LifecycleSweepResult> {
  const result: LifecycleSweepResult = {
    redeemAttempted: 0,
    redeemSucceeded: 0,
    liquidateAttempted: 0,
    liquidateSucceeded: 0,
    stillOpen: 0,
    events: [],
  };
  if (executor.isSimulator) return result;

  const { open, settled, liquidatable } = await executor.getOpenPositions();
  result.stillOpen = new Set(open.map((p) => p.marketProxy)).size;

  // Redeem settled markets (batch across all, per-market failures captured).
  if (settled.length > 0) {
    const markets = [...new Set(settled.map((p) => p.marketProxy))];
    result.redeemAttempted = markets.length;
    const { redeemed, failed } = await executor.redeemPositions(markets);
    result.redeemSucceeded = redeemed.length;
    const ts = Date.now();
    for (const r of redeemed) {
      result.events.push({ kind: "redeem", marketAddress: r.marketAddress, success: true, tokensOut: r.tokensOut, timestamp: ts });
    }
    for (const f of failed) {
      result.events.push({ kind: "redeem", marketAddress: f.marketAddress, success: false, error: f.error, timestamp: ts });
    }
  }

  // Liquidate expired/failed markets — needs explicit outcome indices, which
  // we get from the positions we hold per market.
  const liquidationGroups = groupOutcomesByMarket(liquidatable);
  for (const [marketAddress, outcomeIndices] of liquidationGroups) {
    if (outcomeIndices.length === 0) continue;
    result.liquidateAttempted++;
    try {
      const { transactionHash } = await executor.liquidate({ marketAddress, outcomeIndices });
      result.liquidateSucceeded++;
      result.events.push({ kind: "liquidate", marketAddress, success: true, tokensOut: transactionHash, timestamp: Date.now() });
    } catch (err) {
      result.events.push({
        kind: "liquidate",
        marketAddress,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      });
    }
  }
  return result;
}
