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

export interface ConvictionMetrics {
  score: number;
  patienceTax: number;
  upsideCapture: number;
  earlyExits: number;
  convictionWins: number;
  percentile: number;
  archetype?:
    | "Iron Pillar"
    | "Profit Phantom"
    | "Exit Voyager"
    | "Diamond Hand";
  totalPositions: number;
  avgHoldingPeriod: number;
  winRate: number;
}
