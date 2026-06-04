import { NextRequest, NextResponse } from "next/server";
import { getAlphaTraders } from "@/lib/db/postgres";
import { requireEthosScore } from "@/lib/ethos-gates";
import { ALPHA_GATE_SCORE } from "@/lib/alpha/constants";

/**
 * GET /api/alpha/traders
 *
 * Returns top conviction traders sorted by conviction × Ethos multiplier.
 * Gated at Ethos ≥ 1000 (premium).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const chainParam = searchParams.get("chain");
  const limit = Math.min(parseInt(searchParams.get("limit") || "25", 10), 50);
  const address = searchParams.get("address");

  const chain =
    chainParam === "solana" || chainParam === "base" ? chainParam : undefined;

  const gate = await requireEthosScore(address, ALPHA_GATE_SCORE, "Alpha Discovery");
  if ("error" in gate) return gate.error;

  try {
    const traders = await getAlphaTraders(chain, limit);
    return NextResponse.json({ traders, gate: { score: gate.score, tier: gate.tier } });
  } catch (error) {
    console.error("Alpha traders error:", error);
    return NextResponse.json(
      { error: "Failed to fetch alpha traders", traders: [] },
      { status: 500 },
    );
  }
}
