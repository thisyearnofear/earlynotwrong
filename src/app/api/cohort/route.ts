/**
 * Cohort Stats API
 * Real cohort data from all stored analyses
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getCohortStats,
  getRealPercentile,
  getLeaderboard,
} from "@/lib/db/postgres";

/**
 * GET /api/cohort
 * Returns cohort statistics for comparison
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const chain = searchParams.get("chain") as "solana" | "base" | null;
  const score = searchParams.get("score");

  try {
    // If score provided, return percentile
    if (score) {
      const percentile = await getRealPercentile(
        Number(score),
        chain || undefined
      );
      return NextResponse.json({ score: Number(score), percentile });
    }

    // Otherwise return full cohort stats
    const [stats, leaderboard] = await Promise.all([
      getCohortStats(chain || undefined),
      getLeaderboard(chain || undefined, 10),
    ]);

    return NextResponse.json({
      stats,
      leaderboard: leaderboard.map((a) => ({
        address: `${a.address.slice(0, 6)}...${a.address.slice(-4)}`,
        score: a.score,
        archetype: a.archetype,
        chain: a.chain,
        analyzedAt: a.analyzedAt,
      })),
    });
  } catch (error) {
    console.error("Failed to get cohort stats:", error);
    return NextResponse.json(
      { error: "Failed to get cohort statistics" },
      { status: 500 }
    );
  }
}
