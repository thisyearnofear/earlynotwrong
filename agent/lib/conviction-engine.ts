/**
 * Conviction Scoring Engine
 * Ported from src/app/api/analyze/batch/route.ts — extracted as pure,
 * configurable functions with no Next.js or market service dependencies.
 *
 * The engine computes conviction metrics from pre-fetched position data.
 * Data fetching (via CMC Agent Hub) is handled by the caller.
 */

import { AGENT_CONFIG } from "./config.js";
import { determineArchetype } from "./constants.js";
import type {
  ConvictionMetrics,
  TokenTransaction,
  PortfolioPosition,
} from "./types.js";

// =============================================================================
// Input Types (caller-provided, chain-agnostic)
// =============================================================================

export interface PositionInput {
  tokenAddress: string;
  tokenSymbol?: string;
  entries: Array<{
    hash: string;
    timestamp: number;
    amount: number;
    priceUsd: number;
    valueUsd: number;
  }>;
  exits: Array<{
    hash: string;
    timestamp: number;
    amount: number;
    priceUsd: number;
    valueUsd: number;
  }>;
  totalInvested: number;
  totalRealized: number;
  remainingBalance: number;
  isActive: boolean;
}

export interface PositionAnalysisResult {
  tokenAddress: string;
  tokenSymbol?: string;
  currentPrice: number;
  priceChange24h: number;
  entryDetails: {
    avgPrice: number;
    totalAmount: number;
    totalValue: number;
    firstEntry: number;
  };
  exitDetails: {
    avgPrice: number;
    totalAmount: number;
    totalValue: number;
    lastExit: number;
  } | null;
  patienceTax: number;
  maxMissedGain: number;
  maxMissedGainDate: number;
  realizedPnL: number;
  realizedPnLPercent: number;
  unrealizedPnL: number | null;
  holdingPeriodDays: number;
  isEarlyExit: boolean;
  hasReEntry: boolean;
  counterfactual: {
    wouldBeValue: number;
    missedGainDollars: number;
  } | null;
}

/**
 * Market data lookup interface for patience tax calculation.
 * The caller provides this — CMC Agent Hub for the agent, or marketService for the web app.
 */
export interface PatienceTaxLookup {
  (params: {
    tokenAddress: string;
    exitPrice: number;
    exitTimestamp: number;
    positionSize: number;
  }): Promise<{
    patienceTax: number;
    maxMissedGain: number;
    maxMissedGainDate: number;
    wouldBeValue: number;
  } | null>;
}

export interface ScoreOptions {
  weights?: typeof AGENT_CONFIG.weights;
  reputationThresholds?: typeof AGENT_CONFIG.reputation.scoreThresholds;
  archetypes?: typeof AGENT_CONFIG.archetypes;
  ethosScore?: number | null;
}

export interface WalletMetrics {
  address: string;
  displayName: string | null;
  totalTrades: number;
  winRate: number;
  avgHoldingPeriod: number;
  patienceTax: number;
  upsideCapture: number;
  convictionScore: number;
  archetype: string | null;
  recentTokens: string[];
  portfolioValue: number;
}

// =============================================================================
// Position Analysis
// =============================================================================

/**
 * Analyze a single position.
 *
 * Pure transformation of position data + pre-computed patience tax.
 * The caller fetches patience tax via the injected lookup function.
 */
