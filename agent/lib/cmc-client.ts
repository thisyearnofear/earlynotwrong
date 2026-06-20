/**
 * CMC Client
 *
 * Fetches market data from the CoinMarketCap Pro REST API.
 * Uses the standard X-CMC_PRO_API_KEY header for authentication.
 *
 * NOTE: The CMC MCP endpoint (mcp.coinmarketcap.com) was returning
 * HTTP 400 for all requests. This implementation uses the proven
 * REST API instead.
 *
 * Fear & Greed Index is fetched from CMC's /v3/fear-and-greed/latest endpoint.
 * Derivatives data (funding rates, open interest) comes from CMC's
 * /v5/cryptocurrency/derivatives/market-pairs/list/latest endpoint.
 * Trending narratives are unavailable via the REST API (defaults to empty).
 */

import { AGENT_CONFIG } from "./config.js";
import type { MarketDataProvider } from "./types.js";

// =============================================================================
// Types (kept from MCP client for compatibility)
// =============================================================================

export interface CmcIdMap {
  /** Token symbol → CMC ID lookup */
  [symbol: string]: number;
}

export interface GlobalMetrics {
  totalMarketCapUsd: number;
  btcDominance: number;
  ethDominance: number;
  fearGreedIndex: number;
  totalVolumeUsd: number;
  lastUpdated: number;
}

export interface DerivativesMetrics {
  totalOpenInterestUsd: number;
  totalVolume24hUsd: number;
  btcFundingRate: number;
  ethFundingRate: number;
  liquidationData: {
    longLiquidations24h: number;
    shortLiquidations24h: number;
  } | null;
  lastUpdated: number;
}

export interface TokenQuote {
  id: number;
  name: string;
  symbol: string;
  slug: string;
  price: number;
  volume24h: number;
  marketCap: number;
  percentChange1h: number;
  percentChange24h: number;
  percentChange7d: number;
  lastUpdated: string;
}

export interface TokenMetrics {
  id: number;
  symbol: string;
  holderCount: number;
  whaleHolderCount: number;
  whalePercentOfSupply: number;
  averageHolderBalance: number;
}

export interface TrendingNarrative {
  name: string;
  description: string;
  volume24h: number;
  percentChange24h: number;
  topCoins: Array<{ id: number; symbol: string; name: string }>;
}

export interface CmcMarketData {
  globalMetrics: GlobalMetrics | null;
  derivatives: DerivativesMetrics | null;
  tokenPrices: TokenQuote[];
  tokenHolders: TokenMetrics[];
  trendingNarratives: TrendingNarrative[];
}

// =============================================================================
// REST API Client
// =============================================================================

const BASE_URL = "https://pro-api.coinmarketcap.com";

/**
 * Make a GET request to the CMC Pro REST API.
 */
async function restGet<T = Record<string, unknown>>(
  path: string,
  apiKey: string
): Promise<T | null> {
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      headers: {
        "X-CMC_PRO_API_KEY": apiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.warn(`CMC REST error ${response.status} for ${path}: ${response.statusText}`);
      return null;
    }

    const json = await response.json();
    return (json.data ?? json) as T;
  } catch (error) {
    console.warn(`CMC REST request failed for ${path}:`, error);
    return null;
  }
}

/**
 * Fetch the Fear & Greed Index from CMC's /v3/fear-and-greed/latest endpoint.
 * Returns 0–100 where 0 = extreme fear, 100 = extreme greed.
 */
async function fetchFearGreedFromCmc(apiKey: string): Promise<number> {
  try {
    const data = await restGet<{ value: number; value_classification: string }>(
      "/v3/fear-and-greed/latest",
      apiKey
    );
    if (data && typeof data.value === "number") {
      return Math.max(0, Math.min(100, data.value));
    }
    return 50;
  } catch {
    return 50;
  }
}

/**
 * Fetch derivatives data (funding rates, open interest) from CMC's v5 endpoint.
 * Returns funding rates for BTC and ETH, plus aggregate open interest.
 */
async function fetchDerivativesMetrics(
  apiKey: string
): Promise<DerivativesMetrics | null> {
  try {
    const [btcResult, ethResult] = await Promise.all([
      restGet<Record<string, unknown>>(
        "/v5/cryptocurrency/derivatives/market-pairs/list/latest?crypto_symbol=BTC&limit=1",
        apiKey
      ),
      restGet<Record<string, unknown>>(
        "/v5/cryptocurrency/derivatives/market-pairs/list/latest?crypto_symbol=ETH&limit=1",
        apiKey
      ),
    ]);

    const btcMarketPairs = (btcResult?.market_pairs as Array<Record<string, unknown>> | undefined) ?? [];
    const ethMarketPairs = (ethResult?.market_pairs as Array<Record<string, unknown>> | undefined) ?? [];

    // Extract funding rates from the first market pair's exchange_reported_quotes
    const btcFundingRate = extractFundingRate(btcMarketPairs);
    const ethFundingRate = extractFundingRate(ethMarketPairs);

    // Aggregate open interest
    const btcOi = extractOpenInterest(btcMarketPairs);
    const ethOi = extractOpenInterest(ethMarketPairs);
    const totalOpenInterest = btcOi + ethOi;

    // Aggregate volume
    const btcVol = extractVolume24h(btcMarketPairs);
    const ethVol = extractVolume24h(ethMarketPairs);
    const totalVolume = btcVol + ethVol;

    return {
      totalOpenInterestUsd: totalOpenInterest,
      totalVolume24hUsd: totalVolume,
      btcFundingRate,
      ethFundingRate,
      liquidationData: null,
      lastUpdated: Date.now(),
    };
  } catch {
    return null;
  }
}

