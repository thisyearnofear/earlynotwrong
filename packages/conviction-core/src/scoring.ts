/**
 * Pure behavioral scoring functions for the Early, Not Wrong conviction framework.
 *
 * All functions are deterministic and side-effect free. They operate on a
 * `LedgerPosition[]` and produce `BehavioralMetrics` or sub-metrics.
 */

import {
  type Archetype,
  type ArchetypeThresholds,
  type BehavioralMetrics,
  type BehavioralWeights,
  type LedgerEntry,
  type LedgerPosition,
  type PatienceTaxResult,
  type PricePoint,
  type ScoreBreakdown,
} from "./types.js";
import { clamp, round1 } from "./guards.js";

// =============================================================================
// Defaults
// =============================================================================

export const DEFAULT_BEHAVIORAL_WEIGHTS: BehavioralWeights = {
  winRate: 0.25,
  upsideCapture: 0.35,
  earlyExitMitigation: 0.25,
  holdingPeriod: 0.15,
  diamondHands: 0.05,
  consistency: 0.05,
  panicSell: 0.1,
};

export const DEFAULT_ARCHETYPE_THRESHOLDS: ArchetypeThresholds = {
  ironPillar: { minScore: 90, maxPatienceTax: 1000 },
  profitPhantom: { minScore: 70, minPatienceTax: 5000 },
  exitVoyager: { maxScore: 40 },
};

// =============================================================================
// Ledger construction
// =============================================================================

/** Group mixed ledger entries into per-token positions. */
export function groupEntriesIntoPositions(
  entries: LedgerEntry[],
): LedgerPosition[] {
  const map = new Map<string, LedgerPosition>();

  for (const entry of entries) {
    if (!entry.tokenAddress) continue;

    let position = map.get(entry.tokenAddress);
    if (!position) {
      position = {
        tokenAddress: entry.tokenAddress,
        tokenSymbol: entry.tokenSymbol,
        entries: [],
        exits: [],
        totalInvested: 0,
        totalRealized: 0,
        remainingBalance: 0,
        isActive: false,
      };
      map.set(entry.tokenAddress, position);
    }

    if (entry.type === "buy") {
      position.entries.push(entry);
      position.totalInvested += entry.valueUsd;
    } else {
      position.exits.push(entry);
      position.totalRealized += entry.valueUsd;
    }
  }

  for (const position of map.values()) {
    const totalBought = position.entries.reduce((sum, e) => sum + e.amount, 0);
    const totalSold = position.exits.reduce((sum, e) => sum + e.amount, 0);
    position.remainingBalance = totalBought - totalSold;
    position.isActive = position.remainingBalance > 0;
  }

  return Array.from(map.values()).filter(
    (p) => p.entries.length > 0 && p.totalInvested > 0,
  );
}

// =============================================================================
// Patience tax
// =============================================================================

/**
 * Calculate the patience tax for a single exit.
 *
 * Scans post-exit price history within a window to find the highest price the
 * token reached after the exit. The "tax" is the additional USD value that
 * would have been captured by holding until that peak.
 */
export function calculatePatienceTax(
  exitPrice: number,
  positionSize: number,
  priceHistory: PricePoint[],
  windowDays = 90,
  fromTimestamp?: number,
): PatienceTaxResult {
  const exitTs = fromTimestamp ?? Date.now();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const endTs = Math.min(Date.now(), exitTs + windowMs);

  if (exitPrice <= 0 || priceHistory.length === 0) {
    return {
      patienceTax: 0,
      maxMissedGain: 0,
      maxMissedGainDate: exitTs,
      wouldBeValue: positionSize,
    };
  }

  let maxPrice = exitPrice;
  let maxPriceDate = exitTs;

  for (const point of priceHistory) {
    if (point.timestamp < exitTs || point.timestamp > endTs) continue;
    if (point.price > maxPrice) {
      maxPrice = point.price;
      maxPriceDate = point.timestamp;
    }
  }

  const multiplier = maxPrice / exitPrice;
  const maxMissedGain = (multiplier - 1) * 100;
  const patienceTax = positionSize * (multiplier - 1);
  const wouldBeValue = positionSize * multiplier;

  return {
    patienceTax: Math.max(0, patienceTax),
    maxMissedGain,
    maxMissedGainDate: maxPriceDate,
    wouldBeValue,
  };
}

// =============================================================================
// Position-level metrics
// =============================================================================

export interface PositionAnalysisInput {
  position: LedgerPosition;
  currentPrice?: number;
  priceHistory?: PricePoint[];
  patienceTaxWindowDays?: number;
}

