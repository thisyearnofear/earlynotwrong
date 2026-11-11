/**
 * RYO-CHAN Data Source Adapter (Harness Domain: ryo)
 *
 * Maps RYO-CHAN's published research tools to the harness DataSource
 * interface, following the guide's research funnel:
 *
 *   scan_market → analyze_token per candidate → deep_analysis on the
 *   shortlist → compare_tokens head-to-head → monitor_market_sentiment_shift
 *   (+ market_overview for regime context)
 *
 * Contract discipline (docs/MCP-Builder-Guide.md):
 *   - Envelope `status` (ok/partial/unavailable) travels in metadata.toolStatus
 *     — degraded evidence is disclosed, never silently zeroed.
 *   - Fields that fail to extract land in metadata.missingFields — the
 *     conviction scorer and jury see "missing", not a fabricated 0.
 *   - Internal app routes (market_intelligence universe fallback, OHLCV
 *     klines) are labeled evidence — they are outside the published six.
 */

import type { DataSource } from "./data-source.js";
import type { Kline, MarketSignal, SignalRequest } from "./types.js";
import { RyoClient, type ToolResult, type ToolStatus } from "./ryo-client.js";
import { sha256 } from "./ryo-ledger.js";

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
  const missingFields: string[] = [];
  const grab = (field: string, ...keys: string[]): number => {
    const v = num(src, ...keys);
    if (v === undefined) missingFields.push(field);
    return v ?? 0;
  };
  return {
    symbol,
    name: (item.name as string) ?? symbol,
    price: grab("price", "price_usd", "price", "usd"),
    priceChange24hPercent: grab("priceChange24hPercent", "pct_24h", "percent_change_24h", "change_24h", "h24"),
    priceChange7dPercent: grab("priceChange7dPercent", "pct_7d", "percent_change_7d", "change_7d", "d7", "7d"),
    volume24h: grab("volume24h", "volume_24h", "volume", "liquidity"),
    marketCap: grab("marketCap", "market_cap", "mcap"),
    metadata: { raw: item, missingFields },
  };
}

/** Jury-facing context fetched after deterministic scoring — the richest
 *  evidence RYO publishes, attached per-candidate and globally. */
export interface RyoJuryContext {
  /** Per-symbol deep_analysis envelope data + status (undefined = call failed). */
  deep: Map<string, { data: unknown; status: ToolStatus; digest: string }>;
  compare: { data: unknown; status: ToolStatus; digest: string } | null;
  sentiment: { data: unknown; status: ToolStatus; digest: string } | null;
}

export async function fetchRyoJuryContext(
  client: RyoClient,
  symbols: string[],
): Promise<RyoJuryContext> {
  const ctx: RyoJuryContext = { deep: new Map(), compare: null, sentiment: null };

  const [sentiment, compare] = await Promise.all([
    client.tool("monitor_market_sentiment_shift", {}).catch(() => null),
    symbols.length >= 2
      ? client.tool("compare_tokens", { symbols: symbols.slice(0, 4).join(","), intent: "swing" }).catch(() => null)
      : Promise.resolve(null),
  ]);
  if (sentiment) ctx.sentiment = { data: sentiment.data, status: sentiment.status, digest: digest(sentiment) };
  if (compare) ctx.compare = { data: compare.data, status: compare.status, digest: digest(compare) };

  for (const symbol of symbols.slice(0, 4)) {
    const deep = await client.tool("deep_analysis", { symbol }).catch(() => null);
    if (deep) ctx.deep.set(symbol.toUpperCase(), { data: deep.data, status: deep.status, digest: digest(deep) });
  }
  return ctx;
}

export function createRyoDataAdapter(client: RyoClient = new RyoClient()): DataSource {
  return {
    async fetchSignals(config: SignalRequest): Promise<MarketSignal[]> {
      // Published funnel step 1: scan_market for the research shortlist.
      // Internal fallback: /market/intelligence readiness[] is the broad
      // scored universe when the scan is empty in RISK_OFF regimes.
      const [scan, intel] = await Promise.all([
        client.tool("scan_market", { top_n: config.limit ?? 12 }),
        client.tool("market_intelligence"),
      ]);
      if (!scan.ok && !intel.ok) throw new Error(`market scan failed: ${scan.error ?? intel.error}`);

      const intelBody = intel.data as Record<string, unknown> | null;
      const readiness = Array.isArray(intelBody?.readiness) ? (intelBody.readiness as Record<string, unknown>[]) : [];
      let items = scanItems(scan.data);
      const universeSource = items.length ? "scan_market" : "market_intelligence(internal)";
      if (!items.length && readiness.length) items = readiness;

      if (config.symbols?.length) {
        const want = new Set(config.symbols.map((s) => s.toUpperCase()));
        items = items.filter((i) => want.has(symbolOf(i) ?? ""));
      }
      const limit = config.limit ?? 12;

      // Regime context: published market_overview + sentiment shift first,
      // internal intelligence fear/greed as fallback.
      let fearGreed = num(intelBody, "fear", "greed");
      let overviewDigest: string | null = null;
      if (fearGreed === undefined) {
        const overview = await client.tool("market_overview");
        fearGreed = num(overview.data, "fear", "greed");
        if (overview.ok) overviewDigest = digest(overview);
      }

      const signals: MarketSignal[] = [];
      for (const item of items.slice(0, limit)) {
        const symbol = symbolOf(item);
        if (!symbol || /^(USD|USDT|USDC)$/.test(symbol) || item.is_stablecoin === true) continue;
        // Published funnel step 2: analyze_token per candidate.
        const analysis = await client.tool("analyze_token", { symbol });
        const sig = itemToSignal(item, analysis.ok ? analysis.data : undefined);
        if (!sig) continue;
        const a = analysis.data as Record<string, unknown> | null;
        const evidence: Record<string, string> = {
          scan: digest(scan),
          analyze: digest(analysis),
        };
        if (universeSource.startsWith("market_intelligence")) evidence.intelligence = digest(intel);
        if (overviewDigest) evidence.overview = overviewDigest;
        sig.metadata = {
          ...sig.metadata,
          universeSource,
          toolStatus: { scan: scan.status, intelligence: intel.status, analyze: analysis.status },
          safety: a?.safety ?? null,
          rsi14: num(a, "rsi_14", "rsi"),
          emaTrend: (a?.technicals as Record<string, unknown>)?.trend ?? null,
          verdict: a?.verdict ?? item.verdict ?? null,
          evidence,
          fearGreed: fearGreed ?? null,
        };
        if (config.minLiquidityUsd && sig.volume24h < config.minLiquidityUsd) continue;
        signals.push(sig);
      }
      return signals;
    },

    async fetchHistorical(symbol: string, days: number): Promise<Kline[]> {
      // OHLCV is an internal app route — no published tool covers klines.
      const r = await client.tool("ohlcv", { symbol, days });
      const body = r.data as Record<string, unknown> | unknown[] | null;
      const rows: unknown[] = Array.isArray(body) ? body : Array.isArray((body as Record<string, unknown>)?.candles) ? ((body as Record<string, unknown>).candles as unknown[]) : [];
      return rows
        .map((c): Kline | null => {
          const o = c as Record<string, unknown>;
          if (!o || typeof o !== "object") return null;
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
      const h = await client.health();
      if (h.ok) return true;
      // published health down ≠ internal routes down
      const r = await client.tool("market_overview");
      return r.ok;
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
