/**
 * Shared payment stats for all A2A transports.
 *
 * The MCP + x402 paywall and the CROO CAP adapter both record calls here.
 * This keeps the dashboard's /reputation/stats endpoint as a single source
 * of truth while still letting each transport maintain its own pricing
 * and settlement asset.
 */

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

export const paymentStats: PaymentStats = {
  queriesServed: 0,
  paidQueries: 0,
  feesCollectedBaseUnits: { x402: 0n, cap: 0n },
  byTool: new Map<string, ToolStatEntry>(),
  byProvider: {
    x402: {
      queriesServed: 0,
      paidQueries: 0,
      feesCollectedBaseUnits: 0n,
      byTool: new Map<string, ToolStatEntry>(),
    },
    cap: {
      queriesServed: 0,
      paidQueries: 0,
      feesCollectedBaseUnits: 0n,
      byTool: new Map<string, ToolStatEntry>(),
    },
  },
};

/**
 * Record one A2A query, attributed to a provider and optionally paid.
 *
 * @param tool — tool name, or null for protocol-level calls (initialize, tools/list)
 * @param provider — "x402" | "cap"
 * @param paid — whether the call carried a valid payment
 * @param baseUnits — amount collected in provider base units (0n for free calls)
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

  if (!tool) return;

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
}

/** Serialize a per-tool map into a plain JSON object. */
export function serializeByTool(map: Map<string, ToolStatEntry>): Record<string, { calls: number; paidCalls: number; baseUnits: string }> {
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
