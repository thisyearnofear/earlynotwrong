/**
 * On-Chain Holder Data — BSC holder counts + growth computation.
 *
 * Merged from:
 *   - bscscan-client.ts — NodeReal MegaNode + CoinGecko holder count fetcher
 *   - holder-growth.ts  — Holder growth % computation and scoring fraction
 *
 * Exports: HolderCache, HolderSnapshot, HolderMetric,
 *          loadHolderCache, saveHolderCache, fetchHolderCount, recordHolderCount,
 *          computeHolderMetric, holderGrowthFraction.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const NODEREAL_RPC = "https://bsc-mainnet.nodereal.io/v1";
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

// =============================================================================
// Types
// =============================================================================

/** A single snapshot of an on-chain holder count. */
export interface HolderSnapshot {
  /** Total holder count at this point in time. */
  count: number;
  /** Unix ms timestamp when the count was fetched. */
  fetchedAt: number;
}

/**
 * Chronologically-ordered holder-count snapshots keyed by uppercase symbol.
 * Persisted to disk between cycles in `agent/data/holders.json`.
 */
export interface HolderCache {
  [symbol: string]: HolderSnapshot[];
}

/** Computed holder-growth metric for a single token. */
export interface HolderMetric {
  /** Current holder count (0 if unknown). */
  count: number;
  /**
   * Percent growth over the lookback window (default 7 days).
   * Null if the cache has insufficient history (< 24h or no snapshots).
   */
  growthPercent: number | null;
  /** Number of snapshots in the cache for this symbol. */
  samples: number;
}

// =============================================================================
// Cache Persistence
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
  try { mkdirSync(fallback, { recursive: true }); return fallback; } catch { return null; }
}

const dataDir = findDataDir();
const cachePath = dataDir ? resolve(dataDir, "holders.json") : null;

export function loadHolderCache(): HolderCache {
  if (!cachePath || !existsSync(cachePath)) return {};
  try { return JSON.parse(readFileSync(cachePath, "utf-8")) as HolderCache; } catch { return {}; }
}

export function saveHolderCache(cache: HolderCache): void {
  if (!cachePath) return;
  try { writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf-8"); } catch (err) {
    console.warn("[holders] Failed to persist holder cache:", (err as Error)?.message || String(err));
  }
}

// =============================================================================
// Primary: NodeReal MegaNode
// =============================================================================

async function fetchFromNodeReal(contractAddress: string, symbol: string): Promise<number | null> {
  const apiKey = process.env.NODEREAL_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`${NODEREAL_RPC}/${apiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "nr_getTokenHolderCount", params: [contractAddress], id: 1 }),
    });
    if (!res.ok) { console.warn(`[holders] ${symbol}: NodeReal HTTP ${res.status}`); return null; }
    const body = (await res.json()) as { result?: { result?: string }; error?: { message?: string } };
    if (body.error) { console.warn(`[holders] ${symbol}: NodeReal ${body.error.message}`); return null; }
    const hex = body.result?.result;
    if (!hex) return null;
    const count = parseInt(hex, 16);
    return Number.isFinite(count) && count >= 0 ? count : null;
  } catch (err) {
    console.warn(`[holders] ${symbol} NodeReal failed:`, (err as Error)?.message || String(err));
    return null;
  }
}

// =============================================================================
// Fallback: CoinGecko
// =============================================================================

async function fetchFromCoinGecko(contractAddress: string, symbol: string): Promise<number | null> {
  const apiKey = process.env.COINGECKO_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`${COINGECKO_BASE}/onchain/networks/bsc/tokens/${contractAddress}/info`, {
      headers: { "x-cg-demo-api-key": apiKey },
    });
    if (!res.ok) { console.warn(`[holders] ${symbol}: CoinGecko HTTP ${res.status}`); return null; }
    const body = (await res.json()) as { data?: { attributes?: { holders?: { count?: number } } } };
    const count = body.data?.attributes?.holders?.count;
    return typeof count === "number" && count >= 0 ? count : null;
  } catch (err) {
    console.warn(`[holders] ${symbol} CoinGecko failed:`, (err as Error)?.message || String(err));
    return null;
  }
}

// =============================================================================
// Public API
// =============================================================================

/** Fetch holder count from NodeReal (primary) → CoinGecko (fallback). */
export async function fetchHolderCount(contractAddress: string, symbol: string): Promise<number | null> {
  if (!contractAddress) return null;
  const nr = await fetchFromNodeReal(contractAddress, symbol);
  if (nr !== null) return nr;
  return fetchFromCoinGecko(contractAddress, symbol);
}

/** Record a snapshot in the cache. Caller persists via saveHolderCache(). */
export function recordHolderCount(cache: HolderCache, symbol: string, count: number, now: number = Date.now()): void {
  const key = symbol.toUpperCase();
  const history = cache[key] ?? [];
  const last = history[history.length - 1];
  if (last && now - last.fetchedAt < 60_000 && last.count === count) return;
  history.push({ count, fetchedAt: now });
  if (history.length > 500) history.splice(0, history.length - 500);
  cache[key] = history;
}

// =============================================================================
// Growth Computation
// =============================================================================

/**
 * Compute a holder metric for one symbol from the cache.
 * `growthPercent` is null if history is insufficient.
 */
export function computeHolderMetric(cache: HolderCache, symbol: string, options: { lookbackMs?: number; minHistoryMs?: number; now?: number } = {}): HolderMetric {
  const history = cache[symbol.toUpperCase()] ?? [];
  const now = options.now ?? Date.now();
  const lookback = options.lookbackMs ?? DEFAULT_LOOKBACK_MS;
  const minHistory = options.minHistoryMs ?? 24 * 60 * 60 * 1000;
  if (history.length === 0) return { count: 0, growthPercent: null, samples: 0 };
  const latest = history[history.length - 1];
  const cutoff = now - lookback;
  let anchor = history[0];
  for (const snap of history) { if (snap.fetchedAt > cutoff) break; anchor = snap; }
  if (now - anchor.fetchedAt < minHistory || anchor.count <= 0) return { count: latest.count, growthPercent: null, samples: history.length };
  return { count: latest.count, growthPercent: ((latest.count - anchor.count) / anchor.count) * 100, samples: history.length };
}

/**
 * Map holder growth to a bonus fraction (0–1).
 * Returns null when growthPercent is null — skips the holder component.
 *   growth ≤ -5%  → 0.0, growth = 0% → 0.4, growth ≥ +10% → 1.0
 */
export function holderGrowthFraction(growthPercent: number | null): number | null {
  if (growthPercent === null) return null;
  const g = growthPercent;
  if (g <= -5) return 0;
  if (g <= 0) return 0.4 * (1 + g / 5);
  if (g <= 10) return 0.4 + (g / 10) * 0.6;
  return 1.0;
}
