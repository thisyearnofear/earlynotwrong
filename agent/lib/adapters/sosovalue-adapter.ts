/**
 * Crypto Data Source — SoSoValue + CMC Composite Adapter
 *
 * Wraps the existing `data-providers.ts` (SosovalueClient + CmcClient) to
 * implement the harness DataSource interface. This is the "crypto" domain's
 * data source adapter. The existing code is unchanged — this file is a thin
 * mapping layer that conforms to the adapter contract.
 *
 * The existing agent (cycle-runner.ts) still calls the clients directly;
 * this adapter exists so the harness loop can call `fetchSignals()` /
 * `fetchHistorical()` through the interface, enabling domain swapping.
 */

import type { DataSource } from "./data-source.js";
import type { Kline, MarketSignal, SignalRequest } from "./types.js";
import { sosovalueClient, cmcClient } from "../data-providers.js";
import type { TokenQuote, SosovalueKline } from "../data-providers.js";
import { AGENT_CONFIG } from "../config.js";

/** Map a TokenQuote (existing domain type) to a MarketSignal (adapter type). */
function tokenQuoteToSignal(t: TokenQuote): MarketSignal {
  return {
    symbol: t.symbol,
    name: t.name,
    price: t.price,
    priceChange24hPercent: t.percentChange24h,
    priceChange7dPercent: t.percentChange7d,
    volume24h: t.volume24h,
    marketCap: t.marketCap,
    metadata: {
      id: t.id,
      slug: t.slug,
      lastUpdated: t.lastUpdated,
    },
  };
}

/** Map a SosovalueKline (existing type) to a Kline (adapter type). */
function klineToAdapter(k: SosovalueKline): Kline {
  return {
    timestamp: k.timestamp,
    open: k.open,
    high: k.high,
    low: k.low,
    close: k.close,
    volume: k.volume,
  };
}

/**
 * Create a SoSoValue-backed DataSource adapter.
 *
 * The adapter delegates to the existing singleton clients — it adds no
 * new state and makes no new network calls beyond what the existing agent
 * already does.
 */
export function createSosovalueAdapter(): DataSource {
  return {
    async fetchSignals(config: SignalRequest): Promise<MarketSignal[]> {
      // Reuse the existing fetchMarketData path: SoSoValue preferred,
      // CMC fills missing tokens (same merge logic as cycle-runner step 2).
      const ssvData = await sosovalueClient.fetchMarketData().catch(() => null);
      const cmcData = await cmcClient.fetchGlobalData().catch(() => null);

      let tokenPrices: TokenQuote[] = ssvData?.tokenPrices ?? [];

      // CMC fallback for missing tokens when SoSoValue returns nothing.
      if (tokenPrices.length === 0 && cmcData) {
        tokenPrices = await cmcClient.getEligibleTokenQuotes().catch(() => []);
      } else if (cmcData) {
        // Merge: SoSoValue preferred, CMC fills gaps.
        const ssvSymbols = new Set(tokenPrices.map((t) => t.symbol.toUpperCase()));
        const cmcPrices = await cmcClient.getEligibleTokenQuotes().catch(() => []);
        for (const cmcToken of cmcPrices) {
          if (!ssvSymbols.has(cmcToken.symbol.toUpperCase())) {
            tokenPrices.push(cmcToken);
          }
        }
      }

      let signals = tokenPrices.map(tokenQuoteToSignal);

      // Apply symbol filter if specified.
      if (config.symbols && config.symbols.length > 0) {
        const wanted = new Set(config.symbols.map((s) => s.toUpperCase()));
        signals = signals.filter((s) => wanted.has(s.symbol.toUpperCase()));
      }

      // Apply liquidity filter.
      if (config.minLiquidityUsd && config.minLiquidityUsd > 0) {
        signals = signals.filter(
          (s) => s.volume24h >= config.minLiquidityUsd! || s.marketCap >= config.minLiquidityUsd!,
        );
      }

      // Apply limit.
      if (config.limit && config.limit > 0) {
        signals = signals.slice(0, config.limit);
      }

      return signals;
    },

    async fetchHistorical(symbol: string, days: number): Promise<Kline[]> {
      // Delegate to the existing klines fetcher (symbol → currency ID → klines).
      const klines = await sosovalueClient.fetchKlinesBySymbol(symbol, "1d", Math.min(days, 200));
      return klines.map(klineToAdapter);
    },

    async healthCheck(): Promise<boolean> {
      // The SoSoValue client is "healthy" when the API key is set (even if
      // the current request budget is exhausted — the breaker will self-heal).
      // Without a key, all calls short-circuit to CMC/fallback data.
      return !!process.env.SOSOVALUE_API_KEY || !!process.env.CMC_API_KEY;
    },
  };
}

/**
 * A pre-built instance for the adapter registry.
 * Created lazily so module evaluation doesn't trigger client construction.
 */
let _instance: DataSource | null = null;
export function getSosovalueAdapter(): DataSource {
  if (!_instance) _instance = createSosovalueAdapter();
  return _instance;
}

/** Re-export the eligible token list for adapter consumers. */
export function getEligibleSymbols(): string[] {
  return [...AGENT_CONFIG.competition.eligibleTokens];
}
