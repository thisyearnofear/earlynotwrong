/**
 * RYO social surfaces — shared by the standalone demo server
 * (agent/ryo/serve.ts, node:http) and the production Hono server
 * (agent/src/server.ts). Pure functions: read the ledger, build the pages.
 * Keeping them here means the two servers can't drift — same receipts,
 * same debate page, same feed, whatever port serves them.
 */
import { readFileSync, existsSync } from "node:fs";
import { LEDGER_PATH, verifyChain, type LedgerEntry } from "../lib/adapters/ryo-ledger.js";

export { verifyChain, LEDGER_PATH };
export type { LedgerEntry };

export function ledgerEntries(): LedgerEntry[] {
  if (!existsSync(LEDGER_PATH)) return [];
  return readFileSync(LEDGER_PATH, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as LedgerEntry);
}

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Shareable single-decision receipt — the SocialFi surface: one URL a
 *  trader can open, read, and repost. No app, no auth, no JSON. */
export function receiptPage(e: LedgerEntry, chainOk: boolean): string {
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
${e.evidence && Object.keys(e.evidence).length ? `<div class="chain" style="margin-top:12px"><b>evidence</b> — ${esc(
  Object.entries(e.evidence)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v).slice(0, 140)}`)
    .join(" · "),
)}</div>` : ""}
<div class="chain">this receipt is an entry in a sha256 hash chain —
edit the reason above and every hash after it stops matching.<br/>
<b>verify:</b> hash = sha256(prevHash + canonical-json(entry)) · recompute with
<code>npx tsx agent/ryo/run.ts --verify</code> · or fetch
<code>/ryo/verify</code> for the live audit result</div>
<p class="reason" style="margin-top:20px"><a href="/ryo/debate/${esc(e.symbol)}">→ the full debate on ${esc(e.symbol)}</a></p>
${related.length ? `<p class="reason">related theses on ${esc(e.symbol)}: ${related.map((r) => `<br/>· ${esc(r.reason)} <a href="/ryo/receipt/${esc(r.hash)}">#${esc(r.hash.slice(0, 8))}</a>`).join("")}</p>` : ""}
<footer>early, not wrong · RYO-CHAN hackathon 2026 · paper trades only — no real funds</footer>
</body></html>`;
}

/** The debate surface — every entry for one symbol, chronologically: theses
 *  (open or resolved), jury verdicts, decisions. This is the room where
 *  "early, not wrong" claims get settled — and it's writable: the commit
 *  and resolve forms post to the same /tools/{tool}/call convention. */
