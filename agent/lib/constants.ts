/**
 * Agent Constants
 * Ported from src/lib/alpha/constants.ts and src/lib/config.ts (thresholds).
 * Single source of truth for agent-side thresholds and labels.
 */

import { AGENT_CONFIG } from "./config.js";

// =============================================================================
// Conviction Archetype Labels
// =============================================================================

export const ARCHETYPE_LABELS: Record<string, string> = {
  IRON_PILLAR: "Iron Pillar",
  PROFIT_PHANTOM: "Profit Phantom",
  EXIT_VOYAGER: "Exit Voyager",
  DIAMOND_HAND: "Diamond Hand",
  EARLY_BUT_RIGHT: "Early but Right",
};

// =============================================================================
// Tier Display Names
// =============================================================================

export const TIER_NAMES: Record<string, string> = {
  elite: "Elite",
  alpha: "Alpha",
  whale: "Whale",
  premium: "Premium",
  member: "Member",
  visitor: "Visitor",
};

// =============================================================================
// Ethos Tier → Reputation Tier Mapping
// =============================================================================

/**
 * Maps an Ethos score to a tier key.
 */
export function scoreToTier(score: number | null): string {
  const s = score ?? 0;
  const thresholds = AGENT_CONFIG.reputation.scoreThresholds;
  if (s >= thresholds.elite) return "elite";
  if (s >= thresholds.alpha) return "alpha";
  if (s >= thresholds.whale) return "whale";
  if (s >= thresholds.premium) return "premium";
  if (s > 0) return "member";
  return "visitor";
}

/**
 * Returns the conviction multiplier for a given Ethos score.
 * Higher tiers get more weight when ranking which wallets to copy.
 */
export function getConvictionMultiplier(score: number | null): number {
  const tier = scoreToTier(score);
  return AGENT_CONFIG.reputation.convictionMultipliers[tier] ?? 1.0;
}

/**
 * Returns the minimum Ethos score required for a given tier.
 */
export function getTierMinScore(tier: string): number {
  const thresholds = AGENT_CONFIG.reputation.scoreThresholds as Record<string, number>;
  return thresholds[tier] ?? 0;
}

/**
 * Determines the conviction archetype from metrics.
 */
export function determineArchetype(
  score: number,
  patienceTax: number
): string {
  const arch = AGENT_CONFIG.archetypes;

  if (score >= arch.IRON_PILLAR.minScore && patienceTax <= arch.IRON_PILLAR.maxPatienceTax) {
    return arch.IRON_PILLAR.label;
  }
  if (score >= arch.PROFIT_PHANTOM.minScore && patienceTax >= arch.PROFIT_PHANTOM.minPatienceTax) {
    return arch.PROFIT_PHANTOM.label;
  }
  if (score <= arch.EXIT_VOYAGER.maxScore) {
    return arch.EXIT_VOYAGER.label;
  }
  return arch.DIAMOND_HAND.label;
}

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
