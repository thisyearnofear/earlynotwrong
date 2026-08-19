/**
 * Tests for the all-forecasts log (delphi/forecast-log.ts) — the unbiased
 * calibration record that scores EVERY estimate, not just traded ones.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendForecastLog,
  resolveForecastLog,
  loadAllForecastsLedger,
  countForecastLogEntries,
  type ForecastLogMarketDetails,
} from "../lib/delphi/forecast-log.js";
import type { MarketEstimate } from "../lib/delphi/probability.js";

function makeEstimate(overrides: Partial<MarketEstimate> = {}): MarketEstimate {
  return {
    marketAddress: "0xM1",
    question: "Will it rain on Aug 20?",
    category: "culture",
    outcomes: [
      { outcomeIdx: 0, probability: 0.3, reasoning: "No is more likely" },
      { outcomeIdx: 1, probability: 0.7, reasoning: "Yes is more likely" },
    ],
    provider: "b-ai",
    model: "deepseek-v4-flash ×3 median",
    estimatedAt: 1_755_000_000_000,
    provenance: { provider: "b-ai", model: "deepseek-v4-flash ×3 median", samples: 3, webEvidence: true },
    ...overrides,
  };
}

describe("delphi forecast log", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "delphi-forecast-log-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("appends one row per outcome with implied probability mapped by index", () => {
    appendForecastLog(dir, makeEstimate(), [0.4, 0.6]);

    expect(countForecastLogEntries(dir)).toBe(2);
    const content = readFileSync(join(dir, "estimates.jsonl"), "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    expect(content[0]).toMatchObject({
      marketAddress: "0xM1",
      outcomeIdx: 0,
      forecast: 0.3,
      impliedProbability: 0.4,
    });
    expect(content[1]).toMatchObject({
      marketAddress: "0xM1",
      outcomeIdx: 1,
      forecast: 0.7,
      impliedProbability: 0.6,
    });
    expect(content[0].provenance.samples).toBe(3);
  });

  it("scores the LAST forecast per outcome when the market settles", async () => {
    // Two cycles: the estimate moves between them — the settled row must
    // take the later observation.
    appendForecastLog(dir, makeEstimate({ estimatedAt: 1_755_000_000_000 }), [0.4, 0.6]);
    appendForecastLog(
      dir,
      makeEstimate({
        estimatedAt: 1_755_003_600_000,
        outcomes: [
          { outcomeIdx: 0, probability: 0.45, reasoning: "updated" },
          { outcomeIdx: 1, probability: 0.55, reasoning: "updated" },
        ],
      }),
      [0.4, 0.6],
    );

    const markets = new Map<string, ForecastLogMarketDetails>([
      ["0xM1", { status: "settled", winningOutcomeIdx: "1" }],
    ]);
    const result = await resolveForecastLog(dir, {
      getMarketDetails: async (addr) => markets.get(addr) ?? { status: "open" },
      clock: () => 1_755_100_000_000,
    });

    expect(result).toEqual({ scored: 1, dropped: 0, pending: 0 });
    const scored = loadAllForecastsLedger(dir);
    expect(scored).toHaveLength(2);
    const yesRow = scored.find((r) => r.outcomeIdx === 1);
    const noRow = scored.find((r) => r.outcomeIdx === 0);
    expect(yesRow).toMatchObject({ forecast: 0.55, outcome: 1, observations: 2 });
    expect(noRow).toMatchObject({ forecast: 0.45, outcome: 0, observations: 2 });
  });

  it("is idempotent — a settled market scores exactly once", async () => {
    appendForecastLog(dir, makeEstimate(), [0.4, 0.6]);
    const markets = new Map<string, ForecastLogMarketDetails>([
      ["0xM1", { status: "settled", winningOutcomeIdx: 1 }],
    ]);
    const opts = { getMarketDetails: async (addr: string) => markets.get(addr) ?? { status: "open" } };

    await resolveForecastLog(dir, opts);
    await resolveForecastLog(dir, opts);

    expect(loadAllForecastsLedger(dir)).toHaveLength(2);
  });

  it("drops expired/failed markets without scoring them", async () => {
    appendForecastLog(dir, makeEstimate(), [0.4, 0.6]);
    const markets = new Map<string, ForecastLogMarketDetails>([
      ["0xM1", { status: "expired" }],
    ]);

    const result = await resolveForecastLog(dir, {
      getMarketDetails: async (addr) => markets.get(addr) ?? { status: "open" },
    });

    expect(result).toEqual({ scored: 0, dropped: 1, pending: 0 });
    expect(loadAllForecastsLedger(dir)).toHaveLength(0);
    // Second pass: already terminal, so it's skipped entirely.
    const again = await resolveForecastLog(dir, {
      getMarketDetails: async () => { throw new Error("should not be called"); },
    });
    expect(again).toEqual({ scored: 0, dropped: 0, pending: 0 });
  });

  it("keeps unsettled and index-lag markets pending", async () => {
    appendForecastLog(dir, makeEstimate({ marketAddress: "0xOPEN" }), [0.5, 0.5]);
    appendForecastLog(dir, makeEstimate({ marketAddress: "0xLAG", question: "Lag" }), [0.5, 0.5]);
    const markets = new Map<string, ForecastLogMarketDetails>([
      ["0xOPEN", { status: "open" }],
      ["0xLAG", { status: "settled", winningOutcomeIdx: null }],
    ]);

    const result = await resolveForecastLog(dir, {
      getMarketDetails: async (addr) => markets.get(addr) ?? { status: "open" },
    });

    expect(result).toEqual({ scored: 0, dropped: 0, pending: 2 });
    expect(loadAllForecastsLedger(dir)).toHaveLength(0);
  });

  it("survives provider errors without losing the log", async () => {
    appendForecastLog(dir, makeEstimate(), [0.4, 0.6]);
    const result = await resolveForecastLog(dir, {
      getMarketDetails: async () => { throw new Error("REST down"); },
    });

    expect(result).toEqual({ scored: 0, dropped: 0, pending: 1 });
    expect(countForecastLogEntries(dir)).toBe(2);
    expect(loadAllForecastsLedger(dir)).toHaveLength(0);
  });
});
