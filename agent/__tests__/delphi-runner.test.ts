/**
 * Tests for the Delphi runner loop.
 *
 * Covers: DELPHI_ENABLED gate, health-check failure, market → estimate →
 * gate → trade flow with an injected executor + estimator, trade-ledger
 * writes, and snapshot persistence across cycles.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DelphiRunner,
  forecastCacheKey,
  pruneForecastCache,
  latestStopsByMarket,
  evaluateStopReentryGate,
} from "../lib/delphi/runner.js";
import { DelphiExecutor, type DelphiClientLike, type DelphiMarket, type DelphiPosition } from "../lib/delphi/executor.js";
import { AGENT_CONFIG } from "../lib/config.js";
import type { MarketEstimate, MarketEstimateInput } from "../lib/delphi/probability.js";
import type { FactCheck } from "../lib/delphi/fact-check.js";
import type { VerificationInput, VerificationResult } from "../lib/delphi/verification.js";

// Post-competition (2026-08-25): the arena window closed 2026-08-24, so any
// test that exercises market discovery with the real Date.now() would hit
// the closed-window branch and silently skip evaluation. Push the configured
// close out by one year for the lifetime of this file. The one test that
// asserts post-close behavior (line ~1533) passes a fixed `now:` *after* the
// new close so it still exercises the right code path.
const ORIGINAL_WINDOW_CLOSES = AGENT_CONFIG.delphi.tradingWindowCloses;
beforeAll(() => {
  (AGENT_CONFIG.delphi as { tradingWindowCloses: string }).tradingWindowCloses = "2027-08-24T00:00:00Z";
});
afterAll(() => {
  (AGENT_CONFIG.delphi as { tradingWindowCloses: string }).tradingWindowCloses = ORIGINAL_WINDOW_CLOSES;
});

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
  /** On-chain positions returned by listPositions (awaiting_settlement counts as open). */
  chainPositions?: DelphiPosition[];
  /** getMarket-only markets (not listed as open). */
  extraMarkets?: DelphiMarket[];
}): DelphiClientLike {
  const allMarkets = [...options.markets, ...(options.extraMarkets ?? [])];
  return {
    health: async () => ({ status: "ok" }),
    listMarkets: async () => ({ markets: options.markets }),
    getMarket: async ({ id }) => {
      const m = allMarkets.find((x) => x.id === id);
      if (!m) throw new Error(`unknown market ${id}`);
      return m;
    },
    quoteBuy: async ({ marketAddress, outcomeIdx, sharesOut }) => {
      const price = (options.prices?.[marketAddress] ?? [0.4, 0.6])[outcomeIdx];
      // tokensIn is 6-dec TST, sharesOut is 18-dec: same contract as live.
      return { tokensIn: (sharesOut * BigInt(Math.round(price * 1e6))) / (10n ** 12n * 1_000_000n) };
    },
    buyShares: async () => ({ transactionHash: "0xhash" }),
    redeemPositions: async ({ marketAddresses }) => ({
      results: marketAddresses.map((m) => ({ marketAddress: m, success: true, tokensOut: 0n })),
      totalTokensOut: 0n,
    }),
    getSigner: async () => ({ address: "0xWallet" }),
    getErc20Balance: async () => options.balanceTokens ?? 10_000n * 10n ** 6n, // 10,000 TST, 6-dec
    ensureTokenApproval: async () => ({ approvalNeeded: false, allowance: 0n }),
    listPositions: async () => ({ positions: options.chainPositions ?? [] }),
    liquidate: async () => ({ transactionHash: "0xliq" }),
    quoteSell: async ({ marketAddress, outcomeIdx, sharesIn }) => {
      const price = (options.prices?.[marketAddress] ?? [0.4, 0.6])[outcomeIdx];
      return { tokensOut: (sharesIn * BigInt(Math.round(price * 1e6))) / (10n ** 12n * 1_000_000n) };
    },
    sellShares: async () => ({ transactionHash: "0xsell" }),
  };
}

const ENABLED_ENV_SNAPSHOT: Record<string, string | undefined> = {};

/**
 * No-op alpha data sources. runner.ts side-effect-imports env-bootstrap,
 * which loads agent/.env (including a real VERCEL_AI_GATEWAY_API_KEY) into
 * the test process — without these injections the default DelphiWebSearch
 * and SoSoValue vol fetcher would make live network calls and time out.
 */
const noopWebSearch = { resetCycleBudget: () => {}, briefing: async () => null };
const noopVolBaseline = async () => undefined;
/** Tier 1/4 defaults: no authority matches, verification never runs. */
const noopFactCheck = async () => null;
const noopVerify = async () => ({ ran: false }) as VerificationResult;

describe("latestStopsByMarket (pure)", () => {
  it("picks the latest exit-stop per market with its edge", () => {
    const stops = latestStopsByMarket([
      { type: "exit-stop", marketAddress: "0xA", timestamp: 100, edge: 0.15 },
      { type: "exit-stop", marketAddress: "0xA", timestamp: 300, edge: 0.20 },
      { type: "exit-stop", marketAddress: "0xB", timestamp: 200, edge: 0.10 },
      { type: "entry", marketAddress: "0xA", timestamp: 50, edge: 0.99 }, // noise
    ]);
    expect(stops.get("0xA")).toEqual({ timestamp: 300, edge: 0.2 });
    expect(stops.get("0xB")).toEqual({ timestamp: 200, edge: 0.1 });
  });

  it("falls back to the matching entry edge for legacy stops without an edge", () => {
    const stops = latestStopsByMarket([
      { type: "entry", marketAddress: "0xA", timestamp: 100, edge: 0.147 },
      { type: "exit-stop", marketAddress: "0xA", timestamp: 200 }, // pre-fix record
    ]);
    expect(stops.get("0xA")).toEqual({ timestamp: 200, edge: 0.147 });
  });

  it("fail-closes to Infinity edge when no edge is recoverable", () => {
    const stops = latestStopsByMarket([
      { type: "exit-stop", marketAddress: "0xA", timestamp: 200 },
    ]);
    expect(stops.get("0xA")?.edge).toBe(Number.POSITIVE_INFINITY);
  });

  it("ignores non-stop ledger records", () => {
    const stops = latestStopsByMarket([
      { type: "entry", marketAddress: "0xA", timestamp: 100, edge: 0.2 },
      { type: "exit-convergence", marketAddress: "0xA", timestamp: 300, edge: 0.2 },
      { type: "redeem", marketAddress: "0xA", timestamp: 400, success: true },
    ]);
    expect(stops.size).toBe(0);
  });
});

