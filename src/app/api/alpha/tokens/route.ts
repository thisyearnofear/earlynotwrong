import { NextRequest, NextResponse } from "next/server";
import { getTokenHeatmap } from "@/lib/db/postgres";
import { requireEthosScore } from "@/lib/ethos-gates";
import { ALPHA_GATE_SCORE } from "@/lib/alpha/constants";

/**
 * GET /api/alpha/tokens
 *
 * Cohort holdings: tokens with the highest concentration of high-conviction
 * (behavioral score ≥ 60) holders. Ethos ≥ 1000 is the access gate (sybil
 * resistance) only — the cohort filter is behavioral, not social.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const chainParam = searchParams.get("chain");
  const limit = Math.min(parseInt(searchParams.get("limit") || "25", 10), 50);
  const address = searchParams.get("address");

  const chain =
    chainParam === "solana" || chainParam === "base" ? chainParam : undefined;

  const gate = await requireEthosScore(address, ALPHA_GATE_SCORE, "Conviction Discovery");
  if ("error" in gate) return gate.error;

  try {
    const tokens = await getTokenHeatmap(chain, limit);
    return NextResponse.json({ tokens, gate: { score: gate.score, tier: gate.tier } });
  } catch (error) {
    console.error("Alpha tokens error:", error);
    return NextResponse.json(
      { error: "Failed to fetch token heatmap", tokens: [] },
      { status: 500 },
    );
  }
}
