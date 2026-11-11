/**
 * RYO-CHAN Data Source Adapter (Harness Domain: ryo)
 *
 * Maps RYO-CHAN's read-only research tools to the harness DataSource
 * interface. `scan_market` produces the tradable universe; `analyze_token`
 * enriches signals with per-token evidence; `market/ohlcv` provides klines.
 * `check_safety` output rides along in `signal.metadata.safety` so the
 * conviction adapter can apply the honeypot veto.
 *
 * Everything is real live data from RYO-CHAN — nothing is synthesized.
 */

import type { DataSource } from "./data-source.js";
import type { Kline, MarketSignal, SignalRequest } from "./types.js";
import { RyoClient, type ToolResult } from "./ryo-client.js";
import { sha256 } from "./ryo-ledger.js";

const API_BASE = process.env.RYO_API_BASE ?? "https://app-ryochan.com/api";

/** Depth-first search for the first numeric field matching any key fragment (coerces numeric strings — RYO returns them). */
function num(obj: unknown, ...keys: string[]): number | undefined {
  if (obj == null || typeof obj !== "object") return undefined;
  const stack: unknown[] = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (cur && typeof cur === "object" && !Array.isArray(cur)) {
      for (const [k, v] of Object.entries(cur as Record<string, unknown>)) {
        const match = keys.some((f) => k.toLowerCase().includes(f));
        if (match) {
          const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : undefined;
          if (n !== undefined && Number.isFinite(n)) return n;
          // key matches but value is an object like { value: 26, label: "fear" }
          if (v && typeof v === "object" && !Array.isArray(v)) {
            const inner = (v as Record<string, unknown>).value ?? (v as Record<string, unknown>).score;
            if (typeof inner === "number" && Number.isFinite(inner)) return inner;
            if (typeof inner === "string" && !Number.isNaN(Number(inner))) return Number(inner);
          }
        }
        if (v && typeof v === "object") stack.push(v);
      }
    }
  }
  return undefined;
}

function symbolOf(item: Record<string, unknown>): string | null {
  const s = item.symbol ?? item.ticker ?? item.slug;
  return typeof s === "string" && s.length > 0 && s.length <= 14 ? s.toUpperCase() : null;
}

/** Extract candidate token rows from a scan_market payload (shape-tolerant). */
function scanItems(data: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const stack: unknown[] = [data];
  while (stack.length) {
    const cur = stack.pop();
    if (Array.isArray(cur)) {
      for (const v of cur) {
        if (v && typeof v === "object" && symbolOf(v as Record<string, unknown>)) {
          out.push(v as Record<string, unknown>);
        } else if (v && typeof v === "object") stack.push(v);
      }
    } else if (cur && typeof cur === "object") {
      for (const v of Object.values(cur as Record<string, unknown>)) stack.push(v);
    }
  }
  return out;
}

function itemToSignal(item: Record<string, unknown>, analysis?: unknown): MarketSignal | null {
  const symbol = symbolOf(item);
  if (!symbol) return null;
  const src = analysis && typeof analysis === "object" ? analysis : item;
  return {
    symbol,
    name: (item.name as string) ?? symbol,
    price: num(src, "price_usd", "price", "usd") ?? 0,
    priceChange24hPercent: num(src, "pct_24h", "percent_change_24h", "change_24h", "h24") ?? 0,
    priceChange7dPercent: num(src, "pct_7d", "percent_change_7d", "change_7d", "d7", "7d") ?? 0,
    volume24h: num(src, "volume_24h", "volume", "liquidity") ?? 0,
    marketCap: num(src, "market_cap", "mcap") ?? 0,
    metadata: { raw: item },
  };
}

