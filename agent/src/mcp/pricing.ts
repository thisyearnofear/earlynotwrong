/**
 * Per-tool pricing config for the MCP server.
 *
 * Free tier: get_latest_conviction, get_by_thesis.
 *   Cheap, low-value-per-call — designed for "is this agent live?" sanity
 *   checks before paid lookups.
 *
 * Paid tier (x402): get_subject_history, cross_chain_lookup, get_agent_reputation.
 *   These walk the full event log + return aggregated views — the actual
 *   reputation marketplace surface.
 *
 * Amounts are in the CEP-18 token's base units (decimals from PaymentRequirements.extra).
 * Default 0.1 CSPR per paid call assuming 2-decimal token (≈ 10 base units).
 */

export type ToolName =
  | "get_latest_conviction"
  | "get_by_thesis"
  | "get_subject_history"
  | "cross_chain_lookup"
  | "get_agent_reputation";

interface PricingEntry {
  paid: boolean;
  amountBaseUnits: string;
  /** Human-readable description used in dashboard surfaces. */
  description: string;
}

export const PRICING: Record<ToolName, PricingEntry> = {
  get_latest_conviction: {
    paid: false,
    amountBaseUnits: "0",
    description: "Free — most recent record across both chains",
  },
  get_by_thesis: {
    paid: false,
    amountBaseUnits: "0",
    description: "Free — point lookup by thesis hash",
  },
  get_subject_history: {
    paid: true,
    amountBaseUnits: "10",
    description: "0.1 CSPR — full chronological history cross-chain",
  },
  cross_chain_lookup: {
    paid: true,
    amountBaseUnits: "10",
    description: "0.1 CSPR — Mantle + Casper side-by-side, in-sync flag",
  },
  get_agent_reputation: {
    paid: true,
    amountBaseUnits: "20",
    description: "0.2 CSPR — aggregate reputation report (counts, mean score, dual-chain status)",
  },
};
