/**
 * History Service
 * Persists conviction analyses to local storage AND Postgres for historical tracking.
 */

import { ConvictionMetrics } from "./market";

export interface HistoricalAnalysis {
  id: string;
  address: string;
  addressShort: string;
  chain: "solana" | "base";
  metrics: ConvictionMetrics;
  timestamp: number;
  timeHorizon: number;
  isShowcase: boolean;
}

const STORAGE_KEY = "enw_conviction_history";
const MAX_HISTORY_ITEMS = 50;

export function getConvictionHistory(): HistoricalAnalysis[] {
  if (typeof window === "undefined") return [];

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

/**
 * Save analysis to Postgres (fire and forget, non-blocking)
 */
async function saveToPostgres(
  address: string,
  chain: "solana" | "base",
  metrics: ConvictionMetrics,
  timeHorizon: number
): Promise<void> {
  try {
    await fetch("/api/analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, chain, metrics, timeHorizon }),
    });
  } catch {
    // Silently fail - Postgres is optional enhancement
  }
}

export function saveConvictionAnalysis(
  address: string,
  chain: "solana" | "base",
  metrics: ConvictionMetrics,
  timeHorizon: number,
  isShowcase: boolean = false
): HistoricalAnalysis {
  const history = getConvictionHistory();

  const analysis: HistoricalAnalysis = {
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    address,
    addressShort: `${address.slice(0, 6)}...${address.slice(-4)}`,
    chain,
    metrics,
    timestamp: Date.now(),
    timeHorizon,
    isShowcase,
  };

  const updatedHistory = [analysis, ...history].slice(0, MAX_HISTORY_ITEMS);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedHistory));
  } catch (error) {
    console.warn("Failed to save conviction history:", error);
  }

  // Also save to Postgres for real cohort data (non-blocking)
  if (!isShowcase) {
    saveToPostgres(address, chain, metrics, timeHorizon);
  }

  return analysis;
}

export function getAnalysisById(id: string): HistoricalAnalysis | null {
  const history = getConvictionHistory();
  return history.find((h) => h.id === id) || null;
}

export function getAnalysesByAddress(address: string): HistoricalAnalysis[] {
  const history = getConvictionHistory();
  return history.filter(
    (h) => h.address.toLowerCase() === address.toLowerCase()
  );
}

export function clearConvictionHistory(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function getScoreEvolution(address: string): Array<{
  timestamp: number;
  score: number;
  archetype: string;
}> {
  const analyses = getAnalysesByAddress(address);
  return analyses
    .map((a) => ({
      timestamp: a.timestamp,
      score: a.metrics.score,
      archetype: a.metrics.archetype || "Unknown",
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function getLatestAnalysis(
  address: string
): HistoricalAnalysis | null {
  const analyses = getAnalysesByAddress(address);
  if (analyses.length === 0) return null;
  return analyses.sort((a, b) => b.timestamp - a.timestamp)[0];
}

export function getScoreChange(address: string): {
  current: number;
  previous: number | null;
  change: number | null;
  trend: "up" | "down" | "stable" | null;
} | null {
  const analyses = getAnalysesByAddress(address);
  if (analyses.length === 0) return null;

  const sorted = analyses.sort((a, b) => b.timestamp - a.timestamp);
  const current = sorted[0].metrics.score;

  if (sorted.length < 2) {
    return { current, previous: null, change: null, trend: null };
  }

  const previous = sorted[1].metrics.score;
  const change = current - previous;
  const trend = change > 1 ? "up" : change < -1 ? "down" : "stable";

  return { current, previous, change, trend };
}
