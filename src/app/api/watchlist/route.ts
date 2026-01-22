/**
 * Watchlist API
 * Get and manage the watchlist of high-conviction traders
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
} from "@/lib/db/postgres";
import { WATCHLIST } from "@/lib/watchlist";

/**
 * GET /api/watchlist
 * Returns watchlist from database, falls back to static config
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const chain = searchParams.get("chain") as "solana" | "base" | null;

  try {
    // Try database first
    const dbWatchlist = await getWatchlist(chain || undefined);

    if (dbWatchlist.length > 0) {
      return NextResponse.json({
        source: "database",
        traders: dbWatchlist,
      });
    }
  } catch (error) {
    console.warn("Database unavailable, using static watchlist:", error);
  }

  // Fallback to static config
  const staticList = chain
    ? WATCHLIST.filter((t) => t.chain === chain)
    : WATCHLIST;

  return NextResponse.json({
    source: "static",
    traders: staticList.map((t) => ({
      traderId: t.id,
      name: t.name,
      chain: t.chain,
      wallets: t.wallets,
      farcaster: t.socials?.farcaster || null,
      twitter: t.socials?.twitter || null,
      ens: t.socials?.ens || null,
      addedBy: null,
      addedAt: new Date(),
      isActive: true,
    })),
  });
}

/**
 * POST /api/watchlist
 * Add a new trader to the watchlist
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { traderId, name, chain, wallets, farcaster, twitter, ens, addedBy } =
      body;

    if (!traderId || !name || !chain || !wallets?.length) {
      return NextResponse.json(
        { error: "Missing required fields: traderId, name, chain, wallets" },
        { status: 400 }
      );
    }

    const result = await addToWatchlist({
      traderId,
      name,
      chain,
      wallets,
      farcaster: farcaster || null,
      twitter: twitter || null,
      ens: ens || null,
      addedBy: addedBy || null,
    });

    if (!result) {
      return NextResponse.json(
        { error: "Failed to add trader to watchlist" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: "Trader added to watchlist",
      trader: result,
    });
  } catch (error) {
    console.error("Failed to add to watchlist:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/watchlist
 * Remove a trader from the watchlist
 */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const traderId = searchParams.get("traderId");

  if (!traderId) {
    return NextResponse.json(
      { error: "Missing traderId parameter" },
      { status: 400 }
    );
  }

  const success = await removeFromWatchlist(traderId);

  if (!success) {
    return NextResponse.json(
      { error: "Failed to remove trader" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    message: "Trader removed from watchlist",
    traderId,
  });
}
