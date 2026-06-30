import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeNewsSentiment,
  fetchMacroPauseSignal,
  fetchSsiRegimeSignal,
  fetchNewsSentimentSignal,
} from "../lib/sosovalue-signals.js";
import type { NormalisedNewsItem } from "../lib/sosovalue-signals.js";
import { scoreMarketRegime } from "../lib/conviction-signal.js";
import * as dataProviders from "../lib/data-providers.js";

describe("computeNewsSentiment", () => {
  it("aggregates per-symbol sentiment averages using explicit sentimentWord", () => {
    const news: NormalisedNewsItem[] = [
      { id: "1", title: "BTC rally", sentimentWord: "positive", matchedSymbols: ["BTC"] },
      { id: "2", title: "BTC and ETH dip", sentimentWord: "negative", matchedSymbols: ["BTC", "ETH"] },
      { id: "3", title: "ETH upgrade", sentimentWord: "positive", matchedSymbols: ["ETH"] },
    ];
    const { perSymbol, totalItems } = computeNewsSentiment(news);
    expect(totalItems).toBe(3);
    // BTC: (+1 + -1) / 2 = 0
    expect(perSymbol.get("BTC")).toBe(0);
    // ETH: (-1 + +1) / 2 = 0
    expect(perSymbol.get("ETH")).toBe(0);
  });

  it("ignores items with no matched symbols", () => {
    const news: NormalisedNewsItem[] = [
      { id: "1", title: "Generic market news", sentimentWord: "positive", matchedSymbols: [] },
    ];
    const { perSymbol } = computeNewsSentiment(news);
    expect(perSymbol.size).toBe(0);
  });

  it("falls back to keyword-inferred sentiment when sentimentWord is absent", () => {
    const news: NormalisedNewsItem[] = [
      { id: "1", title: "BTC rally to new highs", matchedSymbols: ["BTC"] },
      { id: "2", title: "ETH plunge after exploit", matchedSymbols: ["ETH"] },
      { id: "3", title: "DOGE plain headline", matchedSymbols: ["DOGE"] },
    ];
    const { perSymbol } = computeNewsSentiment(news);
    expect(perSymbol.get("BTC")).toBe(1);
    expect(perSymbol.get("ETH")).toBe(-1);
    expect(perSymbol.get("DOGE")).toBe(0);
  });

  it("clamps aggregate to [-1, +1]", () => {
    const news: NormalisedNewsItem[] = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      title: "Bullish",
      sentimentWord: "positive" as const,
      matchedSymbols: ["DOGE"],
    }));
    const { perSymbol } = computeNewsSentiment(news);
    expect(perSymbol.get("DOGE")).toBeLessThanOrEqual(1);
    expect(perSymbol.get("DOGE")).toBeGreaterThanOrEqual(-1);
  });

  it("uppercases symbols for case-insensitive lookup", () => {
    const news: NormalisedNewsItem[] = [
      { id: "1", title: "x", sentimentWord: "negative", matchedSymbols: ["btc"] },
    ];
    const { perSymbol } = computeNewsSentiment(news);
    expect(perSymbol.get("BTC")).toBe(-1);
    expect(perSymbol.get("btc")).toBeUndefined();
  });
});

