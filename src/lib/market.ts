/**
 * Market Types
 * Core type definitions for transaction analysis and conviction metrics.
 */

export interface TokenTransaction {
  hash: string;
  timestamp: number;
  tokenAddress: string;
  tokenSymbol?: string;
  type: "buy" | "sell";
  amount: number;
  priceUsd: number;
  valueUsd: number;
  blockNumber: number;
}

export interface TokenPosition {
  tokenAddress: string;
  tokenSymbol?: string;
  entries: TokenTransaction[];
  exits: TokenTransaction[];
  avgEntryPrice: number;
  totalInvested: number;
  totalRealized: number;
  remainingBalance: number;
  isActive: boolean;
  patienceTaxAnalysis?: {
    patienceTax: number;
    maxMissedGain: number;
    wouldBeValue: number;
  };
}

export interface ConvictionAnalysis {
  exitPrice: number;
  postExitHigh: number;
  potentialGain: number;
  patienceTax: number;
  isEarlyExit: boolean;
  daysHeld: number;
}

export interface ScoreComponent {
  /** The measured input (a rate/percentage, 0–100 scale). */
  value: number;
  /** Points this component contributed to the score (negative = penalty). */
  points: number;
}

/** Exact server-computed component contributions behind a conviction score. */
export interface ScoreBreakdown {
  winRate: ScoreComponent;
  upsideCapture: ScoreComponent;
  earlyExitMitigation: ScoreComponent;
  holdingPeriod: ScoreComponent;
  diamondHands: ScoreComponent;
  consistency: ScoreComponent;
  panicSell: ScoreComponent;
}

export interface ConvictionMetrics {
  score: number;
  /** Present on fresh analyses; absent on older cached results. */
  breakdown?: ScoreBreakdown;
  patienceTax: number;
  upsideCapture: number;
  earlyExits: number;
  convictionWins: number;
  /** Real cohort rank ("Top X%") — null when the cohort is unavailable/too small. */
  percentile: number | null;
  /** Number of analyzed wallets the percentile was computed against. */
  cohortSize?: number;
  archetype?:
    | "Iron Pillar"
    | "Profit Phantom"
    | "Exit Voyager"
    | "Diamond Hand";
  totalPositions: number;
  avgHoldingPeriod: number;
  winRate: number;
}
