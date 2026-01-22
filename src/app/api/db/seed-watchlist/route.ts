/**
 * Seed Watchlist API
 * One-time endpoint to populate watchlist from static config
 */

import { NextResponse } from "next/server";
import { addToWatchlist } from "@/lib/db/postgres";
import { WATCHLIST } from "@/lib/watchlist";

export async function POST() {
  const results: { success: string[]; failed: string[] } = {
    success: [],
    failed: [],
  };

  for (const trader of WATCHLIST) {
    const result = await addToWatchlist({
      traderId: trader.id,
      name: trader.name,
      chain: trader.chain,
      wallets: trader.wallets,
      farcaster: trader.socials?.farcaster || null,
      twitter: trader.socials?.twitter || null,
      ens: trader.socials?.ens || null,
      addedBy: null,
    });

    if (result) {
      results.success.push(trader.id);
    } else {
      results.failed.push(trader.id);
    }
  }

  return NextResponse.json({
    message: "Watchlist seeded",
    results,
  });
}
