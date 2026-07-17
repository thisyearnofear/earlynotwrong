/**
 * CAP (CROO Agent Protocol) service pricing.
 *
 * Each service maps to one of the shared reputation tools in
 * `agent/src/mcp/tools.ts`. The serviceId is registered on the CROO Agent
 * Store; when a requester agent negotiates an order with that serviceId,
 * the CAP handler routes it to the matching tool.
 *
 * Pricing philosophy (mirrors the x402/MCP side): the trust-decision query
 * (`reputation-agent`) is the free-equivalent — $0 is supported end-to-end
 * here (the handler and payment stats both handle a 0 amount) — while the
 * recurring-value live conviction data (`signals-live`) is the premium
 * product. The four reputation-* serviceIds are PRE-REGISTERED on the CROO
 * Store and must NOT be renamed; the Store listing price for
 * `reputation-agent` must be updated there to match the $0 here.
 *
 * NOTE: `signals-live` is a NEW serviceId — it must be registered on the
 * CROO Agent Store (see docs/CROO_INTEGRATION.md) before it is purchasable.
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

/**
 * CROO Store negotiations often use the Store service UUID in `serviceId`, not
 * the human slug (`signals-live`). Map UUID → slug via env:
 *
 *   CROO_SERVICE_UUID_MAP='{"3da733af-...":"signals-live"}'
 * or
 *   CROO_SIGNALS_LIVE_SERVICE_UUID=3da733af-...
 */
export function resolveCapServiceId(rawId: string): CapServiceName | null {
  if (rawId in CAP_PRICING) {
    return rawId as CapServiceName;
  }

  const signalsUuid = process.env.CROO_SIGNALS_LIVE_SERVICE_UUID?.trim();
  if (signalsUuid && rawId === signalsUuid) {
    return "signals-live";
  }

  const mapJson = process.env.CROO_SERVICE_UUID_MAP?.trim();
  if (mapJson) {
    try {
      const map = JSON.parse(mapJson) as Record<string, string>;
      const slug = map[rawId];
      if (slug && slug in CAP_PRICING) {
        return slug as CapServiceName;
      }
    } catch {
      // ignore malformed map
    }
  }

  return null;
}

/** Map a CAP serviceId to the internal reputation tool name. */
export function toolNameForService(serviceId: string): string | null {
  const resolved = resolveCapServiceId(serviceId);
  if (!resolved) return null;
  return CAP_PRICING[resolved].toolName;
}

/** Map an internal tool name back to its CAP service entry. */
export function pricingForToolName(toolName: string): CapPricingEntry | null {
  const entry = Object.values(CAP_PRICING).find((e) => e.toolName === toolName);
  return entry ?? null;
}
