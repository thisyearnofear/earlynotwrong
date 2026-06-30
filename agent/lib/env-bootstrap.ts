/**
 * .env bootstrap — populates process.env from agent/.env BEFORE any sibling
 * module in the agent graph evaluates.
 *
 * IMPORTANT: this module must be imported via a SIDE-EFFECT IMPORT (no named
 * imports) as the FIRST line of index.ts:
 *
 *   import "./lib/env-bootstrap.js";
 *
 * Why: ESM evaluates every import in a module before any of that module's
 * top-level code. The previous design ran the loader inline at the top of
 * index.ts AFTER the import statements — but Node still hoisted those imports,
 * which meant singletons like `sosovalueClient = new SosovalueClient()` in
 * data-providers.ts captured `process.env.SOSOVALUE_API_KEY` BEFORE this
 * loader ever ran. Keys that happened to already be in the parent process's
 * env (pm2-managed TWAK_ACCESS_ID, CMC_API_KEY, etc.) worked by accident.
 * Keys only present in .env (SOSOVALUE_API_KEY) silently came up empty.
 *
 * Module evaluation order in ESM is depth-first by import position, so a leaf
 * side-effect import placed at line 1 runs before any subsequent imports —
 * which is exactly what we need.
 *
 * Walks up from the compiled file's directory looking for `.env`. Silent on
 * missing files (simulator mode doesn't need one). Existing process.env
 * entries always win over .env values, so pm2-managed secrets stay
 * authoritative.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

try {
  const here = dirname(fileURLToPath(import.meta.url));
  let envPath: string | undefined;
  let dir = here;
  for (let i = 0; i < 5; i++) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) {
      envPath = candidate;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (envPath) {
    for (const raw of readFileSync(envPath, "utf-8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  }
} catch {
  // Silent — missing .env is fine in simulator mode.
}
