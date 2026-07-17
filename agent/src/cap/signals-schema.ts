/**
 * Deliverable schema registered on the CROO Store listing (field builder).
 * Must match the four rows: guidance, signals, freshness, provenance.
 *
 * CAP deliverOrder expects deliverableSchema as JSON text of this object —
 * not a URL and not the full signals-live-v1.1 JSON Schema file.
 */

import { SIGNALS_LIVE_SCHEMA_URL } from "../mcp/tools.js";

export { SIGNALS_LIVE_SCHEMA_URL };

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

/** Full v1.1 JSON Schema URL — for docs / MCP; not sent as CAP deliverableSchema. */

/**
 * @deprecated Use CROO_STORE_DELIVERABLE_SCHEMA for CAP deliverOrder.
 * Kept for tests that verify the public JSON Schema file exists on disk.
 */
export async function getCapDeliverableSchemaJson(): Promise<string> {
  const { readFileSync, existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const path = join(process.cwd(), "../public/schemas/signals-live-v1.1.schema.json");
  if (existsSync(path)) {
    return readFileSync(path, "utf-8");
  }
  const res = await fetch(SIGNALS_LIVE_SCHEMA_URL);
  if (!res.ok) throw new Error(`Schema fetch failed: ${res.status}`);
  return JSON.stringify(await res.json());
}
