import { NextRequest, NextResponse } from "next/server";
import { WATCHLIST, WatchlistTrader } from "@/lib/watchlist";
import { ethosClient } from "@/lib/ethos";
import { APP_CONFIG } from "@/lib/config";
import { gates, getFeatureAccess } from "@/lib/ethos-gates";
import { sql } from "@vercel/postgres";

interface AlphaWallet {
  address: string;
  chain: "solana" | "base";
  convictionScore: number | null;
  ethosScore: number;
  totalPositions: number | null;
  patienceTax: number | null;
  upsideCapture: number | null;
  archetype: string;
  alphaRating: "Unknown" | "Low" | "Medium" | "High" | "Elite";
  lastAnalyzed: number | null;
  farcasterIdentity?: {
    username: string;
    displayName?: string;
    pfpUrl?: string;
  };
  scout?: {
    address: string;
    ethos: number;
  };
}

const ethosScoreCache = new Map<
  string,
  { score: number | null; timestamp: number }
>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function getEthosScore(address: string): Promise<number | null> {
  // Ethos currently only supports EVM addresses (0x prefix)
  if (!address.startsWith("0x")) {
    return 0;
  }

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
  ethosScore: number,
): "Unknown" | "Low" | "Medium" | "High" | "Elite" {
  const { ethosScoreThresholds } = APP_CONFIG.reputation;
  if (ethosScore >= ethosScoreThresholds.elite) return "Elite";
  if (ethosScore >= ethosScoreThresholds.high) return "High";
  if (ethosScore >= ethosScoreThresholds.medium) return "Medium";
  if (ethosScore >= ethosScoreThresholds.low) return "Low";
  return "Unknown";
}

function getArchetype(ethosScore: number, convictionScore?: number): string {
  if (convictionScore) {
    if (convictionScore >= 90) return "Iron Pillar";
    if (convictionScore >= 80) return "Diamond Hand";
    if (convictionScore >= 60) return "Profit Phantom";
  }

  if (ethosScore >= 1800) return "High Ethos";
  if (ethosScore >= 1000) return "Verified Trader";
  return "Newcomer";
}

