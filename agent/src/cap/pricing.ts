/**
 * CAP (CROO Agent Protocol) service pricing.
 *
 * Each service maps to one of the shared reputation tools in
 * `agent/src/mcp/tools.ts`. When a requester agent negotiates an order with
 * one of these serviceIds, the CAP handler routes it to the matching tool.
 *
 * Only `signals-live` (paid live-signal feed) is registered on the CROO
 * Agent Store. `reputation-agent` is meant to be a free trust-decision
 * query, but CROO's Store requires a positive price, so it stays free via
 * MCP instead of being listed there. The other three need a `subjectHash` a
 * cold Store buyer has no way to discover (see docs/CROO_INTEGRATION.md).
 * All five stay in CAP_SERVICE_IDS so a requester who already knows what to
 * ask for can still negotiate any of them directly.
 */

export type CapServiceName =
  | "reputation-latest"
  | "reputation-history"
  | "reputation-cross-chain"
  | "reputation-agent"
  | "signals-live";

export interface CapPricingEntry {
  serviceId: CapServiceName;
  /** Internal reputation tool name (see `agent/src/mcp/tools.ts`). */
  toolName: string;
  /** USDC amount in base units (6 decimals). "5000" = $0.005 USDC. */
  amountUsdcBaseUnits: string;
  description: string;
}

export const CAP_PRICING: Record<CapServiceName, CapPricingEntry> = {
  "reputation-latest": {
    serviceId: "reputation-latest",
    toolName: "get_latest_conviction",
    amountUsdcBaseUnits: "5000",
    description: "$0.005 USDC — most recent conviction record across Mantle + Casper",
  },
  "reputation-history": {
    serviceId: "reputation-history",
    toolName: "get_subject_history",
    amountUsdcBaseUnits: "10000",
    description: "$0.01 USDC — full chronological history cross-chain",
  },
  "reputation-cross-chain": {
    serviceId: "reputation-cross-chain",
    toolName: "cross_chain_lookup",
    amountUsdcBaseUnits: "10000",
    description: "$0.01 USDC — Mantle + Casper side-by-side with sync flag",
  },
  "reputation-agent": {
    serviceId: "reputation-agent",
    toolName: "get_agent_reputation",
    // Free-equivalent: the trust-decision query. serviceId is pre-registered
    // on the CROO Store — do not rename; update the Store listing price to $0.
    amountUsdcBaseUnits: "0",
    description: "Free ($0 USDC) — aggregate reputation report, the trust-decision query",
  },
  "signals-live": {
    serviceId: "signals-live",
    toolName: "get_live_signals",
    // NEW serviceId — requires registration on the CROO Agent Store before
    // it is purchasable (see docs/CROO_INTEGRATION.md).
    amountUsdcBaseUnits: "50000",
    description: "$0.05 USDC — live conviction signals for the current cycle (the tradeable data)",
  },
};

/** All CAP serviceIds that this agent advertises. */
export const CAP_SERVICE_IDS: readonly string[] = Object.values(CAP_PRICING).map(
  (entry) => entry.serviceId,
);

/** Map a CAP serviceId to the internal reputation tool name. */
export function toolNameForService(serviceId: string): string | null {
  const entry = Object.values(CAP_PRICING).find((e) => e.serviceId === serviceId);
  return entry?.toolName ?? null;
}

/** Map an internal tool name back to its CAP service entry. */
export function pricingForToolName(toolName: string): CapPricingEntry | null {
  const entry = Object.values(CAP_PRICING).find((e) => e.toolName === toolName);
  return entry ?? null;
}
