/**
 * Tests for Delphi on-chain anchoring (thesis digest quantization, dedup)
 * and the calibration ledger (forecast resolution on redemption).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  quantizeEdge,
  computeDelphiDigest,
  buildDelphiRecord,
  anchorDelphiCycle,
  delphiSubjectHash,
  type DelphiAnchorInput,
} from "../lib/delphi/anchoring.js";
import { DelphiRunner } from "../lib/delphi/runner.js";
import { DelphiExecutor, type DelphiClientLike, type DelphiMarket, type DelphiPosition } from "../lib/delphi/executor.js";
import type { ConvictionRecord } from "../lib/anchors/types.js";

// =============================================================================
// Digest quantization
// =============================================================================

const baseInput: DelphiAnchorInput = {
  marketsEvaluated: 2,
  tradesPlaced: 1,
  decisions: [
    { marketAddress: "0xA", outcomeIdx: 0, decision: "buy", edge: 0.16 },
    { marketAddress: "0xA", outcomeIdx: 1, decision: "skip", edge: -0.16 },
    { marketAddress: "0xB", outcomeIdx: 0, decision: "skip", edge: 0.02 }, // neutral → dropped
  ],
};

describe("quantizeEdge", () => {
  it("buckets edges to the nearest 0.05", () => {
    expect(quantizeEdge(0.16)).toBeCloseTo(0.15, 9);
    expect(quantizeEdge(0.13)).toBeCloseTo(0.15, 9);
    expect(quantizeEdge(-0.02)).toBeCloseTo(0, 9);
    expect(quantizeEdge(0)).toBe(0);
  });

  it("absorbs LLM jitter within a bucket", () => {
    // 0.14 vs 0.16 are both inside the 0.15 bucket → same quantized edge.
    expect(quantizeEdge(0.14)).toBeCloseTo(quantizeEdge(0.16), 9);
  });
});

describe("computeDelphiDigest", () => {
  it("is deterministic for the same decisions", () => {
    expect(computeDelphiDigest(baseInput)).toBe(computeDelphiDigest(baseInput));
  });

  it("drops neutral decisions (quantized edge 0)", () => {
    const digest = JSON.parse(computeDelphiDigest(baseInput));
    // 0xB's ±0.02 edge quantizes to 0 → dropped from the digest.
    expect(digest.d.every((d: { mk: string }) => d.mk !== "0xB")).toBe(true);
    expect(digest.d).toHaveLength(2);
  });

  it("jitter within a bucket does not move the digest", () => {
    const jittered: DelphiAnchorInput = {
      ...baseInput,
      decisions: baseInput.decisions.map((d) =>
        d.marketAddress === "0xA" && d.outcomeIdx === 0
          ? { ...d, edge: 0.14 } // 0.14 → bucket 0.15, same as 0.16
          : d,
      ),
    };
    expect(computeDelphiDigest(jittered)).toBe(computeDelphiDigest(baseInput));
  });

  it("a meaningful edge shift moves the digest", () => {
    const shifted: DelphiAnchorInput = {
      ...baseInput,
      decisions: baseInput.decisions.map((d) =>
        d.marketAddress === "0xA" && d.outcomeIdx === 0
          ? { ...d, edge: 0.24 } // bucket 0.25 ≠ 0.15
          : d,
      ),
    };
    expect(computeDelphiDigest(shifted)).not.toBe(computeDelphiDigest(baseInput));
  });

  it("sorts decisions by market + outcome for stable ordering", () => {
    const reversed: DelphiAnchorInput = {
      ...baseInput,
      decisions: [...baseInput.decisions].reverse(),
    };
    expect(computeDelphiDigest(reversed)).toBe(computeDelphiDigest(baseInput));
  });
});

describe("buildDelphiRecord", () => {
  it("uses the competition gateway as the subject identity", () => {
    const record = buildDelphiRecord(baseInput);
    expect(record.subjectHash).toBe(delphiSubjectHash());
  });

  it("conviction score = % of markets with a buy signal", () => {
    // 1 of 2 evaluated markets produced a buy → 50.
    expect(buildDelphiRecord(baseInput).convictionScore).toBe(50);
  });

  it("conviction score is 0 when no markets were evaluated", () => {
    const empty: DelphiAnchorInput = { marketsEvaluated: 0, tradesPlaced: 0, decisions: [] };
    expect(buildDelphiRecord(empty).convictionScore).toBe(0);
  });

  it("thesis hash is deterministic from the digest", () => {
    const a = buildDelphiRecord(baseInput).thesisHash;
    const b = buildDelphiRecord(baseInput).thesisHash;
    expect(a).toBe(b);
    expect(a.startsWith("0x")).toBe(true);
  });
});

describe("anchorDelphiCycle", () => {
  it("calls the injected anchor fn with the built record", async () => {
    const calls: ConvictionRecord[] = [];
    const { outcome, deduped } = await anchorDelphiCycle({
      input: baseInput,
      lastAnchoredThesisHash: null,
      anchor: async (record) => {
        calls.push(record);
        return [{ adapter: "test", status: "success", txHash: "0xabc" }];
      },
    });
    expect(deduped).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].archetype).toBe("DELPHI FORECASTER");
    expect(outcome?.results[0].adapter).toBe("test");
  });

  it("dedupes when the thesis hash matches the last anchored one", async () => {
    let callCount = 0;
    const anchor = async () => {
      callCount++;
      return [{ adapter: "test", status: "success" as const }];
    };
    const first = await anchorDelphiCycle({ input: baseInput, lastAnchoredThesisHash: null, anchor });
    const second = await anchorDelphiCycle({
      input: baseInput,
      lastAnchoredThesisHash: first.thesisHash,
      anchor,
    });
    expect(callCount).toBe(1);
    expect(second.deduped).toBe(true);
    expect(second.outcome).toBeNull();
  });

  it("captures anchor-fn failures without throwing", async () => {
    const { outcome } = await anchorDelphiCycle({
      input: baseInput,
      lastAnchoredThesisHash: null,
      anchor: async () => {
        throw new Error("chain down");
      },
    });
    expect(outcome?.results[0].status).toBe("failed");
    expect(outcome?.results[0].error).toContain("chain down");
  });
});

// =============================================================================
// Runner integration: anchor dedup across restarts + calibration resolution
// =============================================================================

function makeMarket(id: string, question: string): DelphiMarket {
  return { id, question, category: "crypto", status: "open" };
}

function pos(market: string, outcomeIdx: number, status: DelphiPosition["marketStatus"]): DelphiPosition {
  return {
    marketProxy: market,
    outcomeIdx: String(outcomeIdx),
    shares: (10n ** 18n * 100n).toString(),
    marketStatus: status,
    redeemedOrLiquidated: false,
  };
}

/** Mutable fake-client config so tests can change chain state between cycles. */
function makeMutableFakeClient() {
  const cfg = {
    markets: [] as DelphiMarket[],
    prices: {} as Record<string, [number, number]>,
    positions: [] as DelphiPosition[],
    redeemTokensOut: {} as Record<string, bigint>,
  };
  const client: DelphiClientLike = {
    health: async () => ({ status: "ok" }),
    listMarkets: async () => ({ markets: cfg.markets }),
    getMarket: async ({ id }) => cfg.markets.find((m) => m.id === id) ?? ({} as DelphiMarket),
    quoteBuy: async ({ marketAddress, outcomeIdx, sharesOut }) => {
      const price = (cfg.prices[marketAddress] ?? [0.4, 0.6])[outcomeIdx];
      return { tokensIn: (sharesOut * BigInt(Math.round(price * 1e6))) / 1_000_000n };
    },
    buyShares: async () => ({ transactionHash: "0xentry" }),
    redeemPositions: async ({ marketAddresses }) => ({
      results: marketAddresses.map((m) => ({
        marketAddress: m,
        success: true,
        tokensOut: cfg.redeemTokensOut[m] ?? 0n,
      })),
      totalTokensOut: 0n,
    }),
    getSigner: async () => ({ address: "0xWallet" }),
    getErc20Balance: async () => 10n ** 18n * 1000n,
    listPositions: async () => ({ positions: cfg.positions }),
    liquidate: async () => ({ transactionHash: "0xliq" }),
  };
  return { cfg, client };
}

