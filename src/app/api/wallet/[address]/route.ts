/**
 * Wallet Analysis API Endpoint
 *
 * GET /api/wallet/[address]
 * Returns comprehensive wallet analysis including:
 * - Identity (ENS, Farcaster, Ethos)
 * - Conviction analysis
 * - Social proof
 *
 * This is the main endpoint for analyzing arbitrary wallets.
 */

import { NextRequest, NextResponse } from "next/server";
import { identityResolver } from "@/lib/services/identity-resolver";
import { cachedEthosService } from "@/lib/services/ethos-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface WalletAnalysisParams {
  params: Promise<{
    address: string;
  }>;
}

/**
 * GET /api/wallet/[address]
 *
 * Query params:
 * - includeConviction: boolean (default: false) - fetch conviction analysis
 * - includeIdentity: boolean (default: true) - fetch identity data
 */
export async function GET(
  request: NextRequest,
  { params }: WalletAnalysisParams,
) {
  try {
    const { address } = await params;
    const { searchParams } = new URL(request.url);

    const includeIdentity = searchParams.get("includeIdentity") !== "false";
    const includeConviction = searchParams.get("includeConviction") === "true";

    if (!address) {
      return NextResponse.json(
        { error: "Address parameter is required" },
        { status: 400 },
      );
    }

    // Parallel fetch identity and Ethos data
    const [identity, ethosData] = await Promise.all([
      includeIdentity
        ? identityResolver.resolve(address)
        : Promise.resolve(null),
      cachedEthosService.getWalletEthosData(address),
    ]);

    const response = {
      address: address.toLowerCase(),
      timestamp: new Date().toISOString(),
      identity: includeIdentity && identity ? identity : undefined,
      ethos: {
        score: ethosData.score?.score || null,
        tier: ethosData.score
          ? cachedEthosService.getReputationPerks(ethosData.score.score).tier
          : "unknown",
        profile: ethosData.profile,
        attestationCount: ethosData.attestations.length,
      },
      socialProof: {
        hasEthosProfile: !!ethosData.profile,
        hasFarcaster: !!identity?.farcaster,
        hasENS: !!identity?.ens.name,
        attestations: ethosData.attestations.length,
      },
      conviction: includeConviction
        ? {
            available: true,
            analyzeUrl: "/api/analyze/transactions",
          }
        : undefined,
    };

    return NextResponse.json({
      success: true,
      data: response,
    });
  } catch (error) {
    console.error("Wallet analysis error:", error);
    return NextResponse.json(
      {
        error: "Failed to analyze wallet",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