describe("evaluateStopReentryGate (pure)", () => {
  const H = 3_600_000;
  const cooldownMs = 12 * H;

  it("blocks re-entry inside the cooldown for a same-or-weaker edge", () => {
    const stoppedAt = 0;
    const gate = evaluateStopReentryGate({ stoppedAt, stoppedEdge: 0.15, newEdge: 0.15, now: 6 * H, cooldownMs });
    expect(gate.allow).toBe(false);
    const weaker = evaluateStopReentryGate({ stoppedAt, stoppedEdge: 0.15, newEdge: 0.10, now: 6 * H, cooldownMs });
    expect(weaker.allow).toBe(false);
  });

  it("allows re-entry once the cooldown has elapsed", () => {
    const gate = evaluateStopReentryGate({ stoppedAt: 0, stoppedEdge: 0.15, newEdge: 0.10, now: 12 * H + 1, cooldownMs });
    expect(gate.allow).toBe(true);
  });

  it("allows re-entry inside the cooldown when the edge strictly improved", () => {
    const gate = evaluateStopReentryGate({ stoppedAt: 0, stoppedEdge: 0.15, newEdge: 0.3, now: H, cooldownMs });
    expect(gate.allow).toBe(true);
    expect(gate.reason).toMatch(/edge improved/);
  });

  it("never lets a jitter-equal edge through inside the cooldown", () => {
    const gate = evaluateStopReentryGate({ stoppedAt: 0, stoppedEdge: 0.147, newEdge: 0.147, now: H, cooldownMs });
    expect(gate.allow).toBe(false);
  });
});