const estimatorWithEdge = (yesProb: number) => (input: { marketAddress: string; question: string }) => ({
  marketAddress: input.marketAddress,
  question: input.question,
  outcomes: [
    { outcomeIdx: 0, probability: yesProb, reasoning: "test" },
    { outcomeIdx: 1, probability: 1 - yesProb, reasoning: "" },
  ],
  provider: "injected" as const,
  model: "test",
  estimatedAt: Date.now(),
});

describe("DelphiRunner anchoring + calibration integration", () => {
  let dataDir: string;
  let savedEnabled: string | undefined;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "delphi-anchor-test-"));
    savedEnabled = process.env.DELPHI_ENABLED;
    process.env.DELPHI_ENABLED = "1";
  });

  afterEach(() => {
    if (savedEnabled === undefined) delete process.env.DELPHI_ENABLED;
    else process.env.DELPHI_ENABLED = savedEnabled;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("anchors a changed thesis and dedupes it after a restart", async () => {
    const { cfg, client } = makeMutableFakeClient();
    cfg.markets = [makeMarket("0xUnder", "Q?")];
    cfg.prices = { "0xUnder": [0.4, 0.6] };
    const factory = { apiKey: "k", retry: { maxRetries: 0 as const }, clientFactory: async () => client };

    const calls: string[] = [];
    const anchor = async (record: ConvictionRecord) => {
      calls.push(record.thesisHash);
      return [{ adapter: "test", status: "success" as const }];
    };

    const first = new DelphiRunner({
      executor: new DelphiExecutor(factory),
      dataDir,
      telegramEnabled: false,
      probability: { minEdgeToTrade: 0.08, estimator: estimatorWithEdge(0.55) },
      anchor,
    });
    const r1 = await first.runCycle(1);
    expect(r1.anchored).toBe(true);
    expect(calls).toHaveLength(1);

    // Restart: fresh runner instance, same dataDir → dedup must hold.
    const second = new DelphiRunner({
      executor: new DelphiExecutor(factory),
      dataDir,
      telegramEnabled: false,
      probability: { minEdgeToTrade: 0.08, estimator: estimatorWithEdge(0.55) },
      anchor,
    });
    const r2 = await second.runCycle(2);
    expect(r2.anchorDeduped).toBe(true);
    expect(calls).toHaveLength(1);

    // A meaningful shift (estimate jumps a bucket) re-anchors.
    cfg.markets = [makeMarket("0xUnder", "Q?")];
    const third = new DelphiRunner({
      executor: new DelphiExecutor(factory),
      dataDir,
      telegramEnabled: false,
      probability: { minEdgeToTrade: 0.08, estimator: estimatorWithEdge(0.75) },
      anchor,
    });
    const r3 = await third.runCycle(3);
    expect(r3.anchored).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]).not.toBe(calls[0]);
  });

  it("resolves a redeemed forecast into the calibration ledger (win)", async () => {
    const { cfg, client } = makeMutableFakeClient();
    const factory = { apiKey: "k", retry: { maxRetries: 0 as const }, clientFactory: async () => client };
    const runner = new DelphiRunner({
      executor: new DelphiExecutor(factory),
      dataDir,
      telegramEnabled: false,
      probability: { minEdgeToTrade: 0.08, estimator: estimatorWithEdge(0.55) },
      anchor: async () => [],
    });

    // Cycle 1: enter market 0xM (implied 0.40, est 0.55 → buy Yes).
    cfg.markets = [makeMarket("0xM", "Will it happen?")];
    cfg.prices = { "0xM": [0.4, 0.6] };
    const r1 = await runner.runCycle(1);
    expect(r1.tradesPlaced).toBe(1);
    expect(existsSync(join(dataDir, "positions.json"))).toBe(true);

    // Cycle 2: market settled, redeem pays out → forecast resolved as a win.
    cfg.markets = [];
    cfg.positions = [pos("0xM", 0, "settled")];
    cfg.redeemTokensOut = { "0xM": 100n * 10n ** 18n };
    const r2 = await runner.runCycle(2);
    expect(r2.redeemsSucceeded).toBe(1);

    const forecasts = readFileSync(join(dataDir, "forecasts.jsonl"), "utf-8")
      .trim().split("\n").map((l) => JSON.parse(l));
    expect(forecasts).toHaveLength(1);
    expect(forecasts[0].outcome).toBe(1);
    expect(forecasts[0].forecast).toBeCloseTo(0.55, 9);
    expect(forecasts[0].marketAddress).toBe("0xM");

    // Position closed out.
    const positions = JSON.parse(readFileSync(join(dataDir, "positions.json"), "utf-8"));
    expect(Object.keys(positions)).toHaveLength(0);
  });

  it("resolves a zero-payout redemption as a loss", async () => {
    const { cfg, client } = makeMutableFakeClient();
    const factory = { apiKey: "k", retry: { maxRetries: 0 as const }, clientFactory: async () => client };
    const runner = new DelphiRunner({
      executor: new DelphiExecutor(factory),
      dataDir,
      telegramEnabled: false,
      probability: { minEdgeToTrade: 0.08, estimator: estimatorWithEdge(0.55) },
      anchor: async () => [],
    });

    cfg.markets = [makeMarket("0xM", "Q?")];
    cfg.prices = { "0xM": [0.4, 0.6] };
    await runner.runCycle(1);

    cfg.markets = [];
    cfg.positions = [pos("0xM", 0, "settled")];
    cfg.redeemTokensOut = { "0xM": 0n }; // our outcome lost
    await runner.runCycle(2);

    const forecasts = readFileSync(join(dataDir, "forecasts.jsonl"), "utf-8")
      .trim().split("\n").map((l) => JSON.parse(l));
    expect(forecasts[0].outcome).toBe(0);
  });

  it("does not score markets with multiple tracked outcomes (ambiguous payout)", async () => {
    // An overround market (implied sums to < 1) can produce a positive edge on
    // BOTH outcomes — the only way the runner holds two forecasts in one
    // market. A single redeem payout can't be attributed between them, so we
    // close them out without scoring either.
    const { cfg, client } = makeMutableFakeClient();
    const factory = { apiKey: "k", retry: { maxRetries: 0 as const }, clientFactory: async () => client };
    const runner = new DelphiRunner({
      executor: new DelphiExecutor(factory),
      dataDir,
      telegramEnabled: false,
      // est [0.5, 0.5] vs implied [0.35, 0.35] → edge +0.15 on both outcomes.
      probability: { minEdgeToTrade: 0.08, estimator: estimatorWithEdge(0.5) },
      anchor: async () => [],
    });

    cfg.markets = [makeMarket("0xM", "Q?")];
    cfg.prices = { "0xM": [0.35, 0.35] };
    const r1 = await runner.runCycle(1);
    expect(r1.tradesPlaced).toBe(2);

    const positions = JSON.parse(readFileSync(join(dataDir, "positions.json"), "utf-8"));
    expect(Object.keys(positions)).toHaveLength(2);

    cfg.markets = [];
    cfg.positions = [pos("0xM", 0, "settled"), pos("0xM", 1, "settled")];
    cfg.redeemTokensOut = { "0xM": 100n * 10n ** 18n };
    await runner.runCycle(2);

    // Ambiguous attribution → positions closed, but NO forecast scored.
    expect(existsSync(join(dataDir, "forecasts.jsonl"))).toBe(false);
    const after = JSON.parse(readFileSync(join(dataDir, "positions.json"), "utf-8"));
    expect(Object.keys(after)).toHaveLength(0);
  });

  it("liquidated (expired) markets close positions without scoring them", async () => {
    const { cfg, client } = makeMutableFakeClient();
    const factory = { apiKey: "k", retry: { maxRetries: 0 as const }, clientFactory: async () => client };
    const runner = new DelphiRunner({
      executor: new DelphiExecutor(factory),
      dataDir,
      telegramEnabled: false,
      probability: { minEdgeToTrade: 0.08, estimator: estimatorWithEdge(0.55) },
      anchor: async () => [],
    });

    cfg.markets = [makeMarket("0xM", "Q?")];
    cfg.prices = { "0xM": [0.4, 0.6] };
    await runner.runCycle(1);

    cfg.markets = [];
    cfg.positions = [pos("0xM", 0, "expired")];
    const r = await runner.runCycle(2);
    expect(r.liquidatesSucceeded).toBe(1);
    expect(existsSync(join(dataDir, "forecasts.jsonl"))).toBe(false);
  });
});
