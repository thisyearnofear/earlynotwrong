/**
 * Ethos Gates - Single Source of Truth for Access Control
 *
 * All feature gating, tier detection, and capability checks flow through here.
 * Consolidates: config thresholds, perks, community roles, and UI messaging.
 *
 * When tokens are added later, extend checkAccess() to combine:
 * - Ethos score check
 * - Token balance check (Base & Solana)
 * - Token spend/burn for premium actions
 */

import { APP_CONFIG } from "./config";
import { ethosClient } from "./ethos";

const { featureGating, communityTiers } = APP_CONFIG.reputation;

// =============================================================================
// Types
// =============================================================================

export type EthosTier =
  | "visitor" // 0 - untrusted
  | "member" // 1-999 - questionable
  | "premium" // 1000+ - neutral/known start
  | "whale" // 1400+ - known/established
  | "alpha" // 1700+ - reputable
  | "elite"; // 2000+ - exemplary

export type CommunityRole =
  | "viewer" // 0
  | "nominator" // 1000+ - Neutral start
  | "contributor" // 1200+ - Neutral
  | "curator" // 1400+ - Known
  | "moderator" // 1700+ - Reputable
  | "admin"; // 2000+ - Exemplary

export interface GateResult {
  allowed: boolean;
  tier: EthosTier;
  score: number;
  requiredScore: number;
  message?: string;
}

export interface FeatureAccess {
  // Analysis features
  analysisLookbackDays: number;
  positionsPerAnalysis: number;
  dailyAnalysisLimit: number;

  // Data access
  canExportData: boolean;
  canViewFullHistory: boolean;

  // Premium features
  canAccessAdvancedAnalytics: boolean;
}

// =============================================================================
// Tier Detection
// =============================================================================

export function getEthosTier(score: number | null): EthosTier {
  const s = score || 0;
  if (s >= featureGating.eliteInsights) return "elite";
  if (s >= featureGating.alphaSignals) return "alpha";
  if (s >= featureGating.whaleAnalysis) return "whale";
  if (s >= featureGating.premiumAccess) return "premium";
  if (s > 0) return "member";
  return "visitor";
}

// =============================================================================
// Feature Access Matrix
// =============================================================================

export function getFeatureAccess(score: number | null): FeatureAccess {
  const tier = getEthosTier(score);
  const s = score || 0;

  // Base access for everyone
  const base: FeatureAccess = {
    analysisLookbackDays: 30,
    positionsPerAnalysis: 20,
    dailyAnalysisLimit: 5,
    canExportData: false,
    canViewFullHistory: false,
    canAccessAdvancedAnalytics: false,
  };

  // Tier upgrades
  switch (tier) {
    case "elite":
      return {
        ...base,
        analysisLookbackDays: 365,
        positionsPerAnalysis: 200,
        dailyAnalysisLimit: Infinity,
        canExportData: true,
        canViewFullHistory: true,
        canAccessAdvancedAnalytics: true,
      };

    case "alpha":
      return {
        ...base,
        analysisLookbackDays: 180,
        positionsPerAnalysis: 100,
        dailyAnalysisLimit: 50,
        canExportData: true,
        canViewFullHistory: true,
        canAccessAdvancedAnalytics: true,
      };

    case "whale":
      return {
        ...base,
        analysisLookbackDays: 90,
        positionsPerAnalysis: 50,
        dailyAnalysisLimit: 20,
        canExportData: true,
        canViewFullHistory: true,
        canAccessAdvancedAnalytics: false,
      };

    case "premium":
      return {
        ...base,
        analysisLookbackDays: 60,
        positionsPerAnalysis: 30,
        dailyAnalysisLimit: 10,
        canExportData: false,
        canAccessAdvancedAnalytics: false,
      };

    default:
      return base;
  }
}

// =============================================================================
// Gate Checks
// =============================================================================

/**
 * Check if a wallet can access a feature
 */
export async function checkGate(
  walletAddress: string | null,
  requiredScore: number,
  featureName: string,
): Promise<GateResult> {
  if (!walletAddress) {
    return {
      allowed: requiredScore === 0,
      tier: "visitor",
      score: 0,
      requiredScore,
      message: "Connect wallet to access this feature",
    };
  }

  const ethosResult = await ethosClient.getScoreByAddress(walletAddress);
  const score = ethosResult?.score || 0;
  const tier = getEthosTier(score);
  const allowed = score >= requiredScore;

  return {
    allowed,
    tier,
    score,
    requiredScore,
    message: allowed
      ? undefined
      : `${featureName} requires Ethos score of ${requiredScore}+ (you have ${score})`,
  };
}

/**
 * Quick check for specific features
 */
export const gates = {
  // Analysis
  extendedLookback: (score: number) => score >= 1400,
  fullHistory: (score: number) => score >= 1700,

  // Data
  export: (score: number) => score >= 1400,

  // Analytics
  advancedAnalytics: (score: number) => score >= 1700,
};

// =============================================================================
// API Middleware Helper
// =============================================================================

/**
 * Verify Ethos score for API routes
 * Returns null if allowed, or error response if denied
 */
