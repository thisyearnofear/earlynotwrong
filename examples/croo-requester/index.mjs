/**
 * Reference CROO CAP requester for Early, Not Wrong — signals-live.
 *
 * Prerequisites:
 * - CROO requester SDK key (NOT the provider key running on the VPS)
 * - USDC in the requester's CROO agent wallet on Base
 * - signals-live registered on https://agent.croo.network
 *
 * Usage:
 *   export CROO_SDK_KEY=croo_sk_...
 *   npm install && npm start
 *
 * Dry-run (validate a saved sample without paying):
 *   npm run dry-run
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentClient } from "@croo-network/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVICE_ID = "signals-live";
const EXPECTED_SCHEMA = "signals-live/v1.1";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function actOnGuidance(payload) {
  const { guidance, signals, provenance } = payload;
  console.log("\n── Buyer agent decision ──");
  console.log(`Action: ${guidance.recommendedAction}`);
  console.log(`Reason: ${guidance.reason}`);
  console.log(`Size multiplier: ${guidance.sizeMultiplier}`);

  switch (guidance.recommendedAction) {
    case "wait":
      console.log("→ No trade action this cycle.");
      break;
    case "skip_entries":
      console.log("→ Macro gate active — block new entries.");
      break;
    case "evaluate":
      console.log(`→ Review top candidate: ${guidance.topCandidate}`);
      console.log(`  Signals returned: ${signals.length}`);
      if (signals[0]) {
        console.log(`  Top score: ${signals[0].score}/100 — ${signals[0].rationale}`);
      }
      if (provenance.behavioral) {
        console.log(
          `  Agent behavioral score: ${provenance.behavioral.score} (${provenance.behavioral.archetype})`,
        );
      }
      console.log("→ Apply your own sizing/risk rules before executing.");
      break;
  }
}

function validatePayload(payload) {
  if (payload.schema !== EXPECTED_SCHEMA) {
    throw new Error(`Expected schema ${EXPECTED_SCHEMA}, got ${payload.schema}`);
  }
  if (!payload.guidance?.recommendedAction) {
    throw new Error("Missing guidance.recommendedAction");
  }
  if (!payload.provenance?.reputation) {
    throw new Error("Missing provenance.reputation");
  }
}

async function dryRun() {
  const samplePath = resolve(__dirname, "../../docs/samples/signals-live-v1.1.example.json");
  const payload = JSON.parse(readFileSync(samplePath, "utf-8"));
  validatePayload(payload);
  console.log("✓ Sample validates structurally");
  actOnGuidance(payload);
}

async function main() {
  if (process.argv.includes("--dry-run")) {
    await dryRun();
    return;
  }

  const sdkKey = process.env.CROO_SDK_KEY;
  if (!sdkKey) {
    console.error("Set CROO_SDK_KEY to a requester SDK key (not the ENW provider key).");
    process.exit(1);
  }

  const client = new AgentClient(
    {
      baseURL: process.env.CROO_API_URL ?? "https://api.croo.network",
      wsURL: process.env.CROO_WS_URL ?? "wss://api.croo.network/ws",
      logger: { info: () => {}, warn: console.warn, error: console.error, debug: () => {} },
    },
    sdkKey,
  );

  console.log(`→ Negotiating ${SERVICE_ID} ...`);
  let negotiation;
  try {
    negotiation = await client.negotiateOrder({
      serviceId: SERVICE_ID,
      requirements: JSON.stringify({}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("SERVICE_NOT_FOUND")) {
      console.error(
        "SERVICE_NOT_FOUND — register signals-live on https://agent.croo.network first.\n" +
          "See docs/croo-store-listing.md for paste-ready listing copy.",
      );
      process.exit(1);
    }
    throw err;
  }
  console.log(`✓ Negotiation ${negotiation.negotiationId}`);

  console.log("→ Waiting for provider accept + order ...");
  let orderId = null;
  for (let i = 0; i < 45; i++) {
    const orders = await client.listOrders({ role: "requester", pageSize: 20 });
    const order = orders.find((o) => o.negotiationId === negotiation.negotiationId);
    if (order) {
      orderId = order.orderId;
      break;
    }
    await sleep(2000);
  }
  if (!orderId) {
    console.error("Timed out waiting for order creation.");
    process.exit(1);
  }

  console.log(`→ Paying order ${orderId} ...`);
  const pay = await client.payOrder(orderId);
  console.log(`✓ Paid tx=${pay.txHash}`);

  console.log("→ Waiting for delivery ...");
  for (let i = 0; i < 60; i++) {
    const order = await client.getOrder(orderId);
    if (order.status === "completed") break;
    if (["rejected", "expired", "pay_failed"].includes(order.status)) {
      throw new Error(`Order ended: ${order.status}`);
    }
    await sleep(2000);
  }

  const delivery = await client.getDelivery(orderId);
  const payload = JSON.parse(delivery.deliverableText);
  validatePayload(payload);
  console.log(`\n✓ Delivery received (schema ${payload.schema})`);
  actOnGuidance(payload);
}

main().catch((err) => {
  console.error("✗", err instanceof Error ? err.message : err);
  process.exit(1);
});
