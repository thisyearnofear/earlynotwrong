/**
 * scan-holdings.mjs — Reliable on-chain BEP-20 holdings discovery.
 *
 * Enumerates every ERC-20 that has ever transferred INTO the agent wallet
 * (via Transfer logs), reads the live on-chain balanceOf for each, and prices
 * them via CMC (primary) + CoinGecko (fallback). This is independent of TWAK's
 * limited `wallet portfolio` output, which only surfaces native + USDC.
 *
 * Usage: node scripts/scan-holdings.mjs [walletAddress]
 * Env:   NODEREAL_API_KEY, CMC_API_KEY, COINGECKO_API_KEY
 */

const WALLET = (process.argv[2] || "0xA1Dd482E4D6C8cf6f5f7BF80FEc6Bd3F11F5888a").toLowerCase();
const NODEREAL_KEY = process.env.NODEREAL_API_KEY;
const CMC_KEY = process.env.CMC_API_KEY;
const CG_KEY = process.env.COINGECKO_API_KEY;

if (!NODEREAL_KEY) {
  console.error("NODEREAL_API_KEY not set");
  process.exit(1);
}

const RPC = `https://bsc-mainnet.nodereal.io/v1/${NODEREAL_KEY}`;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const PADDED_WALLET = "0x" + "0".repeat(24) + WALLET.slice(2);
const CHUNK = 50000;
const CHUNKS_BACK = Number(process.env.SCAN_CHUNKS ?? 30); // 30 * 50k = 1.5M blocks (~3-4 weeks)

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

async function call(to, data) {
  return rpc("eth_call", [{ to, data }, "latest"]);
}

const hexToBig = (h) => (h && h !== "0x" ? BigInt(h) : 0n);

// ERC-20 selectors
const SEL_BALANCEOF = "0x70a08231";
const SEL_DECIMALS = "0x313ce567";
const SEL_SYMBOL = "0x95d89b41";

function decodeString(hex) {
  if (!hex || hex === "0x") return "";
  const body = hex.slice(2);
  // ABI dynamic string: offset(32) len(32) data
  if (body.length >= 128) {
    const len = parseInt(body.slice(64, 128), 16);
    if (len > 0 && len < 100) {
      const data = body.slice(128, 128 + len * 2);
      try { return Buffer.from(data, "hex").toString("utf8").replace(/\0/g, "").trim(); } catch {}
    }
  }
  // bytes32 fallback
  try { return Buffer.from(body, "hex").toString("utf8").replace(/\0/g, "").trim(); } catch { return ""; }
}

async function main() {
  const latestHex = await rpc("eth_blockNumber", []);
  const latest = parseInt(latestHex, 16);
  const start = Math.max(0, latest - CHUNK * CHUNKS_BACK);
  console.error(`Scanning Transfer→wallet logs, blocks ${start}..${latest} (${CHUNKS_BACK} chunks)`);

  const contracts = new Map(); // contract -> { txs:Set<hash> }
  for (let from = start; from <= latest; from += CHUNK) {
    const to = Math.min(from + CHUNK - 1, latest);
    const logs = await rpc("eth_getLogs", [{
      fromBlock: "0x" + from.toString(16),
      toBlock: "0x" + to.toString(16),
      topics: [TRANSFER_TOPIC, null, PADDED_WALLET],
    }]);
    for (const l of logs) {
      const c = l.address.toLowerCase();
      if (!contracts.has(c)) contracts.set(c, new Set());
      if (contracts.get(c).size < 3) contracts.get(c).add(l.transactionHash); // sample a few txs
    }
    process.stderr.write(`  ${to}/${latest} — ${contracts.size} tokens seen\r`);
  }
  console.error("");

  // Classify acquisition: a real swap is INITIATED BY our wallet (tx.from == wallet).
  // An airdrop is pushed by a third party (tx.from != wallet).
  const acquired = {}; // contract -> "bought" | "airdrop"
  for (const [c, txs] of contracts) {
    let bought = false;
    for (const h of txs) {
      try { const tx = await rpc("eth_getTransactionByHash", [h]); if (tx?.from?.toLowerCase() === WALLET) { bought = true; break; } } catch {}
    }
    acquired[c] = bought ? "bought" : "airdrop";
  }

  const holdings = [];
  for (const c of contracts.keys()) {
    const balHex = await call(c, SEL_BALANCEOF + "0".repeat(24) + WALLET.slice(2));
    const raw = hexToBig(balHex);
    if (raw === 0n) continue;
    let dec = 18, sym = "?";
    try { dec = Number(hexToBig(await call(c, SEL_DECIMALS))); } catch {}
    try { sym = decodeString(await call(c, SEL_SYMBOL)) || "?"; } catch {}
    const amount = Number(raw) / 10 ** dec;
    holdings.push({ contract: c, symbol: sym, amount, origin: acquired[c] });
  }

  // Price: CMC by symbol (primary), CoinGecko by contract (fallback)
  const prices = {}; // contract -> usd
  if (CG_KEY && holdings.length) {
    try {
      const url = `https://api.coingecko.com/api/v3/simple/token_price/binance-smart-chain?contract_addresses=${holdings.map(h => h.contract).join(",")}&vs_currencies=usd`;
      const r = await fetch(url, { headers: { "x-cg-demo-api-key": CG_KEY } });
      if (r.ok) { const d = await r.json(); for (const c in d) if (d[c]?.usd) prices[c] = d[c].usd; }
    } catch {}
  }
  const cmcPrice = {};
  if (CMC_KEY && holdings.length) {
    try {
      const syms = [...new Set(holdings.map(h => h.symbol).filter(s => s && s !== "?"))].join(",");
      const r = await fetch(`https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?symbol=${encodeURIComponent(syms)}`, { headers: { "X-CMC_PRO_API_KEY": CMC_KEY } });
      if (r.ok) {
        const d = await r.json();
        for (const sym in (d.data || {})) {
          const arr = Array.isArray(d.data[sym]) ? d.data[sym] : [d.data[sym]];
          const p = arr[0]?.quote?.USD?.price;
          if (p) cmcPrice[sym.toUpperCase()] = p;
        }
      }
    } catch {}
  }

  console.log(`\nWallet ${WALLET}`);
  console.log("SYMBOL        AMOUNT            USD       SOURCE   ORIGIN    CONTRACT");
  console.log("-".repeat(100));
  const rows = holdings.map(h => {
    const cg = prices[h.contract];
    const cmc = cmcPrice[h.symbol.toUpperCase()];
    const price = cmc ?? cg ?? 0;
    const source = cmc != null ? "cmc" : cg != null ? "coingecko" : "none";
    return { ...h, usd: h.amount * price, source };
  }).sort((a, b) => b.usd - a.usd);

  for (const r of rows) {
    console.log(
      r.symbol.padEnd(12),
      r.amount.toPrecision(6).padStart(16),
      ("$" + r.usd.toFixed(2)).padStart(10),
      r.source.padEnd(9),
      r.origin.padEnd(9),
      r.contract
    );
  }
  const bought = rows.filter(r => r.origin === "bought");
  const airdrop = rows.filter(r => r.origin === "airdrop");
  const sum = (a) => a.reduce((t, r) => t + r.usd, 0);
  console.log("-".repeat(100));
  console.log(`BOUGHT (agent-acquired): $${sum(bought).toFixed(2)} across ${bought.length} tokens  ← real positions`);
  console.log(`AIRDROP (pushed to wallet): $${sum(airdrop).toFixed(2)} across ${airdrop.length} tokens  ← spam, exclude`);
  console.log(`TOTAL BEP-20 (excl. native BNB): $${sum(rows).toFixed(2)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
