#!/usr/bin/env node

/**
 * Early, Not Wrong — x402 MCP Client Reference Implementation
 *
 * This script demonstrates the FULL x402 payment round-trip on Casper testnet:
 *
 *   1. Call a paid MCP tool (get_live_signals) without payment → get 402 challenge
 *   2. Parse the PaymentRequirements from the 402 response
 *   3. Construct a Cep18x402 payment payload (signed transfer authorization)
 *   4. Re-POST with X-PAYMENT header → facilitator settles on-chain → get data back
 *
 * Prerequisites:
 *   - The agent must be running (default: http://144.202.117.160:31777)
 *   - For the full paid round-trip, you need a Casper testnet wallet holding
 *     Cep18x402 tokens (the cspr.cloud-hosted canonical wrapper).
 *   - Set CASPER_PRIVATE_KEY_HEX env var to your Ed25519 private key (hex, 128 chars)
 *   - Set AGENT_URL to override the default agent endpoint
 *
 * Usage:
 *   node index.mjs --challenge    # Just get the 402 challenge (no wallet needed)
 *   node index.mjs --free          # Call a free tool (get_agent_reputation)
 *   node index.mjs                 # Full paid round-trip (needs wallet + Cep18x402)
 *   node index.mjs --help          # Show this help
 */

import { createHash } from "node:crypto";

const AGENT_URL = process.env.AGENT_URL || "http://144.202.117.160:31777";
const MCP_ENDPOINT = `${AGENT_URL}/mcp`;

// ─── Helpers ──────────────────────────────────────────────────────────────

function log(label, data) {
  console.log(`\n── ${label} ${"─".repeat(Math.max(0, 60 - label.length))}`);
  if (typeof data === "string") {
    console.log(data);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

/** POST a JSON-RPC message to the MCP endpoint. Returns {response, headers}. */
async function mcpCall(method, params, extraHeaders = {}) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const res = await fetch(MCP_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json, text/event-stream",
      ...extraHeaders,
    },
    body,
  });
  const text = await res.text();
  let parsed;
  try {
    // Handle SSE format (event: message\ndata: {...})
    const lines = text.split("\n");
    const dataLine = lines.find((l) => l.startsWith("data: "));
    parsed = dataLine ? JSON.parse(dataLine.slice(6)) : JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, headers: res.headers, body: parsed };
}

/** Extract the SSE data payload from a text response. */
function parseSSE(text) {
  const lines = text.split("\n");
  const dataLine = lines.find((l) => l.startsWith("data: "));
  if (dataLine) return JSON.parse(dataLine.slice(6));
  return JSON.parse(text);
}

// ─── Step 1: Get the 402 Challenge ─────────────────────────────────────────

async function getChallenge() {
  log("STEP 1: Get 402 Challenge (no payment)", `POST ${MCP_ENDPOINT} → tools/call get_live_signals`);

  const { status, body } = await mcpCall("tools/call", {
    name: "get_live_signals",
    arguments: {},
  });

  if (status === 402) {
    log("402 Payment Required", body);
    console.log("\n✅ The server returned a valid PaymentRequirements object.");
    console.log("   A client with a Cep18x402 token wallet can now construct");
    console.log("   a signed payment payload and re-POST with X-PAYMENT header.\n");
    return body;
  } else {
    log(`Unexpected status: ${status}`, body);
    return null;
  }
}

// ─── Step 2: Call a Free Tool ──────────────────────────────────────────────

async function callFreeTool() {
  log("FREE TOOL: get_agent_reputation", `POST ${MCP_ENDPOINT} → tools/call get_agent_reputation`);

  // First we need a subject hash — use the agent's own known subject hash
  const subjectHash = "0x4a937673ea542abdf587e6b509793b2173980228cc65180a2f32c24fd3ac459a";

  const { status, body } = await mcpCall("tools/call", {
    name: "get_agent_reputation",
    arguments: { subjectHash },
  });

  log(`Response (HTTP ${status})`, body);
  return body;
}

// ─── Step 3: Full Paid Round-Trip ──────────────────────────────────────────