describe("fetchNewsSentimentSignal — schema normalisation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses matchedCurrencies from featured news", async () => {
    vi.spyOn(dataProviders.sosovalueClient, "fetchHotNews").mockResolvedValue([] as any);
    vi.spyOn(dataProviders.sosovalueClient, "fetchFeaturedNews").mockResolvedValue([
      {
        id: "f1",
        title: "Adoption milestone announced",
        matchedCurrencies: [{ id: "x", fullName: "Bitcoin", name: "BTC" }],
      },
    ] as any);

    const signal = await fetchNewsSentimentSignal(new Set(["BTC"]));
    expect(signal.totalItems).toBe(1);
    // "adoption" + "milestone" both positive → +1 clamped
    expect(signal.perSymbol.get("BTC")).toBe(1);
  });

  it("keyword-extracts symbols from hot-news titles when no currency tags exist", async () => {
    vi.spyOn(dataProviders.sosovalueClient, "fetchHotNews").mockResolvedValue([
      { id: "h1", title: "DOGE rally to new milestone" },
      { id: "h2", title: "BTC hacked overnight, outflows surge" },
    ] as any);
    vi.spyOn(dataProviders.sosovalueClient, "fetchFeaturedNews").mockResolvedValue([] as any);

    const signal = await fetchNewsSentimentSignal(new Set(["DOGE", "BTC"]));
    // DOGE positive ("rally", "milestone"), BTC mixed ("hacked", "outflows" negative; "surge" positive) → net negative
    expect(signal.perSymbol.get("DOGE")).toBe(1);
    expect(signal.perSymbol.get("BTC")).toBe(-1);
  });

  it("rejects symbols not in the universe (false-match guard)", async () => {
    vi.spyOn(dataProviders.sosovalueClient, "fetchHotNews").mockResolvedValue([
      // USD is a common 3-letter word but not in the universe → must not be tagged.
      { id: "h1", title: "USD reserve grows, market rally continues" },
    ] as any);
    vi.spyOn(dataProviders.sosovalueClient, "fetchFeaturedNews").mockResolvedValue([] as any);

    const signal = await fetchNewsSentimentSignal(new Set(["BTC", "ETH"]));
    expect(signal.perSymbol.has("USD")).toBe(false);
    expect(signal.perSymbol.size).toBe(0);
  });
});

describe("scoreMarketRegime with SSI confirmation", () => {
  it("matches the legacy 70/30 split when ssiConfirmation is null", () => {
    const legacy = scoreMarketRegime(
      { fearGreedIndex: 20 } as any,
      { btcFundingRate: 0, ethFundingRate: 0 } as any,
    );
    const withNull = scoreMarketRegime(
      { fearGreedIndex: 20 } as any,
      { btcFundingRate: 0, ethFundingRate: 0 } as any,
      null,
    );
    expect(withNull.score).toBe(legacy.score);
    expect(withNull.ssiConfirmation).toBeNull();
  });

  it("boosts the contrarian score when SSI confirms fear (+confirmation)", () => {
    const neutralSsi = scoreMarketRegime(
      { fearGreedIndex: 50 } as any,
      { btcFundingRate: 0, ethFundingRate: 0 } as any,
      0,
    );
    const confirmingSsi = scoreMarketRegime(
      { fearGreedIndex: 50 } as any,
      { btcFundingRate: 0, ethFundingRate: 0 } as any,
      1,
    );
    expect(confirmingSsi.score).toBeGreaterThan(neutralSsi.score);
    expect(confirmingSsi.ssiConfirmation).toBe(1);
  });

  it("pulls regime back toward neutral when SSI contradicts fear (−confirmation)", () => {
    const fearOnly = scoreMarketRegime(
      { fearGreedIndex: 15 } as any,
      { btcFundingRate: 0, ethFundingRate: 0 } as any,
    );
    const fearContradicted = scoreMarketRegime(
      { fearGreedIndex: 15 } as any,
      { btcFundingRate: 0, ethFundingRate: 0 } as any,
      -1,
    );
    expect(fearContradicted.score).toBeLessThan(fearOnly.score);
  });
});

