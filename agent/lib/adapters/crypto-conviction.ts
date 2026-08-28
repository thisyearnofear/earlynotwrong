/**
 * Crypto Conviction Factors Adapter
 *
 * Wraps the existing `conviction-signal.ts` to implement the harness
 * ConvictionFactors interface. This is the "crypto" domain's scoring
 * adapter. The existing 7-factor scoring engine (contrarian, RSI, quality,
 * regime, holders, volatility penalty, LLM jury) is unchanged — this file
 * maps the adapter types to/from the existing domain types.
 *
 * The adapter delegates to `scoreTokenConviction()` — the same pure function
 * the cycle-runner calls. It adds no new scoring logic.
 */

import type { ConvictionFactors } from "./conviction-factors.js";
import type {
  ConvictionResult,
  FactorDefinition,
  FactorScore,
  Kline,
  MarketSignal,
} from "./types.js";
import {
  scoreTokenConviction,
  scoreMarketRegime,
} from "../conviction-signal.js";
import { computeRSI14 } from "../data-providers.js";
import type { TokenQuote } from "../data-providers.js";
import { AGENT_CONFIG } from "../config.js";

/** Map a MarketSignal back to a TokenQuote for the existing scoring engine. */
function signalToTokenQuote(s: MarketSignal): TokenQuote {
  const meta = s.metadata ?? {};
  return {
    id: (meta.id as number) ?? 0,
    name: s.name,
    symbol: s.symbol,
    slug: (meta.slug as string) ?? s.symbol.toLowerCase(),
    price: s.price,
    volume24h: s.volume24h,
    marketCap: s.marketCap,
    percentChange1h: (meta.percentChange1h as number) ?? 0,
    percentChange24h: s.priceChange24hPercent,
    percentChange7d: s.priceChange7dPercent,
    lastUpdated: (meta.lastUpdated as string) ?? "",
  };
}

/** Map a Kline array back to SosovalueKline for the existing RSI computer. */
function klinesToSosovalue(klines: Kline[]) {
  return klines.map((k) => ({
    timestamp: k.timestamp,
    open: k.open,
    high: k.high,
    low: k.low,
    close: k.close,
    volume: k.volume,
  }));
}

/**
 * Create a crypto-domain ConvictionFactors adapter backed by the existing
 * conviction-signal engine.
 */
export function createCryptoConvictionAdapter(): ConvictionFactors {
  return {
    async score(signal: MarketSignal, historical: Kline[]): Promise<ConvictionResult> {
      const token = signalToTokenQuote(signal);

      // Build a neutral regime when no global metrics are available (the
      // adapter path doesn't have the full CmcMarketData). In the live
      // loop, the regime is computed by cycle-runner step 3 and the adapter
      // can receive it via signal metadata.
      const regime = scoreMarketRegime(
        (signal.metadata?.globalMetrics as any) ?? null,
        (signal.metadata?.derivatives as any) ?? null,
        (signal.metadata?.ssiConfirmation as number | null) ?? null,
      );

      // RSI from historical klines if available, else synthesize.
      let rsi14: number | null = null;
      if (historical.length >= 14) {
        try {
          rsi14 = computeRSI14(klinesToSosovalue(historical) as any);
        } catch {
          rsi14 = null;
        }
      }

      // Delegate to the existing scoring engine.
      const conviction = scoreTokenConviction(
        token,
        regime,
        (signal.metadata?.holderMetric as any) ?? undefined,
        (signal.metadata?.newsSentiment as number | null) ?? undefined,
        rsi14,
      );

      // Map the ConvictionSignal to the adapter's ConvictionResult.
      const breakdown: FactorScore[] = [
        { name: "contrarian", score: conviction.breakdown.contrarian, maxScore: conviction.weights.contrarian },
        { name: "rsi", score: conviction.breakdown.rsi, maxScore: conviction.weights.rsi },
        { name: "quality", score: conviction.breakdown.quality, maxScore: conviction.weights.quality },
        { name: "regime", score: conviction.breakdown.regime, maxScore: conviction.weights.regime },
        { name: "holders", score: conviction.breakdown.holders, maxScore: conviction.weights.holders },
        { name: "volatility_penalty", score: conviction.breakdown.volatilityPenalty, maxScore: conviction.weights.volatilityPenaltyMax, rationale: "Subtracted from the bonus total (erratic price path)." },
        { name: "news", score: conviction.breakdown.news, maxScore: conviction.weights.newsMax },
      ];

      if (conviction.breakdown.llmJury !== undefined) {
        breakdown.push({ name: "llm_jury", score: conviction.breakdown.llmJury, maxScore: 15, rationale: conviction.juryReasoning });
      }

      return { symbol: conviction.symbol, score: conviction.score, breakdown, rationale: conviction.rationale };
    },

    factors(): FactorDefinition[] {
      const w = AGENT_CONFIG.signal;
      return [
        { name: "contrarian", weight: w.contrarian, description: "Rewards weakness — quality assets down 7d during fear." },
        { name: "rsi", weight: w.rsi, description: "Rewards oversold timing (RSI < 35)." },
        { name: "quality", weight: w.quality, description: "Rewards liquidity & market cap size." },
        { name: "regime", weight: w.regime, description: "Rewards entering when the market is fearful." },
        { name: "holders", weight: w.holders, description: "Rewards on-chain holder base expansion." },
        { name: "volatility_penalty", weight: w.volatilityPenaltyMax, description: "Penalizes erratic 7d price paths." },
        { name: "news", weight: w.newsMax, description: "Net news sentiment adjustment (±)." },
        { name: "llm_jury", weight: 15, description: "LLM conviction jury ±15 adjustment (7th factor)." },
      ];
    },
  };
}

let _instance: ConvictionFactors | null = null;
export function getCryptoConvictionAdapter(): ConvictionFactors {
  if (!_instance) _instance = createCryptoConvictionAdapter();
  return _instance;
}
