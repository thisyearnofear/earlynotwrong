/**
 * Shared types, helpers, and constants for the agent dashboard's hire-view
 * integration cards (BuyerPreviewCard, ReputationApiCard, CrooCapCard).
 *
 * Extracted from src/app/agent/page.tsx so each card can live in its own
 * file without importing the god component. Runtime code only — no JSX.
 */

import {
  crooStoreUrl,
  CROO_REQUESTER_PATH,
} from "@/lib/marketing-urls";
import { GUIDANCE_LABELS, type BuyerRecommendedAction } from "@/lib/signals-teaser-types";

// ─── Reputation stats (from /api/agent/proxy?endpoint=reputation/stats) ────

export interface ReputationStats {
  queriesServed: number;
  paidQueries: number;
  feesCollectedBaseUnits: string;
  pricing: Record<string, { paid: boolean; amountBaseUnits: string; description: string }>;
  byTool: Record<string, { calls: number; paidCalls: number; baseUnits: string }>;
  providers?: {
    x402: {
      queriesServed: number;
      paidQueries: number;
      feesCollectedBaseUnits: string;
      pricing: Record<string, { paid: boolean; amountBaseUnits: string; description: string }>;
      byTool: Record<string, { calls: number; paidCalls: number; baseUnits: string }>;
    };
    cap: {
      queriesServed: number;
      paidQueries: number;
      feesCollectedBaseUnits: string;
      pricing: Record<string, { paid: boolean; amountUsdcBaseUnits: string; description: string }>;
      byTool: Record<string, { calls: number; paidCalls: number; baseUnits: string }>;
    };
  };
}

export interface CapStatusResponse {
  connected: boolean;
  services: Record<string, string>;
}

export type CapProviderStats = NonNullable<ReputationStats["providers"]>["cap"];

// ─── Signals teaser preview (from /api/agent/proxy?endpoint=signals/teaser) ─

export interface SignalsLivePreview {
  schema: string;
  teaser: true;
  freshness: {
    cycle: number;
    stale: boolean;
    staleReason: string | null;
  };
  guidance: {
    recommendedAction: BuyerRecommendedAction;
    reason: string;
    topCandidate: string | null;
    sizeMultiplier: number;
  };
  signalCount: number;
  topSignal: { symbol: string; score: number } | null;
  provenance: {
    behavioral: {
      score: number;
      archetype: string;
    } | null;
    reputation: {
      totalAnchors: number;
      dualChain: boolean;
    };
  };
  unlock: {
    message: string;
    crooStoreUrl: string;
    priceUsdc: string;
    dashboardUrl: string;
  };
  meta: { schemaUrl: string };
}

// ─── Formatting helpers ─────────────────────────────────────────────────────

/** Format Casper CEP-18 base units as CSPR. The Cep18x402 token uses 2
 *  decimals (matches the cspr.cloud testnet asset), so 20 base units = 0.20 CSPR. */
export function formatCspr(baseUnits: string | undefined, decimals = 2): string {
  if (!baseUnits) return "—";
  const n = BigInt(baseUnits);
  if (n === BigInt(0)) return "0 CSPR";
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = n / divisor;
  const fraction = n % divisor;
  const fracStr = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr} CSPR` : `${whole} CSPR`;
}

/** Format USDC base units (6 decimals on Base). */
export function formatUsdc(baseUnits: string | undefined, decimals = 6): string {
  if (!baseUnits) return "—";
  const n = BigInt(baseUnits);
  if (n === BigInt(0)) return "$0";
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = n / divisor;
  const fraction = n % divisor;
  const fracStr = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `$${whole}.${fracStr} USDC` : `$${whole} USDC`;
}

// ─── Shared constants ──────────────────────────────────────────────────────

export const GUIDANCE_LABELS_LOCAL: Record<BuyerRecommendedAction, string> = GUIDANCE_LABELS;

export const CROO_STORE_URL = crooStoreUrl("dashboard", "cap-card");
export const CROO_REQUESTER_REPO = CROO_REQUESTER_PATH;

export const MCP_ENDPOINT = "http://144.202.117.160:31777/mcp";

export const MCP_CONFIG_SNIPPET = `{
  "mcpServers": {
    "early-not-wrong": {
      "url": "https://earlynotwrong.vercel.app/api/agent/proxy?endpoint=mcp"
    }
  }
}`;

export const MCP_CURL_FREE = `curl -sS -X POST ${MCP_ENDPOINT} \\
  -H 'content-type: application/json' \\
  -H 'accept: application/json, text/event-stream' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_agent_reputation","arguments":{"subjectHash":"0x4a937673ea542abdf587e6b509793b2173980228cc65180a2f32c24fd3ac459a"}}}'`;

export const MCP_CURL_PAID = `curl -sS -i -X POST ${MCP_ENDPOINT} \\
  -H 'content-type: application/json' \\
  -H 'accept: application/json, text/event-stream' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_live_signals","arguments":{}}}'`;

export const CROO_CAP_REQUESTER_SNIPPET = `# Reference requester — examples/croo-requester/
export CROO_SDK_KEY=croo_sk_your_requester_key   # not the provider key

cd examples/croo-requester
npm install
npm run dry-run    # validate sample + print guidance
npm start          # live negotiate → pay → deliver`;
