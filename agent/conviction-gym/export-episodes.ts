/**
 * Conviction Gym — episode exporter.
 *
 * Pulls real daily market data and writes data/episodes.json:
 *   - CoinGecko market_chart (daily prices, mcap, volume) for the env's
 *     token universe — no proprietary API needed, a demo key works.
 *   - alternative.me Fear & Greed history for per-day regime scoring.
 *
 * Usage:
 *   npx tsx agent/conviction-gym/export-episodes.ts [--days 140] [--out data/episodes.json]
 *
 * COINGECKO_API_KEY (demo or pro) is picked up from .env.local / env.
 * The exported file is self-contained: the env needs no API keys to run.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreMarketRegime } from "../lib/conviction-signal.js";
import type {
  TokenQuote,
  SosovalueKline,
  GlobalMetrics,
  DerivativesMetrics,
} from "../lib/data-providers.js";
import type { EpisodeDay, EpisodeSpec } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// .env.local loader (repo convention — see agent/index.ts inline loader)
// ---------------------------------------------------------------------------
for (const f of [resolve(__dirname, "../../.env.local"), resolve(__dirname, "../../.env")]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// ---------------------------------------------------------------------------
// Token universe — liquid BSC names from the live eligible list that have
// clean CoinGecko IDs. Stablecoins excluded (nothing to trade).
// ---------------------------------------------------------------------------
const UNIVERSE: Record<string, string> = {
  ETH: "ethereum",
  XRP: "ripple",
  DOGE: "dogecoin",
  ADA: "cardano",
  LINK: "chainlink",
  BCH: "bitcoin-cash",
  TON: "the-open-network",
  LTC: "litecoin",
  AVAX: "avalanche-2",
  SHIB: "shiba-inu",
  DOT: "polkadot",
  UNI: "uniswap",
  AAVE: "aave",
  ATOM: "cosmos",
  FIL: "filecoin",
  INJ: "injective-protocol",
  FET: "fetch-ai",
  CAKE: "pancakeswap-token",
  FLOKI: "floki",
  PENDLE: "pendle",
  TWT: "trust-wallet-token",
  AXL: "axelar",
  KAVA: "kava",
  SUSHI: "sushi",
  DUSK: "dusk-network",
  ZIL: "zilliqa",
};

const CG_DEMO_BASE = "https://api.coingecko.com/api/v3";
const CG_PRO_BASE = "https://pro-api.coingecko.com/api/v3";
const FGI_URL = "https://api.alternative.me/fng/?limit=0&format=json";
const SPACING_MS = 2200; // demo-key-friendly pacing (~27 req/min)

interface CgSeries {
  prices: [number, number][];
  caps: [number, number][];
  vols: [number, number][];
}

function arg(flag: string, dflt: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<any> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${await res.text().then((t) => t.slice(0, 200))}`);
  return res.json();
}

async function fetchCoinGeckoSeries(id: string, days: number): Promise<CgSeries> {
  const key = process.env.COINGECKO_API_KEY ?? "";
  const params = `vs_currency=usd&days=${days}&interval=daily`;
  const proHeaders: Record<string, string> = key ? { "x-cg-pro-api-key": key } : {};
  const demoHeaders: Record<string, string> = key ? { "x-cg-demo-api-key": key } : {};
  const path = `/coins/${id}/market_chart?${params}`;
  try {
    const d = await fetchJson(`${CG_PRO_BASE}${path}`, proHeaders);
    return { prices: d.prices, caps: d.market_caps, vols: d.total_volumes };
  } catch {
    const d = await fetchJson(`${CG_DEMO_BASE}${path}`, demoHeaders);
    return { prices: d.prices, caps: d.market_caps, vols: d.total_volumes };
  }
}

async function fetchFearGreed(days: number): Promise<Map<string, number>> {
  const d = await fetchJson(FGI_URL, {});
  const map = new Map<string, number>();
  for (const row of d.data ?? []) {
    const date = new Date(Number(row.timestamp) * 1000).toISOString().slice(0, 10);
    map.set(date, Number(row.value));
  }
  return map;
}

/** Resample [ts_ms, v] points to one point per UTC day (last point wins). */
function toDaily(points: [number, number][]): Map<string, number> {
  const map = new Map<string, number>();
  for (const [ts, v] of points) {
    map.set(new Date(ts).toISOString().slice(0, 10), v);
  }
  return map;
}

