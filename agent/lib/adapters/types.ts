/**
 * Harness Adapter — Shared Types
 *
 * Domain-agnostic types shared by all three adapter interfaces
 * (DataSource, ConvictionFactors, TradeExecutor). These are the contract
 * the harness loop depends on; each domain adapter maps its domain-specific
 * data to/from these generic structures.
 *
 * The principle: the loop imports from interfaces, not implementations.
 * Adding a new domain means writing three adapters that satisfy these types —
 * the loop, LLM ladder, jury, verification, self-analysis, and anchoring
 * are all unchanged.
 */

// =============================================================================
// Market Data Types
// =============================================================================

/**
 * OHLCV candlestick — the universal historical price unit.
 *
 * Timestamps are Unix **seconds** (matching the existing SosovalueKline
 * convention; the harness never uses millisecond klines internally).
 */
export interface Kline {
  /** Unix timestamp in seconds. */
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * A tradeable signal produced by a DataSource.
 *
 * For crypto: one row per token (symbol, price, 7d change, …).
 * For options: one row per contract (symbol = underlying, metadata carries
 * strike / expiry / IV / greeks).
 *
 * The `metadata` bag is intentionally open so each domain can attach
 * domain-specific fields without forcing the interface to know about them.
 */
export interface MarketSignal {
  /** Trading symbol — token ticker (crypto) or underlying + contract spec (options). */
  symbol: string;
  /** Human-readable name. */
  name: string;
  /** Current USD price of the tradable instrument. */
  price: number;
  /** 24-hour percent price change of the underlier. */
  priceChange24hPercent: number;
  /** 7-day percent price change of the underlier. */
  priceChange7dPercent: number;
  /** 24-hour trading volume in USD. */
  volume24h: number;
  /** Market capitalization in USD (0 if N/A for the domain). */
  marketCap: number;
  /**
   * Domain-specific extension data. The interface treats this as opaque;
   * the adapter that produced the signal is the only code that reads it.
   *
   * Crypto: { circulatingSupply, maxSupply, cmcRank, lastUpdated }
   * Options: { contractType, strike, expiry, iv, delta, gamma, theta, vega,
   *            openInterest, bid, ask }
   */
  metadata?: Record<string, unknown>;
}

/**
 * Request configuration for fetching signals from a data source.
 */
export interface SignalRequest {
  /** Specific symbols to fetch; omit for the full eligible universe. */
  symbols?: string[];
  /** Maximum number of signals to return. */
  limit?: number;
  /** Minimum liquidity in USD to be included (0 = no filter). */
  minLiquidityUsd?: number;
}

// =============================================================================
// Conviction Scoring Types
// =============================================================================

/**
 * The scored result for a single signal.
 */
export interface ConvictionResult {
  symbol: string;
  /** 0–100 conviction score. */
  score: number;
  /** Per-factor breakdown (transparent for the dashboard). */
  breakdown: FactorScore[];
  /** Human-readable rationale for logs and the dashboard. */
  rationale: string;
}

/**
 * A single factor's contribution to the conviction score.
 */
export interface FactorScore {
  name: string;
  /** Actual points awarded (may be negative for penalties). */
  score: number;
  /** Maximum possible points for this factor. */
  maxScore: number;
  /** Optional explanation of why this factor scored what it did. */
  rationale?: string;
}

/**
 * Static metadata describing a scoring factor — for dashboard rendering.
 */
export interface FactorDefinition {
  name: string;
  /** Weight (max points) of this factor in the total score. */
  weight: number;
  description: string;
}

// =============================================================================
// Trade Execution Types
// =============================================================================

/**
 * A signal paired with its conviction score — the input to the executor.
 */
export interface SignalWithScore {
  signal: MarketSignal;
  conviction: ConvictionResult;
}

/**
 * Configuration for entering a position.
 */
export interface PositionConfig {
  /** Dollar size of the position to open. */
  sizeUsd: number;
  /** Direction. */
  side: "long" | "short";
  /** Order type (market if omitted). */
  orderType?: "market" | "limit";
  /** Limit price (required when orderType is "limit"). */
  limitPrice?: number;
  /** Slippage tolerance in basis points (100 = 1%). */
  slippageBps?: number;
  /**
   * Domain-specific entry parameters.
   * Crypto: { tokenIn, tokenOut }
   * Options: { contractType, strike, expiry, quantity, legs }
   */
  metadata?: Record<string, unknown>;
}

/**
 * Result of placing or closing an order.
 */
export interface TradeResult {
  success: boolean;
  /** Broker / on-chain order ID on success. */
  orderId?: string;
  symbol: string;
  /** Fill price on success. */
  executedPrice?: number;
  /** Filled quantity on success. */
  executedQuantity?: number;
  /** Executed dollar value on success. */
  executedValueUsd?: number;
  /** Error message on failure. */
  error?: string;
  timestamp: number;
}

/**
 * A position in the portfolio, as seen by the executor.
 */
export interface AdapterPosition {
  symbol: string;
  /** Broker / on-chain position identifier (nullable for some domains). */
  positionId?: string;
  /** Quantity held (shares, contracts, or token amount). */
  quantity: number;
  /** Average entry price in USD. */
  avgEntryPrice: number;
  /** Current mark price in USD. */
  currentPrice: number;
  /** Current market value in USD. */
  valueUsd: number;
  /** Unrealized P&L in USD. */
  unrealizedPnlUsd: number;
  /** Unrealized P&L as a percent of cost basis. */
  unrealizedPnlPercent: number;
  /** Domain-specific position data (greeks, token address, etc.). */
  metadata?: Record<string, unknown>;
}

/**
 * Portfolio snapshot from the executor's perspective.
 */
export interface Portfolio {
  totalValueUsd: number;
  /** Available cash / buying power in USD. */
  cashUsd: number;
  positions: AdapterPosition[];
}

/**
 * Result of a pre-trade risk check.
 */
export interface RiskCheck {
  approved: boolean;
  /** Reason for rejection (when approved is false). */
  reason?: string;
  /** Maximum position size in USD the risk layer will allow. */
  maxPositionUsd?: number;
  /** Margin required for this trade (options/leverage domains). */
  marginRequired?: number;
  /** Margin currently available. */
  marginAvailable?: number;
}

/**
 * Executor health-check result.
 */
export interface ExecutorHealth {
  healthy: boolean;
  /** Operating mode label (e.g. "paper", "live", "simulator"). */
  mode: string;
  /** Additional diagnostic details. */
  details?: Record<string, unknown>;
}

