/**
 * Analysis Cache for Offline/Cached Mode
 * Stores complete analysis results for previously analyzed wallets
 */

import { ConvictionMetrics } from "./market";
import { PositionAnalysis } from "./api-client";
import { EthosScore, EthosProfile } from "./ethos";

export interface CachedAnalysis {
  id: string;
  address: string;
  chain: "solana" | "base";
  timestamp: number;
  expiresAt: number;
  
  // Complete analysis data
  convictionMetrics: ConvictionMetrics;
  positionAnalyses: PositionAnalysis[];
  ethosScore: EthosScore | null;
  ethosProfile: EthosProfile | null;
  
  // Metadata
  parameters: {
    timeHorizon: number;
    minTradeValue: number;
  };
}

const CACHE_KEY = "enw_analysis_cache";
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHE_SIZE = 20; // Store up to 20 complete analyses

/**
 * Save a complete analysis to cache
 */
export function cacheAnalysis(
  address: string,
  chain: "solana" | "base",
  convictionMetrics: ConvictionMetrics,
  positionAnalyses: PositionAnalysis[],
  ethosScore: EthosScore | null,
  ethosProfile: EthosProfile | null,
  parameters: { timeHorizon: number; minTradeValue: number }
): CachedAnalysis {
  if (typeof window === "undefined") {
    throw new Error("cacheAnalysis can only be called on the client");
  }

  const now = Date.now();
  const cached: CachedAnalysis = {
    id: `${address}_${chain}_${now}`,
    address,
    chain,
    timestamp: now,
    expiresAt: now + CACHE_TTL,
    convictionMetrics,
    positionAnalyses,
    ethosScore,
    ethosProfile,
    parameters,
  };

  try {
    const existing = getAllCachedAnalyses();
    
    // Remove old cache entries for the same address/chain/parameters
    const filtered = existing.filter(
      (item) =>
        !(
          item.address === address &&
          item.chain === chain &&
          item.parameters.timeHorizon === parameters.timeHorizon &&
          item.parameters.minTradeValue === parameters.minTradeValue
        )
    );

    // Add new entry
    filtered.push(cached);

    // Sort by timestamp (newest first)
    filtered.sort((a, b) => b.timestamp - a.timestamp);

    // Limit size and remove expired
    const valid = filtered
      .filter((item) => item.expiresAt > now)
      .slice(0, MAX_CACHE_SIZE);

    localStorage.setItem(CACHE_KEY, JSON.stringify(valid));
    return cached;
  } catch (error) {
    console.error("Failed to cache analysis:", error);
    return cached;
  }
}

/**
 * Get cached analysis for a specific wallet
 */
export function getCachedAnalysis(
  address: string,
  chain: "solana" | "base",
  parameters?: { timeHorizon: number; minTradeValue: number }
): CachedAnalysis | null {
  if (typeof window === "undefined") return null;

  try {
    const all = getAllCachedAnalyses();
    const now = Date.now();

    // Find matching analysis
    const matches = all.filter(
      (item) =>
        item.address === address &&
        item.chain === chain &&
        item.expiresAt > now &&
        (!parameters ||
          (item.parameters.timeHorizon === parameters.timeHorizon &&
            item.parameters.minTradeValue === parameters.minTradeValue))
    );

    // Return most recent
    if (matches.length > 0) {
      return matches.sort((a, b) => b.timestamp - a.timestamp)[0];
    }

    return null;
  } catch (error) {
    console.error("Failed to get cached analysis:", error);
    return null;
  }
}

/**
 * Check if cached analysis exists for wallet
 */
export function hasCachedAnalysis(
  address: string,
  chain: "solana" | "base"
): boolean {
  return getCachedAnalysis(address, chain) !== null;
}

/**
 * Get all cached analyses
 */
export function getAllCachedAnalyses(): CachedAnalysis[] {
  if (typeof window === "undefined") return [];

  try {
    const stored = localStorage.getItem(CACHE_KEY);
    if (!stored) return [];

    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Failed to load cached analyses:", error);
    return [];
  }
}

/**
 * Clear expired cache entries
 */
export function clearExpiredCache(): number {
  if (typeof window === "undefined") return 0;

  try {
    const all = getAllCachedAnalyses();
    const now = Date.now();
    const valid = all.filter((item) => item.expiresAt > now);
    const removed = all.length - valid.length;

    if (removed > 0) {
      localStorage.setItem(CACHE_KEY, JSON.stringify(valid));
    }

    return removed;
  } catch (error) {
    console.error("Failed to clear expired cache:", error);
    return 0;
  }
}

/**
 * Clear all cached analyses
 */
export function clearAllCache(): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.removeItem(CACHE_KEY);
  } catch (error) {
    console.error("Failed to clear cache:", error);
  }
}

/**
 * Get cache statistics
 */
export function getCacheStats(): {
  totalEntries: number;
  validEntries: number;
  expiredEntries: number;
  sizeBytes: number;
} {
  if (typeof window === "undefined") {
    return { totalEntries: 0, validEntries: 0, expiredEntries: 0, sizeBytes: 0 };
  }

  try {
    const all = getAllCachedAnalyses();
    const now = Date.now();
    const valid = all.filter((item) => item.expiresAt > now);
    const stored = localStorage.getItem(CACHE_KEY) || "";
    
    return {
      totalEntries: all.length,
      validEntries: valid.length,
      expiredEntries: all.length - valid.length,
      sizeBytes: new Blob([stored]).size,
    };
  } catch (error) {
    console.error("Failed to get cache stats:", error);
    return { totalEntries: 0, validEntries: 0, expiredEntries: 0, sizeBytes: 0 };
  }
}
