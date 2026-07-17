/**
 * Retry CAP delivery for a paid order that failed fulfillCapOrder (e.g. schema format bug).
 *
 * Usage (on VPS, from agent/ with .env loaded):
 *   set -a && . ./.env && set +a
 *   node scripts/retry-cap-delivery.mjs <orderId>
 */

import { AgentClient } from "@croo-network/sdk";
import { AGENT_CONFIG } from "../dist/lib/config.js";
import { fulfillCapOrder } from "../dist/src/cap/handler.js";

const orderId = process.argv[2];
if (!orderId) {
  console.error("Usage: node scripts/retry-cap-delivery.mjs <orderId>");
  process.exit(1);
}

const sdkKey = process.env.CROO_SDK_KEY;
if (!sdkKey) {
  console.error("CROO_SDK_KEY not set");
  process.exit(1);
}

const client = new AgentClient(
  { baseURL: AGENT_CONFIG.cap.apiUrl, wsURL: AGENT_CONFIG.cap.wsUrl },
  sdkKey,
);

const order = await client.getOrder(orderId);
console.log("Order status:", order.status, "service:", order.serviceId);

await fulfillCapOrder(client, {
  orderId,
  serviceId: order.serviceId,
  requirements: order.requirements,
});

console.log("✓ Delivery submitted for", orderId);
