/**
 * x402 paywall middleware for MCP tool calls.
 *
 * Pattern:
 *   1. Hono receives POST /mcp.
 *   2. Middleware reads the JSON-RPC body, finds the tool name.
 *   3. Free tools: pass through.
 *   4. Paid tools: require X-PAYMENT header. If missing or invalid, return
 *      HTTP 402 with a PaymentRequirements body the client can sign.
 *   5. If present, POST to cspr.cloud facilitator /settle (which verifies
 *      AND submits the on-chain CEP-18 transfer in one call). On success,
 *      continue with the MCP request and attach X-PAYMENT-RESPONSE.
 *
 * Pure function shape: the facilitator URL + token + payment requirements
 * come from config; the middleware itself is a Hono handler. Testable by
 * stubbing fetch.
 */

import type { Context, MiddlewareHandler } from "hono";
import { PRICING, type ToolName } from "./pricing.js";

const FACILITATOR_BASE = "https://x402-facilitator.cspr.cloud";
const X402_VERSION = 2;
const NETWORK = "casper:casper-test";
const SCHEME = "exact";

interface PaymentRequirements {
  scheme: string;
  network: string;
  payTo: string;
  amount: string;
  asset: string;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string; decimals: string; symbol: string };
}

interface SettleResponse {
  success: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
  invalidReason?: string;
  invalidMessage?: string;
}

interface PaymentPayload {
  x402Version: number;
  resource: { url: string };
  accepted: PaymentRequirements;
  payload: unknown;
}

/** Build PaymentRequirements for a specific tool from config. */
function paymentRequirementsFor(tool: ToolName): PaymentRequirements | null {
  const price = PRICING[tool];
  if (!price.paid) return null;
  return {
    scheme: SCHEME,
    network: NETWORK,
    payTo: process.env.CASPER_PAYTO_ACCOUNT_HASH ?? "",
    amount: price.amountBaseUnits,
    asset: process.env.CASPER_X402_ASSET_HASH ?? "",
    maxTimeoutSeconds: 300,
    extra: {
      name: process.env.CASPER_X402_TOKEN_NAME ?? "Cep18x402",
      version: "1",
      decimals: process.env.CASPER_X402_TOKEN_DECIMALS ?? "2",
      symbol: process.env.CASPER_X402_TOKEN_SYMBOL ?? "CSPR",
    },
  };
}

/** 402 Payment Required response with the spec-shaped accepts array. */
function paymentRequiredResponse(c: Context, requirements: PaymentRequirements): Response {
  return c.json(
    {
      x402Version: X402_VERSION,
      accepts: [requirements],
      error: "payment required for this MCP tool",
    },
    402,
  );
}

/** Decode the base64 X-PAYMENT header into the spec PaymentPayload shape. */
function decodePaymentHeader(header: string): PaymentPayload | null {
  try {
    const decoded = Buffer.from(header, "base64").toString("utf-8");
    return JSON.parse(decoded) as PaymentPayload;
  } catch {
    return null;
  }
}

/** Encode the X-PAYMENT-RESPONSE header (base64 JSON). */
function encodePaymentResponse(payload: { transaction?: string; network?: string; payer?: string }): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

/** Call the facilitator's /settle endpoint (verifies + submits in one). */
async function settle(
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements,
): Promise<SettleResponse> {
  const token = process.env.CSPR_CLOUD_TOKEN;
  if (!token) {
    return { success: false, invalidReason: "facilitator_unavailable", invalidMessage: "CSPR_CLOUD_TOKEN not set" };
  }
  try {
    const r = await fetch(`${FACILITATOR_BASE}/settle`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: token },
      body: JSON.stringify({ paymentPayload, paymentRequirements }),
    });
    return (await r.json()) as SettleResponse;
  } catch (err) {
    return {
      success: false,
      invalidReason: "facilitator_unreachable",
      invalidMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Extract the tool name from a JSON-RPC tools/call message. Returns null for
 * other RPC methods (initialize, tools/list, etc.) — those are always free.
 */
function extractToolName(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const rpc = body as { method?: string; params?: { name?: string } };
  if (rpc.method !== "tools/call") return null;
  return rpc.params?.name ?? null;
}

/**
 * Hono middleware. Reads and re-attaches the request body so the downstream
 * MCP handler can re-parse it.
 *
 * Counters are exposed at the module level so the dashboard can surface them.
 */
export const x402Stats = {
  queriesServed: 0,
  paidQueries: 0,
  feesCollectedBaseUnits: 0n,
  byTool: new Map<string, { calls: number; paidCalls: number; baseUnits: bigint }>(),
};

function recordCall(tool: string | null, paid: boolean, baseUnits: bigint): void {
  x402Stats.queriesServed += 1;
  if (paid) {
    x402Stats.paidQueries += 1;
    x402Stats.feesCollectedBaseUnits += baseUnits;
  }
  if (!tool) return;
  const entry = x402Stats.byTool.get(tool) ?? { calls: 0, paidCalls: 0, baseUnits: 0n };
  entry.calls += 1;
  if (paid) {
    entry.paidCalls += 1;
    entry.baseUnits += baseUnits;
  }
  x402Stats.byTool.set(tool, entry);
}

export function x402Middleware(): MiddlewareHandler {
  return async (c, next) => {
    // Clone the body so we can both inspect it and let MCP re-read it.
    const raw = await c.req.raw.clone().text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Not JSON — let the MCP handler fail with its own error response.
      return next();
    }
    const toolName = extractToolName(parsed);
    if (!toolName) {
      // Not a tools/call — free pass (initialize, tools/list, ping, etc.).
      recordCall(null, false, 0n);
      return next();
    }
    if (!(toolName in PRICING)) {
      // Unknown tool name. Let MCP handle the error.
      recordCall(toolName, false, 0n);
      return next();
    }
    const requirements = paymentRequirementsFor(toolName as ToolName);
    if (!requirements) {
      // Free tier.
      recordCall(toolName, false, 0n);
      return next();
    }

    const paymentHeader = c.req.header("x-payment") ?? c.req.header("X-PAYMENT");
    if (!paymentHeader) {
      return paymentRequiredResponse(c, requirements);
    }
    const payload = decodePaymentHeader(paymentHeader);
    if (!payload) {
      return paymentRequiredResponse(c, requirements);
    }
    const settled = await settle(payload, requirements);
    if (!settled.success) {
      return c.json(
        {
          x402Version: X402_VERSION,
          accepts: [requirements],
          error: settled.invalidReason ?? "payment_rejected",
          message: settled.invalidMessage,
        },
        402,
      );
    }
    recordCall(toolName, true, BigInt(requirements.amount));
    c.header(
      "x-payment-response",
      encodePaymentResponse({
        transaction: settled.transaction,
        network: settled.network,
        payer: settled.payer,
      }),
    );
    return next();
  };
}
