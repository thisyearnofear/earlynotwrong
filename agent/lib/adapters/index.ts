/**
 * Harness Adapters — barrel export.
 *
 * The harness loop and startup code import from this file to get the
 * resolved adapter bundle. Individual adapters can also be imported
 * directly when fine-grained access is needed.
 *
 * Usage:
 *   import { resolveAdapters } from "./lib/adapters/index.js";
 *   const { dataSource, convictionFactors, executor } = resolveAdapters(HARNESS_CONFIG);
 */

export type { DataSource } from "./data-source.js";
export type { ConvictionFactors } from "./conviction-factors.js";
export type { TradeExecutor } from "./executor.js";

export type {
  Kline,
  MarketSignal,
  SignalRequest,
  ConvictionResult,
  FactorScore,
  FactorDefinition,
  SignalWithScore,
  PositionConfig,
  TradeResult,
  AdapterPosition,
  Portfolio,
  RiskCheck,
  ExecutorHealth,
} from "./types.js";

export {
  resolveAdapters,
  registerDataSource,
  registerConvictionFactors,
  registerExecutor,
  listRegisteredAdapters,
} from "./registry.js";
export type { AdapterBundle } from "./registry.js";

// Crypto domain adapters.
export { createSosovalueAdapter, getSosovalueAdapter, getEligibleSymbols } from "./sosovalue-adapter.js";
export { createCryptoConvictionAdapter, getCryptoConvictionAdapter } from "./crypto-conviction.js";
export { createTwakAdapter, getTwakAdapter } from "./twak-adapter.js";

// Options domain adapters (Alpaca).
export { createAlpacaDataAdapter, getAlpacaDataAdapter } from "./alpaca-data.js";
export { createAlpacaExecutor, getAlpacaExecutor, fetchAlpacaPortfolio } from "./alpaca-executor.js";
export { createOptionsConvictionAdapter, getOptionsConvictionAdapter, OPTIONS_WEIGHTS } from "./options-conviction.js";

// Harness config.
export { resolveHarnessConfig, HARNESS_CONFIG, DOMAIN_PROFILES } from "../harness-config.js";
export type { Domain, HarnessConfig } from "../harness-config.js";
