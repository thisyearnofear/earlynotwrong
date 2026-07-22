/**
 * Per-tool pricing config for the MCP server.
 *
 * Free tier: get_latest_conviction, get_by_thesis, get_agent_reputation, get_jury_deliberation.
 *   The trust-decision surface. get_agent_reputation is deliberately free:
 *   it's the one-shot query a first-time evaluator runs to decide whether to
 *   trust this agent at all — paywalling it gates adoption of everything else.
 *   get_jury_deliberation is free because it's metadata about the scoring
 *   process (AI reasoning), not the tradeable signals themselves.
 *
 * Paid tier (x402): get_subject_history, cross_chain_lookup, get_live_signals.
 *   Recurring-value data. History walks and cross-chain reconciliation are
 *   audit-grade lookups; get_live_signals is the premium product — the agent's
 *   CURRENT-cycle conviction signals, i.e. the tradeable data.
 *
 * Amounts are in the CEP-18 token's base units (decimals from PaymentRequirements.extra).
 * Default 0.1 CSPR per paid call assuming 2-decimal token (≈ 10 base units).
 */

export type ToolName =
  | "get_latest_conviction"
  | "get_by_thesis"
  | "get_subject_history"
  | "cross_chain_lookup"
  | "get_agent_reputation"
  | "get_jury_deliberation"
  | "get_live_signals";

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
    paid: false,
    amountBaseUnits: "0",
    description:
      "Free — aggregate reputation report (counts, mean score, dual-chain status); the trust-decision query",
  },
  get_jury_deliberation: {
    paid: false,
    amountBaseUnits: "0",
    description:
      "Free — LLM jury deliberation (provider, verdicts, reasoning, Casper ecosystem context)",
  },
  get_live_signals: {
    paid: true,
    amountBaseUnits: "50",
    description: "0.5 CSPR — live conviction signals for the current cycle (the tradeable data)",
  },
};
