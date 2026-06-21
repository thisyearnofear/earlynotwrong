/**
 * On-Chain Holder Count Client — BSC behavioral conviction data.
 *
 * Queries BEP-20 token holder counts from two sources:
 *   1. NodeReal MegaNode (primary) — JSON-RPC `nr_getTokenHolderCount`
 *   2. CoinGecko token info (fallback) — REST `holders.count`
 *
 * Results are cached in `agent/data/holders.json` so we can compute holder
 * GROWTH across cycles without re-querying. Each source is env-gated: when
 * the key isn't set, that source is skipped. The cache still works for any
 * previously-fetched counts.
 *
 * Contract addresses come from TWAK's symbol → address resolver, so we
 * don't maintain a separate address table.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CACHE_FILE = "holders.json";
const NODEREAL_RPC = "https://bsc-mainnet.nodereal.io/v1";
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

export interface HolderSnapshot {
  count: number;
  fetchedAt: number;
}

export interface HolderCache {
  /** symbol (upper) → chronologically-ordered snapshots. */
  [symbol: string]: HolderSnapshot[];
}

// =============================================================================
// Cache persistence — walks up from the compiled location to find agent/data/
// =============================================================================

function findDataDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 5; i++) {
    const candidate = resolve(dir, "data");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const fallback = resolve(here, "data");
  try {
    mkdirSync(fallback, { recursive: true });
    return fallback;
  } catch {
    return null;
  }
}

const dataDir = findDataDir();
const cachePath = dataDir ? resolve(dataDir, CACHE_FILE) : null;

export function loadHolderCache(): HolderCache {
  if (!cachePath || !existsSync(cachePath)) return {};
  try {
    return JSON.parse(readFileSync(cachePath, "utf-8")) as HolderCache;
  } catch {
    return {};
  }
}

export function saveHolderCache(cache: HolderCache): void {
  if (!cachePath) return;
  try {
    writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf-8");
  } catch (err) {
    console.warn(
      "[holders] Failed to persist holder cache:",
      (err as Error)?.message || String(err)
    );
  }
}

// =============================================================================
// Primary: NodeReal MegaNode — JSON-RPC nr_getTokenHolderCount (50 CUs/call)
// =============================================================================

async function fetchFromNodeReal(
  contractAddress: string,
  symbol: string
): Promise<number | null> {
  const apiKey = process.env.NODEREAL_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(`${NODEREAL_RPC}/${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "nr_getTokenHolderCount",
        params: [contractAddress],
        id: 1,
      }),
    });
    if (!res.ok) {
      console.warn(`[holders] ${symbol}: NodeReal HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json()) as {
      result?: { result?: string };
      error?: { message?: string };
    };
    if (body.error) {
      console.warn(`[holders] ${symbol}: NodeReal ${body.error.message}`);
      return null;
    }
    const hex = body.result?.result;
    if (!hex) return null;
    const count = parseInt(hex, 16);
    return Number.isFinite(count) && count >= 0 ? count : null;
  } catch (err) {
    console.warn(
      `[holders] ${symbol} NodeReal failed:`,
      (err as Error)?.message || String(err)
    );
    return null;
  }
}

// =============================================================================
// Fallback: CoinGecko token info — REST holders.count
// =============================================================================

async function fetchFromCoinGecko(
  contractAddress: string,
  symbol: string
): Promise<number | null> {
  const apiKey = process.env.COINGECKO_API_KEY;
  if (!apiKey) return null;

  try {
    const url = `${COINGECKO_BASE}/onchain/networks/bsc/tokens/${contractAddress}/info`;
    const res = await fetch(url, {
      headers: { "x-cg-demo-api-key": apiKey },
    });
    if (!res.ok) {
      console.warn(`[holders] ${symbol}: CoinGecko HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json()) as {
      data?: { attributes?: { holders?: { count?: number } } };
    };
    const count = body.data?.attributes?.holders?.count;
    return typeof count === "number" && count >= 0 ? count : null;
  } catch (err) {
    console.warn(
      `[holders] ${symbol} CoinGecko failed:`,
      (err as Error)?.message || String(err)
    );
    return null;
  }
}

// =============================================================================
// Public API — tries NodeReal first, falls back to CoinGecko
// =============================================================================

/**
 * Fetch the current holder count for a BEP-20 token. Returns null if:
 *   - Neither NODEREAL_API_KEY nor COINGECKO_API_KEY is set
 *   - Both sources fail or return no data
 */
export async function fetchHolderCount(
  contractAddress: string,
  symbol: string
): Promise<number | null> {
  if (!contractAddress) return null;

  const nodeReal = await fetchFromNodeReal(contractAddress, symbol);
  if (nodeReal !== null) return nodeReal;

  return fetchFromCoinGecko(contractAddress, symbol);
}

/**
 * Record a fresh snapshot in the cache (mutates in place). Caller is
 * responsible for persisting via saveHolderCache() once the batch is done.
 */
export function recordHolderCount(
  cache: HolderCache,
  symbol: string,
  count: number,
  now: number = Date.now()
): void {
  const key = symbol.toUpperCase();
  const history = cache[key] ?? [];
  const last = history[history.length - 1];
  if (last && now - last.fetchedAt < 60_000 && last.count === count) return;
  history.push({ count, fetchedAt: now });
  if (history.length > 500) history.splice(0, history.length - 500);
  cache[key] = history;
}
