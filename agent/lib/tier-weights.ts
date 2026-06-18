/**
 * Agent Tier Weights
 * Ported from src/lib/ethos-gates.ts — stripped of UI/server-gating logic.
 * Only the tier detection and weight calculation used for wallet ranking.
 */

import { AGENT_CONFIG } from "./config.js";
import { scoreToTier, getConvictionMultiplier, getTierMinScore } from "./constants.js";

// =============================================================================
// Types
// =============================================================================

export type ReputationTier =
  | "visitor"
  | "member"
  | "premium"
  | "whale"
  | "alpha"
  | "elite";

export interface WeightedScore {
  rawScore: number;
  tier: ReputationTier;
  multiplier: number;
  weighted: number;
}

// =============================================================================
// Score Weighting
// =============================================================================

/**
 * Compute the weighted conviction score for a wallet given its Ethos score.
 * Higher-tier wallets get a multiplier for ranking purposes.
 */
export function computeWeightedScore(
  convictionScore: number,
  ethosScore: number | null
): WeightedScore {
  const tier = scoreToTier(ethosScore) as ReputationTier;
  const multiplier = getConvictionMultiplier(ethosScore);

  return {
    rawScore: convictionScore,
    tier,
    multiplier,
    weighted: Math.round(convictionScore * multiplier),
  };
}

/**
 * Rank wallets by weighted conviction score (descending).
 * Returns a new sorted array.
 */
export function rankWallets(
  wallets: { address: string; convictionScore: number; ethosScore: number | null }[]
): (WeightedScore & { address: string; rank: number })[] {
  const weighted = wallets.map((w) => ({
    address: w.address,
    ...computeWeightedScore(w.convictionScore, w.ethosScore),
  }));

  weighted.sort((a, b) => b.weighted - a.weighted);

  return weighted.map((w, i) => ({
    ...w,
    rank: i + 1,
  }));
}

/**
 * Select the top-K wallets for copy-trading.
 * Filters out wallets below the minimum conviction threshold first.
 */
export function selectTopWallets(
  ranked: { address: string; weighted: number; rank: number }[],
  k: number = AGENT_CONFIG.trading.topK,
  minScore: number = AGENT_CONFIG.trading.minConvictionScore
): { address: string; weighted: number; rank: number }[] {
  return ranked
    .filter((w) => w.weighted >= minScore)
    .slice(0, k);
}

// =============================================================================
// Tier Gate Checks (lightweight — no API calls)
// =============================================================================

/**
 * Check if a score meets a minimum tier requirement.
 * Pure function — no network calls.
 */
export function meetsTierRequirement(
  score: number | null,
  requiredTier: ReputationTier
): boolean {
  const userTier = scoreToTier(score) as ReputationTier;
  const userMin = getTierMinScore(userTier);
  const requiredMin = getTierMinScore(requiredTier);
  return userMin >= requiredMin;
}

/**
 * Returns the tier ordering index (higher = better).
 */
export function tierIndex(tier: ReputationTier): number {
  const order: ReputationTier[] = [
    "visitor",
    "member",
    "premium",
    "whale",
    "alpha",
    "elite",
  ];
  return order.indexOf(tier);
}
