/**
 * CAP (CROO Agent Protocol) service pricing.
 *
 * Each service maps to one of the shared reputation tools in
 * `agent/src/mcp/tools.ts`. The serviceId is registered on the CROO Agent
 * Store; when a requester agent negotiates an order with that serviceId,
 * the CAP handler routes it to the matching tool.
 */

export type CapServiceName =
  | "reputation-latest"
  | "reputation-history"
  | "reputation-cross-chain"
  | "reputation-agent";

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
    amountUsdcBaseUnits: "20000",
    description: "$0.02 USDC — aggregate reputation report",
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
