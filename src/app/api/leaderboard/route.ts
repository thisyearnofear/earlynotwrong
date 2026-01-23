/**
 * Alpha Leaderboard API
 * Rankings of top conviction wallets with Ethos filtering
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

interface LeaderboardFilters {
  chain?: "solana" | "base";
  minEthos?: number;
  minConviction?: number;
  archetype?: string;
  limit?: number;
}

/**
 * GET /api/leaderboard
 * Get the conviction leaderboard with optional filters
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const filters: LeaderboardFilters = {
    chain: searchParams.get("chain") as "solana" | "base" | undefined,
    minEthos: parseInt(searchParams.get("minEthos") || "0"),
    minConviction: parseInt(searchParams.get("minConviction") || "0"),
    archetype: searchParams.get("archetype") || undefined,
    limit: Math.min(parseInt(searchParams.get("limit") || "50"), 100),
  };

  const requester = searchParams.get("requester");
  if (requester === "DEMO") {
    filters.minEthos = 0;
  }

  try {
    // First, try to get from leaderboard table
    const result = await sql`
      SELECT
        address,
        chain,
        conviction_score,
        patience_tax,
        win_rate,
        archetype,
        total_positions,
        display_name,
        farcaster,
        ens,
        ethos_score,
        unified_trust_score,
        unified_trust_tier,
        rank,
        rank_change,
        last_updated_at
      FROM alpha_leaderboard
      WHERE conviction_score >= ${filters.minConviction}
        AND (ethos_score >= ${filters.minEthos} OR ethos_score IS NULL)
        AND (${filters.chain}::text IS NULL OR chain = ${filters.chain})
        AND (${filters.archetype}::text IS NULL OR archetype = ${filters.archetype})
      ORDER BY conviction_score DESC, ethos_score DESC NULLS LAST
      LIMIT ${filters.limit}
    `;

    if (result.rows.length > 0) {
      return NextResponse.json({
        source: "leaderboard",
        filters,
        entries: result.rows.map((row, idx) => ({
          rank: row.rank || idx + 1,
          address: row.address,
          addressShort: `${row.address.slice(0, 6)}...${row.address.slice(-4)}`,
          chain: row.chain,
          convictionScore: row.conviction_score,
          patienceTax: row.patience_tax,
          winRate: row.win_rate,
          archetype: row.archetype,
          totalPositions: row.total_positions,
          displayName: row.display_name,
          farcaster: row.farcaster,
          ens: row.ens,
          ethosScore: row.ethos_score,
          unifiedTrustScore: row.unified_trust_score,
          unifiedTrustTier: row.unified_trust_tier,
          rankChange: row.rank_change,
          lastUpdated: row.last_updated_at,
        })),
      });
    }

    // Fallback: Build from conviction_analyses if leaderboard is empty
    const analysesResult = await sql`
      SELECT DISTINCT ON (address, chain)
        address,
        chain,
        score as conviction_score,
        patience_tax,
        win_rate,
        archetype,
        total_positions,
        ens_name as ens,
        farcaster_username as farcaster,
        ethos_score,
        unified_trust_score,
        unified_trust_tier,
        analyzed_at as last_updated_at
      FROM conviction_analyses
      WHERE score >= ${filters.minConviction}
        AND (ethos_score >= ${filters.minEthos} OR ethos_score IS NULL)
        AND (${filters.chain}::text IS NULL OR chain = ${filters.chain})
        AND (${filters.archetype}::text IS NULL OR archetype = ${filters.archetype})
      ORDER BY address, chain, analyzed_at DESC
    `;

    const sorted = analysesResult.rows
      .sort((a, b) => b.conviction_score - a.conviction_score)
      .slice(0, filters.limit);

    return NextResponse.json({
      source: "analyses",
      filters,
      entries: sorted.map((row, idx) => ({
        rank: idx + 1,
        address: row.address,
        addressShort: `${row.address.slice(0, 6)}...${row.address.slice(-4)}`,
        chain: row.chain,
        convictionScore: row.conviction_score,
        patienceTax: row.patience_tax,
        winRate: row.win_rate,
        archetype: row.archetype,
        totalPositions: row.total_positions,
        ens: row.ens,
        farcaster: row.farcaster,
        ethosScore: row.ethos_score,
        unifiedTrustScore: row.unified_trust_score,
        unifiedTrustTier: row.unified_trust_tier,
        rankChange: null,
        lastUpdated: row.last_updated_at,
      })),
    });
  } catch (error) {
    console.error("Failed to get leaderboard:", error);
    return NextResponse.json(
      { error: "Failed to get leaderboard" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/leaderboard/refresh
 * Rebuild the leaderboard from analyses (admin/cron)
 */
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");

  // Simple auth for cron jobs
  if (secret !== process.env.CRON_SECRET && process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Save current ranks as previous
    await sql`
      UPDATE alpha_leaderboard SET previous_rank = rank
    `;

    // Upsert latest scores from analyses
    await sql`
      INSERT INTO alpha_leaderboard (
        address, chain, conviction_score, patience_tax, win_rate,
        archetype, total_positions, ens, farcaster, ethos_score,
        unified_trust_score, unified_trust_tier, last_updated_at
      )
      SELECT DISTINCT ON (address, chain)
        address, chain, score, patience_tax, win_rate,
        archetype, total_positions, ens_name, farcaster_username, ethos_score,
        unified_trust_score, unified_trust_tier, analyzed_at
      FROM conviction_analyses
      WHERE analyzed_at > NOW() - INTERVAL '90 days'
      ORDER BY address, chain, analyzed_at DESC
      ON CONFLICT (address, chain) DO UPDATE SET
        conviction_score = EXCLUDED.conviction_score,
        patience_tax = EXCLUDED.patience_tax,
        win_rate = EXCLUDED.win_rate,
        archetype = EXCLUDED.archetype,
        total_positions = EXCLUDED.total_positions,
        ens = EXCLUDED.ens,
        farcaster = EXCLUDED.farcaster,
        ethos_score = EXCLUDED.ethos_score,
        unified_trust_score = EXCLUDED.unified_trust_score,
        unified_trust_tier = EXCLUDED.unified_trust_tier,
        last_updated_at = EXCLUDED.last_updated_at
    `;

    // Update ranks
    await sql`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY conviction_score DESC, ethos_score DESC NULLS LAST) as new_rank
        FROM alpha_leaderboard
      )
      UPDATE alpha_leaderboard l
      SET rank = r.new_rank
      FROM ranked r
      WHERE l.id = r.id
    `;

    const countResult = await sql`
      SELECT COUNT(*) as count FROM alpha_leaderboard
    `;

    return NextResponse.json({
      message: "Leaderboard refreshed",
      totalEntries: countResult.rows[0].count,
    });
  } catch (error) {
    console.error("Failed to refresh leaderboard:", error);
    return NextResponse.json(
      { error: "Failed to refresh leaderboard" },
      { status: 500 }
    );
  }
}
