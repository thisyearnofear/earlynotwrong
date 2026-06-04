import { NextRequest, NextResponse } from "next/server";
import { getCohortStats, getRealPercentile } from "@/lib/db/postgres";
import { requireEthosScore, getEthosTier } from "@/lib/ethos-gates";

/**
 * GET /api/cohort/compare
 *
 * Returns cohort statistics for the caller's tier + chain, plus the caller's
 * percentile within the global cohort. Gated at Ethos ≥ 1400 (whale).
 *
 * Required query: score (number), chain (solana | base, optional),
 * address (string, for gate check).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");
  const chainParam = searchParams.get("chain");
  const score = parseInt(searchParams.get("score") || "0", 10);

  const chain =
    chainParam === "solana" || chainParam === "base" ? chainParam : undefined;

  const gate = await requireEthosScore(address, 1400, "Cohort Comparison");
  if ("error" in gate) return gate.error;

  try {
    const [cohortStats, percentile] = await Promise.all([
      getCohortStats(chain),
      score > 0 ? getRealPercentile(score, chain) : Promise.resolve(50),
    ]);

    const tier = getEthosTier(gate.score);

    return NextResponse.json({
      cohort: cohortStats,
      percentile,
      tier,
      gate: { score: gate.score, tier: gate.tier },
    });
  } catch (error) {
    console.error("Cohort compare error:", error);
    return NextResponse.json(
      { error: "Failed to compute cohort comparison" },
      { status: 500 },
    );
  }
}
