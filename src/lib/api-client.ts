/**
 * API Client
 * Unified interface for calling server-side analysis endpoints.
 * Replaces direct external API calls from the client.
 */

import {
  TokenTransaction,
  TokenPosition,
  ConvictionMetrics,
} from "./market";
import { groupEntriesIntoPositions } from "conviction-core";

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
  hasReEntry?: boolean;
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
  quality?: {
    totalRaw: number;
    invalidFiltered: number;
    dataCompleteness: {
      symbolRate: number;
      priceRate: number;
      amountRate: number;
    };
    avgTradeSize: number;
  };
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
    chain: "solana" | "base",
    ethosScore?: number | null
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
        ethosScore,
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
    return groupEntriesIntoPositions(transactions);
  }

  async verifyAleoProof(transactionId: string): Promise<{
    verified: boolean;
    status: string;
    program?: string;
    message?: string;
  }> {
    const response = await fetch(`/api/aleo/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionId }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Verification error: ${response.status}`);
    }

    return response.json();
  }
}

export const apiClient = new ApiClient();
