/**
 * Community Watchlist API
 * Ethos-gated endpoints for community-curated trader watchlist
 * 
 * Tiers:
 * - 1000+ Ethos: Can nominate (requires 2 endorsements to approve)
 * - 1200+ Ethos: Can add with 1 endorsement
 * - 1400+ Ethos: Can add directly + endorse nominations
 * - 1600+ Ethos: Can remove + moderate
 * - 2000+ Ethos: Full admin + featured picks
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { ethosClient } from "@/lib/ethos";
import { APP_CONFIG } from "@/lib/config";

const { communityTiers } = APP_CONFIG.reputation;

interface NominationRequest {
  traderName: string;
  wallets: string[];
  chain: "solana" | "base";
  farcaster?: string;
  twitter?: string;
  ens?: string;
  reason?: string;
}

/**
 * GET /api/community/watchlist
 * Get community watchlist with optional filters
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const chain = searchParams.get("chain") as "solana" | "base" | null;
  const status = searchParams.get("status") || "approved";
  const minEthos = parseInt(searchParams.get("minEthos") || "0");

  try {
    const result = await sql`
      SELECT 
        w.*,
        COALESCE(
          (SELECT json_agg(json_build_object(
            'address', e.endorser_address,
            'ethos', e.endorser_ethos,
            'at', e.endorsed_at
          ))
          FROM watchlist_endorsements e 
          WHERE e.trader_id = w.trader_id),
          '[]'
        ) as endorsements
      FROM watchlist_traders w
      WHERE w.is_active = true
        AND (w.status = ${status} OR w.status = 'featured')
        AND (${chain}::text IS NULL OR w.chain = ${chain})
        AND (w.added_by_ethos >= ${minEthos} OR w.added_by IS NULL)
      ORDER BY 
        CASE WHEN w.status = 'featured' THEN 0 ELSE 1 END,
        w.endorsement_count DESC,
        w.added_at DESC
      LIMIT 100
    `;

    return NextResponse.json({
      traders: result.rows,
      filters: { chain, status, minEthos },
    });
  } catch (error) {
    console.error("Failed to get community watchlist:", error);
    return NextResponse.json(
      { error: "Failed to get watchlist" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/community/watchlist
 * Nominate or add a trader to the watchlist (Ethos-gated)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      nominatorAddress,
      traderName,
      wallets,
      chain,
      farcaster,
      twitter,
      ens,
    } = body as NominationRequest & { nominatorAddress: string };

    if (!nominatorAddress || !traderName || !wallets?.length || !chain) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Verify Ethos score
    const ethosScore = await ethosClient.getScoreByAddress(nominatorAddress);
    const score = ethosScore?.score || 0;

    if (score < communityTiers.nominator) {
      return NextResponse.json(
        {
          error: `Ethos score of ${communityTiers.nominator}+ required to nominate`,
          currentScore: score,
          requiredScore: communityTiers.nominator,
        },
        { status: 403 }
      );
    }

    // Determine status based on Ethos tier
    let status: "nominated" | "approved" = "nominated";
    if (score >= communityTiers.curator) {
      status = "approved"; // Curators can add directly
    }

    // Generate trader ID
    const traderId = `community-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const walletsArray = `{${wallets.map((w: string) => `"${w}"`).join(",")}}`;

    const result = await sql`
      INSERT INTO watchlist_traders (
        trader_id, name, chain, wallets, farcaster, twitter, ens,
        added_by, added_by_ethos, status
      ) VALUES (
        ${traderId},
        ${traderName},
        ${chain},
        ${walletsArray}::text[],
        ${farcaster || null},
        ${twitter || null},
        ${ens || null},
        ${nominatorAddress.toLowerCase()},
        ${score},
        ${status}
      )
      RETURNING *
    `;

    // Auto-endorse if curator+
    if (score >= communityTiers.curator) {
      await sql`
        INSERT INTO watchlist_endorsements (trader_id, endorser_address, endorser_ethos)
        VALUES (${traderId}, ${nominatorAddress.toLowerCase()}, ${score})
        ON CONFLICT DO NOTHING
      `;
      
      await sql`
        UPDATE watchlist_traders 
        SET endorsement_count = endorsement_count + 1
        WHERE trader_id = ${traderId}
      `;
    }

    return NextResponse.json({
      message: status === "approved" 
        ? "Trader added to watchlist" 
        : "Trader nominated - needs endorsements to be approved",
      trader: result.rows[0],
      status,
      endorsementsNeeded: status === "nominated" 
        ? (score >= communityTiers.contributor ? 1 : 2)
        : 0,
    });
  } catch (error) {
    console.error("Failed to nominate trader:", error);
    return NextResponse.json(
      { error: "Failed to nominate trader" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/community/watchlist
 * Endorse a nomination (Ethos-gated)
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { endorserAddress, traderId } = body;

    if (!endorserAddress || !traderId) {
      return NextResponse.json(
        { error: "Missing endorserAddress or traderId" },
        { status: 400 }
      );
    }

    // Verify Ethos score (need at least contributor level to endorse)
    const ethosScore = await ethosClient.getScoreByAddress(endorserAddress);
    const score = ethosScore?.score || 0;

    if (score < communityTiers.contributor) {
      return NextResponse.json(
        {
          error: `Ethos score of ${communityTiers.contributor}+ required to endorse`,
          currentScore: score,
          requiredScore: communityTiers.contributor,
        },
        { status: 403 }
      );
    }

    // Add endorsement
    await sql`
      INSERT INTO watchlist_endorsements (trader_id, endorser_address, endorser_ethos)
      VALUES (${traderId}, ${endorserAddress.toLowerCase()}, ${score})
      ON CONFLICT (trader_id, endorser_address) DO NOTHING
    `;

    // Update endorsement count
    const countResult = await sql`
      UPDATE watchlist_traders 
      SET endorsement_count = (
        SELECT COUNT(*) FROM watchlist_endorsements WHERE trader_id = ${traderId}
      )
      WHERE trader_id = ${traderId}
      RETURNING endorsement_count, status, added_by_ethos
    `;

    const trader = countResult.rows[0];
    
    // Check if nomination should be auto-approved
    const requiredEndorsements = trader.added_by_ethos >= communityTiers.contributor ? 1 : 2;
    
    if (trader.status === "nominated" && trader.endorsement_count >= requiredEndorsements) {
      await sql`
        UPDATE watchlist_traders 
        SET status = 'approved'
        WHERE trader_id = ${traderId}
      `;
      
      return NextResponse.json({
        message: "Endorsement added - nomination approved!",
        traderId,
        endorsementCount: trader.endorsement_count,
        status: "approved",
      });
    }

    return NextResponse.json({
      message: "Endorsement added",
      traderId,
      endorsementCount: trader.endorsement_count,
      endorsementsNeeded: Math.max(0, requiredEndorsements - trader.endorsement_count),
    });
  } catch (error) {
    console.error("Failed to endorse:", error);
    return NextResponse.json(
      { error: "Failed to endorse" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/community/watchlist
 * Remove a trader (Moderator+ only)
 */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const traderId = searchParams.get("traderId");
  const moderatorAddress = searchParams.get("moderator");

  if (!traderId || !moderatorAddress) {
    return NextResponse.json(
      { error: "Missing traderId or moderator address" },
      { status: 400 }
    );
  }

  // Verify moderator status
  const ethosScore = await ethosClient.getScoreByAddress(moderatorAddress);
  const score = ethosScore?.score || 0;

  if (score < communityTiers.moderator) {
    return NextResponse.json(
      {
        error: `Ethos score of ${communityTiers.moderator}+ required to moderate`,
        currentScore: score,
        requiredScore: communityTiers.moderator,
      },
      { status: 403 }
    );
  }

  await sql`
    UPDATE watchlist_traders 
    SET is_active = false, status = 'rejected'
    WHERE trader_id = ${traderId}
  `;

  return NextResponse.json({
    message: "Trader removed from watchlist",
    traderId,
    moderatedBy: moderatorAddress,
  });
}
