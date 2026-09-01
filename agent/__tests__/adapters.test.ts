/**
 * Harness Adapter Tests
 *
 * Tests the three adapter interfaces, the crypto domain wrappers (which
 * wrap the existing implementations), the Alpaca options domain adapters,
 * the harness config layer, and the adapter registry.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createCryptoConvictionAdapter,
  createOptionsConvictionAdapter,
  createSosovalueAdapter,
  createAlpacaDataAdapter,
  createAlpacaExecutor,
  createTwakAdapter,
  resolveAdapters,
  resolveHarnessConfig,
  registerDataSource,
  registerConvictionFactors,
  registerExecutor,
  listRegisteredAdapters,
  OPTIONS_WEIGHTS,
} from "../lib/adapters/index.js";
import type {
  MarketSignal,
  Kline,
  ConvictionResult,
  FactorDefinition,
} from "../lib/adapters/types.js";
import type { DataSource, ConvictionFactors, TradeExecutor } from "../lib/adapters/index.js";

// =============================================================================
// Test Helpers
// =============================================================================

function makeCryptoSignal(overrides: Partial<MarketSignal> = {}): MarketSignal {
  return {
    symbol: "TWT",
    name: "Trust Wallet Token",
    price: 1.0,
    priceChange24hPercent: -5,
    priceChange7dPercent: -25,
    volume24h: 25_000_000,
    marketCap: 500_000_000,
    metadata: { id: 1, slug: "trust-wallet-token", lastUpdated: "" },
    ...overrides,
  };
}

function makeOptionsSignal(overrides: Partial<MarketSignal> = {}): MarketSignal {
  return {
    symbol: "AAPL240315C00150000",
    name: "AAPL CALL 150 2024-03-15",
    price: 5.0,
    priceChange24hPercent: 2,
    priceChange7dPercent: 5,
    volume24h: 10_000,
    marketCap: 0,
    metadata: {
      underlyingSymbol: "AAPL",
      contractType: "call",
      strike: 150,
      expiry: "2024-03-15",
      impliedVolatility: 0.45,
      ivAvailable: true,
      ivToRealized: 0,
      realizedVol: 0,
      delta: 0.5,
      gamma: 0.02,
      theta: -0.05,
      vega: 0.1,
      openInterest: 5000,
      bid: 4.9,
      ask: 5.1,
      underlierPrice: 155,
      earningsNear: false,
      newsHeadline: null,
      newsSummary: null,
      newsSentiment: "neutral",
    },
    ...overrides,
  };
}

function makeKlines(count: number, basePrice = 100): Kline[] {
  const klines: Kline[] = [];
  for (let i = 0; i < count; i++) {
    const noise = (i % 7) - 3;
    const close = basePrice + noise * 2;
    klines.push({
      timestamp: 1700000000 + i * 86400,
      open: basePrice + noise,
      high: close + 2,
      low: close - 2,
      close,
      volume: 1000000,
    });
  }
  return klines;
}

// =============================================================================
// Harness Config
// =============================================================================

describe("Harness Config", () => {
  it("defaults to crypto domain", () => {
    const original = process.env.HARNESS_DOMAIN;
    delete process.env.HARNESS_DOMAIN;
    const config = resolveHarnessConfig();
    expect(config.domain).toBe("crypto");
    expect(config.adapters.dataSource).toBe("sosovalue");
    expect(config.adapters.convictionFactors).toBe("crypto");
    expect(config.adapters.executor).toBe("twak");
    if (original) process.env.HARNESS_DOMAIN = original;
  });

  it("switches to options domain when HARNESS_DOMAIN=options", () => {
    const original = process.env.HARNESS_DOMAIN;
    process.env.HARNESS_DOMAIN = "options";
    const config = resolveHarnessConfig();
    expect(config.domain).toBe("options");
    expect(config.adapters.dataSource).toBe("alpaca");
    expect(config.adapters.convictionFactors).toBe("options");
    expect(config.adapters.executor).toBe("alpaca");
    if (original) process.env.HARNESS_DOMAIN = original;
    else delete process.env.HARNESS_DOMAIN;
  });

  it("returns unknown adapters for unrecognized domain", () => {
    const original = process.env.HARNESS_DOMAIN;
    process.env.HARNESS_DOMAIN = "forex";
    const config = resolveHarnessConfig();
    expect(config.domain).toBe("forex");
    expect(config.adapters.dataSource).toBe("unknown");
    if (original) process.env.HARNESS_DOMAIN = original;
    else delete process.env.HARNESS_DOMAIN;
  });
});

// =============================================================================
// Adapter Registry
// =============================================================================

describe("Adapter Registry", () => {
  it("resolves the crypto adapter bundle", () => {
    const bundle = resolveAdapters(resolveHarnessConfig());
    expect(bundle.dataSource).toBeDefined();
    expect(bundle.convictionFactors).toBeDefined();
    expect(bundle.executor).toBeDefined();
  });

  it("resolves the options adapter bundle", () => {
    const original = process.env.HARNESS_DOMAIN;
    process.env.HARNESS_DOMAIN = "options";
    const bundle = resolveAdapters(resolveHarnessConfig());
    expect(bundle.dataSource).toBeDefined();
    expect(bundle.convictionFactors).toBeDefined();
    expect(bundle.executor).toBeDefined();
    if (original) process.env.HARNESS_DOMAIN = original;
    else delete process.env.HARNESS_DOMAIN;
  });

  it("lists all registered adapters", () => {
    const registered = listRegisteredAdapters();
    expect(registered.dataSources).toContain("sosovalue");
    expect(registered.dataSources).toContain("alpaca");
    expect(registered.convictionFactors).toContain("crypto");
    expect(registered.convictionFactors).toContain("options");
    expect(registered.executors).toContain("twak");
    expect(registered.executors).toContain("alpaca");
  });

  it("throws a clear error for an unregistered data source", () => {
    expect(() =>
      resolveAdapters({ domain: "test", adapters: { dataSource: "nonexistent", convictionFactors: "crypto", executor: "twak" } }),
    ).toThrow(/No data source adapter registered/);
  });

  it("supports runtime adapter registration", () => {
    const mockDs: DataSource = {
      fetchSignals: async () => [],
      fetchHistorical: async () => [],
      healthCheck: async () => true,
    };
    registerDataSource("test-custom", () => mockDs);
    const registered = listRegisteredAdapters();
    expect(registered.dataSources).toContain("test-custom");
  });
});

// =============================================================================
// Crypto Conviction Factors
// =============================================================================

describe("Crypto Conviction Adapter", () => {
  const adapter = createCryptoConvictionAdapter();

  it("returns factor definitions with correct weights", () => {
    const defs = adapter.factors();
    expect(defs.length).toBeGreaterThanOrEqual(7);
    const contrarian = defs.find((d) => d.name === "contrarian");
    expect(contrarian).toBeDefined();
    expect(contrarian!.weight).toBe(30);
  });

  it("scores a signal with a 0-100 result", async () => {
    const signal = makeCryptoSignal();
    const result = await adapter.score(signal, makeKlines(30));
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.symbol).toBe("TWT");
    expect(result.breakdown.length).toBeGreaterThanOrEqual(7);
    expect(result.rationale).toBeTruthy();
  });

  it("scores contrarian entries higher in a fearful market", async () => {
    const fearful = makeCryptoSignal({
      priceChange7dPercent: -30,
      metadata: {
        globalMetrics: { fearGreedIndex: 10 } as any,
        derivatives: { btcFundingRate: -0.02, ethFundingRate: -0.02 } as any,
      },
    });
    const result = await adapter.score(fearful, makeKlines(30));
    expect(result.score).toBeGreaterThan(40);
  });

  it("scores momentum/chasing low (contrarian thesis)", async () => {
    const chasing = makeCryptoSignal({ priceChange7dPercent: 30 });
    const result = await adapter.score(chasing, makeKlines(30));
    expect(result.score).toBeLessThan(40);
  });
});

// =============================================================================
// Options Conviction Factors
// =============================================================================

describe("Options Conviction Adapter", () => {
  const adapter = createOptionsConvictionAdapter();

  it("returns 8 factor definitions summing to 100", () => {
    const defs = adapter.factors();
    expect(defs.length).toBe(8);
    const total = defs.reduce((sum, d) => sum + d.weight, 0);
    expect(total).toBe(100);
  });

  it("includes options-specific factors", () => {
    const defs = adapter.factors();
    const names = defs.map((d) => d.name);
    expect(names).toContain("iv_contrarian");
    expect(names).toContain("gamma_squeeze_risk");
    expect(names).toContain("earnings_vol_crush");
    expect(names).toContain("vanna_charm_penalty");
  });

  it("scores a high-IV signal with a low IV-contrarian contribution (avoid buying rich premium)", async () => {
    const highIv = makeOptionsSignal({
      metadata: { ...makeOptionsSignal().metadata, impliedVolatility: 0.9, gamma: 0.001, theta: -0.01 },
    });
    const result = await adapter.score(highIv, makeKlines(30, 155));
    const ivFactor = result.breakdown.find((f) => f.name === "iv_contrarian");
    // Fallback absolute band: IV >= 0.6 → 0.25 fraction → 5 points (out of 20).
    expect(ivFactor!.score).toBeLessThanOrEqual(5);
  });
  it("scores premium rich relative to realized vol as low-conviction (IV/RV >= 1.4, avoid)", async () => {
    const rich = makeOptionsSignal({
      metadata: {
        ...makeOptionsSignal().metadata,
        impliedVolatility: 0.6,
        realizedVol: 0.3,
        ivToRealized: 2.0,
        gamma: 0.001,
        theta: -0.01,
      },
    });
    const result = await adapter.score(rich, makeKlines(30, 155));
    const ivFactor = result.breakdown.find((f) => f.name === "iv_contrarian");
    expect(ivFactor!.score).toBeLessThanOrEqual(5);
  });
  it("scores premium cheap relative to realized vol as high-conviction (IV/RV <= 0.9, buy)", async () => {
    const cheap = makeOptionsSignal({
      metadata: {
        ...makeOptionsSignal().metadata,
        impliedVolatility: 0.25,
        realizedVol: 0.35,
        ivToRealized: 0.71,
        gamma: 0.001,
        theta: -0.01,
      },
    });
    const result = await adapter.score(cheap, makeKlines(30, 155));
    const ivFactor = result.breakdown.find((f) => f.name === "iv_contrarian");
    expect(ivFactor!.score).toBeGreaterThanOrEqual(13);
  });
  it("treats a degenerate near-zero IV as neutral, not a cheap-premium buy", async () => {
    // A stale quote (mid at/below intrinsic) yields IV ≈ 0 and IV/RV ≈ 0.
    // That is "no real market", not "super cheap premium" — the factor must
    // not fabricate a max buy edge from it.
    const deg = makeOptionsSignal({
      metadata: {
        ...makeOptionsSignal().metadata,
        impliedVolatility: 0.0001,
        realizedVol: 0.35,
        ivToRealized: 0.0003,
        gamma: 0.001,
        theta: -0.01,
      },
    });
    const result = await adapter.score(deg, makeKlines(30, 155));
    const ivFactor = result.breakdown.find((f) => f.name === "iv_contrarian");
    // Neutral 0.5 fraction → 10 points out of 20, not 20 (max buy).
    expect(ivFactor!.score).toBe(10);
  });

  it("penalizes high gamma (squeeze risk)", async () => {
    const highGamma = makeOptionsSignal({
      metadata: { ...makeOptionsSignal().metadata, gamma: 0.15 },
    });
    const result = await adapter.score(highGamma, makeKlines(30, 155));
    const gammaFactor = result.breakdown.find((f) => f.name === "gamma_squeeze_risk");
    expect(gammaFactor!.score).toBeLessThan(0);
  });

  it("produces a 0-100 score", async () => {
    const signal = makeOptionsSignal();
    const result = await adapter.score(signal, makeKlines(30, 155));
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.symbol).toBe(signal.symbol);
  });

  it("scores a put higher on overbought RSI than on oversold RSI", async () => {
    const overbought = makeKlines(20, 155).map((k, i) => ({ ...k, close: 100 + i * 3 }));
    const oversold = makeKlines(20, 155).map((k, i) => ({ ...k, close: 160 - i * 3 }));
    const put = makeOptionsSignal({
      metadata: { ...makeOptionsSignal().metadata, contractType: "put", delta: -0.4 },
    });
    const high = await adapter.score(put, overbought);
    const low = await adapter.score(put, oversold);
    const highRsi = high.breakdown.find((f) => f.name === "rsi_delta")!.score;
    const lowRsi = low.breakdown.find((f) => f.name === "rsi_delta")!.score;
    expect(highRsi).toBeGreaterThan(lowRsi);
  });

  it("penalizes earnings-near for a long-premium book", async () => {
    const near = makeOptionsSignal({
      metadata: { ...makeOptionsSignal().metadata, earningsNear: true },
    });
    const clear = makeOptionsSignal({
      metadata: { ...makeOptionsSignal().metadata, earningsNear: false },
    });
    const a = await adapter.score(near, makeKlines(30, 155));
    const b = await adapter.score(clear, makeKlines(30, 155));
    const nearF = a.breakdown.find((f) => f.name === "earnings_vol_crush")!.score;
    const clearF = b.breakdown.find((f) => f.name === "earnings_vol_crush")!.score;
    expect(nearF).toBeLessThan(0);
    expect(clearF).toBeGreaterThan(0);
  });
});

// =============================================================================
// Crypto Data Source (SoSoValue Adapter)
// =============================================================================

describe("SoSoValue Data Source Adapter", () => {
  const adapter = createSosovalueAdapter();

  it("implements the DataSource interface", () => {
    expect(typeof adapter.fetchSignals).toBe("function");
    expect(typeof adapter.fetchHistorical).toBe("function");
    expect(typeof adapter.healthCheck).toBe("function");
  });

  it("healthCheck returns a boolean", async () => {
    const result = await adapter.healthCheck();
    expect(typeof result).toBe("boolean");
  });
});

// =============================================================================
// Alpaca Data Source
// =============================================================================

describe("Alpaca Data Source Adapter", () => {
  const adapter = createAlpacaDataAdapter();

  it("implements the DataSource interface", () => {
    expect(typeof adapter.fetchSignals).toBe("function");
    expect(typeof adapter.fetchHistorical).toBe("function");
    expect(typeof adapter.healthCheck).toBe("function");
  });

  it("returns empty signals when not configured", async () => {
    const originalKey = process.env.ALPACA_API_KEY_ID;
    const originalSecret = process.env.ALPACA_API_SECRET_KEY;
    delete process.env.ALPACA_API_KEY_ID;
    delete process.env.ALPACA_API_SECRET_KEY;
    const signals = await adapter.fetchSignals({ symbols: ["AAPL"] });
    expect(signals).toEqual([]);
    if (originalKey) process.env.ALPACA_API_KEY_ID = originalKey;
    if (originalSecret) process.env.ALPACA_API_SECRET_KEY = originalSecret;
  });
});

// =============================================================================
// Alpaca Executor
// =============================================================================

describe("Alpaca Executor Adapter", () => {
  const adapter = createAlpacaExecutor();

  it("implements the TradeExecutor interface", () => {
    expect(typeof adapter.placeOrder).toBe("function");
    expect(typeof adapter.closePosition).toBe("function");
    expect(typeof adapter.manageRisk).toBe("function");
    expect(typeof adapter.healthCheck).toBe("function");
  });

  it("placeOrder fails gracefully when not configured", async () => {
    const originalKey = process.env.ALPACA_API_KEY_ID;
    const originalSecret = process.env.ALPACA_API_SECRET_KEY;
    delete process.env.ALPACA_API_KEY_ID;
    delete process.env.ALPACA_API_SECRET_KEY;
    const signal = makeOptionsSignal();
    const result = await adapter.placeOrder(
      { signal, conviction: { symbol: signal.symbol, score: 70, breakdown: [], rationale: "test" } },
      { sizeUsd: 500, side: "long" },
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("not configured");
    if (originalKey) process.env.ALPACA_API_KEY_ID = originalKey;
    if (originalSecret) process.env.ALPACA_API_SECRET_KEY = originalSecret;
  });

  it("manageRisk rejects when drawdown exceeds limit (with peak)", () => {
    const signal = makeOptionsSignal({
      metadata: { ...makeOptionsSignal().metadata, peakPortfolioValue: 10000 },
    });
    const result = adapter.manageRisk(
      { signal, conviction: { symbol: signal.symbol, score: 70, breakdown: [], rationale: "test" } },
      { totalValueUsd: 7000, cashUsd: 7000, positions: [] },
    );
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("drawdown");
  });

  it("manageRisk rejects for over-concentrated underlier", () => {
    const signal = makeOptionsSignal();
    const result = adapter.manageRisk(
      { signal, conviction: { symbol: signal.symbol, score: 70, breakdown: [], rationale: "test" } },
      {
        totalValueUsd: 10000, cashUsd: 2000,
        positions: [
          { symbol: "AAPL240301C00140000", quantity: 10, avgEntryPrice: 3, currentPrice: 5, valueUsd: 2500, unrealizedPnlUsd: 500, unrealizedPnlPercent: 20, metadata: { underlyingSymbol: "AAPL" } },
        ],
      },
    );
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("concentration");
  });

  it("healthCheck returns unconfigured when no keys", async () => {
    const originalKey = process.env.ALPACA_API_KEY_ID;
    const originalSecret = process.env.ALPACA_API_SECRET_KEY;
    delete process.env.ALPACA_API_KEY_ID;
    delete process.env.ALPACA_API_SECRET_KEY;
    const result = await adapter.healthCheck();
    expect(result.healthy).toBe(false);
    expect(result.mode).toBe("unconfigured");
    if (originalKey) process.env.ALPACA_API_KEY_ID = originalKey;
    if (originalSecret) process.env.ALPACA_API_SECRET_KEY = originalSecret;
  });
});

// =============================================================================
// TWAK Executor
// =============================================================================

describe("TWAK Executor Adapter", () => {
  const adapter = createTwakAdapter();

  it("implements the TradeExecutor interface", () => {
    expect(typeof adapter.placeOrder).toBe("function");
    expect(typeof adapter.closePosition).toBe("function");
    expect(typeof adapter.manageRisk).toBe("function");
    expect(typeof adapter.healthCheck).toBe("function");
  });

  it("healthCheck returns a result with mode", async () => {
    const result = await adapter.healthCheck();
    expect(typeof result.healthy).toBe("boolean");
    expect(typeof result.mode).toBe("string");
  });
});


