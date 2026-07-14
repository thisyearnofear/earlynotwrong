import { NextRequest, NextResponse } from "next/server";
import {
  analyzePosition,
  calculateBehavioralMetrics,
  type LedgerEntry,
  type LedgerPosition,
} from "conviction-core";
import { marketService } from "@/lib/services/market-service";
import { APP_CONFIG } from "@/lib/config";
import { getCohortPercentile } from "@/lib/db/postgres";
import type { ConvictionMetrics } from "@/lib/market";
import type { PositionAnalysis as WebPositionAnalysis } from "@/lib/api-client";

interface Position {
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

interface BatchRequest {
  positions: Position[];
  chain: "solana" | "base";
  ethosScore?: number | null;
}

export async function POST(request: NextRequest) {
  try {
    const body: BatchRequest = await request.json();
    const { positions, chain } = body;

    if (!positions || !chain) {
      return NextResponse.json(
        { error: "Missing required fields: positions, chain" },
        { status: 400 }
      );
    }

    const uniqueTokens = Array.from(
      new Set(positions.map((p) => p.tokenAddress))
    );

    const [metadataResults, priceResults] = await Promise.all([
      Promise.all(
        uniqueTokens.map((address) => marketService.getTokenMetadata(address, chain))
      ),
      Promise.all(
        uniqueTokens.map((address) => marketService.getPriceData(address, chain))
      ),
    ]);

    const metadataMap = new Map<
      string,
      { name: string; symbol: string; logoUri?: string } | null
    >();
    const currentPriceMap = new Map<string, number>();
    const priceChangeMap = new Map<string, number>();

    uniqueTokens.forEach((address, index) => {
      const metadata = metadataResults[index];
      metadataMap.set(
        address,
        metadata
          ? { name: metadata.name, symbol: metadata.symbol, logoUri: metadata.logoUri }
          : null
      );

      const priceData = priceResults[index];
      currentPriceMap.set(address, priceData?.currentPrice ?? 0);
      priceChangeMap.set(address, priceData?.priceChange24h ?? 0);
    });

    // Fetch post-exit price histories for exited positions so patience tax can
    // be calculated. This is the only remaining I/O in the analyzer; everything
    // else is pure conviction-core logic.
    const priceHistories = new Map<string, { timestamp: number; price: number }[]>();
    await Promise.all(
      positions.map(async (position) => {
        if (position.exits.length === 0) return;
        const lastExit = position.exits[position.exits.length - 1];
        const endTimestamp = Math.min(
          Date.now(),
          lastExit.timestamp +
            APP_CONFIG.analysis.patienceTaxWindowDays * 24 * 60 * 60 * 1000
        );
        const history = await marketService.getHistoricalPrices(
          position.tokenAddress,
          chain,
          lastExit.timestamp,
          endTimestamp
        );
        if (history.length > 0) {
          priceHistories.set(position.tokenAddress, history);
        }
      })
    );

    const ledgerPositions: LedgerPosition[] = positions.map((p) => ({
      tokenAddress: p.tokenAddress,
      tokenSymbol: p.tokenSymbol,
      entries: p.entries.map(
        (e): LedgerEntry => ({
          hash: e.hash,
          timestamp: e.timestamp,
          tokenAddress: p.tokenAddress,
          tokenSymbol: p.tokenSymbol,
          type: "buy",
          amount: e.amount,
          priceUsd: e.priceUsd,
          valueUsd: e.valueUsd,
        })
      ),
      exits: p.exits.map(
        (e): LedgerEntry => ({
          hash: e.hash,
          timestamp: e.timestamp,
          tokenAddress: p.tokenAddress,
          tokenSymbol: p.tokenSymbol,
          type: "sell",
          amount: e.amount,
          priceUsd: e.priceUsd,
          valueUsd: e.valueUsd,
        })
      ),
      totalInvested: p.totalInvested,
      totalRealized: p.totalRealized,
      remainingBalance: p.remainingBalance,
      isActive: p.isActive,
    }));

    const coreAnalyses = ledgerPositions.map((position) =>
      analyzePosition({
        position,
        currentPrice: currentPriceMap.get(position.tokenAddress),
        priceHistory: priceHistories.get(position.tokenAddress),
        patienceTaxWindowDays: APP_CONFIG.analysis.patienceTaxWindowDays,
      })
    );

    const positionAnalyses: WebPositionAnalysis[] = coreAnalyses.map((analysis, i) => {
      const position = positions[i];
      const metadata = metadataMap.get(position.tokenAddress);
      return {
        tokenAddress: position.tokenAddress,
        tokenSymbol: position.tokenSymbol || metadata?.symbol,
        metadata: metadata
          ? {
              name: metadata.name,
              symbol: metadata.symbol,
              logoUri: metadata.logoUri,
            }
          : null,
        currentPrice: currentPriceMap.get(position.tokenAddress) || 0,
        priceChange24h: priceChangeMap.get(position.tokenAddress) || 0,
        entryDetails: {
          avgPrice: analysis.entryDetails.avgPrice,
          totalAmount: analysis.entryDetails.totalAmount,
          totalValue: analysis.entryDetails.totalValue,
          firstEntry: analysis.entryDetails.firstEntry,
        },
        exitDetails: analysis.exitDetails
          ? {
              avgPrice: analysis.exitDetails.avgPrice,
              totalAmount: analysis.exitDetails.totalAmount,
              totalValue: analysis.exitDetails.totalValue,
              lastExit: analysis.exitDetails.lastExit,
            }
          : null,
        patienceTax: analysis.patienceTax,
        maxMissedGain: analysis.maxMissedGain,
        maxMissedGainDate: analysis.maxMissedGainDate,
        realizedPnL: analysis.realizedPnL,
        realizedPnLPercent: analysis.realizedPnLPercent,
        unrealizedPnL: analysis.unrealizedPnL,
        holdingPeriodDays: analysis.holdingPeriodDays,
        isEarlyExit: analysis.isEarlyExit,
        hasReEntry: analysis.hasReEntry,
        counterfactual: analysis.counterfactual,
      };
    });

    const metrics = calculateBehavioralMetrics(ledgerPositions, {
      weights: APP_CONFIG.weights,
      archetypeThresholds: {
        ironPillar: {
          minScore: APP_CONFIG.archetypes.IRON_PILLAR.minScore,
          maxPatienceTax: APP_CONFIG.archetypes.IRON_PILLAR.maxPatienceTax,
        },
        profitPhantom: {
          minScore: APP_CONFIG.archetypes.PROFIT_PHANTOM.minScore,
          minPatienceTax: APP_CONFIG.archetypes.PROFIT_PHANTOM.minPatienceTax,
        },
        exitVoyager: {
          maxScore: APP_CONFIG.archetypes.EXIT_VOYAGER.maxScore,
        },
      },
      currentPrices: currentPriceMap,
      priceHistories,
      patienceTaxWindowDays: APP_CONFIG.analysis.patienceTaxWindowDays,
    });

    const cohort = await getCohortPercentile(metrics.score, chain);
    const convictionMetrics: ConvictionMetrics = {
      ...metrics,
      percentile: cohort?.topPercent ?? null,
      cohortSize: cohort?.cohortSize,
    };

    return NextResponse.json({
      success: true,
      positions: positionAnalyses,
      metrics: convictionMetrics,
    });
  } catch (error) {
    console.error("Batch analysis error:", error);
    return NextResponse.json(
      { error: "Failed to analyze positions", details: String(error) },
      { status: 500 }
    );
  }
}