function extractFundingRate(marketPairs: Array<Record<string, unknown>>): number {
  for (const pair of marketPairs) {
    const quotes = pair.exchange_reported_quotes as Array<Record<string, unknown>> | undefined;
    if (quotes && quotes.length > 0) {
      const rate = safeNumber(quotes[0].funding_rate);
      if (rate !== 0) return rate;
    }
  }
  return 0;
}

function extractOpenInterest(marketPairs: Array<Record<string, unknown>>): number {
  for (const pair of marketPairs) {
    const quotes = pair.exchange_reported_quotes as Array<Record<string, unknown>> | undefined;
    if (quotes && quotes.length > 0) {
      const oi = safeNumber(quotes[0].open_interest);
      if (oi > 0) return oi;
    }
  }
  return 0;
}

function extractVolume24h(marketPairs: Array<Record<string, unknown>>): number {
  for (const pair of marketPairs) {
    const quotes = pair.exchange_reported_quotes as Array<Record<string, unknown>> | undefined;
    if (quotes && quotes.length > 0) {
      const vol = safeNumber(quotes[0].volume_24h_quote ?? quotes[0].volume_24h);
      if (vol > 0) return vol;
    }
  }
  return 0;
}

// =============================================================================
// Token ID Cache
// =============================================================================

const TOKEN_ID_CACHE = new Map<string, number>();

/**
 * Resolve a token symbol to its CMC ID using the /v1/cryptocurrency/map endpoint.
 */
async function resolveTokenId(symbol: string, apiKey: string): Promise<number | null> {
  const upper = symbol.toUpperCase();
  if (TOKEN_ID_CACHE.has(upper)) return TOKEN_ID_CACHE.get(upper)!;

  const symbolParam = encodeURIComponent(symbol);
  const result = await restGet<Array<{ id: number; symbol: string }>>(
    `/v1/cryptocurrency/map?symbol=${symbolParam}&limit=1`,
    apiKey
  );

  if (Array.isArray(result) && result.length > 0) {
    const match = result[0];
    if (match && typeof match.id === "number") {
      TOKEN_ID_CACHE.set(upper, match.id);
      return match.id;
    }
  }

  return null;
}

// =============================================================================
// CMC Client
// =============================================================================

export class CmcClient implements MarketDataProvider {
  readonly name = "cmc" as const;
  private apiKey: string;

  constructor(options: { apiKey?: string } = {}) {
    this.apiKey = options.apiKey || process.env.CMC_API_KEY || "";
  }

  // ===========================================================================
  // MarketDataProvider Interface
  // ===========================================================================

  /**
   * Fetch current price for a token by symbol.
   */
  async fetchTokenPrice(symbol: string): Promise<number> {
    if (!symbol) return 0;
    const quote = await this.getQuote(symbol);
    return quote?.price ?? 0;
  }

  /** Fetch Fear & Greed Index from CMC's /v3/fear-and-greed/latest. */
  async fetchFearGreedIndex(): Promise<number> {
    return fetchFearGreedFromCmc(this.apiKey);
  }

  /**
   * Fetch funding rates from CMC's v5 derivatives endpoint.
   */
  async fetchFundingRates(): Promise<Record<string, number>> {
    const derivatives = await this.getDerivativesMetrics();
    if (!derivatives) return {};
    return {
      BTC: derivatives.btcFundingRate,
      ETH: derivatives.ethFundingRate,
    };
  }

  // ===========================================================================
  // High-Level Data Fetching
  // ===========================================================================

  /**
   * Fetch all market data the agent needs in one call.
   */
  async fetchMarketData(): Promise<CmcMarketData> {
    const [globalMetrics, derivatives, tokenPrices] = await Promise.all([
      this.getGlobalMetrics(),
      this.getDerivativesMetrics(),
      this.getEligibleTokenQuotes(),
    ]);

    return {
      globalMetrics,
      derivatives,
      tokenPrices,
      tokenHolders: [],
      trendingNarratives: [],
    };
  }

  // ===========================================================================
  // Data Methods
  // ===========================================================================

