/**
 * recover-positions.mjs — Re-adopt orphaned on-chain positions into state.json.
 *
 * Background: TWAK's `wallet portfolio` can't see BEP-20 tokens, so the agent's
 * reconciliation previously deleted real positions from `heldPositions`. The
 * tokens are still in the wallet — this script rebuilds the ledger from chain.
 *
 * It only adopts tokens the agent ACTUALLY BOUGHT (swap initiated by our wallet),
 * excludes airdrop spam (pushed by third parties), and skips anomalous positions
 * whose mark-to-market value exceeds --max-position (default $100) — these are
 * illiquid paper-pumps (e.g. SLX) that would destabilize sizing/drawdown.
 *
 * Entry price is set to the CURRENT price (break-even) since historical cost
 * basis is unrecoverable — the agent will HOLD them and can harvest for BNB.
 *
 * Usage:
 *   node scripts/recover-positions.mjs            # dry-run (preview only)
 *   node scripts/recover-positions.mjs --apply    # write to data/state.json
 * Env: NODEREAL_API_KEY, CMC_API_KEY, COINGECKO_API_KEY
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const MAX_POSITION = Number((process.argv.find((a) => a.startsWith("--max-position=")) || "").split("=")[1] || 100);
const WALLET = (process.env.AGENT_WALLET_KEY || "0xA1Dd482E4D6C8cf6f5f7BF80FEc6Bd3F11F5888a").toLowerCase();
const NODEREAL_KEY = process.env.NODEREAL_API_KEY;
const CMC_KEY = process.env.CMC_API_KEY;
const CG_KEY = process.env.COINGECKO_API_KEY;
const STATE_PATH = new URL("../data/state.json", import.meta.url);

if (!NODEREAL_KEY) { console.error("NODEREAL_API_KEY not set"); process.exit(1); }

const RPC = `https://bsc-mainnet.nodereal.io/v1/${NODEREAL_KEY}`;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const PADDED_WALLET = "0x" + "0".repeat(24) + WALLET.slice(2);
const CHUNK = 49999;
const CHUNKS_BACK = Number(process.env.SCAN_CHUNKS ?? 30);

async function rpc(method, params) {
  const res = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }) });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}
const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
const hexToBig = (h) => (h && h !== "0x" ? BigInt(h) : 0n);
const SEL_BALANCEOF = "0x70a08231", SEL_DECIMALS = "0x313ce567", SEL_SYMBOL = "0x95d89b41";
function decodeString(hex) {
  if (!hex || hex === "0x") return "";
  const body = hex.slice(2);
  if (body.length >= 128) { const len = parseInt(body.slice(64, 128), 16); if (len > 0 && len < 100) { try { return Buffer.from(body.slice(128, 128 + len * 2), "hex").toString("utf8").replace(/\0/g, "").trim(); } catch {} } }
  try { return Buffer.from(body, "hex").toString("utf8").replace(/\0/g, "").trim(); } catch { return ""; }
}

async function main() {
  const latest = parseInt(await rpc("eth_blockNumber", []), 16);
  const start = Math.max(0, latest - (CHUNK + 1) * CHUNKS_BACK);
  console.error(`Scanning Transfer→wallet, blocks ${start}..${latest}`);

  const contracts = new Map();
  for (let from = start; from <= latest; from += CHUNK + 1) {
    const to = Math.min(from + CHUNK, latest);
    const logs = await rpc("eth_getLogs", [{ fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16), topics: [TRANSFER_TOPIC, null, PADDED_WALLET] }]);
    for (const l of logs) { const c = l.address.toLowerCase(); if (!contracts.has(c)) contracts.set(c, new Set()); if (contracts.get(c).size < 3) contracts.get(c).add(l.transactionHash); }
    process.stderr.write(`  ${to}/${latest} — ${contracts.size} tokens\r`);
  }
  console.error("");

  const adopt = [];
  for (const [c, txs] of contracts) {
    // Classify: bought (tx initiated by wallet) vs airdrop (pushed by others)
    let bought = false;
    for (const h of txs) { try { const tx = await rpc("eth_getTransactionByHash", [h]); if (tx?.from?.toLowerCase() === WALLET) { bought = true; break; } } catch {} }
    if (!bought) continue;
    const raw = hexToBig(await call(c, SEL_BALANCEOF + "0".repeat(24) + WALLET.slice(2)));
    if (raw === 0n) continue;
    let dec = 18, sym = "?";
    try { dec = Number(hexToBig(await call(c, SEL_DECIMALS))); } catch {}
    try { sym = decodeString(await call(c, SEL_SYMBOL)) || "?"; } catch {}
    adopt.push({ contract: c, symbol: sym, amount: Number(raw) / 10 ** dec });
  }

  // Price: CMC by symbol → CoinGecko by contract
  const cg = {};
  if (CG_KEY && adopt.length) { try { const r = await fetch(`https://api.coingecko.com/api/v3/simple/token_price/binance-smart-chain?contract_addresses=${adopt.map(a => a.contract).join(",")}&vs_currencies=usd`, { headers: { "x-cg-demo-api-key": CG_KEY } }); if (r.ok) { const d = await r.json(); for (const k in d) if (d[k]?.usd) cg[k.toLowerCase()] = d[k].usd; } } catch {} }
  const cmc = {};
  if (CMC_KEY && adopt.length) { try { const syms = [...new Set(adopt.map(a => a.symbol).filter(s => s && s !== "?"))].join(","); const r = await fetch(`https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?symbol=${encodeURIComponent(syms)}`, { headers: { "X-CMC_PRO_API_KEY": CMC_KEY } }); if (r.ok) { const d = await r.json(); for (const s in (d.data || {})) { const arr = Array.isArray(d.data[s]) ? d.data[s] : [d.data[s]]; const p = arr[0]?.quote?.USD?.price; if (p) cmc[s.toUpperCase()] = p; } } } catch {} }

  const now = Date.now();
  const positions = [], skipped = [];
  for (const a of adopt) {
    const price = cmc[a.symbol.toUpperCase()] ?? cg[a.contract] ?? 0;
    const valueUsd = a.amount * price;
    if (valueUsd <= 0.01) { skipped.push({ ...a, valueUsd, reason: "unpriceable/dust" }); continue; }
    if (valueUsd > MAX_POSITION) { skipped.push({ ...a, valueUsd, reason: `> $${MAX_POSITION} (illiquid paper-pump)` }); continue; }
    positions.push({
      symbol: a.symbol,
      entryPriceUsd: price,        // break-even — historical cost basis unrecoverable
      entryCycle: 0,
      entryAt: now,
      amountUsd: valueUsd,
      peakPriceUsd: price,
      maxUnderwaterPercent: 0,
      // Recovered positions have no recoverable history — but they have been
      // in the wallet for many cycles. Seed at the harvest-maturity threshold
      // so the agent can immediately harvest the weakest one for BNB when
      // bankroll demands it (vs. waiting 8 cycles).
      cyclesHeld: 8,
      partialProfitTaken: false,
    });
  }
  positions.sort((a, b) => b.amountUsd - a.amountUsd);

  console.log(`\nADOPT (${positions.length}, total $${positions.reduce((t, p) => t + p.amountUsd, 0).toFixed(2)}):`);
  for (const p of positions) console.log(`  ${p.symbol.padEnd(10)} $${p.amountUsd.toFixed(2).padStart(8)}  @ $${p.entryPriceUsd}`);
  console.log(`\nSKIP (${skipped.length}):`);
  for (const s of skipped) console.log(`  ${s.symbol.padEnd(10)} $${s.valueUsd.toFixed(2).padStart(8)}  — ${s.reason}`);

  if (!APPLY) { console.log("\n(dry-run — re-run with --apply to write state.json)"); return; }

  if (!existsSync(STATE_PATH)) { console.error("\nstate.json not found at", STATE_PATH.pathname); process.exit(1); }
  const backup = STATE_PATH.pathname + `.bak.${now}`;
  copyFileSync(STATE_PATH, backup);
  const stateJson = JSON.parse(readFileSync(STATE_PATH, "utf8"));
  stateJson.agent = stateJson.agent || {};
  const existing = Array.isArray(stateJson.agent.heldPositions) ? stateJson.agent.heldPositions : [];
  const existingSyms = new Set(existing.map((p) => p.symbol.toUpperCase()));
  const merged = [...existing, ...positions.filter((p) => !existingSyms.has(p.symbol.toUpperCase()))];
  stateJson.agent.heldPositions = merged;
  writeFileSync(STATE_PATH, JSON.stringify(stateJson, null, 2));
  console.log(`\n✓ Wrote ${merged.length} positions to state.json (backup: ${backup})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
