/**
 * Tests for the backtest's stale-kline fallback.
 *
 * The live VPS is rate-limited by SoSoValue (HTTP 429 → circuit-breaker
 * suspension). The disk cache holds ~111-day kline series from the cycle's
 * RSI fetches, and historical klines age gracefully — so loadHistoricalData
 * should serve STALE cached klines before dropping to synthetic data, and
 * mark the run "live-stale" so the dashboard stays honest about the lag.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { SosovalueClient, sosovalueClient, normalizeKlineTimestamp, normalizeKline } from "../lib/data-providers.js";
import { loadHistoricalDataDetailed } from "../lib/backtest.js";

// Daily klines covering May 2026 onward so a 2026-06-01 → 2026-08-01
// backtest window is fully inside the series.
function makeKlines(count: number, startTsSec = Math.floor(Date.UTC(2026, 4, 1) / 1000)) {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: startTsSec + i * 86400,
    open: 1,
    high: 1.02,
    low: 0.98,
    close: 1 + i * 0.001,
    volume: 1_000_000,
  }));
}

/** Mirror the REAL SoSoValue kline shape observed in production:
 *  timestamps as STRINGS of milliseconds ("1778198400000"), OHLCV as strings. */
function makeRawServerKlines(count: number, startTsSec = Math.floor(Date.UTC(2026, 4, 1) / 1000)) {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: String((startTsSec + i * 86400) * 1000), // string of ms — the production shape
    open: "1.0000",
    high: "1.0200",
    low: "0.9800",
    close: String(1 + i * 0.001),
    volume: "1000000",
  }));
}

describe("normalizeKline — SoSoValue string-ms timestamps (production regression)", () => {
  it("converts string-millisecond timestamps to number seconds", () => {
    expect(normalizeKlineTimestamp("1778198400000")).toBe(1778198400); // 2026-05-07
  });

  it("passes through number seconds unchanged (idempotent)", () => {
    expect(normalizeKlineTimestamp(1778198400)).toBe(1778198400);
  });

  it("converts number milliseconds to seconds", () => {
    expect(normalizeKlineTimestamp(1778198400000)).toBe(1778198400);
  });

  it("threshold: 1e11 (AD-5138 seconds / 1973 milliseconds) is the ms/sec boundary", () => {
    expect(normalizeKlineTimestamp(978307200)).toBe(978307200);   // 2001 in seconds
    expect(normalizeKlineTimestamp(978307200000)).toBe(978307200); // 2001 in ms
  });

  it("returns 0 for non-numeric input", () => {
    expect(normalizeKlineTimestamp("abc")).toBe(0);
    expect(normalizeKlineTimestamp(NaN as unknown as number)).toBe(0);
  });

  it("normalizes OHLCV strings to numbers alongside the timestamp", () => {
    const k = normalizeKline({
      timestamp: "1778198400000" as unknown as number,
      open: "1.00" as unknown as number,
      high: "1.02" as unknown as number,
      low: "0.98" as unknown as number,
      close: "1.001" as unknown as number,
      volume: "1000000" as unknown as number,
    });
    expect(k.timestamp).toBe(1778198400);
    expect(k.close).toBe(1.001);
    expect(typeof k.open).toBe("number");
  });
});

describe("SosovalueClient.getCachedKlines — stale-tolerant lookup", () => {
  it("returns in-memory cached klines regardless of TTL", () => {
    const client = new SosovalueClient();
    (client as any).currencyIdCache.set("TWT", { id: "123", symbol: "TWT", name: "TWT" });
    const stale = { klines: makeKlines(40), fetchedAt: Date.now() - 48 * 3600_000 }; // 2 days old — way past the 4h TTL
    (client as any).klineCache.set("123:1d:30", stale);

    const hit = client.getCachedKlines("twt");
    expect(hit).not.toBeNull();
    expect(hit!.klines).toHaveLength(40);
    expect(hit!.fetchedAt).toBe(stale.fetchedAt);
  });

  it("picks the entry with the most klines across limit variants", () => {
    const client = new SosovalueClient();
    (client as any).currencyIdCache.set("TWT", { id: "123", symbol: "TWT", name: "TWT" });
    (client as any).klineCache.set("123:1d:30", { klines: makeKlines(30), fetchedAt: Date.now() });
    (client as any).klineCache.set("123:1d:111", { klines: makeKlines(111), fetchedAt: Date.now() - 86400_000 });

    const hit = client.getCachedKlines("TWT");
    expect(hit!.klines).toHaveLength(111);
  });

  it("ignores klines from a different interval", () => {
    const client = new SosovalueClient();
    (client as any).currencyIdCache.set("TWT", { id: "123", symbol: "TWT", name: "TWT" });
    (client as any).klineCache.set("123:1h:30", { klines: makeKlines(30), fetchedAt: Date.now() });

    expect(client.getCachedKlines("TWT", "1d")).toBeNull();
  });

  it("returns null for a symbol that has never been cached", () => {
    const client = new SosovalueClient();
    expect(client.getCachedKlines("NOSUCH")).toBeNull();
  });
});

