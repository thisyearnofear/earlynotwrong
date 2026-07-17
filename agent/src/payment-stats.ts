/**
 * Shared payment stats for all A2A transports.
 *
 * Persisted to AGENT_DATA_DIR/payment-stats.json so CAP/x402 counters survive
 * pm2 restarts (same data directory as state.json on the VPS).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "../lib/persistence.js";

export type PaymentProvider = "x402" | "cap";

export interface ToolStatEntry {
  calls: number;
  paidCalls: number;
  /** Fees collected in the provider's base units (x402 = token decimals, CAP = USDC 6 decimals). */
  baseUnits: bigint;
}

export interface ProviderStats {
  queriesServed: number;
  paidQueries: number;
  feesCollectedBaseUnits: bigint;
  byTool: Map<string, ToolStatEntry>;
}

export interface PaymentStats {
  queriesServed: number;
  paidQueries: number;
  feesCollectedBaseUnits: Record<PaymentProvider, bigint>;
  byTool: Map<string, ToolStatEntry>;
  byProvider: Record<PaymentProvider, ProviderStats>;
}

const PAYMENT_STATS_FILE = "payment-stats.json";

function emptyProviderStats(): ProviderStats {
  return {
    queriesServed: 0,
    paidQueries: 0,
    feesCollectedBaseUnits: 0n,
    byTool: new Map(),
  };
}

function createEmptyStats(): PaymentStats {
  return {
    queriesServed: 0,
    paidQueries: 0,
    feesCollectedBaseUnits: { x402: 0n, cap: 0n },
    byTool: new Map(),
    byProvider: {
      x402: emptyProviderStats(),
      cap: emptyProviderStats(),
    },
  };
}

export const paymentStats: PaymentStats = createEmptyStats();

// ─── Disk persistence ───

interface SerializedToolEntry {
  calls: number;
  paidCalls: number;
  baseUnits: string;
}

interface SerializedPaymentStats {
  queriesServed: number;
  paidQueries: number;
  feesCollectedBaseUnits: Record<PaymentProvider, string>;
  byTool: Record<string, SerializedToolEntry>;
  byProvider: Record<
    PaymentProvider,
    {
      queriesServed: number;
      paidQueries: number;
      feesCollectedBaseUnits: string;
      byTool: Record<string, SerializedToolEntry>;
    }
  >;
  lastUpdatedAt?: number;
}

function getPaymentStatsPath(): string {
  return join(getDataDir(), PAYMENT_STATS_FILE);
}

function deserializeToolMap(raw: Record<string, SerializedToolEntry> | undefined): Map<string, ToolStatEntry> {
  const map = new Map<string, ToolStatEntry>();
  if (!raw) return map;
  for (const [name, entry] of Object.entries(raw)) {
    map.set(name, {
      calls: entry.calls,
      paidCalls: entry.paidCalls,
      baseUnits: BigInt(entry.baseUnits),
    });
  }
  return map;
}

function serializeToolMap(map: Map<string, ToolStatEntry>): Record<string, SerializedToolEntry> {
  return Object.fromEntries(
    Array.from(map.entries()).map(([name, entry]) => [
      name,
      {
        calls: entry.calls,
        paidCalls: entry.paidCalls,
        baseUnits: entry.baseUnits.toString(),
      },
    ]),
  );
}

function serializeStats(): SerializedPaymentStats {
  return {
    queriesServed: paymentStats.queriesServed,
    paidQueries: paymentStats.paidQueries,
    feesCollectedBaseUnits: {
      x402: paymentStats.feesCollectedBaseUnits.x402.toString(),
      cap: paymentStats.feesCollectedBaseUnits.cap.toString(),
    },
    byTool: serializeToolMap(paymentStats.byTool),
    byProvider: {
      x402: {
        queriesServed: paymentStats.byProvider.x402.queriesServed,
        paidQueries: paymentStats.byProvider.x402.paidQueries,
        feesCollectedBaseUnits: paymentStats.byProvider.x402.feesCollectedBaseUnits.toString(),
        byTool: serializeToolMap(paymentStats.byProvider.x402.byTool),
      },
      cap: {
        queriesServed: paymentStats.byProvider.cap.queriesServed,
        paidQueries: paymentStats.byProvider.cap.paidQueries,
        feesCollectedBaseUnits: paymentStats.byProvider.cap.feesCollectedBaseUnits.toString(),
        byTool: serializeToolMap(paymentStats.byProvider.cap.byTool),
      },
    },
    lastUpdatedAt: Date.now(),
  };
}

