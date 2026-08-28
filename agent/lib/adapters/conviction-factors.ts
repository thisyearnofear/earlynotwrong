/**
 * Harness Adapter — Conviction Factors Interface
 *
 * The second of three extension points. A conviction-factors adapter scores
 * a market signal into a 0–100 conviction score, with a transparent per-factor
 * breakdown for the dashboard.
 *
 * Implementations:
 *   - crypto-conviction.ts     (crypto: contrarian / RSI / quality / regime / holders)
 *   - options-conviction.ts    (options: IV contrarian / gamma squeeze / vol crush / …)
 *
 * The scoring framework stays the same (weighted factors, total 0–100), but
 * the factors change per domain. The harness loop doesn't care about the
 * individual factors — just that they sum to a conviction score.
 */

import type { ConvictionResult, FactorDefinition, Kline, MarketSignal } from "./types.js";

export interface ConvictionFactors {
  /**
   * Score a market signal into a 0–100 conviction result.
   *
   * `historical` provides klines for the underlier (RSI, regime, vol). The
   * adapter decides which factors use it and which use the signal's metadata.
   */
  score(signal: MarketSignal, historical: Kline[]): Promise<ConvictionResult>;

  /**
   * Static factor definitions — metadata for the dashboard so it can render
   * the scoring breakdown before any signal is scored.
   */
  factors(): FactorDefinition[];
}
