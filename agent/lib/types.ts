/**
 * Agent Types
 * Ported from src/lib/market.ts — core type definitions for transaction
 * analysis and conviction metrics. Stripped of Next.js path aliases.
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

export interface WalletConviction {
  address: string;
  chain: "bsc";
  convictionScore: number;
  patienceTax: number;
  winRate: number;
  archetype: string | null;
  totalPositions: number;
  ethosScore: number | null;
  displayName: string | null;
  weightedScore: number;
  rank: number;
}

export interface TradeExecution {
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  minAmountOut: number;
  slippageBps: number;
  timestamp: number;
}

export interface PortfolioState {
  totalValueUsd: number;
  positions: PortfolioPosition[];
  drawdownPercent: number;
  peakValueUsd: number;
}

export interface PortfolioPosition {
  tokenSymbol: string;
  tokenAddress: string;
  amount: number;
  valueUsd: number;
  percentOfPortfolio: number;
}

export interface RiskGuardrails {
  maxDrawdownPercent: number;
  maxPerTradeUsd: number;
  maxDailyTrades: number;
  maxPositionConcentrationPercent: number;
  minConvictionScore: number;
  tokenAllowlist: string[];
}

export interface MarketDataProvider {
  name: "cmc" | "helius" | "birdeye";
  fetchTopWallets(): Promise<WalletConviction[]>;
  fetchTokenPrice(address: string): Promise<number>;
  fetchFearGreedIndex(): Promise<number>;
  fetchFundingRates(): Promise<Record<string, number>>;
}

export interface AgentState {
  cycle: number;
  status: "idle" | "running" | "paused" | "error";
  lastRunAt: number | null;
  nextRunAt: number | null;
  totalTrades: number;
  totalVolumeUsd: number;
  currentDrawdown: number;
  peakValueUsd: number;
  errors: string[];
}