describe("forecastCacheKey / pruneForecastCache (pure)", () => {
  const sampleEstimate = (addr: string): MarketEstimate => ({
    marketAddress: addr,
    question: "Q",
    outcomes: [
      { outcomeIdx: 0, probability: 0.5, reasoning: "" },
      { outcomeIdx: 1, probability: 0.5, reasoning: "" },
    ],
    provider: "injected",
    model: "test",
    estimatedAt: 0,
  });

  it("quantizes prices to 2¢ buckets (jitter under 0.5¢ is the same key)", () => {
    expect(forecastCacheKey("0xA", [0.4, 0.6])).toBe(forecastCacheKey("0xA", [0.4, 0.6]));
    // 0.401 → buckets to 0.4; a full-cent move does not.
    expect(forecastCacheKey("0xA", [0.401, 0.599])).toBe(forecastCacheKey("0xA", [0.4, 0.6]));
    expect(forecastCacheKey("0xA", [0.41, 0.59])).not.toBe(forecastCacheKey("0xA", [0.4, 0.6]));
  });

  it("changes when the briefing text changes", () => {
    expect(forecastCacheKey("0xA", [0.4, 0.6], "briefing one")).not.toBe(
      forecastCacheKey("0xA", [0.4, 0.6], "briefing two"),
    );
    expect(forecastCacheKey("0xA", [0.4, 0.6])).toBe(
      forecastCacheKey("0xA", [0.4, 0.6], undefined),
    );
  });

  it("prunes only entries older than the TTL", () => {
    const cache = new Map<string, { estimate: MarketEstimate; fetchedAt: number }>([
      ["fresh", { estimate: sampleEstimate("0xF"), fetchedAt: 1_000 }],
      ["stale", { estimate: sampleEstimate("0xS"), fetchedAt: 0 }],
    ]);
    pruneForecastCache(cache, 500, 1_000);
    expect(cache.has("fresh")).toBe(true);
    expect(cache.has("stale")).toBe(false);
  });
});

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
    const runner = new DelphiRunner({ executor, dataDir, telegramEnabled: false, tournamentMode: false, endgameHoldFromUtc: null, webSearch: noopWebSearch, fetchVolBaseline: noopVolBaseline });
    const result = await runner.runCycle(1);
    expect(result.marketsEvaluated).toBe(0);
  });

  it("throws on health-check failure with a helpful message", async () => {
    process.env.DELPHI_ENABLED = "1";
    const executor = new DelphiExecutor({ apiKey: "" }); // simulator → unavailable
    const runner = new DelphiRunner({ executor, dataDir, telegramEnabled: false, tournamentMode: false, endgameHoldFromUtc: null, webSearch: noopWebSearch, fetchVolBaseline: noopVolBaseline });
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
      telegramEnabled: false, tournamentMode: false, endgameHoldFromUtc: null,
      webSearch: noopWebSearch,
      fetchVolBaseline: noopVolBaseline,
      verificationEnabled: false,
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

  it("never adds a second thesis to a market with a tracked position", async () => {
    // Regression (production incident 2026-08-15): the Typhoon market was
    // bought YES in cycle #27 and NO in cycle #29 — opposite forecasts in
    // the same market, capital hedging itself into a guaranteed loss. The
    // guard must skip re-entry regardless of which outcome the new edge
    // favors.
    process.env.DELPHI_ENABLED = "1";
    // Seed a tracked YES position in the market the cycle will re-see.
    writeFileSync(
      join(dataDir, "positions.json"),
      JSON.stringify({
        "0xM:0": {
          id: "0xM:0",
          marketAddress: "0xM",
          outcomeIdx: 0,
          question: "Q?",
          forecast: 0.55,
          impliedProbability: 0.4,
          edge: 0.15,
          shares: (10n ** 18n).toString(),
          tokensIn: (4n * 10n ** 5n).toString(), // 0.4 TST, 6-dec
          openedAt: 1000,
        },
      }),
    );

    const executor = new DelphiExecutor({
      apiKey: "k",
      retry: { maxRetries: 0 },
      clientFactory: async () =>
        makeFakeClient({
          markets: [makeMarket("0xM", "Q?")],
          prices: { "0xM": [0.4, 0.6] },
        }),
    });
    const runner = new DelphiRunner({
      executor,
      dataDir,
      telegramEnabled: false, tournamentMode: false, endgameHoldFromUtc: null,
      webSearch: noopWebSearch,
      fetchVolBaseline: noopVolBaseline,
      verificationEnabled: false,
      probability: {
        minEdgeToTrade: 0.08,
        // NO now looks underpriced (edge +0.15) — the guard must still hold.
        estimator: (input: MarketEstimateInput) => ({
          marketAddress: input.marketAddress,
          question: input.question,
          outcomes: [
            { outcomeIdx: 0, probability: 0.45, reasoning: "" },
            { outcomeIdx: 1, probability: 0.55, reasoning: "flipped view" },
          ],
          provider: "injected",
          model: "test",
          estimatedAt: Date.now(),
        }),
      },
    });

    const result = await runner.runCycle(1);
    expect(result.tradesPlaced).toBe(0);
    expect(result.sizingSkips).toBe(0); // skipped by the guard, not sizing

    // The seeded position survives untouched.
    const positions = JSON.parse(readFileSync(join(dataDir, "positions.json"), "utf-8"));
    expect(Object.keys(positions)).toEqual(["0xM:0"]);
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
      telegramEnabled: false, tournamentMode: false, endgameHoldFromUtc: null,
      webSearch: noopWebSearch,
      fetchVolBaseline: noopVolBaseline,
      verificationEnabled: false,
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
      telegramEnabled: false, tournamentMode: false, endgameHoldFromUtc: null,
      webSearch: noopWebSearch,
      fetchVolBaseline: noopVolBaseline,
      verificationEnabled: false,
    });
    await first.runCycle(1);
    await first.runCycle(2);

    const second = new DelphiRunner({
      executor: new DelphiExecutor(factoryConfig),
      dataDir,
      telegramEnabled: false, tournamentMode: false, endgameHoldFromUtc: null,
      webSearch: noopWebSearch,
      fetchVolBaseline: noopVolBaseline,
      verificationEnabled: false,
    });
    await second.runCycle(3);

    const snapshot = JSON.parse(readFileSync(join(dataDir, "snapshot.json"), "utf-8"));
    expect(snapshot.cyclesRun).toBe(3);
  });

  it("reuses cached estimates when implied prices are unchanged (inference efficiency)", async () => {
    process.env.DELPHI_ENABLED = "1";
    let estimatorCalls = 0;
    const factoryConfig = {
      apiKey: "k",
      retry: { maxRetries: 0 as const },
      clientFactory: async () =>
        makeFakeClient({
          markets: [makeMarket("0xFair", "Q")],
          prices: { "0xFair": [0.5, 0.5] },
        }),
    };
    const runner = new DelphiRunner({
      executor: new DelphiExecutor(factoryConfig),
      dataDir,
      telegramEnabled: false, tournamentMode: false, endgameHoldFromUtc: null,
      webSearch: noopWebSearch,
      fetchVolBaseline: noopVolBaseline,
      verificationEnabled: false,
      probability: {
        estimator: (input) => {
          estimatorCalls++;
          return {
            marketAddress: input.marketAddress,
            question: input.question,
            outcomes: [
              { outcomeIdx: 0, probability: 0.5, reasoning: "fair" },
              { outcomeIdx: 1, probability: 0.5, reasoning: "" },
            ],
            provider: "injected",
            model: "test",
            estimatedAt: Date.now(),
          };
        },
      },
    });

    const c1 = await runner.runCycle(1);
    expect(c1.estimatesProduced).toBe(1);
    expect(c1.estimatesCached).toBe(0);
    expect(estimatorCalls).toBe(1);

    const c2 = await runner.runCycle(2);
    expect(c2.estimatesProduced).toBe(1);
    expect(c2.estimatesCached).toBe(1);
    // Second cycle served entirely from cache — zero inference.
    expect(estimatorCalls).toBe(1);
  });

  it("re-estimates when the implied price moves a full bucket (≥1¢)", async () => {
    process.env.DELPHI_ENABLED = "1";
    let estimatorCalls = 0;
    const runner = new DelphiRunner({
      executor: new DelphiExecutor({
        apiKey: "k",
        retry: { maxRetries: 0 },
        clientFactory: async () =>
          makeFakeClient({
            markets: [makeMarket("0xMove", "Q")],
            prices: { "0xMove": [0.5, 0.5] },
          }),
      }),
      dataDir,
      telegramEnabled: false, tournamentMode: false, endgameHoldFromUtc: null,
      webSearch: noopWebSearch,
      fetchVolBaseline: noopVolBaseline,
      verificationEnabled: false,
      probability: {
        estimator: (input) => {
          estimatorCalls++;
          return {
            marketAddress: input.marketAddress,
            question: input.question,
            outcomes: [
              { outcomeIdx: 0, probability: 0.5, reasoning: "" },
              { outcomeIdx: 1, probability: 0.5, reasoning: "" },
            ],
            provider: "injected",
            model: "test",
            estimatedAt: Date.now(),
          };
        },
      },
    });

    await runner.runCycle(1);
    expect(estimatorCalls).toBe(1);

    // Swap the executor for one quoting a 5¢ move → cache miss.
    const movedRunner = new DelphiRunner({
      executor: new DelphiExecutor({
        apiKey: "k",
        retry: { maxRetries: 0 },
        clientFactory: async () =>
          makeFakeClient({
            markets: [makeMarket("0xMove", "Q")],
            prices: { "0xMove": [0.55, 0.45] },
          }),
      }),
      dataDir,
      telegramEnabled: false, tournamentMode: false, endgameHoldFromUtc: null,
      webSearch: noopWebSearch,
      fetchVolBaseline: noopVolBaseline,
      verificationEnabled: false,
      probability: {
        estimator: (input) => {
          estimatorCalls++;
          return {
            marketAddress: input.marketAddress,
            question: input.question,
            outcomes: [
              { outcomeIdx: 0, probability: 0.55, reasoning: "" },
              { outcomeIdx: 1, probability: 0.45, reasoning: "" },
            ],
            provider: "injected",
            model: "test",
            estimatedAt: Date.now(),
          };
        },
      },
    });
    // Different runner instance = empty cache (deliberate: in-process only).
    const c2 = await movedRunner.runCycle(2);
    expect(c2.estimatesProduced).toBe(1);
    expect(c2.estimatesCached).toBe(0);
    expect(estimatorCalls).toBe(2);
  });

  it("never caches vol-anchored markets (the anchor tracks the live spot)", async () => {
    process.env.DELPHI_ENABLED = "1";
    let estimatorCalls = 0;
    const runner = new DelphiRunner({
      executor: new DelphiExecutor({
        apiKey: "k",
        retry: { maxRetries: 0 },
        clientFactory: async () =>
          makeFakeClient({
            markets: [makeMarket("0xVol", "Will BTC close above $150k on Aug 24?")],
            prices: { "0xVol": [0.4, 0.6] },
          }),
      }),
      dataDir,
      telegramEnabled: false, tournamentMode: false, endgameHoldFromUtc: null,
      webSearch: noopWebSearch,
      fetchVolBaseline: async () => 0.05,
      verificationEnabled: false,
      factCheck: noopFactCheck,
      verify: noopVerify,
      probability: {
        estimator: (input) => {
          estimatorCalls++;
          return {
            marketAddress: input.marketAddress,
            question: input.question,
            outcomes: [
              { outcomeIdx: 0, probability: 0.1, reasoning: "" },
              { outcomeIdx: 1, probability: 0.9, reasoning: "" },
            ],
            provider: "injected",
            model: "test",
            estimatedAt: Date.now(),
          };
        },
      },
    });

    const c1 = await runner.runCycle(1);
    expect(c1.volBaselines).toBe(1);
    const c2 = await runner.runCycle(2);
    // Both cycles hit the estimator — vol-anchored estimates are never cached.
    expect(c1.estimatesCached).toBe(0);
    expect(c2.estimatesCached).toBe(0);
    expect(estimatorCalls).toBe(2);
  });

  it("closes a stuck losing redeem via its resolution and scores the forecast", async () => {
    // Regression (production incident 2026-08-18): the Typhoon market
    // resolved NO while we held YES; redeem() reverts for losing shares, so
    // the sweep retried it every hour (~50 times) and pinned the exposure.
    // With the resolution known the sweep must: score the forecast (loss),
    // free the exposure, and stop retrying.
    process.env.DELPHI_ENABLED = "1";
    writeFileSync(
      join(dataDir, "positions.json"),
      JSON.stringify({
        "0xLose:0": {
          id: "0xLose:0",
          marketAddress: "0xLose",
          outcomeIdx: 0,
          question: "Will the typhoon hit?",
          forecast: 0.95,
          impliedProbability: 0.31,
          edge: 0.64,
          shares: (325n * 10n ** 18n).toString(),
          tokensIn: (103n * 10n ** 6n).toString(),
          openedAt: 1000,
        },
      }),
    );
    writeFileSync(join(dataDir, "exposure.json"), JSON.stringify({ "0xLose": (103n * 10n ** 6n).toString() }));

    // Narrow fake: settled losing position, redeem always reverts, API knows
    // the winner.
    const client = makeFakeClient({ markets: [] });
    client.listPositions = async () => ({
      positions: [{ marketProxy: "0xLose", outcomeIdx: "0", shares: "1000", marketStatus: "settled", redeemedOrLiquidated: false }],
    });
    client.redeemPositions = async ({ marketAddresses }) => ({
      results: marketAddresses.map((m) => ({ marketAddress: m, success: false, error: "revert 0x50cd9791" })),
      totalTokensOut: 0n,
    });
    client.getMarket = async ({ id }) => ({ id, question: "Will the typhoon hit?", status: "settled", winningOutcomeIdx: "1" });

    const runner = new DelphiRunner({
      executor: new DelphiExecutor({ apiKey: "k", retry: { maxRetries: 0 }, clientFactory: async () => client }),
      dataDir,
      telegramEnabled: false, tournamentMode: false, endgameHoldFromUtc: null,
      webSearch: noopWebSearch,
      fetchVolBaseline: noopVolBaseline,
      verificationEnabled: false,
    });
    const result = await runner.runCycle(1);
    expect(result.redeemsLostClosed).toBe(1);

    // Position closed, exposure freed.
    const positions = JSON.parse(readFileSync(join(dataDir, "positions.json"), "utf-8"));
    expect(positions["0xLose:0"]).toBeUndefined();
    const exposure = JSON.parse(readFileSync(join(dataDir, "exposure.json"), "utf-8"));
    expect(exposure["0xLose"]).toBeUndefined();

    // Forecast scored as a loss (payout 0) in the calibration ledger.
    const forecasts = readFileSync(join(dataDir, "forecasts.jsonl"), "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    expect(forecasts).toHaveLength(1);
    expect(forecasts[0].outcome).toBe(0);
    expect(forecasts[0].forecast).toBe(0.95);

    // Trade ledger records the close with the winning outcome.
    const ledger = readFileSync(join(dataDir, "trades.jsonl"), "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    const lost = ledger.find((r) => r.type === "redeem-lost");
    expect(lost).toBeDefined();
    expect(lost.winningOutcomeIdx).toBe(1);
    // No plain failed-redeem event lingers to seed another retry cycle.
    expect(ledger.some((r) => r.type === "redeem" && r.success === false)).toBe(false);
  });

  it("blocks re-entry into a recently stopped market until the edge improves", async () => {
    // Regression (Chess-market incident, 2026-08-15..18): after a thesis
    // stop, the hourly cycle re-bought the same "underpriced" outcome within
    // hours — 4 entries in 4 days, net −89 TST. A 12h cooldown (overridable
    // only by a strictly stronger edge) must gate re-entry.
    process.env.DELPHI_ENABLED = "1";
    const now = Date.now();
    const entryTs = now - 6 * 3_600_000;
    const stopTs = now - 1 * 3_600_000; // stopped 1h ago
    writeFileSync(
      join(dataDir, "trades.jsonl"),
      [
        JSON.stringify({ type: "entry", marketAddress: "0xChess", outcomeIdx: 0, question: "Q?", edge: 0.15, tokensIn: "1000000", timestamp: entryTs }),
        JSON.stringify({ type: "exit-stop", marketAddress: "0xChess", outcomeIdx: 0, question: "Q?", edge: 0.15, tokensOut: "500000", timestamp: stopTs }),
      ].join("\n") + "\n",
    );

    const underpricedEstimator = (boost: number) => (input: MarketEstimateInput): MarketEstimate => ({
      marketAddress: input.marketAddress,
      question: input.question,
      outcomes: [
        { outcomeIdx: 0, probability: 0.4 + boost, reasoning: "underpriced" },
        { outcomeIdx: 1, probability: 0.6 - boost, reasoning: "" },
      ],
      provider: "injected",
      model: "test",
      estimatedAt: now,
    });

    // Edge 0.15 (est 0.55 vs implied 0.40 — exactly the stopped thesis's
    // edge, not strictly better) → blocked by the cooldown.
    const blockedRunner = new DelphiRunner({
      executor: new DelphiExecutor({
        apiKey: "k",
        retry: { maxRetries: 0 },
        clientFactory: async () =>
          makeFakeClient({ markets: [makeMarket("0xChess", "Q?")], prices: { "0xChess": [0.4, 0.6] } }),
      }),
      dataDir,
      telegramEnabled: false, tournamentMode: false, endgameHoldFromUtc: null,
      webSearch: noopWebSearch,
      fetchVolBaseline: noopVolBaseline,
      verificationEnabled: false,
      now: () => now,
      probability: { minEdgeToTrade: 0.08, estimator: underpricedEstimator(0.15) },
    });
    const blocked = await blockedRunner.runCycle(1);
    expect(blocked.tradesPlaced).toBe(0);

    // A strictly improved edge (est 0.70 vs implied 0.40 → 0.30 > stopped
    // 0.15) justifies re-entering before the cooldown elapses.
    const allowedRunner = new DelphiRunner({
      executor: new DelphiExecutor({
        apiKey: "k",
        retry: { maxRetries: 0 },
        clientFactory: async () =>
          makeFakeClient({ markets: [makeMarket("0xChess", "Q?")], prices: { "0xChess": [0.4, 0.6] } }),
      }),
      dataDir,
      telegramEnabled: false, tournamentMode: false, endgameHoldFromUtc: null,
      webSearch: noopWebSearch,
      fetchVolBaseline: noopVolBaseline,
      verificationEnabled: false,
      now: () => now,
      probability: { minEdgeToTrade: 0.08, estimator: underpricedEstimator(0.3) },
    });
    const allowed = await allowedRunner.runCycle(2);
    expect(allowed.tradesPlaced).toBe(1);
  });

  it("Tier 1: a direct authority probability produces a deterministic estimate (no LLM)", async () => {
    // When a resolution authority's data covers the window, the estimate is
    // arithmetic from the ground truth — the forecaster LLM never runs, and
    // the entry trades on the authority number with `factAuthority` provenance.
    process.env.DELPHI_ENABLED = "1";
    let estimatorCalls = 0;
    const authority: FactCheck = {
      authority: "test-authority",
      question: "Q?",
      facts: "source of record: threshold exceeded, day complete",
      probability: 0.99,
      fetchedAt: 1000,
    };
    const runner = new DelphiRunner({
      executor: new DelphiExecutor({
        apiKey: "k",
        retry: { maxRetries: 0 },
        clientFactory: async () =>
          makeFakeClient({ markets: [makeMarket("0xAuth", "Q?")], prices: { "0xAuth": [0.6, 0.4] } }),
      }),
      dataDir,
      telegramEnabled: false, tournamentMode: false, endgameHoldFromUtc: null,
      webSearch: noopWebSearch,
      fetchVolBaseline: noopVolBaseline,
      verificationEnabled: false,
      factCheck: async () => authority,
      probability: {
        minEdgeToTrade: 0.08,
        // If the LLM path ever runs, this estimator would be called.
        estimator: (input: MarketEstimateInput) => {
          estimatorCalls++;
          return {
            marketAddress: input.marketAddress,
            question: input.question,
            outcomes: [
              { outcomeIdx: 0, probability: 0.5, reasoning: "" },
              { outcomeIdx: 1, probability: 0.5, reasoning: "" },
            ],
            provider: "injected",
            model: "test",
            estimatedAt: Date.now(),
          };
        },
      },
    });

    const result = await runner.runCycle(1);
    expect(result.factChecks).toBe(1);
    expect(estimatorCalls).toBe(0); // ground truth — the forecaster was skipped
    expect(result.tradesPlaced).toBe(1); // edge 0.99 − 0.60 = 0.39 clears the gate

    // The position records the authority provenance + the authority forecast.
    const positions = JSON.parse(readFileSync(join(dataDir, "positions.json"), "utf-8"));
    const pos = positions["0xAuth:0"];
    expect(pos).toBeDefined();
    expect(pos.factAuthority).toBe("test-authority");
    expect(pos.forecast).toBeCloseTo(0.99, 9);
    expect(pos.model).toBe("authority:test-authority");

    // The ledger entry carries the same provenance.
    const ledger = readFileSync(join(dataDir, "trades.jsonl"), "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    const entry = ledger.find((r) => r.type === "entry");
    expect(entry.estimatedProbability).toBeCloseTo(0.99, 9);
    expect(entry.provenance.factAuthority).toBe("test-authority");
  });

  it("Tier 1: evidence-only facts are injected into the estimate input (no probability override)", async () => {
    // Open resolution window → the authority supplies facts, not a number;
    // the ordinary estimate path runs with authorityFacts in its input.
    process.env.DELPHI_ENABLED = "1";
    const authority: FactCheck = {
      authority: "test-authority",
      question: "Q?",
      facts: "trailing 7 days: 2426; 1900; 2600",
      // no probability → evidence-only mode
      fetchedAt: 1000,
    };
    let sawAuthorityFacts: string | undefined;
    const runner = new DelphiRunner({
      executor: new DelphiExecutor({
        apiKey: "k",
        retry: { maxRetries: 0 },
        clientFactory: async () =>
          makeFakeClient({ markets: [makeMarket("0xOpen", "Q?")], prices: { "0xOpen": [0.5, 0.5] } }),
      }),
      dataDir,
      telegramEnabled: false, tournamentMode: false, endgameHoldFromUtc: null,
      webSearch: noopWebSearch,
      fetchVolBaseline: noopVolBaseline,
      verificationEnabled: false,
      factCheck: async () => authority,
      probability: {
        minEdgeToTrade: 0.08,
        estimator: (input: MarketEstimateInput) => {
          sawAuthorityFacts = input.authorityFacts;
          return {
            marketAddress: input.marketAddress,
            question: input.question,
            outcomes: [
              { outcomeIdx: 0, probability: 0.5, reasoning: "" },
              { outcomeIdx: 1, probability: 0.5, reasoning: "" },
            ],
            provider: "injected",
            model: "test",
            estimatedAt: Date.now(),
          };
        },
      },
    });

    await runner.runCycle(1);
    expect(sawAuthorityFacts).toBe("trailing 7 days: 2426; 1900; 2600");
  });

  it("Tier 2: stale-year briefing passages are dropped before reaching the estimator", async () => {
    // The WTI-1986 incident: a briefing mixing a 1986 price table into a
    // 2026 question must arrive at the forecaster without the stale passage.
    process.env.DELPHI_ENABLED = "1";
    let sawBriefingText: string | undefined;
    const runner = new DelphiRunner({
      executor: new DelphiExecutor({
        apiKey: "k",
        retry: { maxRetries: 0 },
        clientFactory: async () =>
          makeFakeClient({ markets: [makeMarket("0xOil", "Will WTI crude oil close above $95 on 2026-08-22 UTC?")], prices: { "0xOil": [0.5, 0.5] } }),
      }),
      dataDir,
      telegramEnabled: false, tournamentMode: false, endgameHoldFromUtc: null,
      webSearch: {
        resetCycleBudget: () => {},
        briefing: async () => ({
          text:
            "- In 1986 WTI crude collapsed to $10 (history.com)\n" +
            "- Crude futures settled $91.40 in August 2026 (reuters.com)",
          sources: ["https://reuters.com/a"],
          cached: false,
          budgetExhausted: false,
          source: "firecrawl",
        }),
      },
      fetchVolBaseline: noopVolBaseline,
      verificationEnabled: false,
      factCheck: noopFactCheck,
      probability: {
        estimator: (input: MarketEstimateInput) => {
          sawBriefingText = input.webBriefing?.text;
          return {
            marketAddress: input.marketAddress,
            question: input.question,
            outcomes: [
              { outcomeIdx: 0, probability: 0.5, reasoning: "" },
              { outcomeIdx: 1, probability: 0.5, reasoning: "" },
            ],
            provider: "injected",
            model: "test",
            estimatedAt: Date.now(),
          };
        },
      },
    });

    await runner.runCycle(1);
    expect(sawBriefingText).toBeDefined();
    expect(sawBriefingText).toContain("91.40");
    expect(sawBriefingText).not.toContain("1986"); // stale passage stripped
  });

  it("Tier 2: a fully-stale briefing injects nothing (empty → undefined)", async () => {
    process.env.DELPHI_ENABLED = "1";
    let sawBriefing: unknown = "sentinel";
    const runner = new DelphiRunner({
      executor: new DelphiExecutor({
        apiKey: "k",
        retry: { maxRetries: 0 },
        clientFactory: async () =>
          makeFakeClient({ markets: [makeMarket("0xOil2", "Will WTI crude oil close above $95 on 2026-08-22 UTC?")], prices: { "0xOil2": [0.5, 0.5] } }),
      }),
      dataDir,
      telegramEnabled: false, tournamentMode: false, endgameHoldFromUtc: null,
      webSearch: {
        resetCycleBudget: () => {},
        briefing: async () => ({
          text: "- In 1999 analysts predicted a collapse (old.com)",
          sources: [],
          cached: false,
          budgetExhausted: false,
          source: "firecrawl",
        }),
      },
      fetchVolBaseline: noopVolBaseline,
      verificationEnabled: false,
      factCheck: noopFactCheck,
      probability: {
        estimator: (input: MarketEstimateInput) => {
          sawBriefing = input.webBriefing;
          return {
            marketAddress: input.marketAddress,
            question: input.question,
            outcomes: [
              { outcomeIdx: 0, probability: 0.5, reasoning: "" },
              { outcomeIdx: 1, probability: 0.5, reasoning: "" },
            ],
            provider: "injected",
            model: "test",
            estimatedAt: Date.now(),
          };
        },
      },
    });

    await runner.runCycle(1);
    expect(sawBriefing).toBeUndefined(); // nothing plausible survived
  });

  it("Tier 4: verifier agreement passes the entry through unchanged", async () => {
    process.env.DELPHI_ENABLED = "1";
    let verifyCalls = 0;
    const runner = new DelphiRunner({
      executor: new DelphiExecutor({
        apiKey: "k",
        retry: { maxRetries: 0 },
        clientFactory: async () =>
          makeFakeClient({ markets: [makeMarket("0xV1", "Q?")], prices: { "0xV1": [0.4, 0.6] } }),
      }),
      dataDir,
      telegramEnabled: false, tournamentMode: false, endgameHoldFromUtc: null,
      webSearch: noopWebSearch,
      fetchVolBaseline: noopVolBaseline,
      factCheck: noopFactCheck,
      verify: async () => {
        verifyCalls++;
        return { ran: true, verdict: "agree", verifierProbability: 0.53, crossFamily: true, provider: "openai", model: "gpt-4o-mini" };
      },
      probability: {
        minEdgeToTrade: 0.08,
        estimator: (input: MarketEstimateInput) => ({
          marketAddress: input.marketAddress,
          question: input.question,
          outcomes: [
            { outcomeIdx: 0, probability: 0.55, reasoning: "underpriced" },
            { outcomeIdx: 1, probability: 0.45, reasoning: "" },
          ],
          provider: "injected",
          model: "test",
          estimatedAt: Date.now(),
        }),
      },
    });

    const result = await runner.runCycle(1);
    expect(verifyCalls).toBe(1);
    expect(result.verificationsRun).toBe(1);
    expect(result.verificationBlocks).toBe(0);
    expect(result.tradesPlaced).toBe(1); // agree → original forecast stands

    // Position carries verified provenance + the UNCHANGED forecast.
    const positions = JSON.parse(readFileSync(join(dataDir, "positions.json"), "utf-8"));
    expect(positions["0xV1:0"].verified).toBe(true);
    expect(positions["0xV1:0"].verifierModel).toBe("gpt-4o-mini");
    expect(positions["0xV1:0"].forecast).toBeCloseTo(0.55, 9);
  });

  it("Tier 4: flagged overconfidence discounts the estimate and blocks a collapsed edge", async () => {
    // est 0.55 vs implied 0.40 → edge 0.15 clears the 0.08 gate. The
    // verifier says 0.42 (gap 0.13 < threshold 0.15 → NOT adjusted). To
    // exercise a BLOCK, use a larger gap: verifier 0.40.
    // adjusted = 0.5·0.55 + 0.5·0.40 = 0.475 → edge 0.075 < 0.08 → blocked.
    process.env.DELPHI_ENABLED = "1";
    const runner = new DelphiRunner({
      executor: new DelphiExecutor({
        apiKey: "k",
        retry: { maxRetries: 0 },
        clientFactory: async () =>
          makeFakeClient({ markets: [makeMarket("0xV2", "Q?")], prices: { "0xV2": [0.4, 0.6] } }),
      }),
      dataDir,
      telegramEnabled: false, tournamentMode: false, endgameHoldFromUtc: null,
      webSearch: noopWebSearch,
      fetchVolBaseline: noopVolBaseline,
      factCheck: noopFactCheck,
      verify: async () => ({
        ran: true,
        verdict: "overconfident",
        verifierProbability: 0.4, // gap 0.15 ≥ threshold → adjusted to 0.475
        crossFamily: true,
        provider: "openai",
        model: "gpt-4o-mini",
        reasoning: "base rates say this resolves no",
      }),
      probability: {
        minEdgeToTrade: 0.08,
        estimator: (input: MarketEstimateInput) => ({
          marketAddress: input.marketAddress,
          question: input.question,
          outcomes: [
            { outcomeIdx: 0, probability: 0.55, reasoning: "underpriced" },
            { outcomeIdx: 1, probability: 0.45, reasoning: "" },
          ],
          provider: "injected",
          model: "test",
          estimatedAt: Date.now(),
        }),
      },
    });

    const result = await runner.runCycle(1);
    expect(result.verificationsRun).toBe(1);
    expect(result.verificationBlocks).toBe(1);
    expect(result.tradesPlaced).toBe(0); // edge collapsed below the gate

    // The block is ledgared with the verifier's attack for the audit trail.
    const ledger = readFileSync(join(dataDir, "trades.jsonl"), "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    const blocked = ledger.find((r) => r.type === "verification-blocked");
    expect(blocked).toBeDefined();
    expect(blocked.adjustedProbability).toBeCloseTo(0.475, 9);
    expect(blocked.verdict).toBe("overconfident");
    expect(blocked.verifierReasoning).toBe("base rates say this resolves no");
    // No entry record exists.
    expect(ledger.some((r) => r.type === "entry")).toBe(false);
  });

  it("Tier 4: a non-ran verification never blocks the entry", async () => {
    process.env.DELPHI_ENABLED = "1";
    const runner = new DelphiRunner({
      executor: new DelphiExecutor({
        apiKey: "k",
        retry: { maxRetries: 0 },
        clientFactory: async () =>
          makeFakeClient({ markets: [makeMarket("0xV3", "Q?")], prices: { "0xV3": [0.4, 0.6] } }),
      }),
      dataDir,
      telegramEnabled: false, tournamentMode: false, endgameHoldFromUtc: null,
      webSearch: noopWebSearch,
      fetchVolBaseline: noopVolBaseline,
      factCheck: noopFactCheck,
      verify: async () => ({ ran: false }), // no LLM available — degrade, don't block
      probability: {
        minEdgeToTrade: 0.08,
        estimator: (input: MarketEstimateInput) => ({
          marketAddress: input.marketAddress,
          question: input.question,
          outcomes: [
            { outcomeIdx: 0, probability: 0.55, reasoning: "underpriced" },
            { outcomeIdx: 1, probability: 0.45, reasoning: "" },
          ],
          provider: "injected",
          model: "test",
          estimatedAt: Date.now(),
        }),
      },
    });

    const result = await runner.runCycle(1);
    expect(result.verificationsRun).toBe(1);
    expect(result.verificationBlocks).toBe(0);
    expect(result.tradesPlaced).toBe(1); // unverified ≠ blocked
    const positions = JSON.parse(readFileSync(join(dataDir, "positions.json"), "utf-8"));
    expect(positions["0xV3:0"].verified).toBe(false);
  });

  it("Tier 4 receives the estimate's evidence + provider for cross-family verification", async () => {
    process.env.DELPHI_ENABLED = "1";
    let received: VerificationInput | undefined;
    const runner = new DelphiRunner({
      executor: new DelphiExecutor({
        apiKey: "k",
        retry: { maxRetries: 0 },
        clientFactory: async () =>
          makeFakeClient({ markets: [makeMarket("0xV4", "Will it happen?")], prices: { "0xV4": [0.4, 0.6] } }),
      }),
      dataDir,
      telegramEnabled: false, tournamentMode: false, endgameHoldFromUtc: null,
      webSearch: {
        resetCycleBudget: () => {},
        briefing: async () => ({
          text: "- fresh evidence from today (news.com)",
          sources: [],
          cached: false,
          budgetExhausted: false,
          source: "firecrawl",
        }),
      },
      fetchVolBaseline: noopVolBaseline,
      factCheck: noopFactCheck,
      verify: async (input: VerificationInput) => {
        received = input;
        return { ran: true, verdict: "agree", verifierProbability: 0.5 };
      },
      probability: {
        minEdgeToTrade: 0.08,
        estimator: (input: MarketEstimateInput) => ({
          marketAddress: input.marketAddress,
          question: input.question,
          outcomes: [
            { outcomeIdx: 0, probability: 0.55, reasoning: "" },
            { outcomeIdx: 1, probability: 0.45, reasoning: "" },
          ],
          provider: "b-ai",
          model: "deepseek-v4-flash",
          estimatedAt: Date.now(),
        }),
      },
    });

    await runner.runCycle(1);
    expect(received).toBeDefined();
    expect(received!.question).toBe("Will it happen?");
    expect(received!.outcomeIdx).toBe(0);
    expect(received!.outcomeLabel).toBe("Yes");
    expect(received!.estimatedProbability).toBeCloseTo(0.55, 9);
    expect(received!.impliedProbability).toBeCloseTo(0.4, 9);
    expect(received!.webEvidenceText).toContain("fresh evidence");
    expect(received!.estimateProvider).toBe("b-ai"); // for cross-family exclusion
  });

  it("hold-to-settlement does not sell a position that would have converged or stopped", async () => {
    process.env.DELPHI_ENABLED = "1";
    writeFileSync(
      join(dataDir, "positions.json"),
      JSON.stringify({
        "0xHold:0": {
          id: "0xHold:0",
          marketAddress: "0xHold",
          outcomeIdx: 0,
          question: "Hold me",
          forecast: 0.5,
          impliedProbability: 0.4,
          edge: 0.1,
          shares: (10n ** 18n).toString(),
          tokensIn: (4n * 10n ** 5n).toString(),
          openedAt: 1000,
        },
      }),
    );
    let sells = 0;
    const base = makeFakeClient({
      markets: [{ id: "0xHold", question: "Hold me", category: "crypto", status: "open", resolvesAt: "2026-08-23T00:00:00Z" }],
      prices: { "0xHold": [0.55, 0.45] }, // would take-profit (0.55 >= 0.50 − 0.02)
    });
    const executor = new DelphiExecutor({
      apiKey: "k",
      retry: { maxRetries: 0 },
      clientFactory: async () => ({
        ...base,
        sellShares: async () => {
          sells++;
          return { transactionHash: "0xsell" };
        },
      }),
    });
    const runner = new DelphiRunner({
      executor,
      dataDir,
      telegramEnabled: false,
      tournamentMode: false,
      endgameHoldFromUtc: "2026-08-20T00:00:00Z",
      now: () => Date.parse("2026-08-21T00:00:00Z"),
      webSearch: noopWebSearch,
      fetchVolBaseline: noopVolBaseline,
      verificationEnabled: false,
      probability: {
        estimator: (input) => ({
          marketAddress: input.marketAddress,
          question: input.question,
          outcomes: [
            { outcomeIdx: 0, probability: 0.5, reasoning: "" },
            { outcomeIdx: 1, probability: 0.5, reasoning: "" },
          ],
          provider: "injected",
          model: "test",
          estimatedAt: Date.now(),
        }),
      },
    });
    const result = await runner.runCycle(1);
    expect(sells).toBe(0);
    expect(result.exitsHeld).toBeGreaterThanOrEqual(1);
    expect(result.exitsConvergence).toBe(0);
    expect(result.exitsStopped).toBe(0);
    const positions = JSON.parse(readFileSync(join(dataDir, "positions.json"), "utf-8"));
    expect(positions["0xHold:0"]).toBeDefined();
  });

  it("hold-to-settlement still drops a matured market so the redeem sweep can take it", async () => {
    process.env.DELPHI_ENABLED = "1";
    writeFileSync(
      join(dataDir, "positions.json"),
      JSON.stringify({
        "0xDead:0": {
          id: "0xDead:0",
          marketAddress: "0xDead",
          outcomeIdx: 0,
          question: "Settled",
          forecast: 0.8,
          impliedProbability: 0.4,
          edge: 0.4,
          shares: (10n ** 18n).toString(),
          tokensIn: (4n * 10n ** 5n).toString(),
          openedAt: 1000,
        },
      }),
    );
    let sells = 0;
    const base = makeFakeClient({
      markets: [{
        id: "0xDead",
        question: "Settled",
        category: "crypto",
        status: "open",
        resolvesAt: "2000-01-01T00:00:00Z",
      }],
      prices: { "0xDead": [0.9, 0.1] },
    });
    const executor = new DelphiExecutor({
      apiKey: "k",
      retry: { maxRetries: 0 },
      clientFactory: async () => ({
        ...base,
        sellShares: async () => {
          sells++;
          return { transactionHash: "0xsell" };
        },
      }),
    });
    const runner = new DelphiRunner({
      executor,
      dataDir,
      telegramEnabled: false,
      tournamentMode: false,
      endgameHoldFromUtc: "2026-08-20T00:00:00Z",
      now: () => Date.parse("2026-08-21T00:00:00Z"),
      webSearch: noopWebSearch,
      fetchVolBaseline: noopVolBaseline,
      verificationEnabled: false,
      probability: { estimator: () => null as never },
    });
    await runner.runCycle(1);
    expect(sells).toBe(0);
    const positions = JSON.parse(readFileSync(join(dataDir, "positions.json"), "utf-8"));
    expect(positions["0xDead:0"]).toBeUndefined();
  });

  it("tournament mode buys only the highest-multiple candidate", async () => {
    process.env.DELPHI_ENABLED = "1";
    const executor = new DelphiExecutor({
      apiKey: "k",
      retry: { maxRetries: 0 },
      clientFactory: async () =>
        makeFakeClient({
          markets: [
            makeMarket("0xCheap", "Cheap true"),
            makeMarket("0xRich", "Expensive true"),
          ],
          prices: { "0xCheap": [0.32, 0.68], "0xRich": [0.5, 0.5] },
        }),
    });
    const runner = new DelphiRunner({
      executor,
      dataDir,
      telegramEnabled: false,
      tournamentMode: true,
      endgameHoldFromUtc: null,
      webSearch: noopWebSearch,
      fetchVolBaseline: noopVolBaseline,
      verificationEnabled: false,
      probability: {
        minEdgeToTrade: 0.08,
        estimator: (input: MarketEstimateInput) => ({
          marketAddress: input.marketAddress,
          question: input.question,
          outcomes: input.marketAddress === "0xCheap"
            ? [
                { outcomeIdx: 0, probability: 0.85, reasoning: "uap-shaped" },
                { outcomeIdx: 1, probability: 0.15, reasoning: "" },
              ]
            : [
                { outcomeIdx: 0, probability: 0.7, reasoning: "edge but no multiple" },
                { outcomeIdx: 1, probability: 0.3, reasoning: "" },
              ],
          provider: "injected",
          model: "test",
          estimatedAt: Date.now(),
        }),
      },
    });
    const result = await runner.runCycle(1);
    expect(result.tradesPlaced).toBe(1);
    const ledger = readFileSync(join(dataDir, "trades.jsonl"), "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    const entries = ledger.filter((r: { type: string }) => r.type === "entry");
    expect(entries).toHaveLength(1);
    expect(entries[0].marketAddress).toBe("0xCheap");
  });

  it("tournament mode takes a Kelly-skip that is still +EV and 3×s the stake", async () => {
    process.env.DELPHI_ENABLED = "1";
    const executor = new DelphiExecutor({
      apiKey: "k",
      retry: { maxRetries: 0 },
      clientFactory: async () =>
        makeFakeClient({
          markets: [makeMarket("0xThin", "Thin but cheap")],
          prices: { "0xThin": [0.28, 0.72] },
        }),
    });
    const runner = new DelphiRunner({
      executor,
      dataDir,
      telegramEnabled: false,
      tournamentMode: true,
      endgameHoldFromUtc: null,
      webSearch: noopWebSearch,
      fetchVolBaseline: noopVolBaseline,
      verificationEnabled: false,
      probability: {
        minEdgeToTrade: 0.2,
        estimator: (input: MarketEstimateInput) => ({
          marketAddress: input.marketAddress,
          question: input.question,
          outcomes: [
            { outcomeIdx: 0, probability: 0.35, reasoning: "plus-ev but under Kelly" },
            { outcomeIdx: 1, probability: 0.65, reasoning: "" },
          ],
          provider: "injected",
          model: "test",
          estimatedAt: Date.now(),
        }),
      },
    });
    const result = await runner.runCycle(1);
    expect(result.tradesPlaced).toBe(1);
    const ledger = readFileSync(join(dataDir, "trades.jsonl"), "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    expect(ledger.filter((r: { type: string }) => r.type === "entry")).toHaveLength(1);
    expect(ledger.find((r: { type: string }) => r.type === "entry").marketAddress).toBe("0xThin");
  });

  it("tournament mode never buys WTI settle-below YES", async () => {
    process.env.DELPHI_ENABLED = "1";
    const q = "Will WTI front-month crude futures settle below $65.00 on Aug 21, 2026?";
    const executor = new DelphiExecutor({
      apiKey: "k",
      retry: { maxRetries: 0 },
      clientFactory: async () =>
        makeFakeClient({
          markets: [{ ...makeMarket("0xWti", q), outcomes: ["Yes", "No"] }],
          prices: { "0xWti": [0.08, 0.92] },
        }),
    });
    const runner = new DelphiRunner({
      executor,
      dataDir,
      telegramEnabled: false,
      tournamentMode: true,
      endgameHoldFromUtc: null,
      webSearch: noopWebSearch,
      fetchVolBaseline: noopVolBaseline,
      verificationEnabled: false,
      probability: {
        minEdgeToTrade: 0.2,
        estimator: (input: MarketEstimateInput) => ({
          marketAddress: input.marketAddress,
          question: input.question,
          outcomes: [
            { outcomeIdx: 0, probability: 0.15, reasoning: "lottery" },
            { outcomeIdx: 1, probability: 0.85, reasoning: "" },
          ],
          provider: "injected",
          model: "test",
          estimatedAt: Date.now(),
        }),
      },
    });
    const result = await runner.runCycle(1);
    expect(result.tradesPlaced).toBe(0);
  });

  it("rebuilds exposure after dropping a matured orphan so the ghost cannot shrink the budget", async () => {
    process.env.DELPHI_ENABLED = "1";
    writeFileSync(
      join(dataDir, "trades.jsonl"),
      JSON.stringify({
        type: "entry",
        marketAddress: "0xGhost",
        outcomeIdx: 0,
        question: "dead",
        tokensIn: "97000000",
        timestamp: Date.parse("2026-08-20T12:00:00Z"),
      }) + "\n",
    );
    const executor = new DelphiExecutor({
      apiKey: "k",
      retry: { maxRetries: 0 },
      clientFactory: async () =>
        makeFakeClient({
          markets: [makeMarket("0xCheap", "Cheap true")],
          extraMarkets: [{ ...makeMarket("0xGhost", "dead"), resolvesAt: "2026-08-20T00:30:00Z" }],
          prices: { "0xCheap": [0.28, 0.72] },
          balanceTokens: 450n * 10n ** 6n,
          chainPositions: [
            {
              marketProxy: "0xGhost",
              outcomeIdx: "0",
              shares: "1000000000000000000",
              marketStatus: "awaiting_settlement",
              redeemedOrLiquidated: false,
            },
          ],
        }),
    });
    const runner = new DelphiRunner({
      executor,
      dataDir,
      telegramEnabled: false,
      tournamentMode: true,
      endgameHoldFromUtc: "2026-08-20T00:00:00Z",
      now: () => Date.parse("2026-08-21T05:00:00Z"),
      webSearch: noopWebSearch,
      fetchVolBaseline: noopVolBaseline,
      verificationEnabled: false,
      probability: {
        minEdgeToTrade: 0.2,
        estimator: (input: MarketEstimateInput) => ({
          marketAddress: input.marketAddress,
          question: input.question,
          outcomes: [
            { outcomeIdx: 0, probability: 0.4, reasoning: "plus-ev" },
            { outcomeIdx: 1, probability: 0.6, reasoning: "" },
          ],
          provider: "injected",
          model: "test",
          estimatedAt: Date.now(),
        }),
      },
    });
    const result = await runner.runCycle(1);
    expect(result.tradesPlaced).toBe(1);
    const exposure = JSON.parse(readFileSync(join(dataDir, "exposure.json"), "utf-8"));
    expect(exposure["0xGhost"]).toBeUndefined();
    expect(BigInt(exposure["0xCheap"] ?? "0")).toBeGreaterThan(300n * 10n ** 6n);
  });

  it("skips a market that resolves after the redeem deadline before estimating", async () => {
    process.env.DELPHI_ENABLED = "1";
    let estimates = 0;
    const late = {
      ...makeMarket("0xLate", "After close"),
      resolvesAt: "2027-08-25T00:00:00Z", // after the test-file's pushed close
    };
    const executor = new DelphiExecutor({
      apiKey: "k",
      retry: { maxRetries: 0 },
      clientFactory: async () => makeFakeClient({ markets: [late], prices: { "0xLate": [0.3, 0.7] } }),
    });
    const runner = new DelphiRunner({
      executor,
      dataDir,
      telegramEnabled: false,
      tournamentMode: true,
      endgameHoldFromUtc: null,
      webSearch: noopWebSearch,
      fetchVolBaseline: noopVolBaseline,
      verificationEnabled: false,
      factCheck: async () => {
        throw new Error("fact-check must not run on a late market");
      },
      probability: {
        estimator: () => {
          estimates++;
          return null as never;
        },
      },
    });
    const result = await runner.runCycle(1);
    expect(result.marketsEvaluated).toBe(1);
    expect(result.estimatesProduced).toBe(0);
    expect(result.tradesPlaced).toBe(0);
    expect(estimates).toBe(0);
  });

  it("post-close cycle skips discovery", async () => {
    process.env.DELPHI_ENABLED = "1";
    let listed = 0;
    const base = makeFakeClient({ markets: [makeMarket("0xM", "Q")] });
    const executor = new DelphiExecutor({
      apiKey: "k",
      retry: { maxRetries: 0 },
      clientFactory: async () => ({
        ...base,
        listMarkets: async () => {
          listed++;
          return { markets: [makeMarket("0xM", "Q")] };
        },
      }),
    });
    const runner = new DelphiRunner({
      executor,
      dataDir,
      telegramEnabled: false,
      tournamentMode: false,
      endgameHoldFromUtc: null,
      now: () => Date.parse("2027-08-25T00:00:00Z"), // after the test-file's pushed close
      webSearch: noopWebSearch,
      fetchVolBaseline: noopVolBaseline,
      verificationEnabled: false,
    });
    const result = await runner.runCycle(1);
    expect(listed).toBe(0);
    expect(result.marketsEvaluated).toBe(0);
    expect(result.tradesPlaced).toBe(0);
  });
});
