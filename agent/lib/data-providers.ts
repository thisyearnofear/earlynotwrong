/**
 * Data Providers — composite market data sources.
 *
 * Merged from:
 *   - cmc-client.ts       — CMC Pro REST API client (Global Metrics, Fear & Greed, derivatives)
 *   - sosovalue-client.ts — SoSoValue OpenAPI client (token prices, index data, news, macro events)
 *
 * Both implement MarketDataProvider. SoSoValue token prices are preferred;
 * CMC fills regime data gaps (Fear & Greed, funding rates) that SoSoValue
 * doesn't offer.
 *
 * Exports: CmcClient, SosovalueClient, cmcClient, sosovalueClient + all types.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_CONFIG } from "./config.js";
import type { MarketDataProvider } from "./agent-state.js";

// =============================================================================
// Shared Types (compatible with both providers)
// =============================================================================

/** Token symbol → CMC ID lookup map. */
export interface CmcIdMap {
  [symbol: string]: number;
}

/** Aggregate market-wide metrics from the CMC global-metrics endpoint. */
export interface GlobalMetrics {
  /** Total crypto market cap in USD. */
  totalMarketCapUsd: number;
  /** BTC dominance percentage (0–100). */
  btcDominance: number;
  /** ETH dominance percentage (0–100). */
  ethDominance: number;
  /** Fear & Greed Index (0–100; 0 = extreme fear, 100 = extreme greed). */
  fearGreedIndex: number;
  /** 24h global trading volume in USD. */
  totalVolumeUsd: number;
  /** Unix ms timestamp of the last update. */
  lastUpdated: number;
}

/**
 * Derivatives market metrics from CMC's v5 endpoint — funding rates and
 * open interest for BTC and ETH perpetual futures.
 */
export interface DerivativesMetrics {
  /** Aggregate open interest across BTC + ETH perpetuals in USD. */
  totalOpenInterestUsd: number;
  /** Aggregate 24h volume across BTC + ETH perpetuals in USD. */
  totalVolume24hUsd: number;
  /** BTC perpetual funding rate (decimal, e.g. 0.0001 = 0.01%). */
  btcFundingRate: number;
  /** ETH perpetual funding rate (decimal). */
  ethFundingRate: number;
  /** Liquidation data (not available via CMC REST — always null). */
  liquidationData: { longLiquidations24h: number; shortLiquidations24h: number } | null;
  /** Unix ms timestamp of the last update. */
  lastUpdated: number;
}

/**
 * Price quote for a single token from either CMC or SoSoValue.
 * Normalized format shared across all data providers.
 */
export interface TokenQuote {
  /** Numeric ID (CMC ID or hashed SoSoValue ID). */
  id: number;
  /** Token display name. */
  name: string;
  /** Uppercase trading symbol (e.g. "BTC"). */
  symbol: string;
  /** URL-safe slug (e.g. "bitcoin"). */
  slug: string;
  /** Current USD price. */
  price: number;
  /** 24h trading volume in USD. */
  volume24h: number;
  /** Market capitalization in USD. */
  marketCap: number;
  /** 1-hour percent price change. */
  percentChange1h: number;
  /** 24-hour percent price change. */
  percentChange24h: number;
  /** 7-day percent price change. */
  percentChange7d: number;
  /** ISO timestamp of the quote (empty if unavailable). */
  lastUpdated: string;
}

/** Token-level metrics from CMC's token-holder endpoint. */
export interface TokenMetrics {
  id: number;
  symbol: string;
  /** Total number of token holders. */
  holderCount: number;
  /** Number of whale holders (large-balance addresses). */
  whaleHolderCount: number;
  /** Whale-held share of total supply (0–100). */
  whalePercentOfSupply: number;
  /** Average balance across all holders in USD. */
  averageHolderBalance: number;
}

/** A trending narrative on CMC (e.g. "AI", "DeFi", "Meme"). */
export interface TrendingNarrative {
  name: string;
  description: string;
  /** 24h volume attributed to this narrative in USD. */
  volume24h: number;
  /** 24h percent change. */
  percentChange24h: number;
  /** Top coins associated with this narrative. */
  topCoins: Array<{ id: number; symbol: string; name: string }>;
}

/**
 * Composite market data snapshot for a cycle, aggregated from CMC and
 * SoSoValue sources. The agent fetches this once per cycle and distributes
 * the data to the conviction engine, position manager, and anchors.
 */
export interface CmcMarketData {
  /** Global market metrics (FGI, market cap) — CMC primary, null if unavailable. */
  globalMetrics: GlobalMetrics | null;
  /** Derivatives metrics (funding rates, OI) — CMC v5 only, null if unavailable. */
  derivatives: DerivativesMetrics | null;
  /** Price quotes for eligible tokens (SoSoValue preferred, CMC fills gaps). */
  tokenPrices: TokenQuote[];
  /** Token holder metrics (not available via CMC REST — always empty). */
  tokenHolders: TokenMetrics[];
  /** Trending narratives (not available via CMC REST — always empty). */
  trendingNarratives: TrendingNarrative[];
}

// =============================================================================
// Helpers
// =============================================================================

function safeNumber(value: unknown, fallback: number = 0): number {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "number" && !Number.isNaN(val)) return val;
  }
  return undefined;
}

