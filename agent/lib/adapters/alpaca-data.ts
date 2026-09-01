/**
 * Alpaca Data Source — Options Market Data Adapter
 *
 * Implements the harness DataSource interface for the "options" domain using
 * Alpaca's Trading API + Market Data API. Fetches options chains, derives
 * implied vol + greeks (Black-Scholes from quotes), and underlier bars.
 *
 * Alpaca API reference (verified live 2026-08-29 against the paper account):
 *   - Contracts (Trading API!): GET {paper-api}/v2/options/contracts?underlying_symbols={SYM}
 *       NOT data.alpaca.markets/v2/stocks/{sym}/options/contracts (404).
 *       Field names: `type` (not `option_type`), `close_price`, `open_interest`
 *       (both null on the Basic plan's indicative feed), `multiplier` (100).
 *   - Options quotes:            GET {data}/v1beta1/options/snapshots?symbols=...
 *       Returns latestQuote (ap/as/bp/bs). No greeks or IV on the Basic plan —
 *       the adapter derives IV + delta/gamma/theta/vega from the mid quote via
 *       Black-Scholes inversion (standard, no paid feed required).
 *   - Underlier snapshot:        GET {data}/v2/stocks/{SYM}/snapshot  (singular)
 *       Flat object with dailyBar / latestTrade / prevDailyBar. The plural
 *       `/snapshots` path returns "Not Found".
 *   - Underlier bars:            GET {data}/v2/stocks/bars?symbols={SYM}&timeframe=1Day&start=...&end=...
 *       Multi-symbol form returns `bars` keyed by symbol (NOT an array, and
 *       NOT /v2/stocks/{sym}/bars which returns null). Requires explicit
 *       start/end — the default window is "today", which is empty on weekends.
 *   - Option bars:               v1beta1/options/bars returns {} on the Basic
 *       plan — the adapter uses underlier bars for RSI/regime instead.
 *
 * Auth headers: APCA-API-KEY-ID + APCA-API-SECRET-KEY
 * Paper accounts are free — no card required.
 */

import type { DataSource } from "./data-source.js";
import type { Kline, MarketSignal, SignalRequest } from "./types.js";
import { withTimeout } from "../delphi/executor.js";

// =============================================================================
// Config
// =============================================================================

const ALPACA_TRADING_BASE =
  process.env.ALPACA_API_BASE_URL ??
  (process.env.ALPACA_PAPER !== "0" ? "https://paper-api.alpaca.markets" : "https://api.alpaca.markets");

const ALPACA_DATA_BASE = process.env.ALPACA_DATA_BASE_URL ?? "https://data.alpaca.markets";

/** Risk-free rate for Black-Scholes (current ~4.5% fed funds). Overridable. */
const RISK_FREE_RATE = parseFloat(process.env.ALPACA_RISK_FREE_RATE ?? "0.045");

/** Contracts fetched per underlier per cycle. */
const CONTRACTS_LIMIT = 200;

/** Snapshots endpoint accepts up to 100 symbols per request; chunk below that. */
const SNAPSHOT_CHUNK = 50;

function alpacaHeaders(): Record<string, string> {
  return {
    "APCA-API-KEY-ID": process.env.ALPACA_API_KEY_ID ?? "",
    "APCA-API-SECRET-KEY": process.env.ALPACA_API_SECRET_KEY ?? "",
    "Content-Type": "application/json",
  };
}

function isConfigured(): boolean {
  return !!(process.env.ALPACA_API_KEY_ID && process.env.ALPACA_API_SECRET_KEY);
}

// =============================================================================
// Black-Scholes (derives IV + greeks from option quotes)
// =============================================================================

/** Standard normal CDF (Abramowitz–Stegun approximation). */
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  let p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  if (x > 0) p = 1 - p;
  return p;
}

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** European Black-Scholes option price (used for the IV solver only). */
function bsPrice(S: number, K: number, T: number, r: number, sigma: number, isCall: boolean): number {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return 0;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  if (isCall) return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
  return K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}

/**
 * Solve implied volatility for an option price via bisection.
 * Returns 0 when the price is degenerate (no quote, zero, or below intrinsic).
 */
