import { NextRequest, NextResponse } from "next/server";
import { getLeaderboard } from "@/lib/db/postgres";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const chain = searchParams.get("chain") as "solana" | "base" | null;
  const limit = parseInt(searchParams.get("limit") || "20", 10);

  try {
    const entries = await getLeaderboard(
      chain === "solana" || chain === "base" ? chain : undefined,
      Math.min(limit, 50),
    );

    return NextResponse.json({ entries });
  } catch (error) {
    console.error("Failed to fetch leaderboard:", error);
    return NextResponse.json({ entries: [] });
  }
}
