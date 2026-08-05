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
import { SosovalueClient, sosovalueClient } from "../lib/data-providers.js";
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
