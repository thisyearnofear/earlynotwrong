/**
 * RYO demo status server — serves the file-backed practice-agent state over
 * HTTP so the web app's RyoArenaCard (and judges) can watch the reasoning
 * trail live. Same payload the production agent's /ryo/status route builds;
 * standalone so the demo needs no production process.
 *
 * Zero-dependency (node:http) — consistent with the rest of agent/ryo/.
 *
 *   npx tsx agent/ryo/serve.ts            # http://localhost:31800/ryo/status
 *
 * Endpoints:
 *   GET  /ryo/status         portfolio + verdict feed + chain integrity (arena-card shape)
 *   GET  /ryo/ledger?n=50    last N ledger entries
 *   GET  /ryo/verify         recompute the hash chain — the audit endpoint
 *   POST /ryo/thesis-commit  Track 3 tool: hash-chained thesis receipts
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { readRyoStatus } from "../lib/adapters/ryo-status.js";
import { LEDGER_PATH, verifyChain } from "../lib/adapters/ryo-ledger.js";
import { thesisCommit, type ThesisCommitInput } from "./thesis-commit.js";

const PORT = Number(process.env.RYO_STATUS_PORT ?? 31800);

function json(res: import("node:http").ServerResponse, status: number, body: unknown) {
  const b = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
  });
  res.end(b);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "OPTIONS") return json(res, 204, null);

  if (req.method === "GET" && url.pathname === "/ryo/status") {
    return json(res, 200, readRyoStatus());
  }
  if (req.method === "GET" && url.pathname === "/ryo/ledger") {
    if (!existsSync(LEDGER_PATH)) return json(res, 200, { entries: [] });
    const n = Math.min(Number(url.searchParams.get("n") ?? 50), 500);
    const lines = readFileSync(LEDGER_PATH, "utf8").trim().split("\n").filter(Boolean);
    return json(res, 200, { entries: lines.slice(-n).map((l) => JSON.parse(l)) });
  }
  if (req.method === "GET" && url.pathname === "/ryo/verify") {
    return json(res, 200, { ...verifyChain(), ledger: LEDGER_PATH });
  }
  if (req.method === "POST" && url.pathname === "/ryo/thesis-commit") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        return json(res, 200, thesisCommit(JSON.parse(body) as ThesisCommitInput));
      } catch (err) {
        return json(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
    });
    return;
  }
  return json(res, 404, { error: "not found", routes: ["GET /ryo/status", "GET /ryo/ledger?n=", "GET /ryo/verify", "POST /ryo/thesis-commit"] });
});

server.listen(PORT, () => {
  console.log(`ryo status server → http://localhost:${PORT}/ryo/status`);
});
