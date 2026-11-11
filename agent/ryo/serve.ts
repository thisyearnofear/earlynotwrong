/**
 * RYO demo status server — serves the file-backed practice-agent state over
 * HTTP so the web app's RyoArenaCard (and judges) can watch the reasoning
 * trail live. Zero-dependency (node:http), consistent with agent/ryo/.
 *
 *   npx tsx agent/ryo/serve.ts            # http://localhost:31800/ryo/status
 *
 * Endpoints:
 *   GET  /ryo/status              portfolio + verdict feed + chain integrity (arena-card shape)
 *   GET  /ryo/ledger?n=50         last N ledger entries
 *   GET  /ryo/verify              recompute the hash chain — the audit endpoint
 *   GET  /ryo/feed[?symbol=]      public reasoning feed (shareable verdicts, newest first)
 *   GET  /ryo/receipt/{hash}      shareable HTML receipt — one decision, human-readable
 *   GET  /ryo/debate/{symbol}     the reasoning timeline for a symbol — theses,
 *                                 jury verdicts, decisions, resolutions
 *   GET  /ryo/commitment/{hash}   commitment lookup — is this thesis open/resolved?
 *   POST /tools/thesis_commit/call   Track 3 tool at RYO's published convention
 *   POST /tools/thesis_resolve/call  companion — resolve a committed thesis
 *   POST /ryo/thesis-commit / /ryo/thesis-resolve   convenience aliases
 */
import { createServer, type ServerResponse, type IncomingMessage } from "node:http";
import { readRyoStatus } from "../lib/adapters/ryo-status.js";
import { LEDGER_PATH, verifyChain } from "../lib/adapters/ryo-ledger.js";
import { thesisCommit, type ThesisCommitInput } from "./thesis-commit.js";
import { thesisResolve, type ThesisResolveInput } from "./thesis-resolve.js";
import { RyoClient } from "../lib/adapters/ryo-client.js";
import { ledgerEntries, receiptPage, debatePage, feedPayload, commitmentLookup } from "./surfaces.js";

/** Lazy market client — price_at_commit / price_at_resolve evidence for
 *  the debate tools. Constructed on first use so the server starts
 *  credential-free; absent a key the tools degrade honestly (warnings
 *  name the missing price check). */
let _marketClient: RyoClient | null = null;
function marketClient(): RyoClient | undefined {
  if (!process.env.RYO_MCP_KEY) return undefined;
  return (_marketClient ??= new RyoClient());
}

const PORT = Number(process.env.RYO_STATUS_PORT ?? 31800);

function json(res: ServerResponse, status: number, body: unknown) {
  const b = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
  });
  res.end(b);
}

function html(res: ServerResponse, status: number, body: string) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "access-control-allow-origin": "*" });
  res.end(body);
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "OPTIONS") return json(res, 204, null);

  if (req.method === "GET" && url.pathname === "/ryo/status") {
    return json(res, 200, readRyoStatus());
  }
  if (req.method === "GET" && url.pathname === "/ryo/ledger") {
    const n = Math.min(Number(url.searchParams.get("n") ?? 50), 500);
    const entries = ledgerEntries();
    return json(res, 200, { entries: entries.slice(-n) });
  }
  if (req.method === "GET" && url.pathname === "/ryo/verify") {
    return json(res, 200, { ...verifyChain(), ledger: LEDGER_PATH });
  }
  // Public reasoning feed — the shareable SocialFi surface. Newest first,
  // self-describing verdicts with chain position and receipt permalinks.
  if (req.method === "GET" && url.pathname === "/ryo/feed") {
    const n = Math.min(Number(url.searchParams.get("n") ?? 25), 100);
    const base = `http://${req.headers.host ?? `localhost:${PORT}`}`;
    const sym = url.searchParams.get("symbol")?.toUpperCase();
    return json(res, 200, feedPayload(base, ledgerEntries(), n, sym));
  }
  if (req.method === "GET" && url.pathname.startsWith("/ryo/receipt/")) {
    const hash = url.pathname.slice("/ryo/receipt/".length);
    const e = ledgerEntries().find((x) => x.hash === hash || x.hash.startsWith(hash));
    if (!e) return html(res, 404, "<h1>receipt not found</h1>");
    return html(res, 200, receiptPage(e, verifyChain().ok));
  }
  if (req.method === "GET" && url.pathname.startsWith("/ryo/debate/")) {
    const symbol = url.pathname.slice("/ryo/debate/".length).toUpperCase();
    const entries = ledgerEntries().filter((e) => e.symbol.toUpperCase() === symbol);
    if (!entries.length) return html(res, 404, `<h1>no debate on ${symbol}</h1>`);
    const base = `http://${req.headers.host ?? `localhost:${PORT}`}`;
    return html(res, 200, debatePage(symbol, entries, base));
  }
  if (req.method === "GET" && url.pathname.startsWith("/ryo/commitment/")) {
    const c = url.pathname.slice("/ryo/commitment/".length);
    const found = commitmentLookup(c);
    if (!found) return json(res, 404, { found: false, commitment: c });
    return json(res, 200, found);
  }
  const isCommitCall = url.pathname === "/tools/thesis_commit/call" || url.pathname === "/ryo/thesis-commit";
  const isResolveCall = url.pathname === "/tools/thesis_resolve/call" || url.pathname === "/ryo/thesis-resolve";
  if (req.method === "POST" && (isCommitCall || isResolveCall)) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const parsed = JSON.parse(body);
        const out = isCommitCall
          ? await thesisCommit(parsed as ThesisCommitInput, marketClient())
          : await thesisResolve(parsed as ThesisResolveInput, marketClient());
        return json(res, 200, out);
      } catch (err) {
        return json(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
    });
    return;
  }
  return json(res, 404, {
    error: "not found",
    routes: [
      "GET /ryo/status", "GET /ryo/ledger?n=", "GET /ryo/verify", "GET /ryo/feed?symbol=",
      "GET /ryo/receipt/{hash}", "GET /ryo/debate/{symbol}", "GET /ryo/commitment/{hash}",
      "POST /tools/thesis_commit/call", "POST /tools/thesis_resolve/call",
      "POST /ryo/thesis-commit", "POST /ryo/thesis-resolve",
    ],
  });
});

server.listen(PORT, () => {
  console.log(`ryo status server → http://localhost:${PORT}/ryo/status`);
});
