/**
 * BscScan Client — Holder-count queries for on-chain conviction.
 *
 * Queries the BscScan `tokenholdercount` endpoint for BEP-20 tokens and
 * caches results in `agent/data/holders.json` so we can compute holder
 * GROWTH across cycles without re-querying (the free tier is 1 call/s
 * with a 100k/day budget; we query once per token per cycle).
 *
 * Fully gated on `BSCSCAN_API_KEY` — when the key isn't set, all queries
 * return null and the conviction signal gracefully omits the holder
 * component. The cache still works for any previously-fetched counts.
 *
 * Contract addresses come from TWAK's symbol → address resolver, so we
 * don't maintain a separate address table.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CACHE_FILE = "holders.json";
const API_BASE = "https://api.bscscan.com/api";

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
  // Fallback: create a sibling data/ directory next to the compiled output.
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
      "[bscscan] Failed to persist holder cache:",
      (err as Error)?.message || String(err)
    );
  }
}

// =============================================================================
// Live query — gated on BSCSCAN_API_KEY, respects the 1-call/s free-tier pace
// =============================================================================

/**
 * Fetch the current holder count for a BEP-20 token. Returns null if:
 *   - BSCSCAN_API_KEY isn't set (expected in simulator / offline mode)
 *   - The network call fails
 *   - BscScan returns a non-OK status
 */
export async function fetchHolderCount(
  contractAddress: string,
  symbol: string
): Promise<number | null> {
  const apiKey = process.env.BSCSCAN_API_KEY;
  if (!apiKey) return null;
  if (!contractAddress) return null;

  try {
    const url = `${API_BASE}?module=token&action=tokenholdercount&contractaddress=${contractAddress}&apikey=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(
        `[bscscan] ${symbol}: HTTP ${res.status} from holder-count endpoint`
      );
      return null;
    }
    const body = (await res.json()) as {
      status: string;
      message: string;
      result: string;
    };
    if (body.status !== "1" || body.result === undefined) {
      // BscScan returns status "0" with a message on unknown contracts — that's
      // not an error, just missing data.
      if (body.message !== "OK" && body.message !== "No data found") {
        console.warn(`[bscscan] ${symbol}: ${body.message}`);
      }
      return null;
    }
    const count = parseInt(body.result, 10);
    return Number.isFinite(count) && count >= 0 ? count : null;
  } catch (err) {
    console.warn(
      `[bscscan] ${symbol} fetch failed:`,
      (err as Error)?.message || String(err)
    );
    return null;
  }
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
  // De-duplicate within the same minute to avoid churn on rapid restarts.
  const last = history[history.length - 1];
  if (last && now - last.fetchedAt < 60_000 && last.count === count) return;
  history.push({ count, fetchedAt: now });
  // Cap at 500 snapshots per symbol (~2 months at 4h cycles).
  if (history.length > 500) history.splice(0, history.length - 500);
  cache[key] = history;
}