async function buildAlphaWallet(
  trader: WatchlistTrader,
): Promise<AlphaWallet | null> {
  const primaryWallet = trader.wallets[0];
  const ethosScore = await getEthosScore(primaryWallet);

  if (ethosScore === null) {
    return null;
  }

  // Attempt to fetch real conviction analysis from DB
  try {
    const result = await sql`
      SELECT score, total_positions, patience_tax, win_rate, archetype, analyzed_at
      FROM conviction_analyses
      WHERE address = ${primaryWallet.toLowerCase()}
      ORDER BY analyzed_at DESC
      LIMIT 1
    `;

    if (result.rows.length > 0) {
      const row = result.rows[0];
      return {
        address: primaryWallet,
        chain: trader.chain,
        convictionScore: row.score,
        ethosScore,
        totalPositions: row.total_positions,
        patienceTax: row.patience_tax,
        upsideCapture: row.win_rate, // Use win_rate as proxy for upside capture if field is missing
        archetype: row.archetype || getArchetype(ethosScore, row.score),
        alphaRating: getAlphaRating(ethosScore),
        lastAnalyzed: new Date(row.analyzed_at).getTime(),
        farcasterIdentity: trader.socials?.farcaster
          ? {
            username: trader.socials.farcaster,
            displayName: trader.name,
          }
          : undefined,
      };
    }
  } catch (dbError) {
    console.warn("DB fetch failed for alpha wallet, returning basic info:", dbError);
  }

  // Return basic info without simulated metrics if no analysis exists
  return {
    address: primaryWallet,
    chain: trader.chain,
    convictionScore: null,
    ethosScore,
    totalPositions: null,
    patienceTax: null,
    upsideCapture: null,
    archetype: getArchetype(ethosScore),
    alphaRating: getAlphaRating(ethosScore),
    lastAnalyzed: null,
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
    const requesterAddress = searchParams.get("requester");
    const minEthosScore = parseInt(searchParams.get("minEthosScore") || "0");
    const minConvictionScore = parseInt(
      searchParams.get("minConvictionScore") || "0",
    );
    const chain = searchParams.get("chain") as "solana" | "base" | null;
    const limit = parseInt(searchParams.get("limit") || "20");

    // Check if requester can access alpha discovery (1000+ Ethos)
    let requesterScore = 0;
    if (requesterAddress === "DEMO") {
      requesterScore = 9999;
    } else if (requesterAddress && requesterAddress.startsWith("0x")) {
      const ethosResult = await ethosClient.getScoreByAddress(requesterAddress);
      requesterScore = ethosResult?.score || 0;
    }

    const access = getFeatureAccess(requesterScore);

    if (!access.canAccessAlphaDiscovery) {
      return NextResponse.json(
        {
          error: "Alpha Discovery requires Ethos score of 1000+",
          currentScore: requesterScore,
          requiredScore: 1000,
          tier: requesterScore >= 500 ? "whale" : "visitor",
        },
        { status: 403 },
      );
    }

    // Apply tier-based limits
    const effectiveLimit = Math.min(limit, access.leaderboardResultLimit);

    // Filtering by Ethos/conviction requires whale+ (500+)
    const canFilter = gates.filterByEthos(requesterScore);
    const effectiveMinEthos = canFilter ? minEthosScore : 0;
    const effectiveMinConviction = canFilter ? minConvictionScore : 0;

    // Filter watchlist by chain if specified
    const { getWatchlist } = await import("@/lib/watchlist");
    const watchlistTraders = await getWatchlist(chain || undefined);

    // Fetch Ethos scores and build alpha wallets for watchlist in parallel
    const watchlistPromises = watchlistTraders.map(buildAlphaWallet);
    const watchlistWalletsRaw = await Promise.all(watchlistPromises);

    // ENHANCEMENT: Fetch high-scoring wallets from general conviction_analyses (Dynamic Discovery Pool)
    // Only include those NOT in the watchlist to avoid duplicates
    const watchlistAddresses = watchlistTraders.flatMap(t => t.wallets.map(w => w.toLowerCase()));

    let dynamicDiscoveryWallets: AlphaWallet[] = [];
    try {
      let dynamicResult;

      if (watchlistAddresses.length > 0) {
        // Use NOT IN when we have addresses to exclude
        // For arrays, we need to use a different approach with Vercel Postgres
        const addressList = watchlistAddresses.map(addr => `'${addr}'`).join(',');
        const queryText = `
          SELECT DISTINCT ON (address, chain)
            address, chain, score, total_positions, patience_tax, win_rate, archetype, analyzed_at,
            farcaster_username, ens_name, ethos_score, scouted_by, scout_ethos_score
          FROM conviction_analyses
          WHERE score >= 80
            AND analyzed_at > NOW() - INTERVAL '7 days'
            AND address NOT IN (${addressList})
            AND ($1::text IS NULL OR chain = $1)
          ORDER BY address, chain, analyzed_at DESC
          LIMIT 20
        `;

        dynamicResult = await sql.query(queryText, [chain]);
      } else {
        // No addresses to exclude
        dynamicResult = await sql`
          SELECT DISTINCT ON (address, chain)
            address, chain, score, total_positions, patience_tax, win_rate, archetype, analyzed_at,
            farcaster_username, ens_name, ethos_score, scouted_by, scout_ethos_score
          FROM conviction_analyses
          WHERE score >= 80
            AND analyzed_at > NOW() - INTERVAL '7 days'
            AND (${chain}::text IS NULL OR chain = ${chain})
          ORDER BY address, chain, analyzed_at DESC
          LIMIT 20
        `;
      }

      dynamicDiscoveryWallets = dynamicResult.rows.map(row => ({
        address: row.address,
        chain: row.chain,
        convictionScore: row.score,
        ethosScore: row.ethos_score || 0,
        totalPositions: row.total_positions,
        patienceTax: row.patience_tax,
        upsideCapture: row.win_rate,
        archetype: row.archetype || getArchetype(row.ethos_score || 0, row.score),
        alphaRating: getAlphaRating(row.ethos_score || 0),
        lastAnalyzed: new Date(row.analyzed_at).getTime(),
        farcasterIdentity: row.farcaster_username ? {
          username: row.farcaster_username,
          displayName: row.ens_name || row.farcaster_username,
        } : undefined,
        scout: row.scouted_by ? {
          address: row.scouted_by,
          ethos: row.scout_ethos_score || 0
        } : undefined
      }));
    } catch (err) {
      console.warn("Failed to fetch dynamic discovery wallets:", err);
    }

    // Combine both sources
    const allWalletsRaw = [...watchlistWalletsRaw, ...dynamicDiscoveryWallets];

    // Filter and sort (using effective filters based on requester's tier)
    const filteredWallets = allWalletsRaw
      .filter((w): w is AlphaWallet => w !== null)
      .filter((wallet) => {
        if (wallet.ethosScore < effectiveMinEthos) return false;
        if ((wallet.convictionScore || 0) < effectiveMinConviction) return false;
        return true;
      });

    // Sort by weighted alpha score + scout reputation
    filteredWallets.sort((a, b) => {
      const getMultiplier = (ethosScore: number) => {
        const { reputation } = APP_CONFIG;
        if (ethosScore >= reputation.ethosScoreThresholds.elite) return 1.5;
        if (ethosScore >= reputation.ethosScoreThresholds.high) return 1.3;
        if (ethosScore >= reputation.ethosScoreThresholds.medium) return 1.15;
        if (ethosScore >= reputation.ethosScoreThresholds.low) return 1.05;
        return 1.0;
      };

      const aScoutBonus = (a.scout?.ethos || 0) / 1000;
      const bScoutBonus = (b.scout?.ethos || 0) / 1000;

      const aWeighted = ((a.convictionScore || 0) + aScoutBonus) * getMultiplier(a.ethosScore);
      const bWeighted = ((b.convictionScore || 0) + bScoutBonus) * getMultiplier(b.ethosScore);

      return bWeighted - aWeighted;
    });

    const results = filteredWallets.slice(0, effectiveLimit);

    return NextResponse.json({
      success: true,
      wallets: results,
      total: results.length,
      requesterTier: access.canAccessAlphaDiscovery ? "alpha+" : "restricted",
      filters: {
        minEthosScore: effectiveMinEthos,
        minConvictionScore: effectiveMinConviction,
        chain,
        limit: effectiveLimit,
        filtersApplied: canFilter,
      },
    });
  } catch (error) {
    console.error("Alpha discovery error:", error);
    return NextResponse.json(
      { error: "Failed to discover alpha wallets", details: String(error) },
      { status: 500 },
    );
  }
}
