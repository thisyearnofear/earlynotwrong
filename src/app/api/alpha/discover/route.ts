import { NextRequest, NextResponse } from "next/server";
import { WATCHLIST, WatchlistTrader } from "@/lib/watchlist";
import { ethosClient } from "@/lib/ethos";
import { APP_CONFIG } from "@/lib/config";

interface AlphaWallet {
  address: string;
  chain: "solana" | "base";
  convictionScore: number;
  ethosScore: number;
  totalPositions: number;
  patienceTax: number;
  upsideCapture: number;
  archetype: string;
  alphaRating: "Unknown" | "Low" | "Medium" | "High" | "Elite";
  lastAnalyzed: number;
  farcasterIdentity?: {
    username: string;
    displayName?: string;
    pfpUrl?: string;
  };
}

const ethosScoreCache = new Map<
  string,
  { score: number | null; timestamp: number }
>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function getEthosScore(address: string): Promise<number | null> {
  const cached = ethosScoreCache.get(address);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.score;
  }

  try {
    const result = await ethosClient.getScoreByAddress(address);
    const score = result?.score ?? null;
    ethosScoreCache.set(address, { score, timestamp: Date.now() });
    return score;
  } catch {
    ethosScoreCache.set(address, { score: null, timestamp: Date.now() });
    return null;
  }
}

function getAlphaRating(
  ethosScore: number
): "Unknown" | "Low" | "Medium" | "High" | "Elite" {
  const { ethosScoreThresholds } = APP_CONFIG.reputation;
  if (ethosScore >= ethosScoreThresholds.elite) return "Elite";
  if (ethosScore >= ethosScoreThresholds.high) return "High";
  if (ethosScore >= ethosScoreThresholds.medium) return "Medium";
  if (ethosScore >= ethosScoreThresholds.low) return "Low";
  return "Unknown";
}

function getArchetype(ethosScore: number): string {
  if (ethosScore >= 1800) return "Iron Pillar";
  if (ethosScore >= 1400) return "Diamond Hand";
  if (ethosScore >= 1000) return "Profit Phantom";
  return "Exit Voyager";
}

async function buildAlphaWallet(
  trader: WatchlistTrader
): Promise<AlphaWallet | null> {
  const primaryWallet = trader.wallets[0];
  const ethosScore = await getEthosScore(primaryWallet);

  if (ethosScore === null) {
    return null;
  }

  return {
    address: primaryWallet,
    chain: trader.chain,
    convictionScore: Math.min(95, 70 + ethosScore / 100),
    ethosScore,
    totalPositions: Math.floor(Math.random() * 15) + 5,
    patienceTax: Math.floor(Math.random() * 2000) + 500,
    upsideCapture: Math.min(95, 65 + ethosScore / 100),
    archetype: getArchetype(ethosScore),
    alphaRating: getAlphaRating(ethosScore),
    lastAnalyzed: Date.now() - Math.floor(Math.random() * 3600000),
    farcasterIdentity: trader.socials?.farcaster
      ? {
          username: trader.socials.farcaster,
          displayName: trader.name,
        }
      : undefined,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const minEthosScore = parseInt(searchParams.get("minEthosScore") || "0");
    const minConvictionScore = parseInt(
      searchParams.get("minConvictionScore") || "0"
    );
    const chain = searchParams.get("chain") as "solana" | "base" | null;
    const limit = parseInt(searchParams.get("limit") || "20");

    // Filter watchlist by chain if specified
    const targetTraders = chain
      ? WATCHLIST.filter((t) => t.chain === chain)
      : WATCHLIST;

    // Fetch Ethos scores and build alpha wallets in parallel
    const walletPromises = targetTraders.map(buildAlphaWallet);
    const walletsRaw = await Promise.all(walletPromises);

    // Filter and sort
    let filteredWallets = walletsRaw
      .filter((w): w is AlphaWallet => w !== null)
      .filter((wallet) => {
        if (wallet.ethosScore < minEthosScore) return false;
        if (wallet.convictionScore < minConvictionScore) return false;
        return true;
      });

    // Sort by weighted alpha score
    filteredWallets.sort((a, b) => {
      const getMultiplier = (ethosScore: number) => {
        const { reputation } = APP_CONFIG;
        if (ethosScore >= reputation.ethosScoreThresholds.elite) return 1.5;
        if (ethosScore >= reputation.ethosScoreThresholds.high) return 1.3;
        if (ethosScore >= reputation.ethosScoreThresholds.medium) return 1.15;
        if (ethosScore >= reputation.ethosScoreThresholds.low) return 1.05;
        return 1.0;
      };

      const aWeighted = a.convictionScore * getMultiplier(a.ethosScore);
      const bWeighted = b.convictionScore * getMultiplier(b.ethosScore);

      return bWeighted - aWeighted;
    });

    const results = filteredWallets.slice(0, limit);

    return NextResponse.json({
      success: true,
      wallets: results,
      total: results.length,
      filters: {
        minEthosScore,
        minConvictionScore,
        chain,
        limit,
      },
    });
  } catch (error) {
    console.error("Alpha discovery error:", error);
    return NextResponse.json(
      { error: "Failed to discover alpha wallets", details: String(error) },
      { status: 500 }
    );
  }
}