function applySerialized(raw: SerializedPaymentStats): void {
  paymentStats.queriesServed = raw.queriesServed ?? 0;
  paymentStats.paidQueries = raw.paidQueries ?? 0;
  paymentStats.feesCollectedBaseUnits = {
    x402: BigInt(raw.feesCollectedBaseUnits?.x402 ?? "0"),
    cap: BigInt(raw.feesCollectedBaseUnits?.cap ?? "0"),
  };
  paymentStats.byTool = deserializeToolMap(raw.byTool);
  paymentStats.byProvider.x402 = {
    queriesServed: raw.byProvider?.x402?.queriesServed ?? 0,
    paidQueries: raw.byProvider?.x402?.paidQueries ?? 0,
    feesCollectedBaseUnits: BigInt(raw.byProvider?.x402?.feesCollectedBaseUnits ?? "0"),
    byTool: deserializeToolMap(raw.byProvider?.x402?.byTool),
  };
  paymentStats.byProvider.cap = {
    queriesServed: raw.byProvider?.cap?.queriesServed ?? 0,
    paidQueries: raw.byProvider?.cap?.paidQueries ?? 0,
    feesCollectedBaseUnits: BigInt(raw.byProvider?.cap?.feesCollectedBaseUnits ?? "0"),
    byTool: deserializeToolMap(raw.byProvider?.cap?.byTool),
  };
}

/** Load counters from disk on startup. No-op if file missing. */
export function loadPaymentStats(): void {
  try {
    const path = getPaymentStatsPath();
    if (!existsSync(path)) return;
    const raw = JSON.parse(readFileSync(path, "utf-8")) as SerializedPaymentStats;
    applySerialized(raw);
    console.log(
      `[payment-stats] Restored from disk — cap paid=${paymentStats.byProvider.cap.paidQueries}, x402 paid=${paymentStats.byProvider.x402.paidQueries}`,
    );
  } catch (err) {
    console.warn(
      "[payment-stats] Failed to load payment-stats.json:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function persistPaymentStatsNow(): void {
  try {
    writeFileSync(getPaymentStatsPath(), JSON.stringify(serializeStats(), null, 2), "utf-8");
  } catch (err) {
    console.warn(
      "[payment-stats] Failed to write payment-stats.json:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Debounced disk write (500ms coalesce). */
export function schedulePersistPaymentStats(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistPaymentStatsNow();
  }, 500);
}

/** For tests — write immediately and expose path. */
export function persistPaymentStatsSync(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  persistPaymentStatsNow();
}

export { getPaymentStatsPath, serializeStats, applySerialized, createEmptyStats };

/**
 * Record one A2A query, attributed to a provider and optionally paid.
 */
export function recordCall(
  tool: string | null,
  provider: PaymentProvider,
  paid: boolean,
  baseUnits: bigint,
): void {
  paymentStats.queriesServed += 1;
  paymentStats.byProvider[provider].queriesServed += 1;

  if (paid) {
    paymentStats.paidQueries += 1;
    paymentStats.feesCollectedBaseUnits[provider] += baseUnits;
    paymentStats.byProvider[provider].paidQueries += 1;
    paymentStats.byProvider[provider].feesCollectedBaseUnits += baseUnits;
  }

  if (!tool) {
    schedulePersistPaymentStats();
    return;
  }

  const record = (map: Map<string, ToolStatEntry>): void => {
    const entry = map.get(tool) ?? { calls: 0, paidCalls: 0, baseUnits: 0n };
    entry.calls += 1;
    if (paid) {
      entry.paidCalls += 1;
      entry.baseUnits += baseUnits;
    }
    map.set(tool, entry);
  };

  record(paymentStats.byTool);
  record(paymentStats.byProvider[provider].byTool);
  schedulePersistPaymentStats();
}

/** Serialize a per-tool map into a plain JSON object. */
export function serializeByTool(
  map: Map<string, ToolStatEntry>,
): Record<string, { calls: number; paidCalls: number; baseUnits: string }> {
  return Object.fromEntries(
    Array.from(map.entries()).map(([name, entry]) => [
      name,
      {
        calls: entry.calls,
        paidCalls: entry.paidCalls,
        baseUnits: entry.baseUnits.toString(),
      },
    ]),
  );
}
