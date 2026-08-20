/**
 * Tests for the disk-backed Delphi status reader (GET /delphi/status).
 *
 * The reader runs in the main server process and must reflect the runner's
 * persisted state (AGENT_DATA_DIR/delphi/) without shared memory. Covers the
 * honest empty state and a populated snapshot + resolved forecasts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDelphiStatus } from "../lib/delphi/status.js";

const CONFIG = {
  windowOpens: "2026-08-10T00:00:00Z",
  windowCloses: "2026-08-24T00:00:00Z",
  network: "competition-testnet",
  enabled: true,
};

describe("readDelphiStatus", () => {
  let baseDir: string;
  let savedDataDir: string | undefined;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "delphi-status-test-"));
    savedDataDir = process.env.AGENT_DATA_DIR;
    process.env.AGENT_DATA_DIR = baseDir;
  });

  afterEach(() => {
    if (savedDataDir === undefined) delete process.env.AGENT_DATA_DIR;
    else process.env.AGENT_DATA_DIR = savedDataDir;
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("returns an honest empty state when the runner has never produced data", () => {
    const status = readDelphiStatus(CONFIG);
    expect(status.hasData).toBe(false);
    expect(status.snapshot).toBeNull();
    expect(status.lastAnchor).toBeNull();
    expect(status.openPositions).toHaveLength(0);
    expect(status.totalExposureTokens).toBe("0");
    expect(status.calibration.resolved).toBe(0);
    expect(status.calibration.brierScore).toBeNull();
    // The window (08-10 → 08-24) is live as of 2026-08-14 — but this test
    // should not be date-fragile, so just assert the field is a number.
    expect(typeof status.competition.msRemaining).toBe("number");
    expect(status.competition.exitPolicy === "convergence" || status.competition.exitPolicy === "hold-to-settlement").toBe(true);
    expect(typeof status.competition.tournamentMode).toBe("boolean");
  });

  it("reflects a populated snapshot, positions, exposure, and calibration", () => {
    const dir = join(baseDir, "delphi");
    mkdirSync(dir, { recursive: true });

    writeFileSync(
      join(dir, "snapshot.json"),
      JSON.stringify({
        lastCycleAt: 1755100000000,
        cyclesRun: 7,
        tradesPlaced: 3,
        marketsSeen: 40,
        lastAnchoredThesisHash: "0xthesis",
        lastAnchor: {
          thesisHash: "0xthesis",
          anchoredAt: 1755100000000,
          convictionScore: 43,
          results: [{ adapter: "casper", status: "success", txHash: "0xdeploy" }],
        },
      }),
    );
    writeFileSync(
      join(dir, "positions.json"),
      JSON.stringify({
        "0xM:0": {
          id: "0xM:0",
          marketAddress: "0xM",
          outcomeIdx: 0,
          question: "Will it happen?",
          forecast: 0.62,
          impliedProbability: 0.5,
          edge: 0.12,
          shares: "1000000000000000000",
          tokensIn: "500000000000000000",
          openedAt: 1755000000000,
          transactionHash: "0xentry",
        },
      }),
    );
    writeFileSync(join(dir, "exposure.json"), JSON.stringify({ "0xM": "500000000000000000" }));
    // One win (forecast 0.9 → outcome 1) + one loss (forecast 0.3 → outcome 0).
    writeFileSync(
      join(dir, "forecasts.jsonl"),
      [
        JSON.stringify({ id: "0xA:0", forecast: 0.9, forecastAt: 1, outcome: 1, resolvedAt: 2, marketAddress: "0xA", outcomeIdx: 0 }),
        JSON.stringify({ id: "0xB:0", forecast: 0.3, forecastAt: 1, outcome: 0, resolvedAt: 2, marketAddress: "0xB", outcomeIdx: 0 }),
      ].join("\n"),
    );

    const status = readDelphiStatus(CONFIG);
    expect(status.hasData).toBe(true);
    expect(status.snapshot?.cyclesRun).toBe(7);
    expect(status.snapshot?.lastAnchoredThesisHash).toBe("0xthesis");
    expect(status.lastAnchor?.results[0].adapter).toBe("casper");
    expect(status.openPositions).toHaveLength(1);
    expect(status.openPositions[0].forecast).toBeCloseTo(0.62, 9);
    expect(status.totalExposureTokens).toBe("500000000000000000");
    // Both forecasts correct → Brier = ((0.1)² + (0.3)²)/2 = 0.05.
    expect(status.calibration.resolved).toBe(2);
    expect(status.calibration.brierScore).toBeCloseTo(0.05, 9);
    expect(status.calibration.hitRate).toBe(1);
  });

  it("tolerates corrupt JSON files without throwing", () => {
    const dir = join(baseDir, "delphi");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "snapshot.json"), "{not json");
    writeFileSync(join(dir, "forecasts.jsonl"), "garbage\n{also bad");

    const status = readDelphiStatus(CONFIG);
    expect(status.hasData).toBe(false);
    expect(status.calibration.resolved).toBe(0);
  });

  it("surfaces the all-forecasts calibration alongside the traded one", () => {
    const dir = join(baseDir, "delphi");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "snapshot.json"),
      JSON.stringify({ lastCycleAt: 1755100000000, cyclesRun: 1, tradesPlaced: 0, marketsSeen: 5, lastAnchoredThesisHash: null, lastAnchor: null }),
    );
    // Raw estimate observations (2 markets × 2 outcomes).
    writeFileSync(
      join(dir, "estimates.jsonl"),
      [
        JSON.stringify({ marketAddress: "0xA", outcomeIdx: 0, question: "A?", forecast: 0.8, estimatedAt: 1 }),
        JSON.stringify({ marketAddress: "0xA", outcomeIdx: 1, question: "A?", forecast: 0.2, estimatedAt: 1 }),
        JSON.stringify({ marketAddress: "0xB", outcomeIdx: 0, question: "B?", forecast: 0.9, estimatedAt: 1 }),
        JSON.stringify({ marketAddress: "0xB", outcomeIdx: 1, question: "B?", forecast: 0.1, estimatedAt: 1 }),
      ].join("\n"),
    );
    // Scored at settlement: 0xA winner idx1, 0xB winner idx0 — both correct.
    writeFileSync(
      join(dir, "forecasts-all.jsonl"),
      [
        JSON.stringify({ id: "0xA:0", forecast: 0.8, forecastAt: 1, outcome: 0, resolvedAt: 2, marketAddress: "0xA", outcomeIdx: 0, observations: 1 }),
        JSON.stringify({ id: "0xA:1", forecast: 0.2, forecastAt: 1, outcome: 1, resolvedAt: 2, marketAddress: "0xA", outcomeIdx: 1, observations: 1 }),
        JSON.stringify({ id: "0xB:0", forecast: 0.9, forecastAt: 1, outcome: 1, resolvedAt: 2, marketAddress: "0xB", outcomeIdx: 0, observations: 1 }),
        JSON.stringify({ id: "0xB:1", forecast: 0.1, forecastAt: 1, outcome: 0, resolvedAt: 2, marketAddress: "0xB", outcomeIdx: 1, observations: 1 }),
      ].join("\n"),
    );
    writeFileSync(join(dir, "forecasts-dropped.jsonl"), JSON.stringify({ marketAddress: "0xX", status: "expired", droppedAt: 1 }));

    const status = readDelphiStatus(CONFIG);
    expect(status.allForecasts.totalForecasts).toBe(4);
    expect(status.allForecasts.resolved).toBe(4);
    expect(status.allForecasts.totalEstimates).toBe(4);
    expect(status.allForecasts.scoredMarkets).toBe(2);
    expect(status.allForecasts.droppedMarkets).toBe(1);
    // Brier = (0.8² + 0.8² + 0.1² + 0.1²)/4 = 0.325.
    expect(status.allForecasts.brierScore).toBeCloseTo(0.325, 9);
    // 0xA's winner (idx1) was forecast 0.2 (<0.5 → miss both rows); 0xB is a
    // clean hit on both. Hit rate = 2/4 = 0.5.
    expect(status.allForecasts.hitRate).toBe(0.5);
  });
});