export interface PositionAnalysis {
  tokenAddress: string;
  tokenSymbol?: string;
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

/** Analyze a single position with optional post-exit price history. */
export function analyzePosition(
  input: PositionAnalysisInput,
): PositionAnalysis {
  const { position, currentPrice, priceHistory, patienceTaxWindowDays = 90 } = input;

  const entryTotalAmount = position.entries.reduce((sum, e) => sum + e.amount, 0);
  const entryTotalValue = position.entries.reduce((sum, e) => sum + e.valueUsd, 0);
  const entryAvgPrice = entryTotalAmount > 0 ? entryTotalValue / entryTotalAmount : 0;
  const firstEntry = position.entries[0]?.timestamp ?? 0;

  const exitTotalAmount = position.exits.reduce((sum, e) => sum + e.amount, 0);
  const exitTotalValue = position.exits.reduce((sum, e) => sum + e.valueUsd, 0);
  const exitAvgPrice = exitTotalAmount > 0 ? exitTotalValue / exitTotalAmount : 0;
  const lastExit = position.exits[position.exits.length - 1]?.timestamp ?? 0;

  const realizedPnL = position.totalRealized - position.totalInvested;
  const realizedPnLPercent =
    position.totalInvested > 0 ? (realizedPnL / position.totalInvested) * 100 : 0;

  let unrealizedPnL: number | null = null;
  if (position.isActive && currentPrice && currentPrice > 0 && position.remainingBalance > 0) {
    const currentValue = position.remainingBalance * currentPrice;
    const costBasis = position.remainingBalance * entryAvgPrice;
    unrealizedPnL = currentValue - costBasis;
  }

  const holdingPeriodDays =
    position.exits.length > 0
      ? (lastExit - firstEntry) / (24 * 60 * 60 * 1000)
      : (Date.now() - firstEntry) / (24 * 60 * 60 * 1000);

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

  let patienceTaxData: PatienceTaxResult | null = null;
  if (position.exits.length > 0 && priceHistory && priceHistory.length > 0) {
    const lastExitEntry = position.exits[position.exits.length - 1];
    patienceTaxData = calculatePatienceTax(
      lastExitEntry.priceUsd,
      position.totalRealized,
      priceHistory,
      patienceTaxWindowDays,
      lastExitEntry.timestamp,
    );
  }

  const isEarlyExit =
    patienceTaxData !== null && patienceTaxData.maxMissedGain > 50;

  const counterfactual = patienceTaxData
    ? {
        wouldBeValue: patienceTaxData.wouldBeValue,
        missedGainDollars: patienceTaxData.patienceTax,
      }
    : null;

  return {
    tokenAddress: position.tokenAddress,
    tokenSymbol: position.tokenSymbol,
    entryDetails: {
      avgPrice: entryAvgPrice,
      totalAmount: entryTotalAmount,
      totalValue: entryTotalValue,
      firstEntry,
    },
    exitDetails:
      position.exits.length > 0
        ? {
            avgPrice: exitAvgPrice,
            totalAmount: exitTotalAmount,
            totalValue: exitTotalValue,
            lastExit,
          }
        : null,
    patienceTax: patienceTaxData?.patienceTax ?? 0,
    maxMissedGain: patienceTaxData?.maxMissedGain ?? 0,
    maxMissedGainDate: patienceTaxData?.maxMissedGainDate ?? 0,
    realizedPnL,
    realizedPnLPercent,
    unrealizedPnL,
    holdingPeriodDays: Math.max(0, holdingPeriodDays),
    isEarlyExit,
    hasReEntry,
    counterfactual,
  };
}

// =============================================================================
// Aggregate behavioral metrics
// =============================================================================

export interface BehavioralMetricsOptions {
  weights?: Partial<BehavioralWeights>;
  archetypeThresholds?: Partial<ArchetypeThresholds>;
  /** Post-exit price histories keyed by token address. */
  priceHistories?: Map<string, PricePoint[]>;
  /** Current prices keyed by token address. */
  currentPrices?: Map<string, number>;
  patienceTaxWindowDays?: number;
  /** Optional cohort percentile to attach (computed externally). */
  percentile?: number | null;
}

/** Compute the full behavioral metrics for a set of positions. */
export function calculateBehavioralMetrics(
  positions: LedgerPosition[],
  options: BehavioralMetricsOptions = {},
): BehavioralMetrics {
  if (positions.length === 0) {
    return {
      score: 0,
      breakdown: emptyBreakdown(),
      patienceTax: 0,
      upsideCapture: 0,
      earlyExits: 0,
      convictionWins: 0,
      percentile: options.percentile ?? null,
      archetype: "Exit Voyager",
      totalPositions: 0,
      avgHoldingPeriod: 0,
      winRate: 0,
    };
  }

  const weights = { ...DEFAULT_BEHAVIORAL_WEIGHTS, ...options.weights };
  const thresholds = {
    ...DEFAULT_ARCHETYPE_THRESHOLDS,
    ...options.archetypeThresholds,
  };

  const analyses: PositionAnalysis[] = positions.map((p) =>
    analyzePosition({
      position: p,
      currentPrice: options.currentPrices?.get(p.tokenAddress),
      priceHistory: options.priceHistories?.get(p.tokenAddress),
      patienceTaxWindowDays: options.patienceTaxWindowDays,
    }),
  );

  let totalPatienceTax = 0;
  let totalRealized = 0;
  let earlyExits = 0;
  let convictionWins = 0;
  let totalHoldingDays = 0;
  let winningPositions = 0;
  const positionSizes: number[] = [];

  let panicSells = 0;
  let diamondHands = 0;

  for (let i = 0; i < positions.length; i++) {
    const position = positions[i];
    const analysis = analyses[i];

    totalRealized += position.totalRealized;
    totalPatienceTax += analysis.patienceTax;
    totalHoldingDays += analysis.holdingPeriodDays;
    positionSizes.push(position.totalInvested);

    if (analysis.realizedPnL > 0) winningPositions++;

    if (analysis.realizedPnL > position.totalInvested * 0.5) convictionWins++;

    if (analysis.isEarlyExit) earlyExits++;

    if (analysis.holdingPeriodDays < 7 && position.exits.length > 0) {
      panicSells++;
    }

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
  const panicSellRate = (panicSells / positions.length) * 100;
  const diamondHandRate = (diamondHands / positions.length) * 100;

  const consistencyScore = computeConsistency(positionSizes);

  const holdingPeriodFactor = Math.min(avgHoldingPeriod / 30, 1) * 100;

  const breakdown: ScoreBreakdown = {
    winRate: { value: round1(winRate), points: round1(winRate * weights.winRate) },
    upsideCapture: {
      value: round1(upsideCapture),
      points: round1(upsideCapture * weights.upsideCapture),
    },
    earlyExitMitigation: {
      value: round1(100 - earlyExitRate),
      points: round1((100 - earlyExitRate) * weights.earlyExitMitigation),
    },
    holdingPeriod: {
      value: round1(holdingPeriodFactor),
      points: round1(holdingPeriodFactor * weights.holdingPeriod),
    },
    diamondHands: {
      value: round1(diamondHandRate),
      points: round1(diamondHandRate * weights.diamondHands),
    },
    consistency: {
      value: round1(consistencyScore),
      points: round1(consistencyScore * weights.consistency),
    },
    panicSell: {
      value: round1(panicSellRate),
      points: round1(-(panicSellRate * weights.panicSell)),
    },
  };

  const rawScore =
    breakdown.winRate.points +
    breakdown.upsideCapture.points +
    breakdown.earlyExitMitigation.points +
    breakdown.holdingPeriod.points +
    breakdown.diamondHands.points +
    breakdown.consistency.points +
    breakdown.panicSell.points;

  const score = clamp(rawScore, 0, 100);

  return {
    score: Math.round(score * 10) / 10,
    breakdown,
    patienceTax: Math.round(totalPatienceTax),
    upsideCapture: Math.round(upsideCapture),
    earlyExits,
    convictionWins,
    percentile: options.percentile ?? null,
    archetype: getArchetype(score, totalPatienceTax, thresholds),
    totalPositions: positions.length,
    avgHoldingPeriod: Math.round(avgHoldingPeriod),
    winRate: Math.round(winRate),
  };
}

/** Consistency score: lower variance in position sizes scores higher. */
export function computeConsistency(positionSizes: number[]): number {
  if (positionSizes.length === 0) return 50;
  const avg = positionSizes.reduce((a, b) => a + b, 0) / positionSizes.length;
  if (avg <= 0) return 50;

  const variance =
    positionSizes.reduce((sum, size) => {
      const diff = size - avg;
      return sum + diff * diff;
    }, 0) / positionSizes.length;
  const stdDev = Math.sqrt(variance);

  return clamp(100 - (stdDev / avg) * 100, 0, 100);
}

/** Assign a behavioral archetype from a score and patience tax. */
export function getArchetype(
  score: number,
  patienceTax: number,
  thresholds: ArchetypeThresholds = DEFAULT_ARCHETYPE_THRESHOLDS,
): Archetype {
  if (
    score >= thresholds.ironPillar.minScore &&
    patienceTax <= thresholds.ironPillar.maxPatienceTax
  ) {
    return "Iron Pillar";
  }

  if (
    score >= thresholds.profitPhantom.minScore &&
    patienceTax >= thresholds.profitPhantom.minPatienceTax
  ) {
    return "Profit Phantom";
  }

  if (score <= thresholds.exitVoyager.maxScore) {
    return "Exit Voyager";
  }

  return "Diamond Hand";
}

function emptyBreakdown(): ScoreBreakdown {
  const zero = { value: 0, points: 0 };
  return {
    winRate: zero,
    upsideCapture: zero,
    earlyExitMitigation: zero,
    holdingPeriod: zero,
    diamondHands: zero,
    consistency: zero,
    panicSell: zero,
  };
}
