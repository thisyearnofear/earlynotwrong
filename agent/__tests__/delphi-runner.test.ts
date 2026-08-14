/**
 * Tests for the Delphi runner loop.
 *
 * Covers: DELPHI_ENABLED gate, health-check failure, market → estimate →
 * gate → trade flow with an injected executor + estimator, trade-ledger
 * writes, and snapshot persistence across cycles.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DelphiRunner } from "../lib/delphi/runner.js";
import { DelphiExecutor, type DelphiClientLike, type DelphiMarket } from "../lib/delphi/executor.js";
import type { MarketEstimateInput } from "../lib/delphi/probability.js";

// =============================================================================
// Fakes
// =============================================================================

function makeMarket(id: string, question: string): DelphiMarket {
  return { id, question, category: "crypto", status: "open" };
}

/** A DelphiClientLike fake whose quotes are configurable per outcome. */
function makeFakeClient(options: {
  markets: DelphiMarket[];
  prices?: Record<string, [number, number]>; // marketAddress → [yesPrice, noPrice]
  /** Token balance for sizing; default 1000 tokens (18-dec). */
  balanceTokens?: bigint;
}): DelphiClientLike {
  return {
    health: async () => ({ status: "ok" }),
    listMarkets: async () => ({ markets: options.markets }),
    getMarket: async ({ id }) => {
      const m = options.markets.find((x) => x.id === id);
      if (!m) throw new Error(`unknown market ${id}`);
      return m;
    },
    quoteBuy: async ({ marketAddress, outcomeIdx, sharesOut }) => {
      const price = (options.prices?.[marketAddress] ?? [0.4, 0.6])[outcomeIdx];
      // tokensIn = shares × price, scaled to 18-dec.
      return { tokensIn: (sharesOut * BigInt(Math.round(price * 1e6))) / 1_000_000n };
    },
    buyShares: async () => ({ transactionHash: "0xhash" }),
    redeemPositions: async ({ marketAddresses }) => ({
      results: marketAddresses.map((m) => ({ marketAddress: m, success: true, tokensOut: 0n })),
      totalTokensOut: 0n,
    }),
    getSigner: async () => ({ address: "0xWallet" }),
    getErc20Balance: async () => options.balanceTokens ?? 1_000_000_000_000_000_000_000n,
    listPositions: async () => ({ positions: [] }),
    liquidate: async () => ({ transactionHash: "0xliq" }),
  };
}

const ENABLED_ENV_SNAPSHOT: Record<string, string | undefined> = {};

