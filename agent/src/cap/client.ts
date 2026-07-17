/**
 * CAP (CROO Agent Protocol) runtime client.
 *
 * Connects the agent to CROO's coordination layer via WebSocket, listens for
 * incoming service orders, accepts matching negotiations, and dispatches
 * paid orders to the shared reputation fulfillment handler.
 *
 * The client is optional at runtime: if CROO credentials are not configured,
 * the agent logs a single message and continues without CAP. This keeps the
 * agent runnable in simulator / local-dev mode without a Store listing.
 */

import { AgentClient, Config, EventType, type Logger } from "@croo-network/sdk";
import { AGENT_CONFIG } from "../../lib/config.js";
import { fulfillCapOrder } from "./handler.js";
import { CAP_SERVICE_IDS, resolveCapServiceId } from "./pricing.js";

let client: AgentClient | null = null;
let stream: Awaited<ReturnType<AgentClient["connectWebSocket"]>> | null = null;

/** Cache requirements from accepted negotiations so OrderPaid can look them up. */
const negotiationRequirements = new Map<string, string>();

export interface CapClientStatus {
  connected: boolean;
  services: readonly string[];
}

export function getCapStatus(): CapClientStatus {
  return {
    connected: stream !== null,
    services: CAP_SERVICE_IDS,
  };
}

/**
 * Start the CAP client if CROO credentials are present.
 *
 * Errors are caught and logged so CAP issues never crash the trading agent.
 */
export async function startCapClient(): Promise<void> {
  const sdkKey = process.env.CROO_SDK_KEY;

  if (!sdkKey) {
    console.log("[cap] CROO_SDK_KEY not set — CAP client disabled");
    return;
  }

  // The SDK's default logger (plain console) logs the connect URL verbatim,
  // which embeds the SDK key as a `?key=` query param — redact it here since
  // we don't control that log call inside @croo-network/sdk.
  const redact = (value: unknown): unknown => {
    if (typeof value === "string") return value.replaceAll(sdkKey, "***");
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v)]));
    }
    return value;
  };
  const logger: Logger = {
    info: (message, ...args) => console.log(message, ...args.map(redact)),
    warn: (message, ...args) => console.warn(message, ...args.map(redact)),
    error: (message, ...args) => console.error(message, ...args.map(redact)),
    debug: (message, ...args) => console.debug(message, ...args.map(redact)),
  };

  const config: Config = {
    baseURL: AGENT_CONFIG.cap.apiUrl,
    wsURL: AGENT_CONFIG.cap.wsUrl,
    logger,
  };
  client = new AgentClient(config, sdkKey);

  try {
    stream = await client.connectWebSocket();
  } catch (err) {
    console.error("[cap] Failed to connect WebSocket:", err instanceof Error ? err.message : String(err));
    client = null;
    return;
  }

  stream.on(EventType.NegotiationCreated, async (event) => {
    try {
      const negotiationId = event.negotiation_id as string;
      console.log(`[cap] Negotiation created: ${negotiationId}`);

      let negotiation;
      try {
        negotiation = await client!.getNegotiation(negotiationId);
      } catch (err) {
        console.error(
          `[cap] Failed to load negotiation ${negotiationId}:`,
          err instanceof Error ? err.message : String(err),
        );
        await client!.rejectNegotiation(negotiationId, "negotiation lookup failed");
        return;
      }

      const resolvedServiceId = resolveCapServiceId(negotiation.serviceId);
      console.log(
        `[cap] Negotiation ${negotiationId} service=${negotiation.serviceId}` +
          (resolvedServiceId ? ` → ${resolvedServiceId}` : ""),
      );

      if (!resolvedServiceId || !CAP_SERVICE_IDS.includes(resolvedServiceId)) {
        console.log(
          `[cap] Rejecting negotiation ${negotiationId}: unknown service ${negotiation.serviceId}`,
        );
        await client!.rejectNegotiation(negotiationId, "unknown service");
        return;
      }

      if (negotiation.requirements) {
        negotiationRequirements.set(negotiationId, negotiation.requirements);
      }

      const result = await client!.acceptNegotiation(negotiationId);
      console.log(`[cap] Order created: ${result.order.orderId}`);
    } catch (err) {
      console.error("[cap] Failed to handle negotiation:", err instanceof Error ? err.message : String(err));
    }
  });

  stream.on(EventType.OrderPaid, async (event) => {
    try {
      const orderId = event.order_id as string;
      if (!client) return;

      const order = await client.getOrder(orderId);
      const resolvedServiceId = resolveCapServiceId(order.serviceId) ?? order.serviceId;
      console.log(`[cap] Order paid: ${orderId} service=${order.serviceId} → ${resolvedServiceId}`);

      const requirements = negotiationRequirements.get(order.negotiationId);
      negotiationRequirements.delete(order.negotiationId);

      await fulfillCapOrder(client, {
        orderId,
        serviceId: resolvedServiceId,
        requirements,
      });
      console.log(`[cap] Delivered order: ${orderId}`);
    } catch (err) {
      console.error("[cap] Failed to fulfill order:", err instanceof Error ? err.message : String(err));
    }
  });

  console.log("[cap] Connected to CROO CAP");
}

/**
 * Close the CAP WebSocket gracefully.
 */
export async function stopCapClient(): Promise<void> {
  try {
    stream?.close();
  } catch {
    // ignore close errors
  }
  stream = null;
  client = null;
}
