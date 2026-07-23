#!/usr/bin/env node
/**
 * Import SigNoz dashboard + alert rules via HTTP API.
 *
 * Usage:
 *   SIGNOZ_URL=http://localhost:8080 SIGNOZ_API_KEY=... node import-signoz-assets.mjs
 *
 * Dashboard: POST /api/v1/dashboards (v4 JSON import)
 * Alerts:    POST /api/v2/rules   (v2alpha1 threshold rules)
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const SIGNOZ_URL = (process.env.SIGNOZ_URL ?? "http://localhost:8080").replace(/\/$/, "");
const API_KEY = process.env.SIGNOZ_API_KEY ?? "";

function headers() {
  const h = { "Content-Type": "application/json" };
  if (API_KEY) h["SIGNOZ-API-KEY"] = API_KEY;
  return h;
}

async function importDashboard() {
  const path = join(ROOT, "dashboards/agent-trading-operations.json");
  const dashboard = JSON.parse(readFileSync(path, "utf8"));
  delete dashboard.uuid;

  const res = await fetch(`${SIGNOZ_URL}/api/v1/dashboards`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ data: dashboard }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Dashboard import failed (${res.status}): ${body}`);
  }

  const json = await res.json();
  console.log(`Dashboard imported: ${dashboard.title} (id=${json?.data?.uuid ?? json?.data?.id ?? "?"})`);
}

async function importAlerts() {
  const dir = join(ROOT, "alerts");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

  for (const file of files) {
    const rule = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const res = await fetch(`${SIGNOZ_URL}/api/v2/rules`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(rule),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Alert ${file} failed (${res.status}): ${body}`);
    }

    const json = await res.json();
    console.log(`Alert imported: ${rule.alert} (id=${json?.data?.id ?? "?"})`);
  }
}

async function main() {
  console.log(`SigNoz URL: ${SIGNOZ_URL}`);
  await importDashboard();
  await importAlerts();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
