/**
 * Alpaca Data Source — Options Market Data Adapter
 *
 * Implements the harness DataSource interface for the "options" domain using
 * Alpaca's Market Data API + Trading API. Fetches options chains, implied
 * volatility, greeks, underlier price, and historical bars.
 *
 * Alpaca API reference:
 *   - Trading API:  https://paper-api.alpaca.markets (paper) / api.alpaca.markets (live)
 *   - Market Data:  https://data.alpaca.markets/v2
 *   - Options:      /v2/stocks/{symbol}/options/contracts
 *   - Bars:         /v2/stocks/{symbol}/bars
 *   - Snapshots:    /v2/stocks/{symbol}/snapshots
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
// API Calls
// =============================================================================

interface AlpacaOptionContract {
  symbol: string; // e.g. "AAPL240315C00150000"
  underlying_symbol: string; // e.g. "AAPL"
  option_type: string; // "call" | "put"
  strike_price: string;
  expiration_date: string; // ISO date
  implied_volatility?: string;
  delta?: string;
  gamma?: string;
  theta?: string;
  vega?: string;
  open_interest?: string;
  volume?: string;
  bid?: string;
  ask?: string;
  close?: string;
}

interface AlpacaBar {
  t: string; // ISO timestamp
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface AlpacaSnapshot {
  latest_trade: { p: number };
  prev_daily_bar: { c: number };
  daily_bar: { c: number };
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

/** Map an Alpaca option contract to a MarketSignal. */
function contractToSignal(c: AlpacaOptionContract, underlierPrice: number, prevClose: number): MarketSignal {
  const strike = parseFloat(c.strike_price);
  const expiry = c.expiration_date;
  const price = parseFloat(c.close ?? c.ask ?? "0");
  const iv = parseFloat(c.implied_volatility ?? "0");
  const volume = parseFloat(c.volume ?? "0");

  // 7d price change of the underlier (proxy — options don't have their own 7d).
  const priceChange7d = prevClose > 0 ? ((underlierPrice - prevClose) / prevClose) * 100 : 0;

  return {
    symbol: c.symbol,
    name: `${c.underlying_symbol} ${c.option_type.toUpperCase()} ${strike} ${expiry}`,
    price,
    priceChange24hPercent: priceChange7d, // options 24h ≈ underlier 24h
    priceChange7dPercent: priceChange7d,
    volume24h: volume,
    marketCap: 0, // N/A for options
    metadata: {
      underlyingSymbol: c.underlying_symbol,
      contractType: c.option_type,
      strike,
      expiry,
      impliedVolatility: iv,
      delta: parseFloat(c.delta ?? "0"),
      gamma: parseFloat(c.gamma ?? "0"),
      theta: parseFloat(c.theta ?? "0"),
      vega: parseFloat(c.vega ?? "0"),
      openInterest: parseFloat(c.open_interest ?? "0"),
      bid: parseFloat(c.bid ?? "0"),
      ask: parseFloat(c.ask ?? "0"),
      underlierPrice,
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

// =============================================================================
// Adapter
// =============================================================================

/**
 * Create an Alpaca-backed DataSource adapter for options market data.
 *
 * `fetchSignals` fetches the options chain for the configured underliers,
 * enriches each contract with greeks/IV/OI, and returns MarketSignal[].
 */
export function createAlpacaDataAdapter(): DataSource {
  return {
    async fetchSignals(config: SignalRequest): Promise<MarketSignal[]> {
      if (!isConfigured()) {
        console.warn("[alpaca-data] API keys not configured — returning empty signals");
        return [];
      }

      // Default underliers: the S&P 500 + high-liquid names. Override via
      // ALPACA_UNDERLIERS env var (comma-separated).
      const underliers =
        config.symbols ??
        (process.env.ALPACA_UNDERLIERS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [
          "AAPL", "MSFT", "NVDA", "TSLA", "SPY", "QQQ",
        ]);

      const signals: MarketSignal[] = [];

      for (const underlier of underliers) {
        try {
          // Fetch underlier snapshot for price + prev close.
          let underlierPrice = 0;
          let prevClose = 0;
          try {
            const snap = await alpacaGet(`/v2/stocks/${underlier}/snapshots`) as Record<string, AlpacaSnapshot>;
            const s = snap[underlier];
            if (s) {
              underlierPrice = s.latest_trade?.p ?? s.daily_bar?.c ?? 0;
              prevClose = s.prev_daily_bar?.c ?? 0;
            }
          } catch {
            // Snapshot failure is non-fatal — contracts still have their own close.
          }

          // Fetch the options chain.
          const chain = await alpacaGet(
            `/v2/stocks/${underlier}/options/contracts?limit=${config.limit ?? 100}`,
          ) as { option_contracts?: AlpacaOptionContract[] };

          const contracts = chain.option_contracts ?? [];
          for (const c of contracts) {
            signals.push(contractToSignal(c, underlierPrice, prevClose));
          }
        } catch (err) {
          console.warn(`[alpaca-data] Failed to fetch chain for ${underlier}:`, err instanceof Error ? err.message : String(err));
        }
      }

      // Apply liquidity filter.
      if (config.minLiquidityUsd && config.minLiquidityUsd > 0) {
        // For options, liquidity ≈ volume × price.
        return signals.filter((s) => s.volume24h * s.price >= config.minLiquidityUsd!);
      }

      return signals;
    },

    async fetchHistorical(symbol: string, days: number): Promise<Kline[]> {
      if (!isConfigured()) return [];

      // For options, we fetch the underlier's bars (options inherit the
      // underlier's price action for RSI/regime). The `symbol` may be a
      // contract symbol; we extract the underlier from metadata or the
      // symbol prefix.
      const underlier = symbol.match(/^[A-Z]+/)?.[0] ?? symbol;

      try {
        const bars = await alpacaGet(
          `/v2/stocks/${underlier}/bars?timeframe=1Day&limit=${Math.min(days, 200)}`,
        ) as { bars?: AlpacaBar[] };

        return (bars.bars ?? []).map(barToKline);
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