function solveImpliedVol(price: number, S: number, K: number, T: number, r: number, isCall: boolean): number {
  if (!(price > 0) || !(S > 0) || !(K > 0) || !(T > 0)) return 0;
  // Intrinsic value floor: IV of a price at/below intrinsic is degenerate → 0.
  const intrinsic = isCall ? Math.max(0, S - K) : Math.max(0, K - S);
  if (price <= intrinsic + 1e-9) return 0;
  let lo = 1e-4;
  let hi = 5.0;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (bsPrice(S, K, T, r, mid, isCall) > price) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Standard Black-Scholes greeks for a solved IV. */
function bsGreeks(S: number, K: number, T: number, r: number, sigma: number, isCall: boolean) {
  if (sigma <= 0 || T <= 0 || S <= 0 || K <= 0) {
    return { delta: 0, gamma: 0, theta: 0, vega: 0 };
  }
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const pdf = normPdf(d1);
  const delta = isCall ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = pdf / (S * sigma * Math.sqrt(T));
  const theta = -(S * pdf * sigma) / (2 * Math.sqrt(T))
    - (isCall ? 1 : -1) * r * K * Math.exp(-r * T) * (isCall ? normCdf(d2) : normCdf(-d2));
  const vega = S * pdf * Math.sqrt(T);
  return { delta, gamma, theta, vega };
}

// =============================================================================
// API Calls
// =============================================================================

/** Option contract as returned by the Trading API contracts endpoint. */
interface AlpacaOptionContract {
  symbol: string; // e.g. "AAPL260918C00050000"
  underlying_symbol: string; // e.g. "AAPL"
  type: string; // "call" | "put"
  strike_price: string; // "205"
  expiration_date: string; // "2026-09-18"
  multiplier?: string; // "100"
  size?: string;
  tradable?: boolean;
  close_price?: string | null;
  open_interest?: string | null;
  name?: string;
}

interface AlpacaBar {
  t: string; // ISO timestamp
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Options snapshot quote (indicative feed on the Basic plan). */
interface AlpacaOptionQuote {
  ap?: number; // ask price
  as?: number; // ask size
  bp?: number; // bid price
  bs?: number; // bid size
}

// =============================================================================
// Free-data enrichment: news + market clock (Basic plan)
// =============================================================================

/** News article from Alpaca's free news feed (`/v1beta1/news`). */
interface AlpacaNewsItem {
  headline: string;
  summary: string | null;
  symbols: string[];
  created_at: string;
  url: string | null;
  source?: string;
}

/** Recent headline per underlier, cached a few hours to avoid re-fetching. */
interface UnderlierNews {
  headline: string | null;
  summary: string | null;
  url: string | null;
  fetchedAt: number;
  earningsNear: boolean;
  sentimentBias: "bullish" | "bearish" | "neutral";
}

const NEWS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const newsCache = new Map<string, UnderlierNews>();

/** Detect earnings timing from a headline (drives the vol-crush factor). */
function headlineMentionsEarnings(headline: string): boolean {
  return /\b(earnings|earns|q1|q2|q3|q4|fiscal|guidance|revenues?|quarter|results?|upcoming)\b/i.test(
    headline,
  );
}

/** Crude lexical sentiment for the narrative factor (no paid NLP feed). */
function lexicalSentiment(summary: string): "bullish" | "bearish" | "neutral" {
  const bullish = /\b(surge|rally|jump|soar|beat|upgrade|record|boost|gain|rise|outperform|multiply|growth)\b/i;
  const bearish = /\b(plunge|drop|fall|miss|downgrade|slump|weak|cut|loss|recession|sell|slide|decline|fear)\b/i;
  const s = summary ?? "";
  const b = (s.match(bullish) ?? []).length;
  const n = (s.match(bearish) ?? []).length;
  if (b > n) return "bullish";
  if (n > b) return "bearish";
  return "neutral";
}

async function fetchUnderlierNews(symbol: string): Promise<UnderlierNews> {
  const cached = newsCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < NEWS_CACHE_TTL_MS) return cached;
  try {
    const res = await alpacaGet(
      `/v1beta1/news?symbols=${encodeURIComponent(symbol)}&limit=5&sort=desc`,
    ) as { news?: AlpacaNewsItem[] };
    const items = res.news ?? [];
    const top = items.find((n) => n.headline) ?? items[0];
    const summary = top?.summary ?? "";
    const entry: UnderlierNews = {
      headline: top?.headline ?? null,
      summary: top?.summary ?? null,
      url: top?.url ?? null,
      fetchedAt: Date.now(),
      earningsNear: items.some((n) => headlineMentionsEarnings(n.headline)),
      sentimentBias: lexicalSentiment(summary),
    };
    newsCache.set(symbol, entry);
    return entry;
  } catch {
    return {
      headline: null, summary: null, url: null,
      fetchedAt: Date.now(), earningsNear: false, sentimentBias: "neutral",
    };
  }
}

/** Market clock snapshot (free, from the Trading API). */
interface MarketClock {
  isOpen: boolean;
  nextOpen: string | null;
  nextClose: string | null;
}

let clockCache: { data: MarketClock; at: number } | null = null;

/**
 * Return whether the equities/options market is open and the next session
 * boundary. Cached for 30s. On a fetch error we fail safe to "open" so a
 * transient clock bug can't freeze trading — the broker's own market-hours
 * rejection (422) remains the authoritative gate.
 */
export async function getMarketHours(): Promise<MarketClock> {
  if (clockCache && Date.now() - clockCache.at < 30_000) return clockCache.data;
  try {
    const res = await alpacaGet("/v2/clock", ALPACA_TRADING_BASE) as {
      is_open: boolean;
      next_open?: string;
      next_close?: string;
    };
    const data: MarketClock = {
      isOpen: !!res.is_open,
      nextOpen: res.next_open ?? null,
      nextClose: res.next_close ?? null,
    };
    clockCache = { data, at: Date.now() };
    return data;
  } catch {
    return { isOpen: true, nextOpen: null, nextClose: null };
  }
}

async function alpacaGet(path: string, base: string = ALPACA_DATA_BASE): Promise<any> {
  const url = `${base}${path}`;
  const res = await withTimeout(fetch(url, { headers: alpacaHeaders() }), 30000, `alpaca:${path}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Alpaca API ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** Fetch latest quotes for a batch of contract symbols (chunked). */
async function fetchOptionQuotes(symbols: string[]): Promise<Map<string, AlpacaOptionQuote>> {
  const quotes = new Map<string, AlpacaOptionQuote>();
  for (let i = 0; i < symbols.length; i += SNAPSHOT_CHUNK) {
    const chunk = symbols.slice(i, i + SNAPSHOT_CHUNK);
    try {
      const res = await alpacaGet(
        `/v1beta1/options/snapshots?symbols=${encodeURIComponent(chunk.join(","))}`,
      ) as { snapshots?: Record<string, { latestQuote?: AlpacaOptionQuote }> };
      for (const [sym, snap] of Object.entries(res.snapshots ?? {})) {
        if (snap?.latestQuote) quotes.set(sym, snap.latestQuote);
      }
    } catch (err) {
      console.warn(`[alpaca-data] Quote batch failed (${chunk.length} symbols):`, err instanceof Error ? err.message : String(err));
    }
  }
  return quotes;
}

/** Fetch a single underlier's latest snapshot (singular endpoint). */
async function fetchUnderlierSnapshot(symbol: string): Promise<{ price: number; prevClose: number }> {
  try {
    const snap = await alpacaGet(`/v2/stocks/${symbol}/snapshot`) as {
      dailyBar?: { c?: number };
      latestTrade?: { p?: number };
      prevDailyBar?: { c?: number };
    };
    const price = snap.latestTrade?.p ?? snap.dailyBar?.c ?? 0;
    const prevClose = snap.prevDailyBar?.c ?? 0;
    return { price, prevClose };
  } catch {
    return { price: 0, prevClose: 0 };
  }
}

/** Map an Alpaca option contract + quote + underlier data to a MarketSignal. */
function contractToSignal(
  c: AlpacaOptionContract,
  quote: AlpacaOptionQuote | undefined,
  underlierPrice: number,
  prevClose: number,
  realizedVol: number,
  news: UnderlierNews | undefined,
): MarketSignal {
  const strike = parseFloat(c.strike_price);
  const expiry = c.expiration_date;
  const multiplier = parseFloat(c.multiplier ?? "100") || 100;
  const isCall = c.type === "call";

  // Option price: mid of the latest quote when available, else close_price.
  const bid = quote?.bp ?? 0;
  const ask = quote?.ap ?? 0;
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
  const close = parseFloat(c.close_price ?? "0") || 0;
  const price = mid > 0 ? mid : close;

  // Time to expiry in years.
  const daysToExpiry = Math.max(0, (new Date(`${expiry}T20:00:00Z`).getTime() - Date.now()) / 86400000);
  const T = daysToExpiry / 365;

  // Derive IV + greeks from the mid quote (Black-Scholes inversion).
  const iv = solveImpliedVol(mid, underlierPrice, strike, T, RISK_FREE_RATE, isCall);
  const greeks = bsGreeks(underlierPrice, strike, T, RISK_FREE_RATE, iv, isCall);
  // A near-zero IV is a degenerate quote (mid at/below intrinsic) — not a
  // real market. Zero out ivToRealized so the conviction factor can't treat
  // a gap in the indicative feed as "super cheap premium" (the IV/RV < 1
  // buy edge only makes sense for a genuinely-priced, non-degenerate vol).
  const ivUsable = iv >= 0.05;
  const ivToRealized = ivUsable && realizedVol > 0 ? iv / realizedVol : 0;

  // 7d price change of the underlier (options inherit the underlier's drift).
  const priceChange7d = prevClose > 0 ? ((underlierPrice - prevClose) / prevClose) * 100 : 0;

  // Liquidity proxy: quote depth in USD notional (price × contract size × multiplier).
  const quoteNotionalUsd =
    (bid * (quote?.bs ?? 0) + ask * (quote?.as ?? 0)) * multiplier;

  return {
    symbol: c.symbol,
    name: c.name ?? `${c.underlying_symbol} ${c.type.toUpperCase()} ${strike} ${expiry}`,
    price,
    priceChange24hPercent: priceChange7d, // options 24h ≈ underlier 24h
    priceChange7dPercent: priceChange7d,
    volume24h: quoteNotionalUsd, // quote-depth proxy (no volume on the Basic plan)
    marketCap: 0, // N/A for options
    metadata: {
      underlyingSymbol: c.underlying_symbol,
      contractType: c.type,
      strike,
      expiry,
      multiplier,
      impliedVolatility: iv,
      ivAvailable: mid > 0,
      ivToRealized,
      realizedVol,
      delta: greeks.delta,
      gamma: greeks.gamma,
      theta: greeks.theta,
      vega: greeks.vega,
      openInterest: parseFloat(c.open_interest ?? "0") || 0,
      daysToExpiry,
      bid,
      ask,
      bidSize: quote?.bs ?? 0,
      askSize: quote?.as ?? 0,
      quoteNotionalUsd,
      underlierPrice,
      tradable: c.tradable ?? true,
      earningsNear: news?.earningsNear ?? false,
      newsHeadline: news?.headline ?? null,
      newsSummary: news?.summary ?? null,
      newsUrl: news?.url ?? null,
      newsSentiment: news?.sentimentBias ?? "neutral",
    },
  };
}

/** Map an Alpaca bar to a Kline. */
function barToKline(b: AlpacaBar): Kline {
  return {
    timestamp: Math.floor(new Date(b.t).getTime() / 1000),
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
  };
}

/**
 * Annualized realized volatility from daily close-to-close log returns.
 * Returns 0 when there are too few bars to estimate (needs ≥ 2).
 */
function computeRealizedVol(klines: Kline[]): number {
  if (klines.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    const prev = klines[i - 1].close;
    const curr = klines[i].close;
    if (prev > 0 && curr > 0) returns.push(Math.log(curr / prev));
  }
  if (returns.length < 2) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - mean) * (r - mean), 0) / (returns.length - 1);
  const dailyStd = Math.sqrt(variance);
  return dailyStd * Math.sqrt(252); // annualize
}

/** Fetch an underlier's recent daily bars and compute annualized realized vol. */
async function fetchRealizedVol(symbol: string): Promise<number> {
  const end = new Date();
  const start = new Date(Date.now() - 30 * 86400000);
  try {
    const res = await alpacaGet(
      `/v2/stocks/bars?symbols=${encodeURIComponent(symbol)}&timeframe=1Day&feed=iex` +
        `&start=${start.toISOString()}&end=${end.toISOString()}`,
    ) as { bars?: Record<string, AlpacaBar[]> };
    return computeRealizedVol((res.bars?.[symbol] ?? []).map(barToKline));
  } catch {
    return 0;
  }
}

// =============================================================================
// Adapter
// =============================================================================

/**
 * Create an Alpaca-backed DataSource adapter for options market data.
 *
 * `fetchSignals` fetches the options chain for the configured underliers,
 * enriches each contract with quotes + BS-derived IV/greeks, and returns
 * MarketSignal[]. Contracts without a tradable two-sided quote (or without
 * any quote) are still returned but score ~0 and fail the liquidity filter.
 */
export function createAlpacaDataAdapter(): DataSource {
  return {
    async fetchSignals(config: SignalRequest): Promise<MarketSignal[]> {
      if (!isConfigured()) {
        console.warn("[alpaca-data] API keys not configured — returning empty signals");
        return [];
      }

      // Default underliers: S&P 500 + high-liquidity mega-caps. Override via
      // ALPACA_UNDERLIERS env var (comma-separated).
      const underliers =
        config.symbols ??
        (process.env.ALPACA_UNDERLIERS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [
          "AAPL", "MSFT", "NVDA", "TSLA", "SPY", "QQQ",
        ]);

      const signals: MarketSignal[] = [];
      const limit = Math.min(config.limit ?? CONTRACTS_LIMIT, 200);

      // Expiration window: ~7d to ~3 months out.
      // We skip the nearest weeklies: their indicative quotes are stale
      // (mid ≈ intrinsic → IV solver returns 0) and theta decay dominates.
      // Far-dated contracts are sparse in the indicative feed but the
      // liquidity filter (quoteNotionalUsd) excludes them.
      const gte = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const lte = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

      for (const underlier of underliers) {
        try {
          // Underlier snapshot (singular endpoint) for price + prev close.
          const { price: underlierPrice, prevClose } = await fetchUnderlierSnapshot(underlier);
          // Underlier's own realized vol (annualized) — the yardstick for
          // whether the option premium is cheap or rich.
          const realizedVol = await fetchRealizedVol(underlier);
          // Free news feed — narrative + earnings timing for this underlier.
          const news = await fetchUnderlierNews(underlier);

          // Fetch the options chain via the TRADING API (not the data API).
          const qs = [
            `underlying_symbols=${encodeURIComponent(underlier)}`,
            `status=active`,
            `expiration_date_gte=${gte}`,
            `expiration_date_lte=${lte}`,
            `limit=${limit}`,
          ].join("&");
          const chain = await alpacaGet(`/v2/options/contracts?${qs}`, ALPACA_TRADING_BASE) as {
            option_contracts?: AlpacaOptionContract[];
          };

          const contracts = chain.option_contracts ?? [];
          if (contracts.length === 0) {
            console.warn(`[alpaca-data] No active contracts for ${underlier} in ${gte}..${lte}`);
            continue;
          }

          // Batch fetch latest quotes for the chain.
          const quotes = await fetchOptionQuotes(contracts.map((c) => c.symbol));

          let withQuotes = 0;
          for (const c of contracts) {
            const quote = quotes.get(c.symbol);
            if (quote) withQuotes++;
            signals.push(contractToSignal(c, quote, underlierPrice, prevClose, realizedVol, news));
          }
          console.log(
            `[alpaca-data] ${underlier}: ${contracts.length} contracts (${withQuotes} with quotes, RV=${(realizedVol * 100).toFixed(0)}%)` +
            (news?.headline ? ` [news: ${news.headline.slice(0, 60)}]` : ""),
          );
        } catch (err) {
          console.warn(`[alpaca-data] Failed to fetch chain for ${underlier}:`, err instanceof Error ? err.message : String(err));
        }
      }

      // Apply liquidity filter: use the quote-depth notional proxy for options
      // (no volume field exists on the Basic plan).
      if (config.minLiquidityUsd && config.minLiquidityUsd > 0) {
        return signals.filter((s) => {
          const notional = (s.metadata?.quoteNotionalUsd as number) ?? 0;
          return notional >= config.minLiquidityUsd!;
        });
      }

      return signals;
    },

    async fetchHistorical(symbol: string, days: number): Promise<Kline[]> {
      if (!isConfigured()) return [];

      // Underlier bars (options don't have their own bars on the Basic plan).
      const underlier = symbol.match(/^[A-Z]+/)?.[0] ?? symbol;
      const end = new Date();
      const start = new Date(Date.now() - days * 86400000);

      try {
        // Basic plan allows only the `iex` feed for historical stock bars
        // (the default `sip` feed returns 403 "subscription does not permit
        // querying recent SIP data").
        const res = await alpacaGet(
          `/v2/stocks/bars?symbols=${encodeURIComponent(underlier)}&timeframe=1Day&feed=iex` +
            `&start=${start.toISOString()}&end=${end.toISOString()}`,
        ) as { bars?: Record<string, AlpacaBar[]> };

        return (res.bars?.[underlier] ?? []).map(barToKline);
      } catch (err) {
        console.warn(`[alpaca-data] Failed to fetch bars for ${underlier}:`, err instanceof Error ? err.message : String(err));
        return [];
      }
    },

    async healthCheck(): Promise<boolean> {
      if (!isConfigured()) return false;
      try {
        // Verify the account is active.
        const account = await alpacaGet("/v2/account", ALPACA_TRADING_BASE);
        return account?.status === "ACTIVE";
      } catch {
        return false;
      }
    },
  };
}

let _instance: DataSource | null = null;
export function getAlpacaDataAdapter(): DataSource {
  if (!_instance) _instance = createAlpacaDataAdapter();
  return _instance;
}
