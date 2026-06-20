/**
 * Holder Growth — on-chain behavioral conviction.
 *
 * A growing holder base is the closest on-chain proxy we have to
 * "behavioral conviction": real wallets choosing to accumulate and hold.
 * We compute percent growth over a lookback window (default 7 days) and
 * feed it into the conviction signal as a bonus component.
 *
 * Pure functions over the holder cache — fully testable without the
 * BscScan API. When the cache is empty (first cycles, or no
 * BSCSCAN_API_KEY set), every token returns `null` and the conviction
 * signal omits the holder component rather than scoring on fake data.
 */

import type { HolderCache } from "./bscscan-client.js";

export interface HolderMetric {
  /** Current holder count (0 if unknown). */
  count: number;
  /** Percent growth over the lookback window, or null if history is too short. */
  growthPercent: number | null;
  /** Number of snapshots in the cache for this symbol. */
  samples: number;
}

/** Default lookback: 7 days. Matches the 7d return window. */
const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Compute a holder metric for one symbol from the cache.
 *
 * `growthPercent` is null if:
 *   - the symbol has no snapshots (no BscScan key or never queried)
 *   - the oldest snapshot is newer than `minHistoryMs` (not enough history yet)
 *
 * This keeps the conviction signal honest: we score only on real history.
 */
export function computeHolderMetric(
  cache: HolderCache,
  symbol: string,
  options: {
    lookbackMs?: number;
    minHistoryMs?: number;
    now?: number;
  } = {}
): HolderMetric {
  const history = cache[symbol.toUpperCase()] ?? [];
  const now = options.now ?? Date.now();
  const lookback = options.lookbackMs ?? DEFAULT_LOOKBACK_MS;
  // Require at least one day of history before computing growth — the first
  // cycle can't produce a meaningful rate.
  const minHistory = options.minHistoryMs ?? 24 * 60 * 60 * 1000;

  if (history.length === 0) {
    return { count: 0, growthPercent: null, samples: 0 };
  }

  const latest = history[history.length - 1];
  const cutoff = now - lookback;

  // Find the oldest snapshot at-or-before the cutoff. This anchors the growth
  // calculation to the longest available history, up to `lookback`.
  let anchor = history[0];
  for (const snap of history) {
    if (snap.fetchedAt > cutoff) break;
    anchor = snap;
  }

  // Reject growth calculation if we don't have enough history yet.
  if (now - anchor.fetchedAt < minHistory || anchor.count <= 0) {
    return {
      count: latest.count,
      growthPercent: null,
      samples: history.length,
    };
  }

  const growthPercent =
    ((latest.count - anchor.count) / anchor.count) * 100;

  return {
    count: latest.count,
    growthPercent,
    samples: history.length,
  };
}

/**
 * Map holder growth to a bonus fraction (0–1).
 *
 *   growth ≤ −5%  →  0.0  (holders leaving — bearish)
 *   growth =  0%  →  0.4  (neutral)
 *   growth ≥ +10% →  1.0  (strong accumulation — the conviction we want)
 *
 * Returns null when `growthPercent` is null — the conviction signal uses
 * this to skip the holder component entirely rather than bias the score.
 */
export function holderGrowthFraction(
  growthPercent: number | null
): number | null {
  if (growthPercent === null) return null;
  const g = growthPercent;
  if (g <= -5) return 0;
  if (g <= 0) return 0.4 * (1 + g / 5);           // -5 → 0, 0 → 0.4
  if (g <= 10) return 0.4 + (g / 10) * 0.6;        // 0 → 0.4, 10 → 1.0
  return 1.0;
}