function toGlobalMetrics(fgi: number): GlobalMetrics {
  return {
    fearGreedIndex: fgi,
    totalMarketCapUsd: 0,
    btcDominance: 0,
    ethDominance: 0,
    totalVolumeUsd: 0,
    lastUpdated: Date.now(),
  };
}

function toDerivatives(): DerivativesMetrics {
  return {
    totalOpenInterestUsd: 0,
    totalVolume24hUsd: 0,
    btcFundingRate: 0,
    ethFundingRate: 0,
    liquidationData: null,
    lastUpdated: Date.now(),
  };
}

async function main() {
  const days = parseInt(arg("--days", "150"), 10);
  const out = resolve(__dirname, arg("--out", "../data/episodes.json"));
  mkdirSync(dirname(out), { recursive: true });

  console.log(`[export] FGI history…`);
  const fgi = await fetchFearGreed(days);

  const symbols = Object.keys(UNIVERSE);
  const priceBySymDate = new Map<string, Map<string, number>>();
  const capBySymDate = new Map<string, Map<string, number>>();
  const volBySymDate = new Map<string, Map<string, number>>();

  for (const [sym, id] of Object.entries(UNIVERSE)) {
    try {
      const s = await fetchCoinGeckoSeries(id, days);
      priceBySymDate.set(sym, toDaily(s.prices));
      capBySymDate.set(sym, toDaily(s.caps));
      volBySymDate.set(sym, toDaily(s.vols));
      console.log(`[export] ${sym} (${id}): ${s.prices.length} points → ${priceBySymDate.get(sym)!.size} days`);
    } catch (e) {
      console.warn(`[export] ${sym} failed: ${(e as Error).message} — skipped`);
    }
    await new Promise((r) => setTimeout(r, SPACING_MS));
  }

  const dateSet = new Set<string>();
  for (const m of priceBySymDate.values()) for (const d of m.keys()) dateSet.add(d);
  const dates = [...dateSet].sort().slice(-days);

  const LOOKBACK = 30;
  const epDays: EpisodeDay[] = [];
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const quotes: TokenQuote[] = [];
    const klines: Record<string, SosovalueKline[]> = {};

    for (const sym of symbols) {
      const pm = priceBySymDate.get(sym);
      const price = pm?.get(date);
      if (price == null) continue;

      const prevDates = dates.slice(Math.max(0, i - LOOKBACK), i + 1);
      const closes = prevDates.map((d) => pm!.get(d)).filter((v): v is number => v != null);
      const price7dAgo = pm!.get(dates[i - 7]) ?? closes[0];
      const price24hAgo = pm!.get(dates[i - 1]) ?? closes[0];

      const pct = (now: number, then: number | undefined) =>
        then && then > 0 ? ((now - then) / then) * 100 : 0;

      quotes.push({
        id: 0,
        name: sym,
        symbol: sym,
        slug: UNIVERSE[sym],
        price,
        volume24h: volBySymDate.get(sym)?.get(date) ?? 0,
        marketCap: capBySymDate.get(sym)?.get(date) ?? 0,
        percentChange1h: 0,
        percentChange24h: pct(price, price24hAgo),
        percentChange7d: pct(price, price7dAgo),
        lastUpdated: date,
      });

      klines[sym] = closes.map((close, j) => ({
        timestamp: Math.floor(new Date(prevDates[j]).getTime() / 1000),
        open: j > 0 ? closes[j - 1] : close,
        high: close * 1.01,
        low: close * 0.99,
        close,
        volume: volBySymDate.get(sym)?.get(prevDates[j]) ?? 0,
      }));
    }

    if (quotes.length === 0) continue;
    const fgiValue = fgi.get(date) ?? null;
    epDays.push({
      date,
      timestamp: new Date(date).getTime(),
      quotes,
      klines,
      // Missing FGI → neutral 50 so regime scoring stays defined.
      regime: scoreMarketRegime(toGlobalMetrics(fgiValue ?? 50), toDerivatives(), null),
      fearGreedIndex: fgiValue,
    });
  }

  const spec: EpisodeSpec = {
    id: `bsc-cg-${dates[0]}_${dates[dates.length - 1]}`,
    symbols: symbols.filter((s) => priceBySymDate.has(s)),
    days: epDays,
    source: "coingecko",
    split: "full",
  };

  writeFileSync(out, JSON.stringify([spec], null, 1));
  console.log(`[export] wrote ${epDays.length} days × ${spec.symbols.length} symbols → ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
