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
 *   GET  /ryo/feed                public reasoning feed (shareable verdicts, newest first)
 *   GET  /ryo/receipt/{hash}      shareable HTML receipt — one decision, human-readable
 *   POST /tools/thesis_commit/call  Track 3 tool at RYO's published call convention
 *   POST /ryo/thesis-commit       same tool, convenience alias
 */
import { createServer, type ServerResponse, type IncomingMessage } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { readRyoStatus } from "../lib/adapters/ryo-status.js";
import { LEDGER_PATH, verifyChain, type LedgerEntry } from "../lib/adapters/ryo-ledger.js";
import { thesisCommit, type ThesisCommitInput } from "./thesis-commit.js";

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

function ledgerEntries(): LedgerEntry[] {
  if (!existsSync(LEDGER_PATH)) return [];
  return readFileSync(LEDGER_PATH, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as LedgerEntry);
}

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Shareable single-decision receipt — the SocialFi surface: one URL a
 *  trader can open, read, and repost. No app, no auth, no JSON. */
function receiptPage(e: LedgerEntry, chainOk: boolean): string {
  const related = ledgerEntries().filter((x) => x.symbol === e.symbol && x.action === "THESIS" && x.hash !== e.hash);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>RYO receipt — ${esc(e.action)} ${esc(e.symbol)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:title" content="${esc(e.action)} ${esc(e.symbol)} — RYO practice agent receipt">
<meta property="og:description" content="${esc(e.reason)}">
<style>
body{background:#0d0f0a;color:#e8e6d8;font-family:ui-monospace,Menlo,monospace;max-width:640px;margin:48px auto;padding:0 20px}
.badge{display:inline-block;border:1px solid #4a5c3a;border-radius:6px;padding:4px 10px;font-size:12px;letter-spacing:.08em;color:#a8c686}
.broken{border-color:#8c3f3f;color:#e08a8a}
h1{font-size:26px;margin:18px 0 4px}
.reason{color:#b8b5a2;line-height:1.5;font-size:14px}
dl{display:grid;grid-template-columns:120px 1fr;gap:6px 12px;font-size:12px;margin:24px 0}
dt{color:#7d7a68}dd{margin:0;word-break:break-all}
.chain{border:1px solid #2a2d22;border-radius:8px;padding:12px;font-size:11px;color:#8a8774}
.chain b{color:#e8b64c}
footer{margin-top:32px;font-size:10px;color:#5c5948}
a{color:#e8b64c}
</style></head><body>
<span class="badge ${chainOk ? "" : "broken"}">${chainOk ? "⛓ chain intact" : "⚠ chain broken"}</span>
<h1>${esc(e.action)} ${esc(e.symbol)}</h1>
<p class="reason">${esc(e.reason)}</p>
<dl>
<dt>conviction</dt><dd>${esc(e.conviction)}/100</dd>
${e.sizeUsd ? `<dt>size</dt><dd>$${esc(e.sizeUsd)}</dd>` : ""}
${e.priceUsd ? `<dt>price</dt><dd>$${esc(Number(e.priceUsd).toFixed(4))}</dd>` : ""}
<dt>committed</dt><dd>${esc(e.ts)}</dd>
<dt>hash</dt><dd>${esc(e.hash)}</dd>
<dt>prev hash</dt><dd>${esc(e.prevHash)}</dd>
</dl>
<div class="chain">this receipt is <b>entry ${esc(e.prevHash === "GENESIS" ? 0 : "?")}</b> in a sha256 hash chain —
edit the reason above and every hash after it stops matching.
audit: <code>npx tsx agent/ryo/run.ts --verify</code></div>
${related.length ? `<p class="reason" style="margin-top:20px">related theses on ${esc(e.symbol)}: ${related.map((r) => `<br/>· ${esc(r.reason)} <a href="/ryo/receipt/${esc(r.hash)}">#${esc(r.hash.slice(0, 8))}</a>`).join("")}</p>` : ""}
<footer>early, not wrong · RYO-CHAN hackathon 2026 · paper trades only — no real funds</footer>
</body></html>`;
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
    const entries = ledgerEntries();
    return json(res, 200, {
      feed: "ryo-practice-agent/verdicts",
      generated_at: new Date().toISOString(),
      chain: verifyChain(),
      items: entries.slice(-n).reverse().map((e, i) => ({
        seq: entries.length - 1 - i,
        ts: e.ts,
        action: e.action,
        symbol: e.symbol,
        conviction: e.conviction,
        reason: e.reason,
        hash: e.hash,
        receipt_url: `${base}/ryo/receipt/${e.hash}`,
      })),
    });
  }
  if (req.method === "GET" && url.pathname.startsWith("/ryo/receipt/")) {
    const hash = url.pathname.slice("/ryo/receipt/".length);
    const e = ledgerEntries().find((x) => x.hash === hash || x.hash.startsWith(hash));
    if (!e) return html(res, 404, "<h1>receipt not found</h1>");
    return html(res, 200, receiptPage(e, verifyChain().ok));
  }
  const isToolCall = url.pathname === "/tools/thesis_commit/call" || url.pathname === "/ryo/thesis-commit";
  if (req.method === "POST" && isToolCall) {
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
  return json(res, 404, {
    error: "not found",
    routes: [
      "GET /ryo/status", "GET /ryo/ledger?n=", "GET /ryo/verify", "GET /ryo/feed",
      "GET /ryo/receipt/{hash}", "POST /tools/thesis_commit/call", "POST /ryo/thesis-commit",
    ],
  });
});

server.listen(PORT, () => {
  console.log(`ryo status server → http://localhost:${PORT}/ryo/status`);
});
