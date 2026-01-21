/**
 * API Client
 * Unified interface for calling server-side analysis endpoints.
 * Replaces direct external API calls from the client.
 */

import { TokenTransaction, TokenPosition, ConvictionMetrics } from "./market";

export interface PositionAnalysis {
  tokenAddress: string;
  tokenSymbol?: string;
  metadata: {
    name: string;
    symbol: string;
    logoUri?: string;
  } | null;
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
  counterfactual: {
    wouldBeValue: number;
    missedGainDollars: number;
  } | null;
}

export interface BatchAnalysisResult {
  success: boolean;
  positions: PositionAnalysis[];
  metrics: ConvictionMetrics;
}

export interface TransactionResult {
  success: boolean;
  transactions: TokenTransaction[];
  count: number;
}

export interface PriceResult {
  success: boolean;
  metadata: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    logoUri?: string;
  } | null;
  priceAnalysis: {
    currentPrice: number;
    priceChange24h: number;
    priceChange7d: number;
    allTimeHigh: number;
    volume24h?: number;
    marketCap?: number;
    lastUpdated: number;
  } | null;
  patienceTax: {
    patienceTax: number;
    maxMissedGain: number;
    maxMissedGainDate: number;
    currentMissedGain: number;
    wouldBeValue: number;
  } | null;
}

class ApiClient {
  private baseUrl = "/api/analyze";

  async fetchTransactions(
    address: string,
    chain: "solana" | "base",
    timeHorizonDays: number,
    minTradeValue: number
  ): Promise<TransactionResult> {
    const response = await fetch(`${this.baseUrl}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address,
        chain,
        timeHorizonDays,
        minTradeValue,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `API error: ${response.status}`);
    }

    return response.json();
  }

  async fetchPriceData(
    tokenAddress: string,
    chain: "solana" | "base",
    options?: {
      exitPrice?: number;
      exitTimestamp?: number;
      positionSize?: number;
    }
  ): Promise<PriceResult> {
    const response = await fetch(`${this.baseUrl}/prices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenAddress,
        chain,
        ...options,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `API error: ${response.status}`);
    }

    return response.json();
  }

  async batchAnalyzePositions(
    positions: TokenPosition[],
    chain: "solana" | "base"
  ): Promise<BatchAnalysisResult> {
    const response = await fetch(`${this.baseUrl}/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        positions: positions.map((p) => ({
          tokenAddress: p.tokenAddress,
          tokenSymbol: p.tokenSymbol,
          entries: p.entries.map((e) => ({
            hash: e.hash,
            timestamp: e.timestamp,
            amount: e.amount,
            priceUsd: e.priceUsd,
            valueUsd: e.valueUsd,
          })),
          exits: p.exits.map((e) => ({
            hash: e.hash,
            timestamp: e.timestamp,
            amount: e.amount,
            priceUsd: e.priceUsd,
            valueUsd: e.valueUsd,
          })),
          totalInvested: p.totalInvested,
          totalRealized: p.totalRealized,
          remainingBalance: p.remainingBalance,
          isActive: p.isActive,
        })),
        chain,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `API error: ${response.status}`);
    }

    return response.json();
  }

  groupTransactionsIntoPositions(
    transactions: TokenTransaction[]
  ): TokenPosition[] {
    const positionMap = new Map<string, TokenPosition>();

    for (const tx of transactions) {
      const key = tx.tokenAddress;

      if (!positionMap.has(key)) {
        positionMap.set(key, {
          tokenAddress: tx.tokenAddress,
          tokenSymbol: tx.tokenSymbol,
          entries: [],
          exits: [],
          avgEntryPrice: 0,
          totalInvested: 0,
          totalRealized: 0,
          remainingBalance: 0,
          isActive: false,
        });
      }

      const position = positionMap.get(key)!;

      if (tx.type === "buy") {
        position.entries.push(tx);
        position.totalInvested += tx.valueUsd;
      } else {
        position.exits.push(tx);
        position.totalRealized += tx.valueUsd;
      }
    }

    for (const position of positionMap.values()) {
      if (position.entries.length > 0) {
        position.avgEntryPrice =
          position.totalInvested /
          position.entries.reduce((sum, entry) => sum + entry.amount, 0);
      }

      const totalBought = position.entries.reduce(
        (sum, entry) => sum + entry.amount,
        0
      );
      const totalSold = position.exits.reduce(
        (sum, exit) => sum + exit.amount,
        0
      );
      position.remainingBalance = totalBought - totalSold;
      position.isActive = position.remainingBalance > 0;
    }

    return Array.from(positionMap.values()).filter(
      (p) => p.entries.length > 0 && p.totalInvested > 0
    );
  }
}

export const apiClient = new ApiClient();