export function debatePage(symbol: string, entries: LedgerEntry[], base: string): string {
  const rows = entries
    .map((e) => {
      const resolved = entries.find((x) => x.action === "RESOLVE" && x.evidence?.resolves === e.hash);
      const tail =
        e.action === "THESIS" && resolved
          ? ` <span class="res">→ resolved ${esc(resolved.evidence?.outcome ?? "")}</span>`
          : e.action === "THESIS"
            ? ' <span class="open">open</span>'
            : "";
      return `<tr>
<td>${esc(e.ts.slice(0, 16).replace("T", " "))}</td>
<td class="a-${esc(e.action)}">${esc(e.action)}</td>
<td>${esc(e.conviction)}/100</td>
<td class="r">${esc(e.reason)}${tail} <a href="${base}/ryo/receipt/${esc(e.hash)}">#${esc(e.hash.slice(0, 8))}</a></td>
</tr>`;
    })
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Debate — ${esc(symbol)} · RYO practice agent</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:title" content="The reasoning timeline for ${esc(symbol)}">
<meta property="og:description" content="${entries.length} hash-chained entries — theses, jury verdicts, decisions, resolutions.">
<style>
body{background:#0d0f0a;color:#e8e6d8;font-family:ui-monospace,Menlo,monospace;max-width:860px;margin:48px auto;padding:0 20px}
h1{font-size:24px} table{width:100%;border-collapse:collapse;font-size:12px;margin:24px 0}
td{border-top:1px solid #2a2d22;padding:8px 6px;vertical-align:top}
.r{color:#b8b5a2;line-height:1.45}
a{color:#e8b64c} .res{color:#a8c686} .open{color:#8a8774}
.a-JURY,.a-THESIS{color:#a78bfa}.a-BUY{color:#a8c686}.a-EXIT{color:#e08a8a}.a-RESOLVE{color:#38bdf8}
section{border:1px solid #2a2d22;border-radius:8px;padding:16px;margin:20px 0}
label{display:block;font-size:11px;color:#8a8774;margin:10px 0 4px}
input,select{background:#14170f;border:1px solid #2a2d22;color:#e8e6d8;border-radius:6px;padding:8px;font-size:12px;width:100%;box-sizing:border-box;font-family:inherit}
input:focus,select:focus,button:focus{outline:2px solid #e8b64c;outline-offset:1px}
button{margin-top:14px;background:#e8b64c;border:0;border-radius:6px;padding:9px 18px;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer}
pre{font-size:11px;color:#a8c686;white-space:pre-wrap;word-break:break-all}
footer{margin-top:32px;font-size:10px;color:#5c5948}
</style></head><body>
<h1>Debate — ${esc(symbol)}</h1>
<p style="font-size:12px;color:#8a8774">${entries.length} hash-chained entries · theses resolve once, checked against the price when it's reachable</p>
<table>${rows}</table>
<section aria-labelledby="commit-h"><h2 id="commit-h" style="font-size:15px;margin:0">Commit your thesis on ${esc(symbol)}</h2>
<p style="font-size:11px;color:#8a8774">Chains next to the agent's — your reasoning on the record before the move, with the price at commit sealed in.</p>
<form id="cf">
<label for="ct">Thesis</label><input id="ct" name="thesis" required maxlength="480" placeholder="your case, with the evidence">
<label for="cv">Conviction (0–100)</label><input id="cv" name="conviction" type="number" min="0" max="100" value="70">
<label for="ch">Resolve after (hours)</label><input id="ch" name="horizon" type="number" min="1" max="720" value="48">
<button type="submit">Commit thesis</button></form>
<pre id="co" aria-live="polite"></pre></section>
<section aria-labelledby="resolve-h"><h2 id="resolve-h" style="font-size:15px;margin:0">Resolve a commitment</h2>
<p style="font-size:11px;color:#8a8774">One-shot — checked against the actual price move when the market API answers, flagged contested when the claim disagrees.</p>
<form id="rf">
<label for="rc">Commitment hash</label><input id="rc" name="commitment" required placeholder="sha256…">
<label for="ro">Outcome</label><select id="ro" name="outcome"><option>validated</option><option>invalidated</option><option>mixed</option><option>expired</option></select>
<label for="rn">Note</label><input id="rn" name="note" maxlength="300" placeholder="what happened">
<button type="submit">Resolve</button></form>
<pre id="ro2" aria-live="polite"></pre></section>
<p style="font-size:10px;color:#5c5948">same calls by curl — <code>POST ${esc(base)}/tools/thesis_commit/call</code> · <code>POST ${esc(base)}/tools/thesis_resolve/call</code></p>
<script>
async function post(path,body,out){out.textContent="…";
 try{const r=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
 const j=await r.json();
 out.textContent=(j.summary?j.summary.headline+"\\n":"")+JSON.stringify(j.data??j,null,1);
 if(r.ok&&(j.data?.commitment||j.data?.resolved))setTimeout(()=>location.reload(),1500);
 }catch(e){out.textContent=String(e)}}
document.getElementById("cf").addEventListener("submit",e=>{e.preventDefault();const f=new FormData(e.target);
 post("/tools/thesis_commit/call",{symbol:${JSON.stringify(symbol)},thesis:f.get("thesis"),conviction:Number(f.get("conviction")),horizon_hours:Number(f.get("horizon"))},document.getElementById("co"))});
document.getElementById("rf").addEventListener("submit",e=>{e.preventDefault();const f=new FormData(e.target);
 post("/tools/thesis_resolve/call",{commitment:f.get("commitment"),outcome:f.get("outcome"),note:f.get("note")},document.getElementById("ro2"))});
</script>
<footer>early, not wrong · RYO-CHAN hackathon 2026 · paper trades only</footer>
</body></html>`;
}

/** The public reasoning feed payload — shared shape for both servers. */
export function feedPayload(base: string, entries: LedgerEntry[], n: number, sym?: string) {
  let filtered = entries;
  if (sym) filtered = entries.filter((e) => e.symbol.toUpperCase() === sym);
  return {
    feed: "ryo-practice-agent/verdicts",
    generated_at: new Date().toISOString(),
    chain: verifyChain(),
    items: filtered.slice(-n).reverse().map((e, i) => ({
      seq: filtered.length - 1 - i,
      ts: e.ts,
      action: e.action,
      symbol: e.symbol,
      conviction: e.conviction,
      reason: e.reason,
      hash: e.hash,
      receipt_url: `${base}/ryo/receipt/${e.hash}`,
    })),
  };
}

/** Commitment lookup — is this thesis open or resolved? */
export function commitmentLookup(commitment: string) {
  const entries = ledgerEntries();
  const thesis = entries.find(
    (e) =>
      e.action === "THESIS" &&
      (e.hash === commitment ||
        e.hash.startsWith(commitment) ||
        e.evidence?.commitment === commitment ||
        (typeof e.evidence?.commitment === "string" && e.evidence.commitment.startsWith(commitment))),
  );
  if (!thesis) return null;
  const resolution = entries.find((e) => e.action === "RESOLVE" && e.evidence?.resolves === thesis.hash);
  return {
    found: true,
    commitment: thesis.evidence?.commitment ?? commitment,
    symbol: thesis.symbol,
    thesis: thesis.reason,
    committed_at: thesis.ts,
    resolve_after: thesis.evidence?.resolve_after ?? null,
    price_at_commit: thesis.evidence?.price_at_commit ?? null,
    receipt_hash: thesis.hash,
    status: resolution ? `resolved:${resolution.evidence?.outcome}` : "open",
    resolution_receipt: resolution?.hash ?? null,
    contested: resolution?.evidence?.contested ?? false,
  };
}