export async function analyzePosition(
  position: PositionInput,
  currentPrice: number,
  priceChange24h: number,
  patienceTaxResult: {
    patienceTax: number;
    maxMissedGain: number;
    maxMissedGainDate: number;
    wouldBeValue: number;
  } | null
): Promise<PositionAnalysisResult> {
  const entryDetails = {
    avgPrice:
      position.entries.reduce((sum, e) => sum + e.priceUsd * e.amount, 0) /
      position.entries.reduce((sum, e) => sum + e.amount, 0),
    totalAmount: position.entries.reduce((sum, e) => sum + e.amount, 0),
    totalValue: position.totalInvested,
    firstEntry: position.entries[0]?.timestamp || 0,
  };

  const exitDetails = position.exits.length > 0
    ? {
        avgPrice:
          position.exits.reduce((sum, e) => sum + e.priceUsd * e.amount, 0) /
          position.exits.reduce((sum, e) => sum + e.amount, 0),
        totalAmount: position.exits.reduce((sum, e) => sum + e.amount, 0),
        totalValue: position.totalRealized,
        lastExit: position.exits[position.exits.length - 1]?.timestamp || 0,
      }
    : null;

  const realizedPnL = position.totalRealized - position.totalInvested;
  const realizedPnLPercent = position.totalInvested > 0
    ? (realizedPnL / position.totalInvested) * 100
    : 0;

  let unrealizedPnL: number | null = null;
  if (position.isActive && currentPrice > 0 && position.remainingBalance > 0) {
    const currentValue = position.remainingBalance * currentPrice;
    const costBasis = position.remainingBalance * entryDetails.avgPrice;
    unrealizedPnL = currentValue - costBasis;
  }

  const holdingPeriodDays = exitDetails
    ? (exitDetails.lastExit - entryDetails.firstEntry) / (24 * 60 * 60 * 1000)
    : (Date.now() - entryDetails.firstEntry) / (24 * 60 * 60 * 1000);

  // Detect re-entry (gap > 1 day between entry transactions)
  let hasReEntry = false;
  if (position.entries.length > 1) {
    for (let j = 1; j < position.entries.length; j++) {
      const gapDays =
        (position.entries[j].timestamp - position.entries[j - 1].timestamp) /
        (24 * 60 * 60 * 1000);
      if (gapDays > 1) {
        hasReEntry = true;
        break;
      }
    }
  }

  const isEarlyExit = patienceTaxResult !== null && patienceTaxResult.maxMissedGain > 50;

  const counterfactual = patienceTaxResult
    ? {
        wouldBeValue: patienceTaxResult.wouldBeValue,
        missedGainDollars: patienceTaxResult.patienceTax,
      }
    : null;

  return {
    tokenAddress: position.tokenAddress,
    tokenSymbol: position.tokenSymbol,
    currentPrice,
    priceChange24h,
    entryDetails,
    exitDetails,
    patienceTax: patienceTaxResult?.patienceTax || 0,
    maxMissedGain: patienceTaxResult?.maxMissedGain || 0,
    maxMissedGainDate: patienceTaxResult?.maxMissedGainDate || 0,
    realizedPnL,
    realizedPnLPercent,
    unrealizedPnL,
    holdingPeriodDays: Math.round(holdingPeriodDays),
    isEarlyExit,
    hasReEntry,
    counterfactual,
  };
}

// =============================================================================
// Conviction Metrics Calculation
// =============================================================================

/**
 * Compute conviction metrics from analyzed positions.
 *
 * Pure function — no side effects, no external calls.
 * Accepts optional override config for testability (CLEAN principle).
 */
