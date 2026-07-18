import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  SIGNALS_LIVE_SCHEMA,
  SIGNALS_LIVE_SCHEMA_URL,
  getLiveSignalsV1,
  wrapLiveSignalsV1,
  buildBuyerGuidance,
} from "../src/mcp/tools.js";
import { state } from "../lib/agent-state.js";
import { emptyCycleExecution } from "../lib/cycle-execution.js";

const repoRoot = join(process.cwd(), "..");
const schemaPath = join(repoRoot, "public/schemas/signals-live-v1.2.schema.json");
const examplePath = join(repoRoot, "public/samples/signals-live-v1.2.example.json");

function loadValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
  return ajv.compile(schema);
}

describe("signals-live/v1.2 JSON Schema", () => {
  it("schema file exists on disk", () => {
    expect(existsSync(schemaPath)).toBe(true);
  });

  it("validates the public example payload", () => {
    const validate = loadValidator();
    const example = JSON.parse(readFileSync(examplePath, "utf-8"));
    expect(validate(example)).toBe(true);
    if (validate.errors) {
      expect(validate.errors).toEqual([]);
    }
  });

  it("validates getLiveSignalsV1() output before first cycle", async () => {
    const validate = loadValidator();
    const saved = {
      cycle: state.cycle,
      lastRunAt: state.lastRunAt,
      nextRunAt: state.nextRunAt,
      marketRegime: state.marketRegime,
      convictionSignals: state.convictionSignals,
      macroPause: state.macroPause,
      ledger: state.ledger,
      behavioralMetrics: state.behavioralMetrics,
      cycleExecutionDraft: state.cycleExecutionDraft,
      lastCycleExecution: state.lastCycleExecution,
    };
    state.cycle = 0;
    state.lastRunAt = null;
    state.nextRunAt = null;
    state.marketRegime = null;
    state.convictionSignals = [];
    state.macroPause = null;
    state.ledger = [];
    state.behavioralMetrics = null;
    state.cycleExecutionDraft = emptyCycleExecution(0);
    state.lastCycleExecution = null;
    try {
      const payload = await getLiveSignalsV1({
        settlementRail: "croo-cap",
        tool: "signals-live",
      });
      expect(payload.schema).toBe(SIGNALS_LIVE_SCHEMA);
      expect(payload.meta.schemaUrl).toBe(SIGNALS_LIVE_SCHEMA_URL);
      expect(payload.provenance.behavioral.status).toBe("no_ledger");
      expect(payload.provenance.behavioral.metrics).toBeNull();
      expect(payload.execution.cycle).toBe(0);
      expect(validate(payload)).toBe(true);
    } finally {
      Object.assign(state, saved);
    }
  });

  it("validates wrapLiveSignalsV1 with behavioral ready + execution alignment", async () => {
    const validate = loadValidator();
    const { getLiveSignals } = await import("../src/mcp/tools.js");
    const now = 1_700_000_000_000;
    const core = await getLiveSignals();
    const wrapped = wrapLiveSignalsV1(
      core,
      { settlementRail: "mcp-x402", tool: "get_live_signals" },
      {
        provenance: {
          latestThesisHash: null,
          anchoredAt: now,
          anchorMode: "on-chain",
          behavioral: {
            status: "ready",
            minClosedPositions: 1,
            metrics: {
              score: 72,
              archetype: "Patient Contrarian",
              winRate: 55,
              totalPositions: 4,
              upsideCapture: 48,
            },
          },
          reputation: {
            totalAnchors: 2,
            meanConvictionScore: 70,
            dualChain: true,
            latestArchetype: "fear",
          },
          explorerUrls: {
            casper: null,
            mantle: "https://example.com",
            dashboard: "https://earlynotwrong.vercel.app/agent",
            mcp: "http://localhost/mcp",
          },
          trackRecord: { totalTrades: 5, entries: 3, exits: 2, activePositions: 1 },
        },
        guidance: buildBuyerGuidance(null, core.signals, false),
        execution: {
          cycle: 3,
          rankedCandidates: [{ rank: 1, symbol: "FET", score: 80 }],
          entries: [
            {
              symbol: "FET",
              amountUsd: 12,
              convictionScore: 80,
              success: true,
              txHash: "0xabc",
            },
          ],
          exits: [],
          skips: [],
          alignment: {
            topRankedSymbol: "FET",
            topRankedEntered: true,
            enteredSymbols: ["FET"],
          },
        },
      },
      now,
    );
    expect(wrapped.execution.alignment.topRankedEntered).toBe(true);
    expect(validate(wrapped)).toBe(true);
  });
});
