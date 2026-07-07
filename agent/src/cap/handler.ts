/**
 * CAP order fulfillment handler.
 *
 * Receives a paid CAP order (already verified and settled by CROO), parses the
 * request, calls the shared reputation tool, and returns the deliverable as
 * JSON text. Payment stats are recorded in the shared `payment-stats` module.
 */

import type { AgentClient } from "@croo-network/sdk";
import { DeliverableType } from "@croo-network/sdk";
import {
  getLatestConviction,
  getSubjectHistory,
  crossChainLookup,
  getAgentReputation,
} from "../mcp/tools.js";
import { recordCall } from "../payment-stats.js";
import { pricingForToolName, toolNameForService } from "./pricing.js";

export interface CapOrderPayload {
  orderId: string;
  serviceId: string;
  requirements: string | undefined;
}

/**
 * Parse the `requirements` field from a CAP negotiation/order. Expects a
 * JSON object containing at least `subjectHash`. Returns a safe default on
 * parse failure so the tool returns a clean "no record" response instead of
 * throwing.
 */
function parseRequirements(requirements: string | undefined): { subjectHash: `0x${string}` } {
  try {
    const parsed = JSON.parse(requirements ?? "{}");
    if (typeof parsed.subjectHash === "string") {
      return { subjectHash: parsed.subjectHash as `0x${string}` };
    }
  } catch {
    // fall through to default
  }
  return { subjectHash: "0x" + "0".repeat(64) as `0x${string}` };
}

/**
 * Fulfill one paid CAP order by routing the service to the matching
 * reputation tool and delivering JSON text.
 */
export async function fulfillCapOrder(
  client: AgentClient,
  payload: CapOrderPayload,
): Promise<void> {
  const { orderId, serviceId, requirements } = payload;

  const toolName = toolNameForService(serviceId);
  if (!toolName) {
    throw new Error(`CAP service not mapped to a reputation tool: ${serviceId}`);
  }

  const { subjectHash } = parseRequirements(requirements);

  let deliverable: string;
  switch (toolName) {
    case "get_latest_conviction":
      deliverable = JSON.stringify(await getLatestConviction({ subjectHash }));
      break;
    case "get_subject_history":
      deliverable = JSON.stringify(await getSubjectHistory({ subjectHash }));
      break;
    case "cross_chain_lookup":
      deliverable = JSON.stringify(await crossChainLookup({ subjectHash }));
      break;
    case "get_agent_reputation":
      deliverable = JSON.stringify(await getAgentReputation({ subjectHash }));
      break;
    default:
      throw new Error(`Unsupported CAP reputation tool: ${toolName}`);
  }

  await client.deliverOrder(orderId, {
    deliverableType: DeliverableType.Text,
    deliverableText: deliverable,
  });

  const pricing = pricingForToolName(toolName);
  if (pricing) {
    recordCall(toolName, "cap", true, BigInt(pricing.amountUsdcBaseUnits));
  }
}
