/**
 * Transaction Analysis Engine
 * Core logic for analyzing on-chain trading behavior and calculating conviction metrics.
 */

import { priceService } from './price-service';

export interface TokenTransaction {
  hash: string;
  timestamp: number;
  tokenAddress: string;
  tokenSymbol?: string;
  type: 'buy' | 'sell';
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
  patienceTax: number; // Dollar value of missed upside
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
  archetype?: "Iron Pillar" | "Profit Phantom" | "Exit Voyager" | "Diamond Hand";
  totalPositions: number;
  avgHoldingPeriod: number;
  winRate: number;
}

export class MarketClient {
  private cache = new Map<string, any>();
  private cacheExpiry = 5 * 60 * 1000; // 5 minutes

  private getCacheKey(method: string, params: any[]): string {
    return `${method}_${JSON.stringify(params)}`;
  }

  private async cachedFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }

    const data = await fetcher();
    this.cache.set(key, { data, timestamp: Date.now() });
    return data;
  }

  /**
   * Enhanced post-exit performance analysis using real price data
   */
  async analyzePostExitPerformance(
    tokenAddress: string,
    chain: 'solana' | 'base',
    exitPrice: number,
    exitTimestamp: number,
    investmentValue: number
  ): Promise<ConvictionAnalysis> {
    try {
      const patienceTaxData = await priceService.calculatePatienceTax(
        tokenAddress,
        chain,
        exitPrice,
        exitTimestamp,
        investmentValue,
        90 // 90-day analysis window
      );

      const daysHeld = Math.floor((Date.now() - exitTimestamp) / (24 * 60 * 60 * 1000));
      const potentialGain = patienceTaxData.maxMissedGain / 100; // Convert percentage to decimal
      const postExitHigh = exitPrice * (1 + potentialGain);

      return {
        exitPrice,
        postExitHigh,
        potentialGain,
        patienceTax: patienceTaxData.patienceTax,
        isEarlyExit: potentialGain > 0.5, // >50% missed upside = early exit
        daysHeld,
      };
    } catch (error) {
      console.error('Post-exit analysis failed:', error);
      return {
        exitPrice,
        postExitHigh: exitPrice,
        potentialGain: 0,
        patienceTax: 0,
        isEarlyExit: false,
        daysHeld: 0,
      };
    }
  }

  /**
   * Enhanced conviction metrics calculation with real market data
   */
  async calculateConvictionMetrics(
    positions: TokenPosition[],
    chain: 'solana' | 'base'
  ): Promise<ConvictionMetrics> {
    if (positions.length === 0) {
      return {
        score: 0,
        patienceTax: 0,
        upsideCapture: 0,
        earlyExits: 0,
        convictionWins: 0,
        percentile: 0,
        totalPositions: 0,
        avgHoldingPeriod: 0,
        winRate: 0,
      };
    }

    // Prepare positions for batch analysis
    const exitedPositions = positions.filter(p => p.exits.length > 0);
    const batchAnalysisData = exitedPositions.map(position => {
      const lastExit = position.exits[position.exits.length - 1];
      return {
        tokenAddress: position.tokenAddress,
        chain,
        exitPrice: lastExit.priceUsd,
        exitTimestamp: lastExit.timestamp,
        positionSize: position.totalRealized,
      };
    });

    // Batch analyze positions for efficiency
    const analysisResults = await priceService.batchAnalyzePositions(batchAnalysisData);

    // Update positions with patience tax analysis
    for (let i = 0; i < exitedPositions.length; i++) {
      const result = analysisResults[i];
      if (result) {
        exitedPositions[i].patienceTaxAnalysis = {
          patienceTax: result.patienceTax,
          maxMissedGain: result.maxMissedGain,
          wouldBeValue: exitedPositions[i].totalRealized * (1 + result.maxMissedGain / 100),
        };
      }
    }

    // Calculate comprehensive metrics
    let totalPatienceTax = 0;
    let totalRealized = 0;
    let totalInvested = 0;
    let earlyExits = 0;
    let convictionWins = 0;
    let totalHoldingDays = 0;
    let winningPositions = 0;

    positions.forEach(position => {
      totalInvested += position.totalInvested;
      totalRealized += position.totalRealized;

      if (position.exits.length > 0) {
        // Calculate holding period
        const firstEntry = position.entries[0];
        const lastExit = position.exits[position.exits.length - 1];
        const holdingDays = (lastExit.timestamp - firstEntry.timestamp) / (24 * 60 * 60 * 1000);
        totalHoldingDays += holdingDays;

        // Check if position was profitable
        const gainLoss = position.totalRealized - position.totalInvested;
        if (gainLoss > 0) {
          winningPositions++;
        }

        // Conviction win: held through significant drawdown for major gain
        if (gainLoss > position.totalInvested * 0.5) { // >50% gain
          convictionWins++;
        }

        // Add patience tax from analysis
        if (position.patienceTaxAnalysis) {
          totalPatienceTax += position.patienceTaxAnalysis.patienceTax;

          // Early exit: significant missed upside (>50%)
          if (position.patienceTaxAnalysis.maxMissedGain > 50) {
            earlyExits++;
          }
        }
      }
    });

    // Calculate derived metrics
    const avgHoldingPeriod = exitedPositions.length > 0 ? totalHoldingDays / exitedPositions.length : 0;
    const winRate = positions.length > 0 ? (winningPositions / positions.length) * 100 : 0;
    const totalReturn = totalInvested > 0 ? ((totalRealized - totalInvested) / totalInvested) * 100 : 0;

    // Upside capture: how much of potential gains were actually captured
    const totalPotentialValue = totalRealized + totalPatienceTax;
    const upsideCapture = totalPotentialValue > 0 ? (totalRealized / totalPotentialValue) * 100 : 0;

    // Early exit rate (lower is better)
    const earlyExitRate = exitedPositions.length > 0 ? (earlyExits / exitedPositions.length) * 100 : 0;

    // Conviction score formula (0-100)
    // Weighted combination of key behavioral metrics
    const score = Math.max(0, Math.min(100,
      (winRate * 0.25) +                    // 25% weight on win rate
      (upsideCapture * 0.35) +              // 35% weight on upside capture
      ((100 - earlyExitRate) * 0.25) +      // 25% weight on patience (inverse of early exits)
      (Math.min(avgHoldingPeriod / 30, 1) * 15) // 15% weight on holding period (capped at 30 days)
    ));

    // Calculate percentile (simplified - would use real distribution in production)
    const percentile = Math.max(1, Math.min(99, 100 - Math.floor(score)));

    return {
      score: Math.round(score * 10) / 10,
      patienceTax: Math.round(totalPatienceTax),
      upsideCapture: Math.round(upsideCapture),
      earlyExits,
      convictionWins,
      percentile,
      archetype: this.getArchetype(score, totalPatienceTax),
      totalPositions: positions.length,
      avgHoldingPeriod: Math.round(avgHoldingPeriod),
      winRate: Math.round(winRate),
    };
  }

  /**
   * Categorize trader archetype based on conviction metrics
   */
  getArchetype(score: number, patienceTax: number): "Iron Pillar" | "Profit Phantom" | "Exit Voyager" | "Diamond Hand" {
    if (score > 90 && patienceTax < 1000) return "Iron Pillar";
    if (score > 70 && patienceTax > 5000) return "Profit Phantom";
    if (score < 40) return "Exit Voyager";
    return "Diamond Hand";
  }

  /**
   * Get detailed position insights for UI display
   */
  async getPositionInsights(position: TokenPosition, chain: 'solana' | 'base'): Promise<{
    metadata: any;
    currentPrice: number;
    priceChange24h: number;
    unrealizedGain?: number;
    realizedGain: number;
    totalReturn: number;
  }> {
    try {
      const [metadata, priceAnalysis] = await Promise.all([
        priceService.getTokenMetadata(position.tokenAddress, chain),
        priceService.getPriceAnalysis(position.tokenAddress, chain),
      ]);

      const realizedGain = position.totalRealized - position.totalInvested;
      let unrealizedGain = 0;

      // Calculate unrealized gain for active positions
      if (position.isActive && priceAnalysis && position.remainingBalance > 0) {
        const currentValue = position.remainingBalance * priceAnalysis.currentPrice;
        const avgCost = position.totalInvested / position.entries.reduce((sum, e) => sum + e.amount, 0);
        const costBasis = position.remainingBalance * avgCost;
        unrealizedGain = currentValue - costBasis;
      }

      const totalReturn = position.totalInvested > 0
        ? ((realizedGain + (unrealizedGain || 0)) / position.totalInvested) * 100
        : 0;

      return {
        metadata,
        currentPrice: priceAnalysis?.currentPrice || 0,
        priceChange24h: priceAnalysis?.priceChange24h || 0,
        unrealizedGain: position.isActive ? unrealizedGain : undefined,
        realizedGain,
        totalReturn,
      };
    } catch (error) {
      console.error('Position insights failed:', error);
      return {
        metadata: null,
        currentPrice: 0,
        priceChange24h: 0,
        realizedGain: position.totalRealized - position.totalInvested,
        totalReturn: 0,
      };
    }
  }
}

export const marketClient = new MarketClient();