import { NextRequest, NextResponse } from "next/server";
import { WATCHLIST } from "@/lib/watchlist";
import { ethosClient } from "@/lib/ethos";

interface TraderBenchmark {
  id: string;
  name: string;
  chain: "solana" | "base";
  ethosScore: number | null;
  farcaster?: string;
}

interface BenchmarkStats {
  traderCount: number;
  avgEthosScore: number;
  minEthosScore: number;
  maxEthosScore: number;
  traders: TraderBenchmark[];
  chains: {
    solana: number;
    base: number;
  };
}

const benchmarkCache: { data: BenchmarkStats | null; timestamp: number } = {
  data: null,
  timestamp: 0,
};
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export async function GET(request: NextRequest) {
  try {
    // Check cache
    if (
      benchmarkCache.data &&
      Date.now() - benchmarkCache.timestamp < CACHE_TTL
    ) {
      return NextResponse.json({
        success: true,
        benchmark: benchmarkCache.data,
        cached: true,
      });
    }

    // Fetch Ethos scores for all watchlist traders
    const traderPromises = WATCHLIST.map(async (trader) => {
      const primaryWallet = trader.wallets[0];
      let ethosScore: number | null = null;

      try {
        const result = await ethosClient.getScoreByAddress(primaryWallet);
        ethosScore = result?.score ?? null;
      } catch {
        // Skip failed lookups
      }

      return {
        id: trader.id,
        name: trader.name,
        chain: trader.chain,
        ethosScore,
        farcaster: trader.socials?.farcaster,
      } as TraderBenchmark;
    });

    const traders = await Promise.all(traderPromises);

    // Calculate stats (only from traders with Ethos scores)
    const tradersWithScores = traders.filter((t) => t.ethosScore !== null);
    const scores = tradersWithScores.map((t) => t.ethosScore as number);

    const avgEthosScore =
      scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0;

    const benchmark: BenchmarkStats = {
      traderCount: WATCHLIST.length,
      avgEthosScore,
      minEthosScore: scores.length > 0 ? Math.min(...scores) : 0,
      maxEthosScore: scores.length > 0 ? Math.max(...scores) : 0,
      traders: traders.sort((a, b) => (b.ethosScore || 0) - (a.ethosScore || 0)),
      chains: {
        solana: WATCHLIST.filter((t) => t.chain === "solana").length,
        base: WATCHLIST.filter((t) => t.chain === "base").length,
      },
    };

    // Cache result
    benchmarkCache.data = benchmark;
    benchmarkCache.timestamp = Date.now();

    return NextResponse.json({
      success: true,
      benchmark,
      cached: false,
    });
  } catch (error) {
    console.error("Benchmark fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch benchmark data", details: String(error) },
      { status: 500 }
    );
  }
}