export async function requireEthosScore(
  address: string | null,
  minScore: number,
  featureName: string,
): Promise<{ error: Response } | { score: number; tier: EthosTier }> {
  const result = await checkGate(address, minScore, featureName);

  if (!result.allowed) {
    return {
      error: new Response(
        JSON.stringify({
          error: result.message,
          currentScore: result.score,
          requiredScore: result.requiredScore,
          tier: result.tier,
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ),
    };
  }

  return { score: result.score, tier: result.tier };
}

// =============================================================================
// Rate Limiting by Tier
// =============================================================================

export function getRateLimits(tier: EthosTier): {
  requestsPerMinute: number;
  requestsPerDay: number;
} {
  switch (tier) {
    case "elite":
      return { requestsPerMinute: 60, requestsPerDay: 10000 };
    case "alpha":
      return { requestsPerMinute: 30, requestsPerDay: 2000 };
    case "whale":
      return { requestsPerMinute: 20, requestsPerDay: 500 };
    case "premium":
      return { requestsPerMinute: 10, requestsPerDay: 100 };
    case "member":
      return { requestsPerMinute: 5, requestsPerDay: 50 };
    default:
      return { requestsPerMinute: 2, requestsPerDay: 10 };
  }
}

// =============================================================================
// Capabilities Registry - Single source for UI messaging
// =============================================================================

export type FeatureKey =
  | "dataExport"
  | "extendedHistory"
  | "advancedAnalytics";

export interface FeatureInfo {
  key: FeatureKey;
  name: string;
  description: string;
  requiredScore: number;
  requiredTier: EthosTier;
  valueTeaser: string;
}

/**
 * Canonical feature registry - drives UI, API gates, and messaging
 */
export const FEATURES: Record<FeatureKey, FeatureInfo> = {
  dataExport: {
    key: "dataExport",
    name: "Data Export",
    description: "Export your analysis data",
    requiredScore: 1400,
    requiredTier: "whale",
    valueTeaser: "Download conviction metrics and position history as CSV/JSON",
  },

  extendedHistory: {
    key: "extendedHistory",
    name: "Extended History",
    description: "Analyze up to 1 year of trading history",
    requiredScore: 1700,
    requiredTier: "alpha",
    valueTeaser: "365-day lookback for deeper conviction patterns",
  },
  advancedAnalytics: {
    key: "advancedAnalytics",
    name: "Deep Performance Audit",
    description: "Detailed drawdown and volatility analysis",
    requiredScore: 1800,
    requiredTier: "alpha",
    valueTeaser: "Analyze the 'why' behind every win and loss with raw metadata",
  },
};

/**
 * Get contextual lock message for a feature
 */
export function getFeatureLockMessage(
  featureKey: FeatureKey,
  currentScore: number,
): {
  title: string;
  description: string;
  requiredScore: number;
  currentScore: number;
  pointsAway: number;
  valueTeaser: string;
  nextMilestone: { tier: EthosTier; score: number } | null;
} {
  const feature = FEATURES[featureKey];
  const pointsAway = Math.max(0, feature.requiredScore - currentScore);

  // Find next milestone (could be a tier before the feature unlock)
  let nextMilestone: { tier: EthosTier; score: number } | null = null;
  const milestones = [
    { tier: "premium" as EthosTier, score: 100 },
    { tier: "whale" as EthosTier, score: 500 },
    { tier: "alpha" as EthosTier, score: 1000 },
    { tier: "elite" as EthosTier, score: 2000 },
  ];

  for (const m of milestones) {
    if (currentScore < m.score) {
      nextMilestone = m;
      break;
    }
  }

  return {
    title: `Unlock ${feature.name}`,
    description: feature.description,
    requiredScore: feature.requiredScore,
    currentScore,
    pointsAway,
    valueTeaser: feature.valueTeaser,
    nextMilestone,
  };
}

/**
 * Get tier info for UI display
 */
export function getTierInfo(tier: EthosTier): {
  name: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: "shield" | "users" | "zap" | "crown";
  minScore: number;
} {
  switch (tier) {
    case "elite":
      return {
        name: "Elite",
        color: "text-patience",
        bgColor: "bg-patience/10",
        borderColor: "border-patience/30",
        icon: "crown",
        minScore: 2000,
      };
    case "alpha":
      return {
        name: "Alpha",
        color: "text-signal",
        bgColor: "bg-signal/10",
        borderColor: "border-signal/30",
        icon: "zap",
        minScore: 1700,
      };
    case "whale":
      return {
        name: "Whale",
        color: "text-foreground",
        bgColor: "bg-foreground/10",
        borderColor: "border-foreground/30",
        icon: "users",
        minScore: 1400,
      };
    case "premium":
      return {
        name: "Premium",
        color: "text-foreground-muted",
        bgColor: "bg-foreground-muted/10",
        borderColor: "border-foreground-muted/30",
        icon: "shield",
        minScore: 1000,
      };
    default:
      return {
        name: tier === "member" ? "Member" : "Visitor",
        color: "text-border",
        bgColor: "bg-border/10",
        borderColor: "border-border/30",
        icon: "shield",
        minScore: 0,
      };
  }
}

/**
 * Get what unlocks at the next tier
 */
export function getNextTierUnlocks(currentScore: number): {
  nextTier: EthosTier;
  requiredScore: number;
  pointsAway: number;
  unlocks: FeatureInfo[];
} | null {
  const tier = getEthosTier(currentScore);

  const tierOrder: EthosTier[] = [
    "visitor",
    "member",
    "premium",
    "whale",
    "alpha",
    "elite",
  ];
  const currentIdx = tierOrder.indexOf(tier);

  if (currentIdx >= tierOrder.length - 1) return null; // Already elite

  const nextTier = tierOrder[currentIdx + 1];
  const tierInfo = getTierInfo(nextTier);

  const unlocks = Object.values(FEATURES).filter(
    (f) => f.requiredTier === nextTier,
  );

  return {
    nextTier,
    requiredScore: tierInfo.minScore,
    pointsAway: Math.max(0, tierInfo.minScore - currentScore),
    unlocks,
  };
}
