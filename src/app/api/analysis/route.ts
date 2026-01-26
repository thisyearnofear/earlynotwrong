/**
 * Analysis Storage API
 * Stores conviction analyses to Postgres for real cohort data
 */

import { NextRequest, NextResponse } from "next/server";
import { saveAnalysis, savePositions, getAnalysesByAddress } from "@/lib/db/postgres";
import { ConvictionMetrics } from "@/lib/market";

/**
 * POST /api/analysis
 * Store a conviction analysis
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, chain, metrics, timeHorizon, identity, positions } = body as {
      address: string;
      chain: "solana" | "base";
      metrics: ConvictionMetrics;
      timeHorizon: number;
      identity?: {
        ensName?: string;
        farcasterUsername?: string;
        ethosScore?: number;
        unifiedTrustScore?: number;
        unifiedTrustTier?: string;
      };
      positions?: Array<{
        tokenAddress: string;
        tokenSymbol?: string;
        realizedPnL: number;
        holdingPeriodDays: number;
        isEarlyExit: boolean;
      }>;
    };

    if (!address || !chain || !metrics) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const result = await saveAnalysis(
      address,
      chain,
      metrics,
      timeHorizon,
      identity ? {
        ensName: identity.ensName,
        farcasterUsername: identity.farcasterUsername,
        ethosScore: identity.ethosScore,
        unifiedTrustScore: identity.unifiedTrustScore,
        unifiedTrustTier: identity.unifiedTrustTier
      } : undefined
    );

    if (!result) {
      return NextResponse.json(
        { error: "Failed to save analysis" },
        { status: 500 }
      );
    }

    // Save positions for token-centric queries (non-blocking)
    if (positions && positions.length > 0) {
      savePositions(result.id, address, chain, positions).catch(err => {
        console.warn("Failed to save positions (non-blocking):", err);
      });
    }

    return NextResponse.json({
      message: "Analysis saved",
      id: result.id,
    });
  } catch (error) {
    console.error("Failed to save analysis:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/analysis?address=...
 * Get analyses for an address
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");

  if (!address) {
    return NextResponse.json(
      { error: "Missing address parameter" },
      { status: 400 }
    );
  }

  try {
    const analyses = await getAnalysesByAddress(address);
    return NextResponse.json({ analyses });
  } catch (error) {
    console.error("Failed to get analyses:", error);
    return NextResponse.json(
      { error: "Failed to get analyses" },
      { status: 500 }
    );
  }
}
