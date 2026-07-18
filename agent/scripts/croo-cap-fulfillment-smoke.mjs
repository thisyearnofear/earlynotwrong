/**
 * croo-cap-fulfillment-smoke.mjs — provider-side CAP delivery test (no CROO order).
 *
 * Exercises fulfillCapOrder with a mock AgentClient to verify signals-live/v1
 * delivery JSON without needing a live Store negotiation (useful when services
 * are not yet registered on agent.croo.network).
 *
 * Run from agent/:
 *   set -a && . ./.env && set +a && node scripts/croo-cap-fulfillment-smoke.mjs
 */

import { fulfillCapOrder } from "../dist/src/cap/handler.js";

const mockClient = {
  async deliverOrder(orderId, req) {
    const payload = JSON.parse(req.deliverableText);
    if (payload.schema !== "signals-live/v1.2") {
      throw new Error(`expected signals-live/v1.2, got ${payload.schema}`);
    }
    if (payload.meta?.settlementRail !== "croo-cap") {
      throw new Error(`expected croo-cap rail, got ${payload.meta?.settlementRail}`);
    }
    console.log("\n✓ fulfillCapOrder deliverable validated");
    console.log(`  orderId: ${orderId}`);
    console.log(`  cycle: ${payload.freshness?.cycle}`);
    console.log(`  regime: ${payload.regime?.label ?? "null"}`);
    console.log(`  signals: ${payload.signals?.length ?? 0}`);
    console.log(`  subjectHash: ${payload.agent?.subjectHash?.slice(0, 18)}...`);
    return { delivery: { deliveryId: "smoke" } };
  },
};

await fulfillCapOrder(mockClient, {
  orderId: "smoke-order",
  serviceId: "signals-live",
  requirements: JSON.stringify({}),
});
