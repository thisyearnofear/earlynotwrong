/**
 * Tests for DelphiExecutor
 *
 * Covers: simulator mode (no chain), health checks, live quoting + slippage
 * guard, trade-result accounting, and redeem routing — all against an
 * injected DelphiClientLike fake. The real @gensyn-ai/gensyn-delphi-sdk is
 * never imported here due to the dynamic import in getClient().
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  DelphiExecutor,
  withTimeout,
  type DelphiClientLike,
  type DelphiMarket,
  type DelphiPosition,
} from "../lib/delphi/executor.js";

// =============================================================================
// Fake client
// =============================================================================

function makeFakeClient(overrides: Partial<DelphiClientLike> = {}): DelphiClientLike {
  const market: DelphiMarket = {
    id: "0xMarket",
    appMarketId: "uuid-1",
    question: "Will BTC close above $150k on Aug 24?",
    category: "crypto",
    status: "open",
    marketUrl: "https://agent-competition.gensyn.ai/market/uuid-1",
  };
  return {
    health: async () => ({ status: "ok" }),
    listMarkets: async () => ({ markets: [market] }),
    getMarket: async () => market,
    quoteBuy: async ({ marketAddress, outcomeIdx, sharesOut }) => ({
      // Synthetic LMSR-ish quote: 0.42 TST per share. tokensIn is 6-dec TST,
      // sharesOut is 18-dec — same unit contract as the live gateway.
      tokensIn: (sharesOut * 42n) / 100n / 10n ** 12n,
    }),
    buyShares: async () => ({ transactionHash: "0xdeadbeef" }),
    redeemPositions: async ({ marketAddresses }) => ({
      results: marketAddresses.map((m, i) =>
        i === 0
          ? { marketAddress: m, success: true, tokensOut: 1_000_000n }
          : { marketAddress: m, success: false, error: "not settled" },
      ),
      totalTokensOut: 1_000_000n,
    }),
    getSigner: async () => ({ address: "0xWallet" }),
    getErc20Balance: async () => 1_000_000_000n, // 1,000 TST in 6-dec
    ensureTokenApproval: async () => ({ approvalNeeded: false, allowance: 0n }),
    listPositions: async () => ({ positions: [] }),
    liquidate: async () => ({ transactionHash: "0xliq" }),
    quoteSell: async ({ sharesIn }) => ({
      // Symmetric to the quoteBuy fake: 0.42 TST per share, 6-dec out.
      tokensOut: (sharesIn * 42n) / 100n / 10n ** 12n,
    }),
    sellShares: async () => ({ transactionHash: "0xsell" }),
    ...overrides,
  };
}

// =============================================================================
// Simulator mode
// =============================================================================

describe("DelphiExecutor — simulator mode", () => {
  it("is a simulator when no API key is configured", () => {
    const ex = new DelphiExecutor({ apiKey: "" });
    expect(ex.isSimulator).toBe(true);
    expect(ex.networkName).toBe("competition-testnet");
  });

  it("healthCheck reports unavailable with a remediation hint", async () => {
    const ex = new DelphiExecutor({ apiKey: "" });
    const health = await ex.healthCheck();
    expect(health.available).toBe(false);
    expect(health.mode).toBe("simulator");
    expect(health.help).toMatch(/DELPHI_API_ACCESS_KEY/);
  });

  it("listOpenMarkets returns empty in simulator mode", async () => {
    const ex = new DelphiExecutor({ apiKey: "" });
    expect(await ex.listOpenMarkets()).toEqual([]);
  });

  it("synthesizes quotes at the provided price", async () => {
    const ex = new DelphiExecutor({ apiKey: "" });
    const shares = 10n ** 18n; // 1 share
    const quote = await ex.quoteBuy("0xM", 0, shares, 0.42);
    expect(quote.pricePerShare).toBeCloseTo(0.42, 9);
    // 1 share × 0.42 TST in 6-dec token units.
    expect(BigInt(quote.tokensIn)).toBe(420_000n);
  });

  it("records simulated trades in the in-memory log without a chain call", async () => {
    const ex = new DelphiExecutor({ apiKey: "" });
    const result = await ex.buyShares({
      marketAddress: "0xM",
      outcomeIdx: 1,
      sharesOut: 10n ** 18n,
      estimatedProbability: 0.5,
      syntheticPrice: 0.42,
    });
    expect(result.success).toBe(true);
    expect(result.effectivePrice).toBeCloseTo(0.42, 9);
    expect(result.estimatedProbability).toBe(0.5);
    expect(ex.getTradeLog()).toHaveLength(1);
  });

  it("redeemPositions is a no-op in simulator mode", async () => {
    const ex = new DelphiExecutor({ apiKey: "" });
    const { redeemed, failed } = await ex.redeemPositions(["0xA"]);
    expect(redeemed).toEqual([]);
    expect(failed).toEqual([]);
  });
});

// =============================================================================
// Live mode (injected client)
// =============================================================================

describe("DelphiExecutor — live mode with injected client", () => {
  let capturedBuy: Parameters<DelphiClientLike["buyShares"]>[0] | null = null;
  let executor: DelphiExecutor;

  beforeEach(() => {
    capturedBuy = null;
    const fake = makeFakeClient({
      buyShares: async (params) => {
        capturedBuy = params;
        return { transactionHash: "0xdeadbeef" };
      },
    });
    executor = new DelphiExecutor({
      apiKey: "test-key",
      clientFactory: async () => fake,
    });
  });

  it("healthCheck reports available in live mode", async () => {
    const health = await executor.healthCheck();
    expect(health.available).toBe(true);
    expect(health.mode).toBe("live");
    expect(health.network).toBe("competition-testnet");
  });

  it("healthCheck reports unavailable when the client throws", async () => {
    const failing = new DelphiExecutor({
      apiKey: "test-key",
      clientFactory: async () =>
        makeFakeClient({
          health: async () => {
            throw new Error("boom");
          },
        }),
    });
    const health = await failing.healthCheck();
    expect(health.available).toBe(false);
    expect(health.help).toMatch(/Verify DELPHI_API_ACCESS_KEY/);
  });

  it("listOpenMarkets proxies the client with status=open", async () => {
    const markets = await executor.listOpenMarkets({ limit: 5 });
    expect(markets).toHaveLength(1);
    expect(markets[0].status).toBe("open");
    expect(markets[0].id).toBe("0xMarket");
  });

  it("listOpenMarkets maps SDK-style metadata into flat question/outcomes (live API regression)", async () => {
    // The real Delphi SDK nests question/outcomes under `metadata` — flat
    // top-level fields exist only in test fakes. Until 2026-08-14 the runner
    // read `market.question` (undefined on live markets) and silently
    // skipped every market, producing estimates=0 on the first live cycle.
    const ex = new DelphiExecutor({
      apiKey: "test-key",
      clientFactory: async () =>
        makeFakeClient({
          listMarkets: async () => ({
            markets: [
              {
                id: "0xSdkMarket",
                status: "open",
                category: "crypto",
                resolvesAt: "2026-08-16T00:00:00.000Z",
                metadata: {
                  question:
                    "Will Ethereum's daily close on 2026-08-16 UTC be $1,890 or higher?",
                  outcomes: ["Yes", "No"],
                },
              },
            ] as unknown as DelphiMarket[],
          }),
        }),
    });
    const markets = await ex.listOpenMarkets();
    expect(markets).toHaveLength(1);
    expect(markets[0].question).toBe(
      "Will Ethereum's daily close on 2026-08-16 UTC be $1,890 or higher?",
    );
    expect(markets[0].outcomes).toEqual(["Yes", "No"]);
    expect(markets[0].resolvesAt).toBe("2026-08-16T00:00:00.000Z");
    expect((markets[0] as { metadata?: unknown }).metadata).toBeUndefined();
  });

  it("listOpenMarkets keeps flat question/outcomes from test fakes unchanged", async () => {
    // mapSdkMarket must be source-agnostic: fake clients already supply flat
    // fields, and the mapping must not clobber them with metadata lookups.
    const markets = await executor.listOpenMarkets();
    expect(markets[0].question).toBe("Will BTC close above $150k on Aug 24?");
    expect(markets[0].id).toBe("0xMarket");
  });

  it("buyShares applies a slippage guard of maxTokensIn to the quote", async () => {
    const shares = 10n ** 18n; // 1 share
    const result = await executor.buyShares({
      marketAddress: "0xMarket",
      outcomeIdx: 0,
      sharesOut: shares,
      estimatedProbability: 0.5,
    });
    expect(result.success).toBe(true);
    expect(result.transactionHash).toBe("0xdeadbeef");
    expect(capturedBuy).not.toBeNull();
    // Fake quote is 0.42 TST per share => tokensIn (6-dec) = 1e18 × 0.42 / 1e12.
    const quotedTokens = (shares * 42n) / 100n / 10n ** 12n;
    const expectedMax = (quotedTokens * BigInt(10_000 + 300)) / 10_000n;
    expect(capturedBuy!.maxTokensIn).toBe(expectedMax);
    expect(capturedBuy!.sharesOut).toBe(shares);
  });

  it("ensures token approval before the buy and passes the slippage-adjusted amount", async () => {
    // Regression: the SDK's buyShares does not approve the gateway itself,
    // and a fresh wallet has zero allowance (production incident 2026-08-15:
    // first live buy reverted on the simulation for exactly this reason).
    let approved: { marketAddress: string; minimumAmount: bigint } | null = null;
    const ex = new DelphiExecutor({
      apiKey: "test-key",
      retry: { maxRetries: 0 },
      clientFactory: async () =>
        makeFakeClient({
          ensureTokenApproval: async (p) => {
            approved = p;
            return { approvalNeeded: true, allowance: p.minimumAmount };
          },
        }),
    });
    const result = await ex.buyShares({
      marketAddress: "0xMarket",
      outcomeIdx: 0,
      sharesOut: 10n ** 18n,
      estimatedProbability: 0.5,
    });
    expect(result.success).toBe(true);
    expect(approved).not.toBeNull();
    expect(approved!.marketAddress).toBe("0xMarket");
    // 1 share × 0.42 TST = 420_000 (6-dec), plus 300bps slippage.
    const quoted = (10n ** 18n * 42n) / 100n / 10n ** 12n;
    const expected = (quoted * 10_300n) / 10_000n;
    expect(approved!.minimumAmount).toBe(expected);
  });

  it("returns success=false and logs the trade when the chain call fails", async () => {
    const failing = new DelphiExecutor({
      apiKey: "test-key",
      retry: { maxRetries: 0 },
      clientFactory: async () =>
        makeFakeClient({
          buyShares: async () => {
            throw new Error("insufficient balance");
          },
        }),
    });
    const result = await failing.buyShares({
      marketAddress: "0xMarket",
      outcomeIdx: 0,
      sharesOut: 10n ** 18n,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/insufficient balance/);
    expect(failing.getTradeLog()).toHaveLength(1);
    expect(failing.getTradeLog()[0].success).toBe(false);
  });

  it("redeemPositions splits successes and failures per market", async () => {
    const executor2 = new DelphiExecutor({
      apiKey: "test-key",
      clientFactory: async () => makeFakeClient(),
    });
    const { redeemed, failed } = await executor2.redeemPositions(["0xM1", "0xM2"]);
    expect(redeemed).toEqual([{ marketAddress: "0xM1", tokensOut: "1000000" }]);
    expect(failed).toEqual([{ marketAddress: "0xM2", error: "not settled" }]);
  });

  it("redeemPositions short-circuits on empty input", async () => {
    const { redeemed, failed } = await executor.redeemPositions([]);
    expect(redeemed).toEqual([]);
    expect(failed).toEqual([]);
  });
});

// =============================================================================
// Position lifecycle (Phase 4)
// =============================================================================

describe("DelphiExecutor — position lifecycle", () => {
  const settled: DelphiPosition = { marketProxy: "0xS", outcomeIdx: "0", shares: "1000", marketStatus: "settled", redeemedOrLiquidated: false };
  const expired: DelphiPosition = { marketProxy: "0xX", outcomeIdx: "1", shares: "500", marketStatus: "expired", redeemedOrLiquidated: false };
  const open: DelphiPosition = { marketProxy: "0xO", outcomeIdx: "0", shares: "2000", marketStatus: "open", redeemedOrLiquidated: false };

  function lifecycleExecutor(positions: DelphiPosition[]): DelphiExecutor {
    return new DelphiExecutor({
      apiKey: "test-key",
      retry: { maxRetries: 0 },
      clientFactory: async () =>
        makeFakeClient({
          listPositions: async () => ({ positions }),
        }),
    });
  }

  it("getOpenPositions splits positions by market status", async () => {
    const ex = lifecycleExecutor([settled, expired, open]);
    const result = await ex.getOpenPositions();
    expect(result.settled.map((p) => p.marketProxy)).toEqual(["0xS"]);
    expect(result.liquidatable.map((p) => p.marketProxy)).toEqual(["0xX"]);
    expect(result.open.map((p) => p.marketProxy)).toEqual(["0xO"]);
  });

  it("treats 'failed' markets as liquidatable", async () => {
    const failed: DelphiPosition = { ...expired, marketProxy: "0xF", marketStatus: "failed" };
    const ex = lifecycleExecutor([failed]);
    const result = await ex.getOpenPositions();
    expect(result.liquidatable).toHaveLength(1);
    expect(result.settled).toHaveLength(0);
  });

  it("returns empty buckets in simulator mode", async () => {
    const ex = new DelphiExecutor({ apiKey: "" });
    expect(await ex.getOpenPositions()).toEqual({ open: [], settled: [], liquidatable: [] });
  });

  it("getWalletAddress resolves the signer address", async () => {
    const ex = lifecycleExecutor([]);
    expect(await ex.getWalletAddress()).toBe("0xWallet");
  });

  it("getTokenBalance returns the ERC-20 balance as a string", async () => {
    const ex = lifecycleExecutor([]);
    expect(await ex.getTokenBalance()).toBe("1000000000"); // 1,000 TST in 6-dec
  });

  it("liquidate is pass-through in live mode", async () => {
    const ex = lifecycleExecutor([]);
    const { transactionHash } = await ex.liquidate({ marketAddress: "0xX", outcomeIndices: [0, 1] });
    expect(transactionHash).toBe("0xliq");
  });
});

// =============================================================================
// Configuration
// =============================================================================

describe("DelphiExecutor — configuration", () => {
  it("respects an explicit network override", () => {
    const ex = new DelphiExecutor({ apiKey: "", network: "mainnet" });
    expect(ex.networkName).toBe("mainnet");
  });

  it("is live when an API key is provided without a client factory", () => {
    // No clientFactory: getClient() would import the SDK, but isSimulator
    // alone should reflect authenticity of configuration.
    const ex = new DelphiExecutor({ apiKey: "test-key" });
    expect(ex.isSimulator).toBe(false);
  });

  it("explicit simulator flag wins over an API key", () => {
    const ex = new DelphiExecutor({ apiKey: "test-key", simulator: true });
    expect(ex.isSimulator).toBe(true);
  });
});

// =============================================================================
// SDK call timeouts (production incident 2026-08-15: the SDK has no timeout
// of its own and a hung request froze the runner's loop for ~13.5h)
// =============================================================================

const never = <T,>(): Promise<T> => new Promise<T>(() => {}); // hangs forever

describe("withTimeout", () => {
  it("resolves when the promise wins", async () => {
    await expect(withTimeout(Promise.resolve(42), 50, "x")).resolves.toBe(42);
  });

  it("rejects with a labeled error when the deadline wins", async () => {
    await expect(withTimeout(never<number>(), 10, "delphi-test")).rejects.toThrow(
      "delphi-test timed out after 10ms",
    );
  });

  it("propagates the underlying rejection, not the timeout", async () => {
    const failing = Promise.reject(new Error("boom"));
    await expect(withTimeout(failing, 50, "x")).rejects.toThrow("boom");
  });
});

describe("DelphiExecutor — SDK call timeouts", () => {
  it("getTokenBalance rejects (instead of hanging forever) when the SDK hangs", async () => {
    const ex = new DelphiExecutor({
      apiKey: "test-key",
      sdkTimeoutMs: 10,
      clientFactory: async () =>
        makeFakeClient({
          getErc20Balance: () => never<bigint>() as Promise<bigint>,
        } as unknown as Partial<DelphiClientLike>),
    });
    await expect(ex.getTokenBalance()).rejects.toThrow("delphi-get-balance timed out after 10ms");
  });

  it("listOpenMarkets rejects when listMarkets hangs", async () => {
    const ex = new DelphiExecutor({
      apiKey: "test-key",
      sdkTimeoutMs: 10,
      retry: { maxRetries: 0 },
      clientFactory: async () =>
        makeFakeClient({
          listMarkets: () => never<{ markets: DelphiMarket[] }>(),
        } as unknown as Partial<DelphiClientLike>),
    });
    await expect(ex.listOpenMarkets()).rejects.toThrow("delphi-list-markets timed out after 10ms");
  });

  it("a hung health check surfaces as unavailable (never blocks the cycle)", async () => {
    const ex = new DelphiExecutor({
      apiKey: "test-key",
      sdkTimeoutMs: 10,
      clientFactory: async () =>
        makeFakeClient({
          health: () => never<{ status: string }>(),
        } as unknown as Partial<DelphiClientLike>),
    });
    const health = await ex.healthCheck();
    expect(health.available).toBe(false);
    // The specific timeout error lands in diagnostics; help is the static
    // remediation hint.
    expect(health.diagnostics.join(" ")).toMatch(/timed out/);
  });
});