function hashStringToNumber(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

// =============================================================================
// CMC REST Client — CoinMarketCap Pro API
// =============================================================================

const CMC_BASE_URL = "https://pro-api.coinmarketcap.com";

async function cmcRestGet<T = Record<string, unknown>>(path: string, apiKey: string): Promise<T | null> {
  try {
    const response = await fetch(`${CMC_BASE_URL}${path}`, {
      headers: { "X-CMC_PRO_API_KEY": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      console.warn(`CMC REST error ${response.status} for ${path}: ${response.statusText}`);
      return null;
    }
    const json = (await response.json()) as { data?: unknown } | unknown;
    const payload = "data" in (json as object) ? (json as { data: unknown }).data : json;
    return payload as T;
  } catch (error) {
    console.warn(`CMC REST request failed for ${path}:`, error);
    return null;
  }
}

async function fetchFearGreedFromCmc(apiKey: string): Promise<number> {
  try {
    const data = await cmcRestGet<{ value: number; value_classification: string }>("/v3/fear-and-greed/latest", apiKey);
    if (data && typeof data.value === "number") return Math.max(0, Math.min(100, data.value));
    return 50;
  } catch {
    return 50;
  }
}

async function fetchDerivativesMetrics(apiKey: string): Promise<DerivativesMetrics | null> {
  try {
    const [btcResult, ethResult] = await Promise.all([
      cmcRestGet<Record<string, unknown>>("/v5/cryptocurrency/derivatives/market-pairs/list/latest?crypto_symbol=BTC&limit=1", apiKey),
      cmcRestGet<Record<string, unknown>>("/v5/cryptocurrency/derivatives/market-pairs/list/latest?crypto_symbol=ETH&limit=1", apiKey),
    ]);
    const btcPairs = (btcResult?.market_pairs as Array<Record<string, unknown>> | undefined) ?? [];
    const ethPairs = (ethResult?.market_pairs as Array<Record<string, unknown>> | undefined) ?? [];
    const btcFundingRate = extractFundingRate(btcPairs);
    const ethFundingRate = extractFundingRate(ethPairs);
    const totalOpenInterest = extractOpenInterest(btcPairs) + extractOpenInterest(ethPairs);
    const totalVolume = extractVolume24h(btcPairs) + extractVolume24h(ethPairs);
    return { totalOpenInterestUsd: totalOpenInterest, totalVolume24hUsd: totalVolume, btcFundingRate, ethFundingRate, liquidationData: null, lastUpdated: Date.now() };
  } catch { return null; }
}

function extractFundingRate(pairs: Array<Record<string, unknown>>): number {
  for (const pair of pairs) {
    const quotes = pair.exchange_reported_quotes as Array<Record<string, unknown>> | undefined;
    if (quotes?.length) { const r = safeNumber(quotes[0].funding_rate); if (r !== 0) return r; }
  }
  return 0;
}

function extractOpenInterest(pairs: Array<Record<string, unknown>>): number {
  for (const pair of pairs) {
    const quotes = pair.exchange_reported_quotes as Array<Record<string, unknown>> | undefined;
    if (quotes?.length) { const oi = safeNumber(quotes[0].open_interest); if (oi > 0) return oi; }
  }
  return 0;
}

function extractVolume24h(pairs: Array<Record<string, unknown>>): number {
  for (const pair of pairs) {
    const quotes = pair.exchange_reported_quotes as Array<Record<string, unknown>> | undefined;
    if (quotes?.length) { const v = safeNumber(quotes[0].volume_24h_quote ?? quotes[0].volume_24h); if (v > 0) return v; }
  }
  return 0;
}

const TOKEN_ID_CACHE = new Map<string, number>();

async function resolveTokenId(symbol: string, apiKey: string): Promise<number | null> {
  const upper = symbol.toUpperCase();
  if (TOKEN_ID_CACHE.has(upper)) return TOKEN_ID_CACHE.get(upper)!;
  const result = await cmcRestGet<Array<{ id: number; symbol: string }>>(`/v1/cryptocurrency/map?symbol=${encodeURIComponent(symbol)}&limit=1`, apiKey);
  if (Array.isArray(result) && result.length > 0 && result[0]?.id) {
    TOKEN_ID_CACHE.set(upper, result[0].id);
    return result[0].id;
  }
  return null;
}

function parseTokenQuote(data: unknown): TokenQuote | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (!d.id && !d.symbol) return null;
  let quote: Record<string, unknown> | undefined;
  if (d.quote && typeof d.quote === "object") {
    const q = d.quote as Record<string, unknown>;
    quote = (q.USD as Record<string, unknown> | undefined) ?? q;
  }
  return {
    id: Number(d.id || 0), name: String(d.name || ""), symbol: String(d.symbol || ""), slug: String(d.slug || ""),
    price: safeNumber(quote?.price), volume24h: safeNumber(quote?.volume_24h ?? quote?.volume24h),
    marketCap: safeNumber(quote?.market_cap ?? quote?.marketCap),
    percentChange1h: safeNumber(quote?.percent_change_1h ?? quote?.percentChange1h),
    percentChange24h: safeNumber(quote?.percent_change_24h ?? quote?.percentChange24h),
    percentChange7d: safeNumber(quote?.percent_change_7d ?? quote?.percentChange7d),
    lastUpdated: String(quote?.last_updated ?? quote?.lastUpdated ?? ""),
  };
}

/**
 * CMC Pro REST API client.
 *
 * Fetches global market metrics, Fear & Greed Index, derivatives data
 * (funding rates), and per-token price quotes from the CoinMarketCap
 * Pro API. All methods are resilient — returns null on failure and logs
 * warnings rather than throwing.
 */
export class CmcClient implements MarketDataProvider {
  readonly name = "cmc" as const;
  private apiKey: string;

  /** @param options.apiKey — CMC Pro API key. Falls back to CMC_API_KEY env var. */
  constructor(options: { apiKey?: string } = {}) { this.apiKey = options.apiKey || process.env.CMC_API_KEY || ""; }

  /** Fetch current USD price for a token symbol. Returns 0 if unavailable. */
  async fetchTokenPrice(symbol: string): Promise<number> { const q = await this.getQuote(symbol); return q?.price ?? 0; }

  /** Fetch Fear & Greed Index (0–100) from CMC v3 endpoint. Returns 50 on failure. */
  async fetchFearGreedIndex(): Promise<number> { return fetchFearGreedFromCmc(this.apiKey); }

  /** Fetch BTC and ETH perpetual funding rates. Returns {} on failure. */
  async fetchFundingRates(): Promise<Record<string, number>> { const d = await this.getDerivativesMetrics(); return d ? { BTC: d.btcFundingRate, ETH: d.ethFundingRate } : {}; }

  /**
   * Fetch all market data the agent needs: global metrics, derivatives, and
   * token prices. Note: token holders and trending narratives are not
   * available via the CMC REST API and return empty arrays.
   */
  async fetchMarketData(): Promise<CmcMarketData> {
    const [globalMetrics, derivatives, tokenPrices] = await Promise.all([this.getGlobalMetrics(), this.getDerivativesMetrics(), this.getEligibleTokenQuotes()]);
    return { globalMetrics, derivatives, tokenPrices, tokenHolders: [], trendingNarratives: [] };
  }

  /**
   * Fetch only the global/derivative data SoSoValue can't provide
   * (global metrics, Fear & Greed, funding rates). Skips the per-token
   * quote pull so the agent doesn't spend CMC credits on a 147-token batch
   * that SoSoValue already covers. Token prices are fetched separately via
   * getEligibleTokenQuotes() only when SoSoValue returns no prices.
   */
  async fetchGlobalData(): Promise<CmcMarketData> {
    const [globalMetrics, derivatives] = await Promise.all([this.getGlobalMetrics(), this.getDerivativesMetrics()]);
    return { globalMetrics, derivatives, tokenPrices: [], tokenHolders: [], trendingNarratives: [] };
  }

  /** Fetch global market cap, BTC/ETH dominance, and FGI from CMC v1 + v3. */
  async getGlobalMetrics(): Promise<GlobalMetrics | null> {
    const [data, fearGreedIndex] = await Promise.all([cmcRestGet<Record<string, unknown>>("/v1/global-metrics/quotes/latest", this.apiKey), fetchFearGreedFromCmc(this.apiKey)]);
    if (!data) return null;
    const quote = (data.quote as Record<string, unknown>)?.USD as Record<string, unknown> | undefined;
    return { totalMarketCapUsd: safeNumber(quote?.total_market_cap ?? data.total_market_cap), btcDominance: safeNumber(data.btc_dominance), ethDominance: safeNumber(data.eth_dominance), fearGreedIndex, totalVolumeUsd: safeNumber(quote?.total_volume_24h ?? data.total_volume_24h), lastUpdated: Date.now() };
  }

  /** Fetch BTC + ETH funding rates and open interest from CMC v5 derivatives endpoint. */
  async getDerivativesMetrics(): Promise<DerivativesMetrics | null> { return fetchDerivativesMetrics(this.apiKey); }

  /**
   * Get a price quote for a specific token by symbol.
   * Resolves the symbol to a CMC ID first, then fetches the latest quote.
   */
  async getQuote(symbol: string): Promise<TokenQuote | null> {
    if (!symbol) return null;
    const id = await resolveTokenId(symbol, this.apiKey);
    if (!id) return null;
    const result = await cmcRestGet<Record<string, unknown>>(`/v1/cryptocurrency/quotes/latest?id=${id}`, this.apiKey);
    if (!result) return null;
    const data = result[String(id)] as Record<string, unknown> | undefined;
    return data ? parseTokenQuote(data) : null;
  }

  /**
   * Fetch price quotes for all competition-eligible tokens in batches of 100.
   * Uses symbol-based lookup to batch multiple tokens per request (CMC limit).
   */
  async getEligibleTokenQuotes(): Promise<TokenQuote[]> {
    const symbols = AGENT_CONFIG.competition.eligibleTokens;
    const quotes: TokenQuote[] = [];
    for (let i = 0; i < symbols.length; i += 100) {
      const batch = symbols.slice(i, i + 100);
      const result = await cmcRestGet<Record<string, unknown>>(`/v1/cryptocurrency/quotes/latest?symbol=${batch.map(s => encodeURIComponent(s)).join(",")}`, this.apiKey);
      if (result && typeof result === "object") {
        for (const symbol of batch) { const d = result[symbol] as Record<string, unknown> | undefined; if (d) { const q = parseTokenQuote(d); if (q) quotes.push(q); } }
      }
    }
    return quotes;
  }

  /** Token holder metrics are not available via CMC REST. Always returns null. */
  async getTokenMetrics(_symbol: string): Promise<TokenMetrics | null> { return null; }
  /** Trending narratives are not available via CMC REST. Always returns []. */
  async getTrendingNarratives(): Promise<TrendingNarrative[]> { return []; }

  /** Verify connectivity to the CMC REST API by fetching global metrics. */
  async healthCheck(): Promise<boolean> {
    try {
      const data = await cmcRestGet<Record<string, unknown>>("/v1/global-metrics/quotes/latest", this.apiKey);
      if (data) console.log("[CMC] Connected via REST API");
      return data !== null;
    } catch { return false; }
  }
}

/** Singleton CMC client instance. Reads CMC_API_KEY from the environment. */
export const cmcClient = new CmcClient();

// =============================================================================
// SoSoValue REST Client — token prices, index data, news, macro events
// =============================================================================

/** A listed currency on SoSoValue. */
export interface SosovalueCurrency {
  /** SoSoValue internal currency ID. */
  id?: string;
  /** SoSoValue internal currency ID (alternate field name returned by /currencies). */
  currency_id?: string;
  symbol: string;
  name: string;
  /** Optional market cap rank. */
  market_cap_rank?: number;
  /** Number of tracked trading pairs (liquidity proxy). */
  pair_count?: number;
}

/** Live market snapshot for a single currency from SoSoValue. */
export interface SosovalueMarketSnapshot {
  id: string;
  symbol: string;
  name: string;
  last_updated?: string;
  price_usd?: number;
  market_cap_usd?: number;
  volume_24h_usd?: number;
  percent_change_1h?: number;
  percent_change_24h?: number;
  percent_change_7d?: number;
  circulating_supply?: number;
  total_supply?: number;
  pair_count?: number;
}

/** OHLCV kline data point from SoSoValue. */
export interface SosovalueKline {
  /** Unix timestamp in seconds. */
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** A SoSoValue Index (SSI) — curated token basket. */
export interface SosovalueIndex {
  ticker: string;
  name: string;
  description?: string;
  /** Number of constituent tokens. */
  constituent_count?: number;
  methodology?: string;
}

/** Market snapshot for a SoSoValue Index. */
export interface SosovalueIndexSnapshot {
  ticker: string;
  name: string;
  price?: number;
  percent_change_24h?: number;
  percent_change_7d?: number;
  market_cap_usd?: number;
  volume_24h_usd?: number;
  last_updated?: string;
}

/** A constituent token inside a SoSoValue Index. */
export interface SosovalueIndexConstituent {
  currency_id: string;
  symbol: string;
  name: string;
  /** Weight in the index (0–1 or percentage). */
  weight: number;
  price_usd?: number;
}

/** A news feed item from SoSoValue. */
export interface SosovalueFeedItem {
  id: string;
  title: string;
  /** ISO timestamp of publication. */
  published_at: string;
  summary?: string;
  /** Source name (e.g. "CoinDesk", "X/Twitter"). */
  source?: string;
  url?: string;
  /** Related currency symbols mentioned in the article. */
  related_currencies?: string[];
  sentiment?: "positive" | "negative" | "neutral";
}

/** A macro-economic event from the SoSoValue calendar. */
export interface SosovalueMacroEvent {
  id: string;
  name: string;
  /** ISO date of the event. */
  date: string;
  description?: string;
  /** Category (e.g. "CPI", "FOMC", "Employment"). */
  category?: string;
  previous?: string;
  forecast?: string;
  actual?: string;
  impact?: "high" | "medium" | "low";
}

const SSV_DEFAULT_BASE_URL = "https://openapi.sosovalue.com/openapi/v1";

// Persistent cache for SoSoValue: avoids cold-start bursts after deploys/restarts.
// Stored in AGENT_DATA_DIR (or <cwd>/data) next to state.json. Cache entries are
// TTL'd at read time, not written time, so stale-but-recent data is reusable.
const SSV_CACHE_FILE = "sosovalue-cache.json";

function getSsvDataDir(): string | null {
  const dir = process.env.AGENT_DATA_DIR || join(process.cwd(), "data");
  if (!existsSync(dir)) {
    if (process.env.AGENT_DATA_DIR) {
      try { mkdirSync(dir, { recursive: true }); } catch { return null; }
    } else {
      // No explicit data dir and default doesn't exist — skip disk persistence
      // (typical in tests or fresh clones) rather than creating files everywhere.
      return null;
    }
  }
  return dir;
}

interface SsvPersistentCache {
  currencyIdCache: Array<[string, { id: string; symbol: string; name?: string }]> | null;
  currencyCacheLastFetched: number;
  snapshotCache: Array<[string, { snapshot: SosovalueMarketSnapshot; fetchedAt: number }]> | null;
  klineCache: Array<[string, { klines: SosovalueKline[]; fetchedAt: number }]> | null;
  hotNewsCache: { items: SosovalueFeedItem[]; fetchedAt: number } | null;
  featuredNewsCache: { items: SosovalueFeedItem[]; fetchedAt: number } | null;
  macroEventsCache: { items: SosovalueMacroEvent[]; fetchedAt: number; dateKey: string } | null;
  indexListCache: { items: SosovalueIndex[]; fetchedAt: number } | null;
  indexSnapshotCache: Array<[string, { snapshot: SosovalueIndexSnapshot; fetchedAt: number }]> | null;
  indexConstituentCache: Array<[string, { constituents: SosovalueIndexConstituent[]; fetchedAt: number }]> | null;
}

function loadSsvCache(): SsvPersistentCache | null {
  const dir = getSsvDataDir();
  if (!dir) return null;
  const path = join(dir, SSV_CACHE_FILE);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SsvPersistentCache;
  } catch {
    return null;
  }
}

function saveSsvCache(cache: SsvPersistentCache): void {
  const dir = getSsvDataDir();
  if (!dir) return;
  try {
    writeFileSync(join(dir, SSV_CACHE_FILE), JSON.stringify(cache), "utf-8");
  } catch (err) {
    console.warn("[SoSoValue] Failed to persist cache:", (err as Error)?.message || String(err));
  }
}

const SSV_RATE_LIMIT_PER_MIN = 20;
const SSV_RATE_LIMIT_CAPACITY = SSV_RATE_LIMIT_PER_MIN;
const SSV_REFILL_MS_PER_TOKEN = 60_000 / SSV_RATE_LIMIT_PER_MIN;

let ssvBucketTokens = SSV_RATE_LIMIT_CAPACITY;
let ssvBucketLast = Date.now();
let ssvBucketChain: Promise<void> = Promise.resolve();

async function ssvThrottle(): Promise<void> {
  const run = ssvBucketChain.then(async () => {
    for (;;) {
      const now = Date.now();
      const elapsed = now - ssvBucketLast;
      ssvBucketTokens = Math.min(SSV_RATE_LIMIT_CAPACITY, ssvBucketTokens + elapsed / SSV_REFILL_MS_PER_TOKEN);
      ssvBucketLast = now;
      if (ssvBucketTokens >= 1) {
        ssvBucketTokens -= 1;
        return;
      }
      await new Promise((r) => setTimeout(r, (1 - ssvBucketTokens) * SSV_REFILL_MS_PER_TOKEN));
    }
  });
  ssvBucketChain = run.catch(() => {});
  return run;
}

async function ssvRestGet<T = Record<string, unknown>>(
  path: string,
  apiKey: string,
  baseUrl: string = SSV_DEFAULT_BASE_URL,
  onMeta?: (status: number, headers: Headers) => void,
): Promise<T | null> {
  try {
    await ssvThrottle();
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { "x-soso-api-key": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    onMeta?.(response.status, response.headers);
    if (!response.ok) {
      console.warn(`[SoSoValue] HTTP ${response.status} for ${path}: ${response.statusText}`);
      return null;
    }
    const json = (await response.json()) as Record<string, unknown>;
    if (json && typeof json === "object" && "data" in json) return json.data as T;
    return json as unknown as T;
  } catch (error) {
    console.warn(`[SoSoValue] Request failed for ${path}:`, error);
    return null;
  }
}

function extractList<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    for (const key of ["items", "list", "records"]) {
      const v = (raw as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v as T[];
    }
  }
  return [];
}

function snapshotToTokenQuote(snapshot: { id: string | number; symbol: string; price_usd: number; percent_change_24h: number; percent_change_7d: number; market_cap_usd?: number; volume_24h_usd?: number; percent_change_1h?: number; last_updated?: string }): TokenQuote {
  return { id: typeof snapshot.id === "string" ? hashStringToNumber(snapshot.id) : snapshot.id, name: snapshot.symbol, symbol: snapshot.symbol.toUpperCase(), slug: snapshot.symbol.toLowerCase(), price: snapshot.price_usd, volume24h: snapshot.volume_24h_usd ?? 0, marketCap: snapshot.market_cap_usd ?? 0, percentChange1h: snapshot.percent_change_1h ?? 0, percentChange24h: snapshot.percent_change_24h, percentChange7d: snapshot.percent_change_7d, lastUpdated: snapshot.last_updated ?? "" };
}

/**
 * Normalize a raw SoSoValue kline into the canonical SosovalueKline shape.
 *
 * SoSoValue returns kline timestamps as **strings of milliseconds**
 * (e.g. "1778198400000") despite the interface claiming number-of-seconds,
 * and OHLCV fields arrive as strings too. Downstream consumers assume
 * number seconds — the backtest's date-window matching (`timestamp * 1000 >=
 * dayMs`) silently matches nothing when fed string-ms, producing an empty
 * day series (the "No historical data loaded" bug that only surfaced once
 * the stale-cache fallback let real klines actually reach the backtest).
 *
 * Idempotent: already-normalized fixtures (number seconds) pass through.
 *
 * Second-vs-millisecond threshold: 1e11. In seconds that's AD 5138 (no real
 * timestamp), in milliseconds it's Jan 1973 (impossible for this data), so
 * values ≥ 1e11 are milliseconds and values below are seconds.
 */
export function normalizeKlineTimestamp(ts: number | string): number {
  const n = typeof ts === "string" ? Number(ts) : ts;
  if (!Number.isFinite(n)) return 0;
  return n >= 1e11 ? Math.floor(n / 1000) : n;
}

/** Normalize a kline's timestamp to number-seconds and OHLCV to numbers. */
export function normalizeKline(k: SosovalueKline): SosovalueKline {
  return {
    timestamp: normalizeKlineTimestamp(k.timestamp),
    open: Number(k.open),
    high: Number(k.high),
    low: Number(k.low),
    close: Number(k.close),
    volume: Number(k.volume),
  };
}

/**
 * SoSoValue OpenAPI client.
 *
 * Provides token price quotes (preferred over CMC), currency listing,
 * SSI index data, news feeds, and macro-economic events. Does NOT
 * provide Fear & Greed or funding rates — those fall back to CmcClient.
 *
 * Maintains an internal currency ID cache (5min TTL) for symbol→ID
 * resolution so repeated lookups don't re-fetch the full currency list.
 */
export class SosovalueClient implements MarketDataProvider {
  readonly name = "sosovalue" as const;
  private apiKey: string;
  private baseUrl: string;

  // Circuit breaker / rate-limit protection
  private apiHealthy = true;
  private apiSuspendedUntil = 0;
  private consecutiveFailures = 0;
  private static readonly SUSPENSION_COOLDOWN_MS = 15 * 60 * 1000;
  private static readonly MAX_CONSECUTIVE_FAILURES = 3;

  // Currency ID cache (1h TTL) for symbol→ID resolution. The list changes rarely;
  // we keep it long to avoid a /currencies call on every restart.
  private currencyIdCache = new Map<string, { id: string; symbol: string; name: string }>();
  private currencyCacheLastFetched = 0;
  private static readonly CURRENCY_CACHE_TTL_MS = 60 * 60 * 1000;

  // Market snapshot cache: avoid re-fetching 150+ snapshots every cycle.
  // TTL is intentionally longer than the cycle interval so most cycles hit cache.
  private snapshotCache = new Map<string, { snapshot: SosovalueMarketSnapshot; fetchedAt: number }>();
  private static readonly SNAPSHOT_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h (covers 3 cycles at 4h intervals)

  // Kline cache: daily klines change once per day, so cache until next UTC midnight.
  private klineCache = new Map<string, { klines: SosovalueKline[]; fetchedAt: number }>();
  private static readonly KLINE_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4h (pragmatic)

  // News / macro cache: share between sentiment analysis and narrative generation.
  private hotNewsCache: { items: SosovalueFeedItem[]; fetchedAt: number } | null = null;
  private featuredNewsCache: { items: SosovalueFeedItem[]; fetchedAt: number } | null = null;
  private macroEventsCache: { items: SosovalueMacroEvent[]; fetchedAt: number; dateKey: string } | null = null;
  private static readonly NEWS_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2h
  private static readonly MACRO_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4h

  // Index data caches (used by SSI regime signal every cycle).
  private indexListCache: { items: SosovalueIndex[]; fetchedAt: number } | null = null;
  private indexSnapshotCache = new Map<string, { snapshot: SosovalueIndexSnapshot; fetchedAt: number }>();
  private indexConstituentCache = new Map<string, { constituents: SosovalueIndexConstituent[]; fetchedAt: number }>();
  private static readonly INDEX_LIST_TTL_MS = 60 * 60 * 1000; // 1h
  private static readonly INDEX_SNAPSHOT_TTL_MS = 60 * 60 * 1000; // 1h
  private static readonly INDEX_CONSTITUENT_TTL_MS = 60 * 60 * 1000; // 1h

  // Observability: count actual HTTP requests emitted through this client.
  private apiCallsThisCycle = 0;

  /** @param options.apiKey — SoSoValue API key. Falls back to SOSOVALUE_API_KEY env var. */
  constructor(options: { apiKey?: string; baseUrl?: string } = {}) {
    this.apiKey = options.apiKey || process.env.SOSOVALUE_API_KEY || "";
    this.baseUrl = options.baseUrl || SSV_DEFAULT_BASE_URL;
    this.apiHealthy = Boolean(this.apiKey);
    this.loadCache();
  }

  private saveCacheTimer: NodeJS.Timeout | null = null;
  private pendingSavePayload: SsvPersistentCache | null = null;

  /** Persist all caches to disk so restarts don't trigger cold-start bursts.
   *  Writes are debounced: many rapid cache updates coalesce into one file write.
   */
  private saveCache(): void {
    const payload: SsvPersistentCache = {
      currencyIdCache: this.currencyIdCache.size > 0 ? Array.from(this.currencyIdCache.entries()) : null,
      currencyCacheLastFetched: this.currencyCacheLastFetched,
      snapshotCache: this.snapshotCache.size > 0 ? Array.from(this.snapshotCache.entries()) : null,
      klineCache: this.klineCache.size > 0 ? Array.from(this.klineCache.entries()) : null,
      hotNewsCache: this.hotNewsCache,
      featuredNewsCache: this.featuredNewsCache,
      macroEventsCache: this.macroEventsCache,
      indexListCache: this.indexListCache,
      indexSnapshotCache: this.indexSnapshotCache.size > 0 ? Array.from(this.indexSnapshotCache.entries()) : null,
      indexConstituentCache: this.indexConstituentCache.size > 0 ? Array.from(this.indexConstituentCache.entries()) : null,
    };
    this.pendingSavePayload = payload;
    if (this.saveCacheTimer) return;
    this.saveCacheTimer = setTimeout(() => {
      this.saveCacheTimer = null;
      if (this.pendingSavePayload) {
        saveSsvCache(this.pendingSavePayload);
        this.pendingSavePayload = null;
      }
    }, 500);
    this.saveCacheTimer.unref?.();
  }

  private loadCache(): void {
    const raw = loadSsvCache();
    if (!raw) return;
    const now = Date.now();
    if (raw.currencyCacheLastFetched && raw.currencyIdCache && raw.currencyIdCache.length > 0) {
      this.currencyCacheLastFetched = raw.currencyCacheLastFetched;
      for (const [k, v] of raw.currencyIdCache) this.currencyIdCache.set(k, { id: v.id, symbol: v.symbol, name: v.name ?? "" });
    }
    if (raw.snapshotCache) {
      for (const [k, v] of raw.snapshotCache) {
        if (now - v.fetchedAt < SosovalueClient.SNAPSHOT_CACHE_TTL_MS) this.snapshotCache.set(k, v);
      }
    }
    if (raw.klineCache) {
      for (const [k, v] of raw.klineCache) {
        if (now - v.fetchedAt < SosovalueClient.KLINE_CACHE_TTL_MS) this.klineCache.set(k, v);
      }
    }
    if (raw.hotNewsCache && now - raw.hotNewsCache.fetchedAt < SosovalueClient.NEWS_CACHE_TTL_MS) this.hotNewsCache = raw.hotNewsCache;
    if (raw.featuredNewsCache && now - raw.featuredNewsCache.fetchedAt < SosovalueClient.NEWS_CACHE_TTL_MS) this.featuredNewsCache = raw.featuredNewsCache;
    if (raw.macroEventsCache && now - raw.macroEventsCache.fetchedAt < SosovalueClient.MACRO_CACHE_TTL_MS) this.macroEventsCache = raw.macroEventsCache;
    if (raw.indexListCache && now - raw.indexListCache.fetchedAt < SosovalueClient.INDEX_LIST_TTL_MS) this.indexListCache = raw.indexListCache;
    if (raw.indexSnapshotCache) {
      for (const [k, v] of raw.indexSnapshotCache) {
        if (now - v.fetchedAt < SosovalueClient.INDEX_SNAPSHOT_TTL_MS) this.indexSnapshotCache.set(k, v);
      }
    }
    if (raw.indexConstituentCache) {
      for (const [k, v] of raw.indexConstituentCache) {
        if (now - v.fetchedAt < SosovalueClient.INDEX_CONSTITUENT_TTL_MS) this.indexConstituentCache.set(k, v);
      }
    }
  }

  /** Reset the per-cycle API call counter. Called by the trading loop each cycle. */
  resetApiCallCounter(): void {
    if (this.apiCallsThisCycle > 0) {
      console.log(`[SoSoValue] HTTP requests this cycle: ${this.apiCallsThisCycle}`);
    }
    this.apiCallsThisCycle = 0;
  }

  /** True when the key exists and we haven't tripped the circuit breaker. */
  isAvailable(): boolean {
    return this.apiHealthy && Date.now() > this.apiSuspendedUntil && Boolean(this.apiKey);
  }

  /** Update circuit breaker based on response status. Call after every request. */
  private recordApiCall(status: number): void {
    this.apiCallsThisCycle++;
    if (status >= 200 && status < 300) {
      this.consecutiveFailures = 0;
      this.apiSuspendedUntil = 0;
      return;
    }
    // Treat auth failures and rate limits as key-health issues.
    if (status === 401 || status === 403 || status === 429) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= SosovalueClient.MAX_CONSECUTIVE_FAILURES) {
        this.apiSuspendedUntil = Date.now() + SosovalueClient.SUSPENSION_COOLDOWN_MS;
        console.warn(`[SoSoValue] Suspending API calls for ${SosovalueClient.SUSPENSION_COOLDOWN_MS / 60000} min after ${this.consecutiveFailures} consecutive failures (HTTP ${status}).`);
      }
    }
  }

  /** Fetch current USD price for a symbol. Returns 0 if unavailable. */
  async fetchTokenPrice(symbol: string): Promise<number> { const q = await this.getQuote(symbol); return q?.price ?? 0; }
  /** SoSoValue doesn't provide Fear & Greed. Returns 50 (neutral) for CMC fallback. */
  async fetchFearGreedIndex(): Promise<number> { return 50; }
  /** SoSoValue doesn't provide funding rates. Returns {} for CMC fallback. */
  async fetchFundingRates(): Promise<Record<string, number>> { return {}; }

  /** Fetch market data. Only token prices are populated — global metrics and derivatives come from CMC. */
  async fetchMarketData(): Promise<CmcMarketData> {
    if (!this.isAvailable()) return { globalMetrics: null, derivatives: null, tokenPrices: [], tokenHolders: [], trendingNarratives: [] };
    const tokenPrices = await this.getEligibleTokenQuotes();
    return { globalMetrics: null, derivatives: null, tokenPrices, tokenHolders: [], trendingNarratives: [] };
  }

  /**
   * Fetch and cache the full currency list from /currencies.
   * Cache has a 5-minute TTL. Returns cached list if still fresh.
   */
  async fetchCurrencies(): Promise<SosovalueCurrency[]> {
    if (!this.isAvailable()) return [];
    const now = Date.now();
    if (this.currencyIdCache.size > 0 && now - this.currencyCacheLastFetched < SosovalueClient.CURRENCY_CACHE_TTL_MS) return Array.from(this.currencyIdCache.values());
    const raw = await ssvRestGet<unknown>("/currencies", this.apiKey, this.baseUrl, (status) => this.recordApiCall(status));
    const currencies = extractList<SosovalueCurrency>(raw);
    if (currencies.length > 0) {
      this.currencyIdCache.clear();
      for (const c of currencies) {
        const id = c.id || c.currency_id;
        if (id && c.symbol) this.currencyIdCache.set(c.symbol.toUpperCase(), { id, symbol: c.symbol, name: c.name });
      }
      this.currencyCacheLastFetched = now;
      this.saveCache();
    }
    return currencies;
  }

  /** Resolve a symbol to a SoSoValue currency ID, using cache first. */
  private async resolveCurrencyId(symbol: string): Promise<string | null> {
    const upper = symbol.toUpperCase();
    const cached = this.currencyIdCache.get(upper);
    if (cached) return cached.id;
    const currencies = await this.fetchCurrencies();
    const match = currencies.find((c) => c.symbol.toUpperCase() === upper);
    return match?.id ?? null;
  }

  /** Fetch live market snapshot for a currency by SoSoValue ID. Returns null if unavailable. */
  async fetchMarketSnapshot(currencyId: string): Promise<SosovalueMarketSnapshot | null> {
    if (!this.isAvailable()) return null;
    const now = Date.now();
    const cached = this.snapshotCache.get(currencyId);
    if (cached && now - cached.fetchedAt < SosovalueClient.SNAPSHOT_CACHE_TTL_MS) return cached.snapshot;
    const raw = await ssvRestGet<Record<string, unknown>>(`/currencies/${encodeURIComponent(currencyId)}/market-snapshot`, this.apiKey, this.baseUrl, (status) => this.recordApiCall(status));
    const snapshot = raw ? this.parseSnapshot(raw) : null;
    if (snapshot) {
      this.snapshotCache.set(currencyId, { snapshot, fetchedAt: now });
      this.saveCache();
    }
    return snapshot;
  }

  /**
   * Get a price quote for a token by symbol.
   * Resolves symbol → currency ID, fetches market snapshot, returns TokenQuote.
   */
  async getQuote(symbol: string): Promise<TokenQuote | null> {
    if (!symbol) return null;
    const currencyId = await this.resolveCurrencyId(symbol);
    if (!currencyId) return null;
    const snapshot = await this.fetchMarketSnapshot(currencyId);
    if (!snapshot) return null;
    return snapshotToTokenQuote({ id: currencyId, symbol: snapshot.symbol || symbol, price_usd: snapshot.price_usd ?? 0, percent_change_24h: snapshot.percent_change_24h ?? 0, percent_change_7d: snapshot.percent_change_7d ?? 0, market_cap_usd: snapshot.market_cap_usd, volume_24h_usd: snapshot.volume_24h_usd, percent_change_1h: snapshot.percent_change_1h, last_updated: snapshot.last_updated });
  }

  /** Fetch price quotes for all eligible tokens. Primes the cache first. */
  async getEligibleTokenQuotes(): Promise<TokenQuote[]> { await this.fetchCurrencies(); return this.batchFetchQuotes(AGENT_CONFIG.competition.eligibleTokens); }

  /** Batch-fetch snapshots for cached currency IDs. Skips tokens not in the SoSoValue catalog. */
  private async batchFetchQuotes(symbols: readonly string[]): Promise<TokenQuote[]> {
    const quotes: TokenQuote[] = [];
    for (const symbol of symbols) {
      const currencyId = this.currencyIdCache.get(symbol.toUpperCase())?.id;
      if (!currencyId) continue;
      const snapshot = await this.fetchMarketSnapshot(currencyId);
      if (snapshot && typeof snapshot.price_usd === "number" && snapshot.price_usd > 0) {
        quotes.push(snapshotToTokenQuote({ id: currencyId, symbol: snapshot.symbol || symbol, price_usd: snapshot.price_usd, percent_change_24h: snapshot.percent_change_24h ?? 0, percent_change_7d: snapshot.percent_change_7d ?? 0, market_cap_usd: snapshot.market_cap_usd, volume_24h_usd: snapshot.volume_24h_usd, percent_change_1h: snapshot.percent_change_1h, last_updated: snapshot.last_updated }));
      }
    }
    if (quotes.length > 0) console.log(`[SoSoValue] Fetched ${quotes.length}/${symbols.length} token quotes`);
    return quotes;
  }

  /**
   * Fetch historical klines for a currency. Used for real RSI(14) calculation.
   * @param interval — Kline interval (e.g. "1d", "4h", "1h"). Default "1d".
   * @param limit — Number of klines to fetch. Default 30.
   */
  async fetchKlines(currencyId: string, interval: string = "1d", limit: number = 30): Promise<SosovalueKline[]> {
    if (!this.isAvailable()) return [];
    const cacheKey = `${currencyId}:${interval}:${limit}`;
    const now = Date.now();
    const cached = this.klineCache.get(cacheKey);
    if (cached && now - cached.fetchedAt < SosovalueClient.KLINE_CACHE_TTL_MS) return cached.klines;
    const raw = await ssvRestGet<unknown>(`/currencies/${encodeURIComponent(currencyId)}/klines?interval=${encodeURIComponent(interval)}&limit=${limit}`, this.apiKey, this.baseUrl, (status) => this.recordApiCall(status));
    const klines = extractList<SosovalueKline>(raw).map(normalizeKline);
    if (klines.length > 0) {
      this.klineCache.set(cacheKey, { klines, fetchedAt: now });
      this.saveCache();
    }
    return klines;
  }

  /**
   * Fetch historical klines by symbol (resolves currency ID first).
   * Returns empty array if the symbol is not in the SoSoValue catalog.
   */
  async fetchKlinesBySymbol(symbol: string, interval: string = "1d", limit: number = 30): Promise<SosovalueKline[]> {
    const id = await this.resolveCurrencyId(symbol);
    if (!id) return [];
    return this.fetchKlines(id, interval, limit);
  }

  /**
   * Return CACHED klines for a symbol regardless of TTL — used by the
   * backtest as a fallback when the API is rate-limited/suspended (429s).
   *
   * Historical klines age gracefully: a 111-day series fetched yesterday
   * still covers a 90-day backtest window, so stale-beyond-TTL data is
   * perfectly valid there. Checks the in-memory cache first, then the raw
   * disk cache (disk holds entries past their in-memory TTL, since TTL
   * filtering only happens when restoring into memory). Picks the entry
   * with the most klines for the symbol's base key (any limit).
   *
   * No network calls. Returns null when the symbol has never been cached.
   */
  getCachedKlines(symbol: string, interval: string = "1d"): { klines: SosovalueKline[]; fetchedAt: number } | null {
    const upper = symbol.toUpperCase();
    const id = this.currencyIdCache.get(upper)?.id;
    if (!id) return null;
    const baseKey = `${id}:${interval}:`;
    const candidates: Array<{ klines: SosovalueKline[]; fetchedAt: number }> = [];
    const collect = (k: string, v: { klines: SosovalueKline[]; fetchedAt: number }) => {
      if (!k.startsWith(baseKey)) return;
      if (!v?.klines || v.klines.length === 0) return;
      candidates.push(v);
    };
    for (const [k, v] of this.klineCache) collect(k, v);
    if (candidates.length === 0) {
      // Disk cache keeps entries past the in-memory TTL — this is where the
      // stale-but-usable klines live.
      const disk = loadSsvCache();
      if (disk?.klineCache) {
        for (const [k, v] of disk.klineCache) collect(k, v);
      }
    }
    // Most klines wins; ties break to the freshest fetch.
    candidates.sort(
      (a, b) => b.klines.length - a.klines.length || b.fetchedAt - a.fetchedAt,
    );
    const best = candidates[0] ?? null;
    // Normalize on read: legacy disk entries predate the timestamp/field
    // normalization in fetchKlines (raw SoSoValue klines carry timestamps as
    // strings of milliseconds, which silently breaks date-window matching
    // downstream — see normalizeKline).
    return best ? { klines: best.klines.map(normalizeKline), fetchedAt: best.fetchedAt } : null;
  }

  /** Fetch all available SoSoValue Indices. */
  async fetchIndices(): Promise<SosovalueIndex[]> {
    if (!this.isAvailable()) return [];
    const now = Date.now();
    if (this.indexListCache && now - this.indexListCache.fetchedAt < SosovalueClient.INDEX_LIST_TTL_MS) return this.indexListCache.items;
    const raw = await ssvRestGet<unknown>("/indices", this.apiKey, this.baseUrl, (status) => this.recordApiCall(status));
    const items = extractList<SosovalueIndex>(raw);
    if (items.length > 0) {
      this.indexListCache = { items, fetchedAt: now };
      this.saveCache();
    }
    return items;
  }

  /** Fetch live market snapshot for an index by ticker. */
  async fetchIndexSnapshot(indexTicker: string): Promise<SosovalueIndexSnapshot | null> {
    if (!this.isAvailable()) return null;
    const now = Date.now();
    const cached = this.indexSnapshotCache.get(indexTicker);
    if (cached && now - cached.fetchedAt < SosovalueClient.INDEX_SNAPSHOT_TTL_MS) return cached.snapshot;
    const raw = await ssvRestGet<Record<string, unknown>>(`/indices/${encodeURIComponent(indexTicker)}/market-snapshot`, this.apiKey, this.baseUrl, (status) => this.recordApiCall(status));
    if (!raw) return null;
    const snapshot = { ticker: String(raw.ticker ?? raw.symbol ?? indexTicker), name: String(raw.name ?? ""), price: safeNumber(raw.price ?? raw.price_usd), percent_change_24h: safeNumber(raw.percent_change_24h), percent_change_7d: safeNumber(raw.percent_change_7d), market_cap_usd: safeNumber(raw.market_cap_usd), volume_24h_usd: safeNumber(raw.volume_24h_usd), last_updated: String(raw.last_updated ?? "") };
    this.indexSnapshotCache.set(indexTicker, { snapshot, fetchedAt: now });
    this.saveCache();
    return snapshot;
  }

  /** Fetch constituent tokens and weights for an index. */
  async fetchIndexConstituents(indexTicker: string): Promise<SosovalueIndexConstituent[]> {
    if (!this.isAvailable()) return [];
    const now = Date.now();
    const cached = this.indexConstituentCache.get(indexTicker);
    if (cached && now - cached.fetchedAt < SosovalueClient.INDEX_CONSTITUENT_TTL_MS) return cached.constituents;
    const raw = await ssvRestGet<unknown>(`/indices/${encodeURIComponent(indexTicker)}/constituents`, this.apiKey, this.baseUrl, (status) => this.recordApiCall(status));
    const items = extractList<SosovalueIndexConstituent>(raw);
    if (items.length > 0) {
      this.indexConstituentCache.set(indexTicker, { constituents: items, fetchedAt: now });
      this.saveCache();
    }
    return items;
  }

  /** Fetch the latest news feed. @param limit — Max items. Default 20. */
  async fetchFeeds(limit: number = 20): Promise<SosovalueFeedItem[]> {
    if (!this.isAvailable()) return [];
    const raw = await ssvRestGet<unknown>(`/news?page=1&page_size=${limit}`, this.apiKey, this.baseUrl, (status) => this.recordApiCall(status));
    return extractList<SosovalueFeedItem>(raw);
  }

  /** Fetch hot/trending news. @param limit — Max items. Default 10. */
  async fetchHotNews(limit: number = 10): Promise<SosovalueFeedItem[]> {
    if (!this.isAvailable()) return [];
    const now = Date.now();
    if (this.hotNewsCache && now - this.hotNewsCache.fetchedAt < SosovalueClient.NEWS_CACHE_TTL_MS) return this.hotNewsCache.items.slice(0, limit);
    const raw = await ssvRestGet<unknown>(`/news/hot?page=1&page_size=${limit}`, this.apiKey, this.baseUrl, (status) => this.recordApiCall(status));
    const items = extractList<SosovalueFeedItem>(raw);
    if (items.length > 0) {
      this.hotNewsCache = { items, fetchedAt: now };
      this.saveCache();
    }
    return items;
  }

  /** Fetch featured/curated news. @param limit — Max items. Default 10. */
  async fetchFeaturedNews(limit: number = 10): Promise<SosovalueFeedItem[]> {
    if (!this.isAvailable()) return [];
    const now = Date.now();
    if (this.featuredNewsCache && now - this.featuredNewsCache.fetchedAt < SosovalueClient.NEWS_CACHE_TTL_MS) return this.featuredNewsCache.items.slice(0, limit);
    const raw = await ssvRestGet<unknown>(`/news/pick?page=1&page_size=${limit}`, this.apiKey, this.baseUrl, (status) => this.recordApiCall(status));
    const items = extractList<SosovalueFeedItem>(raw);
    if (items.length > 0) {
      this.featuredNewsCache = { items, fetchedAt: now };
      this.saveCache();
    }
    return items;
  }

  /**
   * Fetch macro-economic events for a given date.
   * @param date — ISO date string (e.g. "2024-01-15"). Defaults to today.
   */
  async fetchMacroEvents(date?: string): Promise<SosovalueMacroEvent[]> {
    if (!this.isAvailable()) return [];
    const cacheKey = date || "today";
    const now = Date.now();
    const cached = this.macroEventsCache;
    if (cached && cacheKey === (date || "today") && now - cached.fetchedAt < SosovalueClient.MACRO_CACHE_TTL_MS) return cached.items;
    const query = date ? `?date=${encodeURIComponent(date)}` : "";
    const raw = await ssvRestGet<unknown>(`/macro/events${query}`, this.apiKey, this.baseUrl, (status) => this.recordApiCall(status));
    const items = extractList<SosovalueMacroEvent>(raw);
    if (items.length > 0) {
      this.macroEventsCache = { items, fetchedAt: now, dateKey: cacheKey };
      this.saveCache();
    }
    return items;
  }

  /** Verify connectivity by fetching the currency list. */
  async healthCheck(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      const currencies = await this.fetchCurrencies();
      if (currencies.length > 0) { console.log(`[SoSoValue] Connected — ${currencies.length} currencies available`); return true; }
      return false;
    } catch { return false; }
  }

  /** Parse a raw API response into a typed snapshot, handling flexible field naming. */
  private parseSnapshot(raw: Record<string, unknown>): SosovalueMarketSnapshot | null {
    if (!raw) return null;
    const symbol = String(raw.symbol ?? raw.ticker ?? raw.name ?? "");
    const id = String(raw.id ?? raw.currency_id ?? "");
    const md = (raw.market_data as Record<string, unknown> | undefined) ?? raw;
    return { id: id || symbol, symbol, name: String(raw.name ?? symbol ?? ""), last_updated: String(raw.last_updated ?? md.last_updated ?? ""), price_usd: pickNumber(md, ["price_usd", "price", "current_price"]), market_cap_usd: pickNumber(md, ["market_cap_usd", "market_cap", "marketCap"]), volume_24h_usd: pickNumber(md, ["volume_24h_usd", "volume_24h", "total_volume", "volume24h"]), percent_change_1h: pickNumber(md, ["percent_change_1h", "price_change_percentage_1h_in_currency", "percentChange1h"]), percent_change_24h: pickNumber(md, ["percent_change_24h", "price_change_percentage_24h", "percentChange24h"]), percent_change_7d: pickNumber(md, ["percent_change_7d", "price_change_percentage_7d_in_currency", "percentChange7d"]), circulating_supply: pickNumber(md, ["circulating_supply", "circulatingSupply"]), total_supply: pickNumber(md, ["total_supply", "totalSupply"]), pair_count: pickNumber(raw, ["pair_count", "pairCount", "pair_count_24h"]) };
  }
}

/** Singleton SoSoValue client instance. Reads SOSOVALUE_API_KEY from the environment. */
export const sosovalueClient = new SosovalueClient();

// =============================================================================
// Kline / RSI helpers
// =============================================================================

/**
 * Compute RSI(14) from ascending kline closes.
 * Uses the standard Wilder smoothing method.
 * Returns 50 (neutral) when insufficient data.
 */
export function computeRSI14(klines: SosovalueKline[]): number {
  if (klines.length < 15) return 50;
  const closes = klines
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((k) => k.close);
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= 14; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / 14;
  let avgLoss = losses / 14;
  for (let i = 15; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * 13 + Math.max(change, 0)) / 14;
    avgLoss = (avgLoss * 13 + Math.max(-change, 0)) / 14;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);
  return Math.max(0, Math.min(100, rsi));
}
