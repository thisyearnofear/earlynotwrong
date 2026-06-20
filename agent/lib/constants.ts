/**
 * Agent Constants
 * Single source of truth for agent-side competition thresholds and the
 * token allowlist check.
 */

import { AGENT_CONFIG } from "./config.js";

// =============================================================================
// Competition Constants
// =============================================================================

/**
 * Check if a token symbol is in the competition's eligible token list.
 */
export function isEligibleToken(symbol: string): boolean {
  return (AGENT_CONFIG.competition.eligibleTokens as readonly string[]).includes(symbol.toUpperCase());
}

/**
 * Minimum number of trades per day to qualify for competition ranking.
 */
export const MIN_TRADES_PER_DAY = 1;

/**
 * Minimum total trades for the full trading week.
 */
export const MIN_TRADES_TOTAL = 7;

/**
 * Portfolio threshold — sub-$1 is treated as no capital at work.
 */
export const PORTFOLIO_MINIMUM_USD = 1;

/**
 * HACKATHON: Registration deadline; trading window opens
 * June 22, 2026 00:00 UTC
 */
export const TRADING_WINDOW_OPENS = new Date("2026-06-22T00:00:00Z").getTime();

/**
 * HACKATHON: Trading window closes
 * June 28, 2026 23:59 UTC
 */
export const TRADING_WINDOW_CLOSES = new Date("2026-06-28T23:59:00Z").getTime();

/**
 * Drawdown disqualification threshold (per hackathon rules).
 * Our guardrail trips earlier at 25%.
 */
export const DRAWDOWN_DISQUALIFICATION = 30;