describe("DelphiRunner", () => {
  let dataDir: string;
  let originalEnabled: string | undefined;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "delphi-runner-test-"));
    originalEnabled = process.env.DELPHI_ENABLED;
    // Snapshot every env var the runner might read so we can restore exactly.
    for (const key of [
      "OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
      "DELPHI_API_ACCESS_KEY", "DELPHI_WALLET_PRIVATE_KEY",
    ]) {
      ENABLED_ENV_SNAPSHOT[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.DELPHI_ENABLED;
    else process.env.DELPHI_ENABLED = originalEnabled;
    for (const [k, v] of Object.entries(ENABLED_ENV_SNAPSHOT)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("skips the cycle when DELPHI_ENABLED is off", async () => {
    delete process.env.DELPHI_ENABLED;
    const executor = new DelphiExecutor({ apiKey: "k", clientFactory: async () => makeFakeClient({ markets: [] }) });
    const runner = new DelphiRunner({ executor, dataDir, telegramEnabled: false });
    const result = await runner.runCycle(1);
    expect(result.marketsEvaluated).toBe(0);
  });

  it("throws on health-check failure with a helpful message", async () => {
    process.env.DELPHI_ENABLED = "1";
    const executor = new DelphiExecutor({ apiKey: "" }); // simulator → unavailable
    const runner = new DelphiRunner({ executor, dataDir, telegramEnabled: false });
    await expect(runner.runCycle(1)).rejects.toThrow(/health check failed/);
  });

  it("completes the full market → estimate → gate → trade flow", async () => {
    process.env.DELPHI_ENABLED = "1";
    const executor = new DelphiExecutor({
      apiKey: "k",
      retry: { maxRetries: 0 },
      clientFactory: async () =>
        makeFakeClient({
          markets: [makeMarket("0xUnder", "Will X happen?"), makeMarket("0xFair", "Will Y happen?")],
          prices: {
            // 0xUnder: implied 0.40 but estimator says 0.55 → edge 0.15 clears the 0.08 gate.
            "0xUnder": [0.4, 0.6],
            // 0xFair: estimator agrees with the market → no trade.
            "0xFair": [0.5, 0.5],
          },
        }),
    });
    const runner = new DelphiRunner({
      executor,
      dataDir,
      telegramEnabled: false,
      probability: {
        minEdgeToTrade: 0.08,
        estimator: (input: MarketEstimateInput) => ({
          marketAddress: input.marketAddress,
          question: input.question,
          outcomes: input.marketAddress === "0xUnder"
            ? [
                { outcomeIdx: 0, probability: 0.55, reasoning: "underpriced" },
                { outcomeIdx: 1, probability: 0.45, reasoning: "" },
              ]
            : [
                { outcomeIdx: 0, probability: 0.5, reasoning: "fair" },
                { outcomeIdx: 1, probability: 0.5, reasoning: "" },
              ],
          provider: "injected",
          model: "test",
          estimatedAt: Date.now(),
        }),
      },
    });

    const result = await runner.runCycle(3);
    expect(result.marketsEvaluated).toBe(2);
    expect(result.estimatesProduced).toBe(2);
    expect(result.tradesPlaced).toBe(1);

    // Trade ledger has exactly one entry for the underpriced market.
    const ledgerPath = join(dataDir, "trades.jsonl");
    expect(existsSync(ledgerPath)).toBe(true);
    const ledger = readFileSync(ledgerPath, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    expect(ledger).toHaveLength(1);
    expect(ledger[0].marketAddress).toBe("0xUnder");
    expect(ledger[0].edge).toBeCloseTo(0.15, 9);

    // Snapshot persisted.
    const snapshot = JSON.parse(readFileSync(join(dataDir, "snapshot.json"), "utf-8"));
    expect(snapshot.cyclesRun).toBe(1);
    expect(snapshot.tradesPlaced).toBe(1);
    expect(snapshot.marketsSeen).toBe(2);
  });

  it("places no trades when every market is fairly priced", async () => {
    process.env.DELPHI_ENABLED = "1";
    const executor = new DelphiExecutor({
      apiKey: "k",
      retry: { maxRetries: 0 },
      clientFactory: async () =>
        makeFakeClient({
          markets: [makeMarket("0xFair", "Q")],
          prices: { "0xFair": [0.5, 0.5] },
        }),
    });
    const runner = new DelphiRunner({
      executor,
      dataDir,
      telegramEnabled: false,
      probability: {
        estimator: (input) => ({
          marketAddress: input.marketAddress,
          question: input.question,
          outcomes: [
            { outcomeIdx: 0, probability: 0.5, reasoning: "fair" },
            { outcomeIdx: 1, probability: 0.5, reasoning: "" },
          ],
          provider: "injected",
          model: "test",
          estimatedAt: Date.now(),
        }),
      },
    });

    const result = await runner.runCycle(1);
    expect(result.tradesPlaced).toBe(0);
    expect(existsSync(join(dataDir, "trades.jsonl"))).toBe(false);
  });

  it("snapshot survives a restart (second runner instance resumes)", async () => {
    process.env.DELPHI_ENABLED = "1";
    const factoryConfig = {
      apiKey: "k",
      retry: { maxRetries: 0 as const },
      clientFactory: async () => makeFakeClient({ markets: [] }),
    };
    const first = new DelphiRunner({
      executor: new DelphiExecutor(factoryConfig),
      dataDir,
      telegramEnabled: false,
    });
    await first.runCycle(1);
    await first.runCycle(2);

    const second = new DelphiRunner({
      executor: new DelphiExecutor(factoryConfig),
      dataDir,
      telegramEnabled: false,
    });
    await second.runCycle(3);

    const snapshot = JSON.parse(readFileSync(join(dataDir, "snapshot.json"), "utf-8"));
    expect(snapshot.cyclesRun).toBe(3);
  });
});
