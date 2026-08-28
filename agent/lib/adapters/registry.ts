/**
 * Harness Adapter Registry
 *
 * Maps domain adapter names to their implementations. The harness config
 * selects a domain (crypto / options), and the registry resolves the adapter
 * triple: data source, conviction factors, trade executor.
 *
 * The registry is the single switch point — the loop, LLM ladder, jury,
 * verification, self-analysis, and anchoring all import from the interfaces
 * and never know which concrete adapter is active.
 *
 * New domains register here:
 *   1. Implement the three adapter interfaces.
 *   2. Add the adapter names to DOMAIN_PROFILES in harness-config.ts.
 *   3. Register the factories in the maps below.
 */

import type { DataSource } from "./data-source.js";
import type { ConvictionFactors } from "./conviction-factors.js";
import type { TradeExecutor } from "./executor.js";
import type { HarnessConfig } from "../harness-config.js";

// Crypto domain adapters (wrapping the existing implementations).
import { getSosovalueAdapter } from "./sosovalue-adapter.js";
import { getCryptoConvictionAdapter } from "./crypto-conviction.js";
import { getTwakAdapter } from "./twak-adapter.js";

// Options domain adapters (Alpaca — new implementations).
import { getAlpacaDataAdapter } from "./alpaca-data.js";
import { getOptionsConvictionAdapter } from "./options-conviction.js";
import { getAlpacaExecutor } from "./alpaca-executor.js";

// =============================================================================
// Registry Maps
// =============================================================================

export interface AdapterBundle {
  dataSource: DataSource;
  convictionFactors: ConvictionFactors;
  executor: TradeExecutor;
}

const DATA_SOURCES: Record<string, () => DataSource> = {
  sosovalue: getSosovalueAdapter,
  alpaca: getAlpacaDataAdapter,
};

const CONVICTION_FACTORS: Record<string, () => ConvictionFactors> = {
  crypto: getCryptoConvictionAdapter,
  options: getOptionsConvictionAdapter,
};

const EXECUTORS: Record<string, () => TradeExecutor> = {
  twak: getTwakAdapter,
  alpaca: getAlpacaExecutor,
};

// =============================================================================
// Resolution
// =============================================================================

/**
 * Resolve the adapter bundle for a given harness config.
 *
 * Throws a clear error if any adapter name is not registered — the caller
 * should surface this at startup, not mid-cycle.
 */
export function resolveAdapters(config: HarnessConfig): AdapterBundle {
  const dsFactory = DATA_SOURCES[config.adapters.dataSource];
  const cfFactory = CONVICTION_FACTORS[config.adapters.convictionFactors];
  const exFactory = EXECUTORS[config.adapters.executor];

  if (!dsFactory) {
    throw new Error(
      `[harness] No data source adapter registered for "${config.adapters.dataSource}" (domain: "${config.domain}"). ` +
      `Registered: ${Object.keys(DATA_SOURCES).join(", ")}`,
    );
  }
  if (!cfFactory) {
    throw new Error(
      `[harness] No conviction factors adapter registered for "${config.adapters.convictionFactors}" (domain: "${config.domain}"). ` +
      `Registered: ${Object.keys(CONVICTION_FACTORS).join(", ")}`,
    );
  }
  if (!exFactory) {
    throw new Error(
      `[harness] No trade executor adapter registered for "${config.adapters.executor}" (domain: "${config.domain}"). ` +
      `Registered: ${Object.keys(EXECUTORS).join(", ")}`,
    );
  }

  return {
    dataSource: dsFactory(),
    convictionFactors: cfFactory(),
    executor: exFactory(),
  };
}

/**
 * Register a custom adapter at runtime.
 *
 * Used by tests and by future domains that don't want to modify this file.
 */
export function registerDataSource(name: string, factory: () => DataSource): void {
  DATA_SOURCES[name] = factory;
}

export function registerConvictionFactors(name: string, factory: () => ConvictionFactors): void {
  CONVICTION_FACTORS[name] = factory;
}

export function registerExecutor(name: string, factory: () => TradeExecutor): void {
  EXECUTORS[name] = factory;
}

/**
 * List all registered adapter names — for startup diagnostics.
 */
export function listRegisteredAdapters(): {
  dataSources: string[];
  convictionFactors: string[];
  executors: string[];
} {
  return {
    dataSources: Object.keys(DATA_SOURCES),
    convictionFactors: Object.keys(CONVICTION_FACTORS),
    executors: Object.keys(EXECUTORS),
  };
}