describe("loadHistoricalDataDetailed — stale fallback before synthetic", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    (sosovalueClient as any).currencyIdCache?.clear?.();
    (sosovalueClient as any).klineCache?.clear?.();
  });

  it("serves stale cached klines when the API returns nothing, marked live-stale", async () => {
    // Pre-seed the singleton's private caches as if an earlier cycle had
    // successfully fetched klines (API since suspended).
    (sosovalueClient as any).currencyIdCache.set("TWT", { id: "123", symbol: "TWT", name: "TWT" });
    (sosovalueClient as any).klineCache.set("123:1d:111", { klines: makeKlines(111), fetchedAt: Date.now() - 88800_000 });

    vi.spyOn(sosovalueClient, "fetchKlinesBySymbol").mockResolvedValue([]); // API suspended → empty

    const result = await loadHistoricalDataDetailed({
      startDate: "2026-06-01",
      endDate: "2026-08-01",
      symbols: ["TWT"],
    });

    expect(result.dataSource).toBe("live-stale");
    expect(result.staleSymbols).toEqual(["TWT"]);
    expect(result.days.length).toBeGreaterThan(0);
  });

  it("marks the run live when fresh klines load", async () => {
    vi.spyOn(sosovalueClient, "fetchKlinesBySymbol").mockResolvedValue(makeKlines(111));

    const result = await loadHistoricalDataDetailed({
      startDate: "2026-06-01",
      endDate: "2026-08-01",
      symbols: ["TWT"],
    });

    expect(result.dataSource).toBe("live");
    expect(result.staleSymbols).toEqual([]);
    expect(result.days.length).toBeGreaterThan(0);
  });

  it("handles the PRODUCTION kline shape: string-ms timestamps in the stale cache", async () => {
    // Regression for the live bug: SoSoValue returns timestamps as strings of
    // milliseconds; the old backtest then built 0 days ("No historical data
    // loaded") and silently dropped to synthetic.
    (sosovalueClient as any).currencyIdCache.set("TWT", { id: "123", symbol: "TWT", name: "TWT" });
    (sosovalueClient as any).klineCache.set("123:1d:111", { klines: makeRawServerKlines(111), fetchedAt: Date.now() - 88800_000 });

    vi.spyOn(sosovalueClient, "fetchKlinesBySymbol").mockResolvedValue([]); // API suspended → empty

    const result = await loadHistoricalDataDetailed({
      startDate: "2026-06-01",
      endDate: "2026-08-01",
      symbols: ["TWT"],
    });

    expect(result.dataSource).toBe("live-stale");
    // The critical regression assertion: the date-window matching must
    // actually produce days from string-ms timestamps.
    expect(result.days.length).toBeGreaterThan(0);
  });

  it("throws when nothing loads (fresh fails AND no cache) so callers fall back to synthetic", async () => {
    vi.spyOn(sosovalueClient, "fetchKlinesBySymbol").mockResolvedValue([]);
    // No cache seeded for NOHIST → getCachedKlines returns null.

    await expect(
      loadHistoricalDataDetailed({
        startDate: "2026-06-01",
        endDate: "2026-08-01",
        symbols: ["NOHIST"],
      }),
    ).rejects.toThrow("No historical klines could be loaded");
  });
});