describe("fetchSsiRegimeSignal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns confirmation 0 and zero indices when SoSoValue is offline", async () => {
    vi.spyOn(dataProviders.sosovalueClient, "fetchIndexSnapshot").mockResolvedValue(null);
    const signal = await fetchSsiRegimeSignal();
    expect(signal.indicesRead).toBe(0);
    expect(signal.confirmation).toBe(0);
  });

  it("reads roi_7d (decimal) and converts to percent", async () => {
    // roi_7d = -0.15 → -15% → confirmation = +1 (capped)
    vi.spyOn(dataProviders.sosovalueClient, "fetchIndexSnapshot").mockResolvedValue({
      roi_7d: -0.15,
    } as any);
    const signal = await fetchSsiRegimeSignal();
    expect(signal.indicesRead).toBeGreaterThan(0);
    expect(signal.avgPercentChange7d).toBeCloseTo(-15, 5);
    expect(signal.confirmation).toBeCloseTo(1, 5);
  });

  it("falls back to percent_change_7d when roi_7d absent (mock compat)", async () => {
    vi.spyOn(dataProviders.sosovalueClient, "fetchIndexSnapshot").mockResolvedValue({
      percent_change_7d: 15,
    } as any);
    const signal = await fetchSsiRegimeSignal();
    expect(signal.avgPercentChange7d).toBeCloseTo(15, 5);
    expect(signal.confirmation).toBeCloseTo(-1, 5);
  });
});

describe("fetchMacroPauseSignal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.spyOn(dataProviders.sosovalueClient, "fetchMacroEvents").mockResolvedValue([]);
  });

  it("returns CLEAR when no high-impact events are in window", async () => {
    const sig = await fetchMacroPauseSignal();
    expect(sig.clear).toBe(true);
    expect(sig.skipEntries).toBe(false);
    expect(sig.sizeMultiplier).toBe(1);
  });

  it("ignores events whose names don't keyword-match high impact", async () => {
    const now = new Date("2026-06-01T10:00:00Z");
    vi.spyOn(dataProviders.sosovalueClient, "fetchMacroEvents").mockResolvedValue([
      { date: "2026-06-01", events: ["S&P Global US Manufacturing PMI"] },
    ] as any);
    const sig = await fetchMacroPauseSignal(24, now);
    // PMI is medium-impact, not high → CLEAR
    expect(sig.clear).toBe(true);
  });

  it("SKIPS entries when CPI is within 4h (date-only event anchored to 12 UTC)", async () => {
    const now = new Date("2026-06-01T10:00:00Z"); // 2h before 12 UTC same-day
    vi.spyOn(dataProviders.sosovalueClient, "fetchMacroEvents").mockResolvedValue([
      { date: "2026-06-01", events: ["US CPI YoY"] },
    ] as any);
    const sig = await fetchMacroPauseSignal(24, now);
    expect(sig.skipEntries).toBe(true);
    expect(sig.sizeMultiplier).toBe(0);
    expect(sig.triggeringEvent?.name).toContain("CPI");
    expect(sig.triggeringEvent?.impact).toBe("high");
  });

  it("HALVES size when FOMC is 4-12h away", async () => {
    const now = new Date("2026-06-01T02:00:00Z"); // 10h before 12 UTC same-day
    vi.spyOn(dataProviders.sosovalueClient, "fetchMacroEvents").mockResolvedValue([
      { date: "2026-06-01", events: ["FOMC Interest Rate Decision"] },
    ] as any);
    const sig = await fetchMacroPauseSignal(24, now);
    expect(sig.skipEntries).toBe(false);
    expect(sig.sizeMultiplier).toBe(0.5);
  });

  it("ignores past events", async () => {
    const now = new Date("2026-06-01T15:00:00Z");
    vi.spyOn(dataProviders.sosovalueClient, "fetchMacroEvents").mockResolvedValue([
      // 12 UTC anchor = 3h ago → past, skipped
      { date: "2026-06-01", events: ["FOMC Minutes"] },
    ] as any);
    const sig = await fetchMacroPauseSignal(24, now);
    expect(sig.clear).toBe(true);
  });

  it("backwards-compat: accepts old {name, impact} mock shape", async () => {
    const now = new Date("2026-06-01T10:00:00Z");
    vi.spyOn(dataProviders.sosovalueClient, "fetchMacroEvents").mockResolvedValue([
      { name: "US CPI", date: "2026-06-01T12:30:00Z", impact: "high" } as any,
    ]);
    const sig = await fetchMacroPauseSignal(24, now);
    expect(sig.skipEntries).toBe(true);
    expect(sig.triggeringEvent?.name).toBe("US CPI");
  });
});