export function calculateConvictionMetrics(
  positions: PositionInput[],
  analyses: PositionAnalysisResult[],
  options: ScoreOptions = {}
): ConvictionMetrics {
  // Default to agent config, allow override
  const weights = options.weights ?? AGENT_CONFIG.weights;
  const reputationThresholds =
    options.reputationThresholds ?? AGENT_CONFIG.reputation.scoreThresholds;
  const archetypes = options.archetypes ?? AGENT_CONFIG.archetypes;
  const ethosScore = options.ethosScore ?? null;

  if (positions.length === 0) {
    return {
      score: 0,
      patienceTax: 0,
      upsideCapture: 0,
      earlyExits: 0,
      convictionWins: 0,
      percentile: 0,
      archetype: undefined,
      totalPositions: 0,
      avgHoldingPeriod: 0,
      winRate: 0,
    };
  }

  let totalPatienceTax = 0;
  let totalRealized = 0;
  let earlyExits = 0;
  let convictionWins = 0;
  let totalHoldingDays = 0;
  let winningPositions = 0;
  const positionSizes: number[] = [];
  const holdingPeriods: number[] = [];

  // Behavioral metrics
  let panicSells = 0;
  let diamondHands = 0;

  for (let i = 0; i < positions.length; i++) {
    const position = positions[i];
    const analysis = analyses[i];

    totalRealized += position.totalRealized;
    totalPatienceTax += analysis.patienceTax;
    totalHoldingDays += analysis.holdingPeriodDays;

    positionSizes.push(position.totalInvested);
    holdingPeriods.push(analysis.holdingPeriodDays);

    if (analysis.realizedPnL > 0) {
      winningPositions++;
    }

    // Conviction win: 50%+ gain on position
    if (analysis.realizedPnL > position.totalInvested * 0.5) {
      convictionWins++;
    }

    if (analysis.isEarlyExit) {
      earlyExits++;
    }

    // Panic sell: exited within 7 days
    if (analysis.holdingPeriodDays < 7 && position.exits.length > 0) {
      panicSells++;
    }

    // Diamond hands: held despite high patience tax
    if (analysis.maxMissedGain > 100 && analysis.holdingPeriodDays > 30) {
      diamondHands++;
    }
  }

  const avgHoldingPeriod = totalHoldingDays / positions.length;
  const winRate = (winningPositions / positions.length) * 100;

  const totalPotentialValue = totalRealized + totalPatienceTax;
  const upsideCapture =
    totalPotentialValue > 0 ? (totalRealized / totalPotentialValue) * 100 : 0;

  const earlyExitRate = (earlyExits / positions.length) * 100;

  // Behavioral adjustments
  const panicSellRate = (panicSells / positions.length) * 100;
  const diamondHandRate = (diamondHands / positions.length) * 100;

  // Position sizing consistency (lower variance = higher score)
  const avgPositionSize =
    positionSizes.reduce((a, b) => a + b, 0) / positionSizes.length;
  const positionSizeVariance =
    positionSizes.reduce((sum, size) => {
      const diff = size - avgPositionSize;
      return sum + diff * diff;
    }, 0) / positionSizes.length;
  const positionSizeStdDev = Math.sqrt(positionSizeVariance);
  const consistencyScore =
    avgPositionSize > 0
      ? Math.max(0, 100 - (positionSizeStdDev / avgPositionSize) * 100)
      : 50;

  // Base score with behavioral components
  const baseScore = Math.max(
    0,
    Math.min(
      100,
      winRate * weights.winRate +
        upsideCapture * weights.upsideCapture +
        (100 - earlyExitRate) * weights.earlyExitMitigation +
        Math.min(avgHoldingPeriod / 30, 1) * (weights.holdingPeriod * 100) +
        diamondHandRate * 0.05 -
        panicSellRate * 0.1 +
        consistencyScore * 0.05
    )
  );

  // Apply Ethos reputation weighting if available
  let finalScore = baseScore;

  if (ethosScore !== null && ethosScore > 0) {
    let multiplier = 1.0;
    if (ethosScore >= reputationThresholds.elite) {
      multiplier = 1.5;
    } else if (ethosScore >= reputationThresholds.alpha) {
      multiplier = 1.3;
    } else if (ethosScore >= reputationThresholds.whale) {
      multiplier = 1.15;
    } else if (ethosScore >= reputationThresholds.premium) {
      multiplier = 1.05;
    }
    finalScore = Math.min(100, baseScore * multiplier);
  }

  const percentile = Math.max(1, Math.min(99, 100 - Math.floor(finalScore)));

  return {
    score: Math.round(finalScore * 10) / 10,
    patienceTax: Math.round(totalPatienceTax),
    upsideCapture: Math.round(upsideCapture),
    earlyExits,
    convictionWins,
    percentile,
    archetype: determineArchetype(finalScore, totalPatienceTax) as ConvictionMetrics["archetype"],
    totalPositions: positions.length,
    avgHoldingPeriod: Math.round(avgHoldingPeriod),
    winRate: Math.round(winRate),
  };
}

// =============================================================================
// Transaction Validation
// =============================================================================

/**
 * Check if a token should be excluded from analysis (LP tokens, etc.).
 */
export function shouldExcludeToken(symbol: string | null | undefined): boolean {
  if (!symbol) return false;
  const upper = symbol.toUpperCase();
  return (
    upper.includes("-LP") ||
    upper.includes("LP-") ||
    upper.includes("UNI-V2") ||
    upper.includes("CAKE-LP") ||
    upper.includes("SLP")
  );
}

export interface ValidationResult {
  valid: TokenTransaction[];
  invalid: number;
  quality: {
    withSymbols: number;
    withValidPrices: number;
    withValidAmounts: number;
    avgValueUsd: number;
  };
}

/**
 * Validate and filter transactions, returning quality metrics.
 */
