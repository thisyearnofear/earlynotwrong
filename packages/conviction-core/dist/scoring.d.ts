/**
 * Pure behavioral scoring functions for the Early, Not Wrong conviction framework.
 *
 * All functions are deterministic and side-effect free. They operate on a
 * `LedgerPosition[]` and produce `BehavioralMetrics` or sub-metrics.
 */
import { type Archetype, type ArchetypeThresholds, type BehavioralMetrics, type BehavioralWeights, type LedgerEntry, type LedgerPosition, type PatienceTaxResult, type PricePoint } from "./types.js";
export declare const DEFAULT_BEHAVIORAL_WEIGHTS: BehavioralWeights;
export declare const DEFAULT_ARCHETYPE_THRESHOLDS: ArchetypeThresholds;
/** Group mixed ledger entries into per-token positions. */
export declare function groupEntriesIntoPositions(entries: LedgerEntry[]): LedgerPosition[];
/**
 * Calculate the patience tax for a single exit.
 *
 * Scans post-exit price history within a window to find the highest price the
 * token reached after the exit. The "tax" is the additional USD value that
 * would have been captured by holding until that peak.
 */
export declare function calculatePatienceTax(exitPrice: number, positionSize: number, priceHistory: PricePoint[], windowDays?: number, fromTimestamp?: number): PatienceTaxResult;
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
export declare function analyzePosition(input: PositionAnalysisInput): PositionAnalysis;
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
export declare function calculateBehavioralMetrics(positions: LedgerPosition[], options?: BehavioralMetricsOptions): BehavioralMetrics;
/** Consistency score: lower variance in position sizes scores higher. */
export declare function computeConsistency(positionSizes: number[]): number;
/** Assign a behavioral archetype from a score and patience tax. */
export declare function getArchetype(score: number, patienceTax: number, thresholds?: ArchetypeThresholds): Archetype;
//# sourceMappingURL=scoring.d.ts.map