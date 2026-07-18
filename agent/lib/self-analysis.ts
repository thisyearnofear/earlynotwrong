/**
 * Agent Self-Analysis
 *
 * Turns the agent's own trade history into a behavioral conviction score
 * using the same shared scoring engine that analyzes user wallets.
 */

import {
  calculateBehavioralMetrics,
  groupEntriesIntoPositions,
  type BehavioralMetrics,
  type LedgerEntry,
  type LedgerPosition,
} from "conviction-core";
import { state } from "./agent-state.js";

/** Minimum closed positions before behavioral metrics are meaningful. */
export const MIN_CLOSED_POSITIONS_FOR_BEHAVIORAL = 1;

/** Build a LedgerPosition[] from the agent's canonical ledger. */
export function buildAgentLedger(): LedgerPosition[] {
  return groupEntriesIntoPositions(state.ledger);
}

/**
 * Record an entry (buy) in the agent's canonical ledger.
 *
 * Call this immediately after a successful entry execution so the ledger
 * stays in sync with heldPositions.
 */
export function recordAgentEntry(params: {
  symbol: string;
  priceUsd: number;
  amountUsd: number;
  timestamp: number;
  txHash?: string;
}): void {
  const { symbol, priceUsd, amountUsd, timestamp, txHash } = params;
  if (priceUsd <= 0 || amountUsd <= 0) return;

  const amount = amountUsd / priceUsd;
  state.ledger.push({
    hash: txHash ?? `entry:${symbol}:${timestamp}`,
    timestamp,
    tokenAddress: symbol.toLowerCase(),
    tokenSymbol: symbol,
    type: "buy",
    amount,
    priceUsd,
    valueUsd: amountUsd,
  });
}

/**
 * Record an exit (sell) in the agent's canonical ledger.
 *
 * Call this immediately after a successful exit execution so the ledger
 * captures the actual exit price and value.
 */
export function recordAgentExit(params: {
  symbol: string;
  priceUsd: number;
  amountUsd: number;
  timestamp: number;
  txHash?: string;
}): void {
  const { symbol, priceUsd, amountUsd, timestamp, txHash } = params;
  if (priceUsd <= 0 || amountUsd <= 0) return;

  const amount = amountUsd / priceUsd;
  state.ledger.push({
    hash: txHash ?? `exit:${symbol}:${timestamp}`,
    timestamp,
    tokenAddress: symbol.toLowerCase(),
    tokenSymbol: symbol,
    type: "sell",
    amount,
    priceUsd,
    valueUsd: amountUsd,
  });
}

/**
 * Analyze the agent's own trading behavior.
 *
 * Returns null when the ledger has no closed positions yet — the agent
 * needs at least one exit before a behavioral score is meaningful.
 */
export function analyzeAgentBehavior(): BehavioralMetrics | null {
  const positions = buildAgentLedger();
  const closedPositions = positions.filter((p) => p.exits.length > 0);
  if (closedPositions.length < MIN_CLOSED_POSITIONS_FOR_BEHAVIORAL) {
    return null;
  }

  return calculateBehavioralMetrics(positions, {
    weights: {
      winRate: 0.25,
      upsideCapture: 0.35,
      earlyExitMitigation: 0.25,
      holdingPeriod: 0.15,
      diamondHands: 0.05,
      consistency: 0.05,
      panicSell: 0.1,
    },
  });
}