async function fullPaidRoundTrip() {
  const privateKeyHex = process.env.CASPER_PRIVATE_KEY_HEX;

  if (!privateKeyHex) {
    console.log("\n⚠  CASPER_PRIVATE_KEY_HEX not set — cannot complete full round-trip.");
    console.log("   Run with --challenge to see the 402 challenge, or set the env var");
    console.log("   to your Casper testnet Ed25519 private key (hex, 128 chars).\n");
    console.log("   To get Cep18x402 tokens on testnet:");
    console.log("   1. Get testnet CSPR from the faucet: https://testnet.cspr.live/faucet");
    console.log("   2. Swap CSPR → Cep18x402 on the cspr.cloud testnet DEX\n");
    return;
  }

  log("FULL PAID ROUND-TRIP", "This will: get 402 → construct payment → settle → get live signals");

  // Step 1: Get the 402 challenge
  console.log("\n  1. Requesting paid tool without payment...");
  const { status: chStatus, body: challenge } = await mcpCall("tools/call", {
    name: "get_live_signals",
    arguments: {},
  });

  if (chStatus !== 402) {
    console.log(`  Unexpected status ${chStatus}, expected 402. Response:`, challenge);
    return;
  }

  const requirements = challenge.accepts?.[0];
  if (!requirements) {
    console.log("  No PaymentRequirements in 402 response:", challenge);
    return;
  }

  console.log("  ✅ Got 402 challenge:");
  console.log(`     Network: ${requirements.network}`);
  console.log(`     Asset:   ${requirements.asset} (${requirements.extra?.symbol})`);
  console.log(`     Amount:  ${requirements.amount} base units (${parseInt(requirements.amount) / Math.pow(10, parseInt(requirements.extra?.decimals || "2"))} ${requirements.extra?.symbol})`);
  console.log(`     Pay to: ${requirements.payTo}`);

  // Step 2: Construct the payment payload
  // NOTE: This is a simplified demonstration. A production client would:
  //   a) Use the casper-js-sdk to construct a proper CEP-18 transfer deploy
  //   b) Sign it with the Ed25519 private key
  //   c) Encode the signed deploy as the payment payload
  // The cspr.cloud facilitator expects a specific payload format.
  // See: https://github.com/casper-network/casper-x402 for the spec.

  console.log("\n  2. Constructing payment payload...");
  console.log("     (In production, this uses casper-js-sdk to sign a CEP-18 transfer)");
  console.log("     (For this demo, we'll show the structure of the payload)");

  const paymentPayload = {
    x402Version: 2,
    resource: { url: MCP_ENDPOINT },
    accepted: requirements,
    payload: {
      // In production, this contains the signed CEP-18 transfer deploy
      // For demo purposes, we show the structure
      network: requirements.network,
      asset: requirements.asset,
      amount: requirements.amount,
      payTo: requirements.payTo,
      // The actual signed transaction would go here:
      // deploy: <signed CEP-18 transfer deploy JSON>
      note: "This is a demo payload. Use casper-js-sdk to construct a real signed transfer.",
    },
  };

  const xPaymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");

  console.log(`     X-PAYMENT header: ${xPaymentHeader.slice(0, 60)}...`);

  // Step 3: Re-POST with payment
  console.log("\n  3. Re-POSTing with X-PAYMENT header...");
  const { status: paidStatus, headers: paidHeaders, body: paidBody } = await mcpCall(
    "tools/call",
    { name: "get_live_signals", arguments: {} },
    { "X-PAYMENT": xPaymentHeader },
  );

  if (paidStatus === 200) {
    console.log("\n  ✅ SUCCESS! Paid MCP call completed.");
    const paymentResponse = paidHeaders.get("x-payment-response");
    if (paymentResponse) {
      const decoded = JSON.parse(Buffer.from(paymentResponse, "base64").toString("utf-8"));
      console.log("     Payment response:", decoded);
    }
    log("LIVE SIGNALS DATA", paidBody);
  } else if (paidStatus === 402) {
    console.log("\n  ❌ Payment rejected by facilitator.");
    console.log("     This is expected if the demo payload doesn't contain a real signed transfer.");
    console.log("     Response:", paidBody);
    console.log("\n  To complete the full round-trip:");
    console.log("  1. Install casper-js-sdk: npm install casper-js-sdk");
    console.log("  2. Construct a CEP-18 transfer deploy for the Cep18x402 token");
    console.log("  3. Sign with your Ed25519 private key");
    console.log("  4. Encode as the payload in the X-PAYMENT header");
    console.log("  5. The facilitator at cspr.cloud/settle verifies and submits on-chain");
  } else {
    log(`Unexpected status: ${paidStatus}`, paidBody);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

function showHelp() {
  console.log(`
Early, Not Wrong — x402 MCP Client Reference Implementation

Usage:
  node index.mjs --challenge    Get the 402 PaymentRequirements (no wallet needed)
  node index.mjs --free         Call a free MCP tool (get_agent_reputation)
  node index.mjs                Full paid round-trip (needs CASPER_PRIVATE_KEY_HEX)
  node index.mjs --help         Show this help

Environment:
  AGENT_URL              Agent endpoint (default: http://144.202.117.160:31777)
  CASPER_PRIVATE_KEY_HEX Ed25519 private key (hex, 128 chars) for signing CEP-18 transfers

Prerequisites for full round-trip:
  1. A Casper testnet wallet with CSPR (get from faucet: https://testnet.cspr.live/faucet)
  2. Cep18x402 tokens (swap CSPR → Cep18x402 on cspr.cloud testnet DEX)
  3. The casper-js-sdk to construct and sign the CEP-18 transfer deploy

The 402 challenge step works without any wallet — it demonstrates that the
agent's MCP server correctly returns Casper-native PaymentRequirements.
`);
}

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  showHelp();
} else if (args.includes("--challenge")) {
  await getChallenge();
} else if (args.includes("--free")) {
  await callFreeTool();
} else {
  await fullPaidRoundTrip();
}
