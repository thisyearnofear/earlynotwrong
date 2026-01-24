/**
 * Watchlist Service
 * Single source of truth: Postgres watchlist_traders table
 * Falls back to cached data if DB unavailable
 */

import { sql } from "@vercel/postgres";

export interface WatchlistTrader {
  id: string;
  name: string;
  wallets: string[];
  chain: "solana" | "base";
  socials?: {
    farcaster?: string;
    twitter?: string;
    ens?: string;
  };
}

// In-memory cache for performance
let cachedWatchlist: WatchlistTrader[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch watchlist from Postgres
 */
async function fetchWatchlistFromDb(): Promise<WatchlistTrader[]> {
  try {
    const result = await sql`
      SELECT trader_id, name, chain, wallets, farcaster, twitter, ens
      FROM watchlist_traders
      WHERE is_active = true
        AND status IN ('approved', 'featured')
      ORDER BY endorsement_count DESC, added_at ASC
    `;

    return result.rows.map((row) => ({
      id: row.trader_id,
      name: row.name,
      chain: row.chain as "solana" | "base",
      wallets: row.wallets as string[],
      socials: {
        farcaster: row.farcaster || undefined,
        twitter: row.twitter || undefined,
        ens: row.ens || undefined,
      },
    }));
  } catch (error) {
    console.warn("Failed to fetch watchlist from DB:", error);
    return [];
  }
}

/**
 * Get the full watchlist (cached)
 */
export async function getWatchlist(
  chain?: "solana" | "base"
): Promise<WatchlistTrader[]> {
  const now = Date.now();

  // Refresh cache if stale
  if (!cachedWatchlist || now - cacheTimestamp > CACHE_TTL) {
    const fresh = await fetchWatchlistFromDb();
    if (fresh.length > 0) {
      cachedWatchlist = fresh;
      cacheTimestamp = now;
    }
  }

  // Return empty if still no data
  if (!cachedWatchlist) {
    return [];
  }

  return chain
    ? cachedWatchlist.filter((t) => t.chain === chain)
    : cachedWatchlist;
}

/**
 * Get all wallet addresses (sync version for webhook handlers)
 * Uses cached data only
 */
export function getWatchlistAddresses(chain?: "solana" | "base"): string[] {
  if (!cachedWatchlist) {
    return [];
  }

  const traders = chain
    ? cachedWatchlist.filter((t) => t.chain === chain)
    : cachedWatchlist;

  return traders.flatMap((t) => t.wallets);
}

/**
 * Find trader by wallet address (sync version)
 */
export function findTraderByWallet(
  walletAddress: string
): WatchlistTrader | undefined {
  if (!cachedWatchlist) {
    return undefined;
  }

  const normalized = walletAddress.toLowerCase();
  return cachedWatchlist.find((t) =>
    t.wallets.some((w) => w.toLowerCase() === normalized)
  );
}

/**
 * Get trader by ID (sync version)
 */
export function getTraderById(id: string): WatchlistTrader | undefined {
  if (!cachedWatchlist) {
    return undefined;
  }
  return cachedWatchlist.find((t) => t.id === id);
}

/**
 * Preload cache on module init (fire-and-forget)
 */
export async function preloadWatchlistCache(): Promise<void> {
  await getWatchlist();
}

// Attempt to preload on import (non-blocking)
preloadWatchlistCache().catch(() => {
  // Silently fail - cache will populate on first use
});

/**
 * @deprecated Use getWatchlist() instead. Exported for migration compatibility.
 */
export const WATCHLIST: WatchlistTrader[] = [];
