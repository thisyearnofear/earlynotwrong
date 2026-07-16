/**
 * croo-cap-smoke.mjs — end-to-end CAP requester test for signals-live.
 *
 * Negotiate → pay → wait for delivery → assert signals-live/v1 envelope.
 *
 * Prerequisites:
 * - `signals-live` registered on https://agent.croo.network for this provider
 * - Requester SDK key (not the provider key connected on the VPS WebSocket)
 * - USDC in the requester's CROO agent wallet on Base ($0.05 + fees)
 *
 * Run from agent/:
 *   set -a && . ./.env && set +a && node scripts/croo-cap-smoke.mjs
 *
 * Provider-only fallback (no Store order):
 *   node scripts/croo-cap-fulfillment-smoke.mjs
 */

import { AgentClient, EventType } from "@croo-network/sdk";

const TIMEOUT_MS = 120_000;
const SERVICE_ID = "signals-live";

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function assertV1(payload) {
  if (payload?.schema !== "signals-live/v1.1") {
    fail(`expected schema signals-live/v1.1, got ${payload?.schema ?? "undefined"}`);
  }
  if (!payload.guidance?.recommendedAction) {
    fail("missing guidance.recommendedAction");
  }
  if (!payload.provenance?.reputation) {
    fail("missing provenance.reputation");
  }
  if (!payload.agent?.subjectHash?.match(/^0x[0-9a-fA-F]{64}$/)) {
    fail("missing or invalid agent.subjectHash");
  }
  if (payload.meta?.settlementRail !== "croo-cap") {
    fail(`expected meta.settlementRail croo-cap, got ${payload.meta?.settlementRail}`);
  }
  if (payload.meta?.tool !== "signals-live") {
    fail(`expected meta.tool signals-live, got ${payload.meta?.tool}`);
  }
  if (!Array.isArray(payload.signals)) {
    fail("signals must be an array");
  }
  if (typeof payload.freshness?.stale !== "boolean") {
    fail("freshness.stale must be boolean");
  }
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function pollOrder(client, orderId) {
  for (let i = 0; i < 60; i++) {
    const order = await client.getOrder(orderId);
    if (order.status === "completed") return order;
    if (order.status === "rejected" || order.status === "expired" || order.status === "pay_failed") {
      fail(`order ${orderId} ended with status=${order.status}`);
    }
    await sleep(2000);
  }
  fail(`order ${orderId} did not complete within poll window`);
}

async function main() {
  const sdkKey = process.env.CROO_SDK_KEY;
  if (!sdkKey) fail("CROO_SDK_KEY not set");

  const quiet = { info() {}, warn() {}, error: console.error, debug() {} };
  const client = new AgentClient(
    {
      baseURL: process.env.CROO_API_URL ?? "https://api.croo.network",
      wsURL: process.env.CROO_WS_URL ?? "wss://api.croo.network/ws",
      logger: quiet,
    },
    sdkKey,
  );

  // HTTP-only requester flow — avoids duplicate WebSocket when the provider
  // process is already connected with the same SDK key on the VPS.
  console.log(`→ Negotiating serviceId=${SERVICE_ID} ...`);
  let negotiation;
  try {
    negotiation = await client.negotiateOrder({
      serviceId: SERVICE_ID,
      requirements: JSON.stringify({}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("SERVICE_NOT_FOUND")) {
      fail(
        "SERVICE_NOT_FOUND — register `signals-live` on https://agent.croo.network first. "
        + "Run `node scripts/croo-cap-fulfillment-smoke.mjs` to validate provider delivery locally.",
      );
    }
    throw err;
  }
  console.log(`✓ Negotiation ${negotiation.negotiationId} provider=${negotiation.providerAgentId}`);

  console.log("→ Waiting for provider accept + order creation ...");
  let orderId = null;
  for (let i = 0; i < 45; i++) {
    const negs = await client.listNegotiations({ role: "requester", pageSize: 20 });
    const match = negs.find((n) => n.negotiationId === negotiation.negotiationId);
    if (match?.status === "accepted") {
      const orders = await client.listOrders({ role: "requester", pageSize: 20 });
      const order = orders.find((o) => o.negotiationId === negotiation.negotiationId);
      if (order) {
        orderId = order.orderId;
        break;
      }
    }
    await sleep(2000);
  }
  if (!orderId) fail("provider did not accept negotiation / create order in time");

  console.log(`→ Paying order ${orderId} ...`);
  const pay = await client.payOrder(orderId);
  console.log(`✓ Paid tx=${pay.txHash}`);

  console.log("→ Waiting for delivery ...");
  await pollOrder(client, orderId);
  const delivery = await client.getDelivery(orderId);
  const payload = JSON.parse(delivery.deliverableText);
  assertV1(payload);

  console.log("\n✓ CAP signals-live end-to-end validated (signals-live/v1)");
  console.log(`  cycle: ${payload.freshness?.cycle}`);
  console.log(`  regime: ${payload.regime?.label ?? "null"}`);
  console.log(`  signals: ${payload.signals.length}`);
  console.log(`  stale: ${payload.freshness?.stale}`);
}

main().catch((err) => {
  console.error("✗", err instanceof Error ? err.message : err);
  process.exit(1);
});
