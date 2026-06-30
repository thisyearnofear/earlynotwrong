import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeNewsSentiment,
  fetchMacroPauseSignal,
  fetchSsiRegimeSignal,
} from "../lib/sosovalue-signals.js";
import { scoreMarketRegime } from "../lib/conviction-signal.js";
import * as dataProviders from "../lib/data-providers.js";
import type { SosovalueFeedItem, SosovalueMacroEvent } from "../lib/data-providers.js";

describe("computeNewsSentiment", () => {
  it("aggregates per-symbol sentiment averages", () => {
    const news: SosovalueFeedItem[] = [
      { id: "1", title: "BTC rally", published_at: "", sentiment: "positive", related_currencies: ["BTC"] },
      { id: "2", title: "BTC and ETH dip", published_at: "", sentiment: "negative", related_currencies: ["BTC", "ETH"] },
      { id: "3", title: "ETH upgrade", published_at: "", sentiment: "positive", related_currencies: ["ETH"] },
    ];
    const { perSymbol, totalItems } = computeNewsSentiment(news);
    expect(totalItems).toBe(3);
    // BTC: (+1 + -1) / 2 = 0
    expect(perSymbol.get("BTC")).toBe(0);
    // ETH: (-1 + +1) / 2 = 0
    expect(perSymbol.get("ETH")).toBe(0);
  });

  it("ignores items without related_currencies", () => {
    const news: SosovalueFeedItem[] = [
      { id: "1", title: "Generic market news", published_at: "", sentiment: "positive" },
    ];
    const { perSymbol } = computeNewsSentiment(news);
    expect(perSymbol.size).toBe(0);
  });

  it("treats missing sentiment as neutral (0)", () => {
    const news: SosovalueFeedItem[] = [
      { id: "1", title: "BTC headline", published_at: "", related_currencies: ["BTC"] },
    ];
    const { perSymbol } = computeNewsSentiment(news);
    expect(perSymbol.get("BTC")).toBe(0);
  });

  it("clamps aggregate to [-1, +1]", () => {
    const news: SosovalueFeedItem[] = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      title: "Bullish",
      published_at: "",
      sentiment: "positive" as const,
      related_currencies: ["DOGE"],
    }));
    const { perSymbol } = computeNewsSentiment(news);
    expect(perSymbol.get("DOGE")).toBeLessThanOrEqual(1);
    expect(perSymbol.get("DOGE")).toBeGreaterThanOrEqual(-1);
  });

  it("uppercases symbols for case-insensitive lookup", () => {
    const news: SosovalueFeedItem[] = [
      { id: "1", title: "x", published_at: "", sentiment: "negative", related_currencies: ["btc"] },
    ];
    const { perSymbol } = computeNewsSentiment(news);
    expect(perSymbol.get("BTC")).toBe(-1);
    expect(perSymbol.get("btc")).toBeUndefined();
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

  it("maps a -15% 7d move to confirmation = +1 (capped)", async () => {
    vi.spyOn(dataProviders.sosovalueClient, "fetchIndexSnapshot").mockResolvedValue({
      ticker: "BTCSSI",
      name: "BTC SSI",
      percent_change_7d: -15,
    } as any);
    const signal = await fetchSsiRegimeSignal();
    expect(signal.indicesRead).toBe(3);
    expect(signal.confirmation).toBeCloseTo(1, 5);
  });

  it("maps a +15% 7d move to confirmation = -1 (capped)", async () => {
    vi.spyOn(dataProviders.sosovalueClient, "fetchIndexSnapshot").mockResolvedValue({
      ticker: "BTCSSI",
      name: "BTC SSI",
      percent_change_7d: 15,
    } as any);
    const signal = await fetchSsiRegimeSignal();
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

  it("ignores low/medium impact events", async () => {
    const now = new Date("2026-06-01T10:00:00Z");
    const lowImpact: SosovalueMacroEvent = {
      id: "1",
      name: "Some report",
      date: "2026-06-01T11:00:00Z",
      impact: "low",
    };
    vi.spyOn(dataProviders.sosovalueClient, "fetchMacroEvents").mockResolvedValue([lowImpact]);
    const sig = await fetchMacroPauseSignal(24, now);
    expect(sig.clear).toBe(true);
  });

  it("SKIPS entries when a high-impact event is within 4h", async () => {
    const now = new Date("2026-06-01T10:00:00Z");
    const cpi: SosovalueMacroEvent = {
      id: "cpi",
      name: "US CPI",
      date: "2026-06-01T12:30:00Z", // 2.5h away
      impact: "high",
    };
    vi.spyOn(dataProviders.sosovalueClient, "fetchMacroEvents").mockResolvedValue([cpi]);
    const sig = await fetchMacroPauseSignal(24, now);
    expect(sig.skipEntries).toBe(true);
    expect(sig.sizeMultiplier).toBe(0);
    expect(sig.triggeringEvent?.name).toBe("US CPI");
  });

  it("HALVES size when a high-impact event is 4-12h away", async () => {
    const now = new Date("2026-06-01T10:00:00Z");
    const fomc: SosovalueMacroEvent = {
      id: "fomc",
      name: "FOMC Minutes",
      date: "2026-06-01T18:00:00Z", // 8h away
      impact: "high",
    };
    vi.spyOn(dataProviders.sosovalueClient, "fetchMacroEvents").mockResolvedValue([fomc]);
    const sig = await fetchMacroPauseSignal(24, now);
    expect(sig.skipEntries).toBe(false);
    expect(sig.sizeMultiplier).toBe(0.5);
  });

  it("WATCHES (no resize) when event is 12-24h away", async () => {
    const now = new Date("2026-06-01T10:00:00Z");
    const evt: SosovalueMacroEvent = {
      id: "evt",
      name: "Employment",
      date: "2026-06-02T08:00:00Z", // 22h away
      impact: "high",
    };
    vi.spyOn(dataProviders.sosovalueClient, "fetchMacroEvents").mockResolvedValue([evt]);
    const sig = await fetchMacroPauseSignal(24, now);
    expect(sig.skipEntries).toBe(false);
    expect(sig.sizeMultiplier).toBe(1);
    expect(sig.clear).toBe(false);
  });

  it("ignores past events", async () => {
    const now = new Date("2026-06-01T15:00:00Z");
    const past: SosovalueMacroEvent = {
      id: "p",
      name: "Past event",
      date: "2026-06-01T10:00:00Z", // 5h ago
      impact: "high",
    };
    vi.spyOn(dataProviders.sosovalueClient, "fetchMacroEvents").mockResolvedValue([past]);
    const sig = await fetchMacroPauseSignal(24, now);
    expect(sig.clear).toBe(true);
  });
});
