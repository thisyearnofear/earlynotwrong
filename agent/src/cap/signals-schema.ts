/**
 * CAP deliverOrder expects deliverableSchema as a JSON object string,
 * not a bare URL (CROO returns 400 if it sees "https://...").
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SIGNALS_LIVE_SCHEMA_URL } from "../mcp/tools.js";

let cachedSchemaJson: string | null = null;

function loadSchemaFromDisk(): string | null {
  const candidates = [
    join(process.cwd(), "../public/schemas/signals-live-v1.1.schema.json"),
    join(process.cwd(), "../docs/schemas/signals-live-v1.1.schema.json"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const raw = readFileSync(path, "utf-8");
    JSON.parse(raw);
    return raw;
  }
  return null;
}

/** JSON text of the signals-live/v1.1 schema document for CAP Schema deliveries. */
export async function getCapDeliverableSchemaJson(): Promise<string> {
  if (cachedSchemaJson) return cachedSchemaJson;

  const fromDisk = loadSchemaFromDisk();
  if (fromDisk) {
    cachedSchemaJson = fromDisk;
    return cachedSchemaJson;
  }

  const res = await fetch(SIGNALS_LIVE_SCHEMA_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${SIGNALS_LIVE_SCHEMA_URL}: HTTP ${res.status}`);
  }
  const obj = await res.json();
  cachedSchemaJson = JSON.stringify(obj);
  return cachedSchemaJson;
}
