/**
 * Harness Adapter — Data Source Interface
 *
 * The first of three extension points. A data source fetches market data
 * (tradable signals + historical klines) for the scoring layer.
 *
 * Implementations:
 *   - sosovalue-adapter.ts  (crypto: SoSoValue + CMC composite)
 *   - alpaca-data.ts        (options: Alpaca Market Data API)
 *
 * The harness loop calls `fetchSignals()` and `fetchHistorical()` — it never
 * knows whether the data came from SoSoValue or Alpaca.
 */

import type { Kline, MarketSignal, SignalRequest } from "./types.js";

export interface DataSource {
  /**
   * Fetch tradable market signals for the scoring layer.
   *
   * For crypto: returns token quotes (price, 7d change, volume, mcap).
   * For options: returns option contracts (IV, greeks, OI, bid/ask).
   */
  fetchSignals(config: SignalRequest): Promise<MarketSignal[]>;

  /**
   * Fetch historical OHLCV klines for a symbol.
   *
   * Used by the conviction factors for RSI / regime / vol calculations.
   * `days` is the lookback window (e.g. 30 = last 30 daily candles).
   */
  fetchHistorical(symbol: string, days: number): Promise<Kline[]>;

  /**
   * Verify the data source is reachable and configured.
   * Returns true when the adapter can serve live data.
   */
  healthCheck(): Promise<boolean>;
}
