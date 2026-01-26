/**
 * Token Holders API
 * Returns wallets that have held a specific token based on analyzed positions
 */

import { NextRequest, NextResponse } from "next/server";
import { getWalletsByToken, getRadarOverlapForToken } from "@/lib/db/postgres";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenAddress = searchParams.get("token");
  const chain = searchParams.get("chain") as "solana" | "base" | null;
  const userAddress = searchParams.get("user");
  const limit = parseInt(searchParams.get("limit") || "20", 10);

  if (!tokenAddress || !chain) {
    return NextResponse.json(
      { error: "Missing required parameters: token, chain" },
      { status: 400 }
    );
  }

  try {
    // Get all wallets that held this token
    const holders = await getWalletsByToken(tokenAddress, chain, limit);

    // If user address provided, also check radar overlap
    let radarOverlap: Awaited<ReturnType<typeof getRadarOverlapForToken>> = [];
    if (userAddress) {
      radarOverlap = await getRadarOverlapForToken(userAddress, tokenAddress, chain);
    }

    return NextResponse.json({
      token: tokenAddress,
      chain,
      holders,
      holderCount: holders.length,
      radarOverlap,
      radarOverlapCount: radarOverlap.length,
    });
  } catch (error) {
    console.error("Failed to get token holders:", error);
    return NextResponse.json(
      { error: "Failed to get token holders" },
      { status: 500 }
    );
  }
}
