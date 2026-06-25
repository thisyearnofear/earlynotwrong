/**
 * audit-holdings.mjs — Liquidity & legitimacy audit for held positions.
 *
 * For each entry in state.json's heldPositions:
 *   1. Discover the contract address from recent on-chain Transfer events
 *      (incoming transfers to our wallet for that symbol).
 *   2. Query DexScreener for pool liquidity (the dependable on-chain truth —
 *      CMC's price feed can mark scam tokens that have no real DEX pool).
 *   3. Classify: TRADEABLE / ILLIQUID / SCAM_SIGNAL.
 *
 * Output is JSON on stdout (parseable) plus a human summary on stderr.
 *
 * Usage:
 *   node scripts/audit-holdings.mjs            # dry-run (preview)
 *   node scripts/audit-holdings.mjs --prune    # remove ILLIQUID + SCAM_SIGNAL from state.json
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
const PRUNE = process.argv.includes("--prune");

const WALLET = (process.env.AGENT_WALLET_KEY || "0xA1Dd482E4D6C8cf6f5f7BF80FEc6Bd3F11F5888a").toLowerCase();
const NODEREAL_KEY = process.env.NODEREAL_API_KEY;
const STATE_PATH = new URL("../data/state.json", import.meta.url);

if (!NODEREAL_KEY) { console.error("NODEREAL_API_KEY not set"); process.exit(1); }

const RPC = `https://bsc-mainnet.nodereal.io/v1/${NODEREAL_KEY}`;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const PADDED_WALLET = "0x" + "0".repeat(24) + WALLET.slice(2);
const CHUNK = 49999;
const CHUNKS_BACK = Number(process.env.SCAN_CHUNKS ?? 30);

// Liquidity thresholds (USD). Below MIN_OK we treat as illiquid.
const MIN_OK_LIQUIDITY = 5_000;
const MIN_OK_24H_VOLUME = 100;

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

async function symbolOf(contract) {
  // ERC-20 symbol() = 0x95d89b41
  try {
    const r = await rpc("eth_call", [{ to: contract, data: "0x95d89b41" }, "latest"]);
    if (!r || r === "0x") return null;
    const hex = r.slice(2);
    // Try ABI-encoded string (offset/length/data)
    if (hex.length >= 128) {
      const len = parseInt(hex.slice(64, 128), 16);
      if (len > 0 && len < 64) {
        return Buffer.from(hex.slice(128, 128 + len * 2), "hex").toString("utf8").trim();
      }
    }
    // Or bytes32 padded
    return Buffer.from(hex, "hex").toString("utf8").replace(/\0/g, "").trim() || null;
  } catch {
    return null;
  }
}

async function discoverContractsBySymbol(symbols) {
  const latest = parseInt(await rpc("eth_blockNumber", []), 16);
  const wanted = new Set(symbols.map((s) => s.toUpperCase()));
  const found = new Map(); // SYMBOL -> contract

  for (let i = 0; i < CHUNKS_BACK && wanted.size > 0; i++) {
    const toBlock = latest - i * CHUNK;
    const fromBlock = Math.max(0, toBlock - CHUNK + 1);
    let logs;
    try {
      logs = await rpc("eth_getLogs", [{
        fromBlock: "0x" + fromBlock.toString(16),
        toBlock: "0x" + toBlock.toString(16),
        topics: [TRANSFER_TOPIC, null, PADDED_WALLET],
      }]);
    } catch {
      continue;
    }
    const contracts = new Set(logs.map((l) => l.address.toLowerCase()));
    for (const c of contracts) {
      // Skip already-resolved contracts (we only care about new ones)
      if ([...found.values()].includes(c)) continue;
      const sym = (await symbolOf(c))?.toUpperCase();
      if (sym && wanted.has(sym) && !found.has(sym)) {
        found.set(sym, c);
        wanted.delete(sym);
      }
    }
  }
  return found;
}

async function dexScreener(contract) {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${contract}`);
    if (!r.ok) return null;
    const j = await r.json();
    const pairs = (j.pairs || []).filter((p) => p.chainId === "bsc");
    if (pairs.length === 0) return { liquidity: 0, volume24h: 0, pairCount: 0 };
    // Sum liquidity across all BSC pairs; take max 24h volume
    const liquidity = pairs.reduce((s, p) => s + (Number(p.liquidity?.usd) || 0), 0);
    const volume24h = Math.max(...pairs.map((p) => Number(p.volume?.h24) || 0));
    const priceUsd = Math.max(...pairs.map((p) => Number(p.priceUsd) || 0));
    return { liquidity, volume24h, pairCount: pairs.length, priceUsd };
  } catch {
    return null;
  }
}

function classify(dex, amountUsd) {
  if (!dex || dex.pairCount === 0) return { tier: "SCAM_SIGNAL", reason: "no DEX pair found" };
  if (dex.liquidity < MIN_OK_LIQUIDITY) return { tier: "ILLIQUID", reason: `pool $${dex.liquidity.toFixed(0)} < $${MIN_OK_LIQUIDITY}` };
  if (dex.volume24h < MIN_OK_24H_VOLUME) return { tier: "ILLIQUID", reason: `24h volume $${dex.volume24h.toFixed(0)} < $${MIN_OK_24H_VOLUME}` };
  // Sanity: pool depth should be at least 5x our position size for a clean exit
  if (dex.liquidity < amountUsd * 5) return { tier: "ILLIQUID", reason: `pool $${dex.liquidity.toFixed(0)} < 5x position $${amountUsd.toFixed(2)}` };
  return { tier: "TRADEABLE", reason: `pool $${(dex.liquidity / 1000).toFixed(0)}k · vol $${(dex.volume24h / 1000).toFixed(1)}k` };
}

async function main() {
  const s = JSON.parse(readFileSync(STATE_PATH, "utf8"));
  const positions = (s.agent.heldPositions || [])
    .filter((p) => p.symbol !== "USDC")
    .sort((a, b) => b.amountUsd - a.amountUsd);
  const symbols = positions.map((p) => p.symbol);

  console.error(`Discovering on-chain contracts for ${symbols.length} symbol(s)...`);
  const contracts = await discoverContractsBySymbol(symbols);
  console.error(`Resolved ${contracts.size}/${symbols.length} contracts`);

  const report = [];
  for (const p of positions) {
    const contract = contracts.get(p.symbol.toUpperCase());
    if (!contract) {
      report.push({ symbol: p.symbol, amountUsd: p.amountUsd, tier: "UNKNOWN", reason: "contract not found in recent transfer logs" });
      continue;
    }
    const dex = await dexScreener(contract);
    const cls = classify(dex, p.amountUsd);
    report.push({
      symbol: p.symbol,
      amountUsd: p.amountUsd,
      contract,
      ...cls,
      dex,
    });
  }

  // Human summary
  const byTier = { TRADEABLE: [], ILLIQUID: [], SCAM_SIGNAL: [], UNKNOWN: [] };
  for (const r of report) byTier[r.tier].push(r);
  const sum = (rs) => rs.reduce((t, r) => t + r.amountUsd, 0);

  console.error("\n=== HOLDINGS AUDIT ===");
  for (const tier of ["TRADEABLE", "ILLIQUID", "SCAM_SIGNAL", "UNKNOWN"]) {
    const rs = byTier[tier];
    if (rs.length === 0) continue;
    console.error(`\n${tier} (${rs.length} positions, $${sum(rs).toFixed(2)}):`);
    for (const r of rs) {
      console.error(`  ${r.symbol.padEnd(10)} $${r.amountUsd.toFixed(2).padStart(7)}  — ${r.reason}`);
    }
  }

  console.log(JSON.stringify(report, null, 2));

  if (PRUNE) {
    const removeSymbols = new Set(
      report.filter((r) => r.tier === "ILLIQUID" || r.tier === "SCAM_SIGNAL").map((r) => r.symbol),
    );
    if (removeSymbols.size === 0) {
      console.error("\n[prune] Nothing to remove.");
      return;
    }
    const backup = STATE_PATH.pathname + ".bak-" + Date.now();
    copyFileSync(STATE_PATH, backup);
    const before = s.agent.heldPositions.length;
    s.agent.heldPositions = s.agent.heldPositions.filter((p) => !removeSymbols.has(p.symbol));
    writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
    console.error(`\n[prune] Removed ${before - s.agent.heldPositions.length} position(s) from ledger: ${[...removeSymbols].join(", ")}`);
    console.error(`[prune] Backup written to: ${backup}`);
    console.error(`[prune] Tokens remain in wallet on-chain — agent will simply ignore them.`);
  }
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