  /**
   * Get global market metrics from CMC + Fear & Greed from CMC's v3 endpoint.
   */
  async getGlobalMetrics(): Promise<GlobalMetrics | null> {
    const [data, fearGreedIndex] = await Promise.all([
      restGet<Record<string, unknown>>(
        "/v1/global-metrics/quotes/latest",
        this.apiKey
      ),
      fetchFearGreedFromCmc(this.apiKey),
    ]);
    if (!data) return null;

    const quote = (data.quote as Record<string, unknown>)?.USD as Record<string, unknown> | undefined;

    return {
      totalMarketCapUsd: safeNumber(quote?.total_market_cap ?? data.total_market_cap),
      btcDominance: safeNumber(data.btc_dominance),
      ethDominance: safeNumber(data.eth_dominance),
      fearGreedIndex,
      totalVolumeUsd: safeNumber(quote?.total_volume_24h ?? data.total_volume_24h),
      lastUpdated: Date.now(),
    };
  }

  /**
   * Get derivatives metrics (funding rates, open interest) from CMC's v5 endpoint.
   */
  async getDerivativesMetrics(): Promise<DerivativesMetrics | null> {
    return fetchDerivativesMetrics(this.apiKey);
  }

  /**
   * Get latest price quote for a specific token by symbol.
   */
  async getQuote(symbol: string): Promise<TokenQuote | null> {
    if (!symbol) return null;

    const id = await resolveTokenId(symbol, this.apiKey);
    if (!id) return null;

    // Use ID-based lookup for precision
    const result = await restGet<Record<string, unknown>>(
      `/v1/cryptocurrency/quotes/latest?id=${id}`,
      this.apiKey
    );

    if (!result) return null;
    const data = result[String(id)] as Record<string, unknown> | undefined;
    if (!data) return null;

    return parseTokenQuote(data);
  }

  /**
   * Get price quotes for all eligible tokens by symbol batch.
   */
  async getEligibleTokenQuotes(): Promise<TokenQuote[]> {
    const symbols = AGENT_CONFIG.competition.eligibleTokens;

    const quotes: TokenQuote[] = [];

    // CMC REST API supports up to 100 symbols per request
    for (let i = 0; i < symbols.length; i += 100) {
      const batch = symbols.slice(i, i + 100);
      const symbolParam = batch.map((s) => encodeURIComponent(s)).join(",");

      const result = await restGet<Record<string, unknown>>(
        `/v1/cryptocurrency/quotes/latest?symbol=${symbolParam}`,
        this.apiKey
      );

      if (result && typeof result === "object") {
        for (const symbol of batch) {
          const data = result[symbol] as Record<string, unknown> | undefined;
          if (data) {
            const quote = parseTokenQuote(data);
            if (quote) quotes.push(quote);
          }
        }
      }
    }

    return quotes;
  }

  /**
   * Token holder metrics are not available via the CMC Pro REST API.
   */
  async getTokenMetrics(_symbol: string): Promise<TokenMetrics | null> {
    return null;
  }

  /**
   * Trending narratives are not available via the CMC Pro REST API.
   */
  async getTrendingNarratives(): Promise<TrendingNarrative[]> {
    return [];
  }

  /**
   * Quick health check — can we reach the CMC REST API?
   */
  async healthCheck(): Promise<boolean> {
    try {
      const data = await restGet<Record<string, unknown>>(
        "/v1/global-metrics/quotes/latest",
        this.apiKey
      );
      if (data) {
        console.log("[CMC] Connected via REST API");
      }
      return data !== null;
    } catch {
      return false;
    }
  }
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

function parseTokenQuote(data: unknown): TokenQuote | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (!d.id && !d.symbol) return null;

  // CMC REST returns quotes under data[symbol].quote.USD
  let quote: Record<string, unknown> | undefined;
  if (d.quote && typeof d.quote === "object") {
    const q = d.quote as Record<string, unknown>;
    quote = (q.USD as Record<string, unknown> | undefined) ?? q;
  }

  return {
    id: Number(d.id || 0),
    name: String(d.name || ""),
    symbol: String(d.symbol || ""),
    slug: String(d.slug || ""),
    price: safeNumber(quote?.price),
    volume24h: safeNumber(quote?.volume_24h ?? quote?.volume24h),
    marketCap: safeNumber(quote?.market_cap ?? quote?.marketCap),
    percentChange1h: safeNumber(quote?.percent_change_1h ?? quote?.percentChange1h),
    percentChange24h: safeNumber(quote?.percent_change_24h ?? quote?.percentChange24h),
    percentChange7d: safeNumber(quote?.percent_change_7d ?? quote?.percentChange7d),
    lastUpdated: String(quote?.last_updated ?? quote?.lastUpdated ?? ""),
  };
}

// =============================================================================
// Singleton
// =============================================================================

export const cmcClient = new CmcClient();