export function createRyoDataAdapter(client: RyoClient = new RyoClient()): DataSource {
  return {
    async fetchSignals(config: SignalRequest): Promise<MarketSignal[]> {
      // scan_market's candidate list is often empty in RISK_OFF regimes —
      // /market/intelligence readiness[] is the full scored universe.
      const [scan, intel] = await Promise.all([client.tool("scan_market"), client.tool("market_intelligence")]);
      if (!scan.ok && !intel.ok) throw new Error(`market scan failed: ${scan.error ?? intel.error}`);

      const intelBody = intel.data as Record<string, unknown> | null;
      const readiness = Array.isArray(intelBody?.readiness) ? (intelBody.readiness as Record<string, unknown>[]) : [];
      let items = scanItems(scan.data);
      if (!items.length && readiness.length) items = readiness;

      if (config.symbols?.length) {
        const want = new Set(config.symbols.map((s) => s.toUpperCase()));
        items = items.filter((i) => want.has(symbolOf(i) ?? ""));
      }
      const limit = config.limit ?? 12;
      const fearGreed = num(intelBody ?? (await client.tool("market_overview")).data, "fear", "greed");

      const signals: MarketSignal[] = [];
      for (const item of items.slice(0, limit)) {
        const symbol = symbolOf(item);
        if (!symbol || /^(USD|USDT|USDC)$/.test(symbol) || item.is_stablecoin === true) continue;
        // analyze_token returns token data + embedded safety gate in one call.
        const analysis = await client.tool("analyze_token", { symbol });
        const sig = itemToSignal(item, analysis.ok ? analysis.data : undefined);
        if (!sig) continue;
        const a = analysis.data as Record<string, unknown> | null;
        sig.metadata = {
          ...sig.metadata,
          safety: a?.safety ?? null,
          rsi14: num(a, "rsi_14", "rsi"),
          emaTrend: (a?.technicals as Record<string, unknown>)?.trend ?? null,
          verdict: a?.verdict ?? item.verdict ?? null,
          evidence: { scan: digest(scan), intelligence: digest(intel), analyze: digest(analysis) },
          fearGreed: fearGreed ?? null,
        };
        if (config.minLiquidityUsd && sig.volume24h < config.minLiquidityUsd) continue;
        signals.push(sig);
      }
      return signals;
    },

    async fetchHistorical(symbol: string, days: number): Promise<Kline[]> {
      const res = await fetch(`${API_BASE}/market/ohlcv/${encodeURIComponent(symbol.toUpperCase())}?days=${days}`, {
        headers: { Authorization: `Bearer ${process.env.RYO_MCP_KEY ?? ""}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return [];
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | unknown[] | null;
      const rows: unknown[] = Array.isArray(body) ? body : Array.isArray((body as Record<string, unknown>)?.candles) ? ((body as Record<string, unknown>).candles as unknown[]) : [];
      return rows
        .map((c): Kline | null => {
          const o = c as Record<string, unknown>;
          if (!o || typeof o !== "object") return null;
          // RYO candles: { ts: ISO string, open/high/low/close/volume: string }
          const rawTs = o.ts ?? o.timestamp ?? o.time ?? o.date;
          const timestamp = typeof rawTs === "number" ? (rawTs > 1e12 ? rawTs / 1000 : rawTs) : typeof rawTs === "string" ? Date.parse(rawTs) / 1000 : 0;
          if (!timestamp || Number.isNaN(timestamp)) return null;
          return {
            timestamp,
            open: num(o, "open") ?? 0,
            high: num(o, "high") ?? 0,
            low: num(o, "low") ?? 0,
            close: num(o, "close") ?? 0,
            volume: num(o, "volume") ?? 0,
          };
        })
        .filter((k): k is Kline => k !== null);
    },

    async healthCheck(): Promise<boolean> {
      try {
        const r = await client.tool("market_overview");
        return r.ok;
      } catch {
        return false;
      }
    },
  };
}

function digest(r: ToolResult): string {
  return `${r.tool}:${r.transport}:${sha256(JSON.stringify(r.data)).slice(0, 12)}`;
}

let _instance: DataSource | null = null;
export function getRyoDataAdapter(): DataSource {
  if (!_instance) _instance = createRyoDataAdapter();
  return _instance;
}
