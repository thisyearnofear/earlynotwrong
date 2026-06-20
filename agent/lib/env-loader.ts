/**
 * Zero-dependency .env loader.
 *
 * Imported as the FIRST statement in index.ts so it runs BEFORE any sibling
 * module reads process.env. Without this ordering guarantee, a sibling that
 * constructs a client at module scope (e.g. cmcClient, twakExecutor) would
 * see an empty env when launched via plain `node dist/index.js` without
 * `--env-file`.
 *
 * Searches both the compiled output dir (dist/) and the source root one level
 * up, since tsc emits dist/index.js but .env lives at the agent root.
 * Silent on missing .env — simulator mode doesn't need it.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

try {
  const here = dirname(fileURLToPath(import.meta.url));
  // Walk up until we find .env (works from dist/, dist/lib/, or dist/src/).
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