export function validateTransactions(
  transactions: TokenTransaction[]
): ValidationResult {
  const valid: TokenTransaction[] = [];
  let invalid = 0;
  let withSymbols = 0;
  let withValidPrices = 0;
  let withValidAmounts = 0;
  let totalValue = 0;

  for (const tx of transactions) {
    if (!tx.tokenAddress || tx.timestamp <= 0 || tx.valueUsd < 0) {
      invalid++;
      continue;
    }

    if (shouldExcludeToken(tx.tokenSymbol)) {
      invalid++;
      continue;
    }

    if (tx.tokenSymbol) withSymbols++;
    if (tx.priceUsd > 0) withValidPrices++;
    if (tx.amount > 0) withValidAmounts++;
    totalValue += tx.valueUsd;

    valid.push(tx);
  }

  return {
    valid,
    invalid,
    quality: {
      withSymbols,
      withValidPrices,
      withValidAmounts,
      avgValueUsd: valid.length > 0 ? totalValue / valid.length : 0,
    },
  };
}

// =============================================================================
// Transaction Grouping
// =============================================================================

/**
 * Group raw transactions into positions by token address.
 * Ported from src/lib/api-client.ts (groupTransactionsIntoPositions).
 */
export function groupTransactions(
  transactions: TokenTransaction[]
): PositionInput[] {
  const positionMap = new Map<string, PositionInput>();

  for (const tx of transactions) {
    const key = tx.tokenAddress;
    let pos = positionMap.get(key);
    if (!pos) {
      pos = {
        tokenAddress: tx.tokenAddress,
        tokenSymbol: tx.tokenSymbol,
        entries: [],
        exits: [],
        totalInvested: 0,
        totalRealized: 0,
        remainingBalance: 0,
        isActive: false,
      };
      positionMap.set(key, pos);
    }

    if (tx.type === "buy") {
      pos.entries.push(tx);
      pos.totalInvested += tx.valueUsd;
    } else {
      pos.exits.push(tx);
      pos.totalRealized += tx.valueUsd;
    }
  }

  for (const pos of positionMap.values()) {
    const totalBought = pos.entries.reduce((sum, e) => sum + e.amount, 0);
    const totalSold = pos.exits.reduce((sum, e) => sum + e.amount, 0);
    pos.remainingBalance = totalBought - totalSold;
    pos.isActive = pos.remainingBalance > 0;
  }

  return Array.from(positionMap.values()).filter(
    (p) => p.entries.length > 0 && p.totalInvested > 0
  );
}

// =============================================================================
// Wallet Scoring (for the agent's copy-trading loop)
// =============================================================================

/**
 * Compute a simplified conviction score for a wallet from high-level metrics.
 * Used when we only have summary data from CMC (not full transaction history).
 *
 * This is a fallback for the copy-trading loop when full analysis isn't available.
 */
export function scoreWalletFromSummary(metrics: {
  winRate: number;
  avgHoldingPeriod: number;
  totalTrades: number;
  recentReturn: number; // e.g., 30d return %
}): number {
  const { weights } = AGENT_CONFIG;

  // Normalize holding period: 0–1, where 90 days = 1
  const holdingScore = Math.min(metrics.avgHoldingPeriod / 90, 1);

  // Normalize trade count: 0–1, where 50 trades = 1
  const experienceScore = Math.min(metrics.totalTrades / 50, 1);

  // Normalize return: 0–1, where 50% return = 1
  const returnScore = Math.max(0, Math.min(metrics.recentReturn / 50, 1));

  const rawScore =
    (metrics.winRate / 100) * weights.winRate * 100 +
    holdingScore * 25 +
    experienceScore * 15 +
    returnScore * 25;

  return Math.round(Math.max(0, Math.min(100, rawScore)));
}

/**
 * Normalize a wallet's portfolio into the engine's PortfolioPosition format.
 */
export function normalizePortfolio(
  positions: { tokenSymbol: string; tokenAddress: string; amount: number; valueUsd: number }[]
): PortfolioPosition[] {
  const totalValue = positions.reduce((sum, p) => sum + p.valueUsd, 0);
  return positions.map((p) => ({
    tokenSymbol: p.tokenSymbol,
    tokenAddress: p.tokenAddress,
    amount: p.amount,
    valueUsd: p.valueUsd,
    percentOfPortfolio: totalValue > 0 ? (p.valueUsd / totalValue) * 100 : 0,
  }));
}

/**
 * Compute an aggregate conviction score for a wallet from its positions.
 * Used when we have full position data from CMC.
 */
export function scoreWalletFromPositions(
  positions: PositionInput[],
  analyses: PositionAnalysisResult[]
): { metrics: ConvictionMetrics; analysis: PositionAnalysisResult[] } {
  const metrics = calculateConvictionMetrics(positions, analyses);
  return { metrics, analysis: analyses };
}
