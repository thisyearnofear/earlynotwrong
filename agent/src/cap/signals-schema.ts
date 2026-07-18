/**
 * Public signals-live/v1.2 JSON Schema helpers (docs/MCP tests).
 *
 * Do NOT use CROO_STORE_DELIVERABLE_SCHEMA in the Store listing or CAP delivery.
 * CROO validates paid delivery against Store Schema field-builder rows and rejects
 * the real v1.2 payload. Listing: Deliverable Schema empty, Text teaser only.
 */

import { SIGNALS_LIVE_SCHEMA_URL } from "../mcp/tools.js";

export { SIGNALS_LIVE_SCHEMA_URL };

/** @deprecated Do not register on CROO Store — causes INVALID_DELIVERABLE. Tests only. */
export const CROO_STORE_DELIVERABLE_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    guidance: {
      type: "object",
      description:
        "Action contract: recommendedAction (evaluate | skip_entries | wait), reason, topCandidate, sizeMultiplier.",
    },
    signals: {
      type: "array",
      description: "Ranked conviction candidates (symbol, score, breakdown, rationale).",
    },
    freshness: {
      type: "object",
      description: "Cycle timing: cycle, stale, lastRunAt, nextRunAt.",
    },
    provenance: {
      type: "object",
      description: "Trust bundle: behavioral score, anchors, explorerUrls.",
    },
  },
  required: ["guidance", "signals", "freshness", "provenance"],
});

/** Full v1.2 JSON Schema URL — for docs / MCP; not sent as CAP deliverableSchema. */

/**
 * @deprecated Use CROO_STORE_DELIVERABLE_SCHEMA for CAP deliverOrder.
 * Kept for tests that verify the public JSON Schema file exists on disk.
 */
export async function getCapDeliverableSchemaJson(): Promise<string> {
  const { readFileSync, existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const schemaPath = join(import.meta.dirname, "../../../public/schemas/signals-live-v1.2.schema.json");
  if (!existsSync(schemaPath)) {
    throw new Error(`Missing schema file: ${schemaPath}`);
  }
  return readFileSync(schemaPath, "utf8");
}
