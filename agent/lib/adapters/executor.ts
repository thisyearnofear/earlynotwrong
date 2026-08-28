/**
 * Harness Adapter — Trade Executor Interface
 *
 * The third of three extension points. An executor places and manages trades
 * through a broker or on-chain router.
 *
 * Implementations:
 *   - twak-adapter.ts        (crypto: Trust Wallet Agent Kit CLI on BSC)
 *   - alpaca-executor.ts     (options: Alpaca Trading API, paper trading)
 *
 * The harness loop calls `placeOrder()` and `closePosition()` — it never
 * knows whether the trade went through TWAK or Alpaca.
 */

import type { ExecutorHealth, Portfolio, PositionConfig, RiskCheck, SignalWithScore, TradeResult } from "./types.js";

export interface TradeExecutor {
  /**
   * Place an order to open a position.
   *
   * `signal` carries the conviction-scored tradable; `position` carries the
   * sizing and domain-specific entry parameters (strike, expiry, slippage…).
   */
  placeOrder(signal: SignalWithScore, position: PositionConfig): Promise<TradeResult>;

  /**
   * Close an existing position.
   *
   * `symbol` identifies the tradable; `positionId` is the broker/on-chain
   * identifier returned by placeOrder (or null for domain-agnostic closes).
   */
  closePosition(symbol: string, positionId: string): Promise<TradeResult>;

  /**
   * Pre-trade risk check — margin, position limits, concentration.
   *
   * Synchronous risk math (no network call) that can block an entry before
   * the order is ever placed.
   */
  manageRisk(signal: SignalWithScore, portfolio: Portfolio): RiskCheck;

  /**
   * Verify the executor is available and configured.
   * Returns mode (paper/live/simulator) and diagnostic details.
   */
  healthCheck(): Promise<ExecutorHealth>;
}
