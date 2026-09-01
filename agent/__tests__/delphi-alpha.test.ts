/**
 * Tests for the Delphi alpha stack (Phase 5):
 *
 *   - vol-baseline.ts: normCdf, realized vol, threshold probability,
 *     question parsing (threshold/date/symbol), market matching
 *   - probability.ts additions: ensemble combine (median), vol-baseline
 *     blend, category-aware edge gate, convergence-exit policy
 *   - web-search.ts: source extraction, per-cycle budget, TTL cache
 *
 * Everything here is pure — no network, no gateway key. The ensemble path
 * of estimateProbability is exercised against a mocked llm-providers ladder
 * (vi.mock below), so no live inference calls are ever made.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the shared LLM ladder so the ensemble tests never touch the network.
// DelphiWebSearch's gateway search is injected separately (runSearch), so it
// does not need this mock. vi.hoisted so the factory (hoisted above imports)
// can reference the mock function.
const { mockChatCompletion } = vi.hoisted(() => ({
  mockChatCompletion: vi.fn(),
}));
vi.mock("../lib/llm-providers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/llm-providers.js")>();
  return { ...actual, chatCompletion: mockChatCompletion };
});

import {
  normCdf,
  estimateDailyVolFromCloses,
  cryptoThresholdProbability,
  parsePriceThreshold,
  parseDaysToExpiry,
  detectCryptoSymbol,
  matchCryptoThresholdMarket,
} from "../lib/delphi/vol-baseline.js";
import {
  combineEstimates,
  blendVolBaseline,
  minEdgeForCategory,
  evaluateConvergenceExit,
  estimateProbability,
  evaluateProbabilitySignal,
  type MarketEstimate,
  type MarketEstimateInput,
} from "../lib/delphi/probability.js";
import {
  extractSourceUrls,
  DelphiWebSearch,
  firecrawlResultsToBriefing,
  parallelResultsToBriefing,
  parseMcpTextResult,
  isQuotaExhaustionError,
} from "../lib/delphi/web-search.js";
import { providerCircuitOpen, tripProviderCircuit } from "../lib/llm-providers.js";

// =============================================================================
// vol-baseline: math
// =============================================================================

describe("normCdf", () => {
  it("matches known values of the standard normal CDF", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1)).toBeCloseTo(0.84134, 4);
    expect(normCdf(-1)).toBeCloseTo(0.15866, 4);
    expect(normCdf(2)).toBeCloseTo(0.97725, 4);
    expect(normCdf(-3)).toBeCloseTo(0.00135, 4);
  });

  it("is symmetric: Φ(z) + Φ(-z) = 1", () => {
    for (const z of [0.3, 1.1, 2.7]) {
      expect(normCdf(z) + normCdf(-z)).toBeCloseTo(1, 6);
    }
  });
});

describe("estimateDailyVolFromCloses", () => {
  it("returns null with fewer than 3 closes", () => {
    expect(estimateDailyVolFromCloses([100, 101])).toBeNull();
    expect(estimateDailyVolFromCloses([])).toBeNull();
  });

  it("estimates daily vol of a known log-return series", () => {
    // Construct closes whose daily log returns are all ±1% alternating.
    const closes: number[] = [100];
    for (let i = 0; i < 10; i++) {
      closes.push(closes[closes.length - 1] * (i % 2 === 0 ? 1.01 : 0.99));
    }
    const vol = estimateDailyVolFromCloses(closes);
    expect(vol).not.toBeNull();
    expect(vol!).toBeGreaterThan(0.009);
    expect(vol!).toBeLessThan(0.011);
  });

  it("ignores non-positive closes and clamps to [0.005, 0.3]", () => {
    const vol = estimateDailyVolFromCloses([100, -5, 102, 0, 104, 106]);
    expect(vol).not.toBeNull();
    // A wildly swinging series still clamps at the ceiling.
    const wild = estimateDailyVolFromCloses([1, 100, 1, 100, 1, 100]);
    expect(wild).toBeLessThanOrEqual(0.3);
  });
});

describe("cryptoThresholdProbability", () => {
  it("prices an at-the-money threshold near 0.5", () => {
    const p = cryptoThresholdProbability({
      spotPrice: 100,
      volDaily: 0.02,
      daysToExpiry: 7,
      threshold: 100,
    });
    expect(p).not.toBeNull();
    expect(p!).toBeCloseTo(0.5, 6);
  });

  it("prices a far OTM threshold low and a deep ITM threshold high", () => {
    const low = cryptoThresholdProbability({
      spotPrice: 100,
      volDaily: 0.02,
      daysToExpiry: 7,
      threshold: 200, // +100% in 7 days at 2% vol → z = ln(0.5)/(0.02·√7) ≈ -13
    });
    const high = cryptoThresholdProbability({
      spotPrice: 200,
      volDaily: 0.02,
      daysToExpiry: 7,
      threshold: 100,
    });
    expect(low!).toBeCloseTo(0.01, 6); // clamped floor
    expect(high!).toBeCloseTo(0.99, 6); // clamped ceiling
  });

  it("longer horizons pull probabilities toward 0.5", () => {
    const short = cryptoThresholdProbability({ spotPrice: 100, volDaily: 0.03, daysToExpiry: 1, threshold: 110 })!;
    const long = cryptoThresholdProbability({ spotPrice: 100, volDaily: 0.03, daysToExpiry: 30, threshold: 110 })!;
    expect(long).toBeGreaterThan(short);
  });

  it("returns null for degenerate inputs", () => {
    expect(cryptoThresholdProbability({ spotPrice: 0, volDaily: 0.02, daysToExpiry: 7, threshold: 100 })).toBeNull();
    expect(cryptoThresholdProbability({ spotPrice: 100, volDaily: 0, daysToExpiry: 7, threshold: 100 })).toBeNull();
    expect(cryptoThresholdProbability({ spotPrice: 100, volDaily: 0.02, daysToExpiry: 0, threshold: 100 })).toBeNull();
    expect(cryptoThresholdProbability({ spotPrice: 100, volDaily: 0.02, daysToExpiry: 7, threshold: -1 })).toBeNull();
  });
});

// =============================================================================
// vol-baseline: question parsing
// =============================================================================

describe("parsePriceThreshold", () => {
  it("parses plain dollar amounts with commas", () => {
    expect(parsePriceThreshold("Will BTC close above $150,000 on Aug 24?")).toBe(150_000);
    expect(parsePriceThreshold("Will ETH reach $10,500?")).toBe(10_500);
  });

  it("parses k/M suffixes", () => {
    expect(parsePriceThreshold("Will BTC close above $150k by Friday?")).toBe(150_000);
    expect(parsePriceThreshold("Will ETH reach $1.5M?")).toBe(1_500_000);
    expect(parsePriceThreshold("Will SOL flip $200?")).toBe(200);
  });

  it("parses bare numbers with a USD suffix", () => {
    expect(parsePriceThreshold("Will BTC close above 120000 USD?")).toBe(120_000);
  });

  it("returns null when there is no price level", () => {
    expect(parsePriceThreshold("Will the Fed cut rates in September?")).toBeNull();
    expect(parsePriceThreshold("Who wins the election?")).toBeNull();
  });
});

describe("parseDaysToExpiry", () => {
  // Fixed "now": 2026-08-14T00:00:00Z
  const now = Date.UTC(2026, 7, 14);

  it("parses 'on <Mon> <day>' and 'by <Mon> <day>'", () => {
    expect(parseDaysToExpiry("Will BTC close above $150k on Aug 24?", now)).toBeCloseTo(10, 5);
    expect(parseDaysToExpiry("Will BTC close above $150k by August 24, 2026?", now)).toBeCloseTo(10, 5);
  });

  it("parses ISO dates", () => {
    expect(parseDaysToExpiry("Will ETH reach $10k before 2026-09-01?", now)).toBeCloseTo(18, 5);
  });

  it("parses end-of-month phrasing", () => {
    expect(parseDaysToExpiry("Will BTC be above $200k by the end of August 2026?", now)).toBeCloseTo(17, 5);
  });

  it("returns null for dates in the past or missing dates", () => {
    expect(parseDaysToExpiry("Will BTC close above $150k on Aug 1?", now)).toBeNull();
    expect(parseDaysToExpiry("Will the Fed cut rates?", now)).toBeNull();
  });
});

describe("detectCryptoSymbol", () => {
  it("matches common crypto names case-insensitively", () => {
    expect(detectCryptoSymbol("Will Bitcoin close above $150k?")).toBe("BTC");
    expect(detectCryptoSymbol("Will ETH reach $10k?")).toBe("ETH");
    expect(detectCryptoSymbol("Will Solana flip $200?")).toBe("SOL");
    expect(detectCryptoSymbol("Will Dogecoin double?")).toBe("DOGE");
  });

  it("returns null for non-crypto questions", () => {
    expect(detectCryptoSymbol("Will the Fed cut rates?")).toBeNull();
  });
});

describe("matchCryptoThresholdMarket", () => {
  const now = Date.UTC(2026, 7, 14);

  it("matches a full crypto threshold question", () => {
    const m = matchCryptoThresholdMarket("Will BTC close above $150,000 on Aug 24?", "crypto", now);
    expect(m).not.toBeNull();
    expect(m!.symbol).toBe("BTC");
    expect(m!.threshold).toBe(150_000);
    expect(m!.daysToExpiry).toBeCloseTo(10, 5);
  });

  it("rejects non-crypto categories even with a price + date", () => {
    expect(matchCryptoThresholdMarket("Will BTC close above $150,000 on Aug 24?", "politics", now)).toBeNull();
  });

  it("rejects when any piece is missing", () => {
    expect(matchCryptoThresholdMarket("Will BTC close above $150,000?", "crypto", now)).toBeNull();
    expect(matchCryptoThresholdMarket("Will BTC moon on Aug 24?", "crypto", now)).toBeNull();
    expect(matchCryptoThresholdMarket("Will the Fed close above $150,000 on Aug 24?", "crypto", now)).toBeNull();
  });

  it("detects threshold direction — above, below, and ambiguous", () => {
    // "above" phrasing → blend P(above) directly onto the Yes outcome.
    expect(
      matchCryptoThresholdMarket("Will BTC close above $150,000 on Aug 24?", "crypto", now)!
        .direction,
    ).toBe("above");
    // "$1,890 or higher" is the other live phrasing seen in competition markets.
    expect(
      matchCryptoThresholdMarket(
        "Will Ethereum's daily close on 2026-08-16 UTC be $1,890 or higher?",
        "crypto",
        now,
      )!.direction,
    ).toBe("above");
    // "at or below" → the Yes outcome is the complement of P(above).
    expect(
      matchCryptoThresholdMarket("Will BTC close at or below $62,000 on Aug 17?", "crypto", now)!
        .direction,
    ).toBe("below");
    // Ambiguous wording → no baseline at all. No blend is better than a
    // flipped one.
    expect(
      matchCryptoThresholdMarket("Will BTC end at $150,000 on Aug 24?", "crypto", now),
    ).toBeNull();
  });
});

// =============================================================================
// probability: ensemble combine
// =============================================================================

function sample(p0: number, p1: number, question = "Q", marketAddress = "0xM"): MarketEstimate {
  return {
    marketAddress,
    question,
    outcomes: [
      { outcomeIdx: 0, probability: p0, reasoning: "s" },
      { outcomeIdx: 1, probability: p1, reasoning: "" },
    ],
    provider: "vercel-gateway",
    model: "zai/glm-5.2",
    estimatedAt: Date.now(),
  };
}

describe("combineEstimates — ensemble median", () => {
  it("returns the single estimate untouched", () => {
    const only = sample(0.6, 0.4);
    expect(combineEstimates([only])).toBe(only);
  });

  it("returns null for an empty list", () => {
    expect(combineEstimates([])).toBeNull();
  });

  it("takes the per-outcome median of three samples", () => {
    const combined = combineEstimates([sample(0.5, 0.5), sample(0.6, 0.4), sample(0.95, 0.05)]);
    expect(combined).not.toBeNull();
    expect(combined!.outcomes[0].probability).toBeCloseTo(0.6, 9); // median of [0.5, 0.6, 0.95]
    expect(combined!.outcomes[1].probability).toBeCloseTo(0.4, 9);
  });

  it("averages the middle two on even sample counts", () => {
    const combined = combineEstimates([sample(0.4, 0.6), sample(0.6, 0.4)]);
    expect(combined!.outcomes[0].probability).toBeCloseTo(0.5, 9);
  });

  it("resists a single overconfident outlier", () => {
    const sane = [sample(0.55, 0.45), sample(0.57, 0.43), sample(0.56, 0.44)];
    const outlier = sample(0.99, 0.01);
    const combined = combineEstimates([...sane, outlier]);
    // Median of [0.55, 0.56, 0.57, 0.99] = (0.56+0.57)/2 — the outlier has no pull.
    expect(combined!.outcomes[0].probability).toBeCloseTo(0.565, 9);
  });

  it("normalizes the combined outcome to sum 1", () => {
    const combined = combineEstimates([sample(0.6, 0.6), sample(0.4, 0.4), sample(0.5, 0.5)]);
    const sum = combined!.outcomes.reduce((a, o) => a + o.probability, 0);
    expect(sum).toBeCloseTo(1, 9);
  });
});

// =============================================================================
// probability: vol-baseline blend
// =============================================================================

describe("blendVolBaseline", () => {
  it("blends toward the quant reference by the configured weight", () => {
    const est = sample(0.7, 0.3);
    const blended = blendVolBaseline(est, 0.5, 0.4);
    // final₀ = 0.6·0.7 + 0.4·0.5 = 0.62
    expect(blended.outcomes[0].probability).toBeCloseTo(0.62, 9);
    expect(blended.outcomes[1].probability).toBeCloseTo(0.38, 9);
  });

  it("is a no-op with no reference or zero weight", () => {
    const est = sample(0.7, 0.3);
    expect(blendVolBaseline(est, undefined, 0.4)).toEqual(est);
    expect(blendVolBaseline(est, 0.5, 0)).toEqual(est);
  });

  it("appends an audit marker to the blended outcome's reasoning", () => {
    const blended = blendVolBaseline(sample(0.7, 0.3), 0.5, 0.35);
    expect(blended.outcomes[0].reasoning).toMatch(/vol-baseline anchor 0\.50/);
  });

  it("applies the blend through estimateProbability's injected path", async () => {
    const result = await estimateProbability(
      {
        marketAddress: "0xM",
        question: "Q",
        category: "crypto",
        impliedProbabilities: [0.5, 0.5],
        outcomes: ["Yes", "No"],
        volBaselineProbability: 0.5,
      },
      { estimator: () => sample(0.7, 0.3), volBaselineWeight: 0.4 },
    );
    expect(result!.outcomes[0].probability).toBeCloseTo(0.62, 9);
  });
});

// =============================================================================
// probability: category-aware edge gate
// =============================================================================

describe("minEdgeForCategory", () => {
  it("applies per-category gates from config", () => {
    expect(minEdgeForCategory("crypto")).toBe(0.08);
    expect(minEdgeForCategory("politics")).toBe(0.12);
    expect(minEdgeForCategory("culture")).toBe(0.14);
  });

  it("is case-insensitive and trims", () => {
    expect(minEdgeForCategory("Crypto ")).toBe(0.08);
  });

  it("falls back to the default gate for unknown/missing categories", () => {
    expect(minEdgeForCategory("quantum-mechanics")).toBe(0.12);
    expect(minEdgeForCategory(undefined)).toBe(0.12);
    expect(minEdgeForCategory("")).toBe(0.12);
  });
});

describe("evaluateProbabilitySignal — category gate", () => {
  it("uses the crypto gate when the estimate carries category=crypto", () => {
    const est: MarketEstimate = {
      ...sample(0.55, 0.45),
      category: "crypto",
    };
    // edge 0.15 clears the 0.08 crypto gate with 0.03 slippage.
    const signals = evaluateProbabilitySignal(est, [0.4, 0.6], { slippageBudget: 0.03 });
    expect(signals[0].decision).toBe("buy");
  });

  it("holds a 0.10 edge below the politics gate (0.12)", () => {
    const est: MarketEstimate = {
      ...sample(0.5, 0.5),
      category: "politics",
    };
    const signals = evaluateProbabilitySignal(est, [0.4, 0.6], { slippageBudget: 0 });
    expect(signals[0].decision).toBe("skip");
    expect(signals[0].reason).toMatch(/edge 0\.100 < minEdgeToTrade 0\.12/);
  });

  it("an explicit minEdgeToTrade overrides the category gate", () => {
    const est: MarketEstimate = { ...sample(0.5, 0.5), category: "culture" };
    const signals = evaluateProbabilitySignal(est, [0.4, 0.6], {
      minEdgeToTrade: 0.05,
      slippageBudget: 0,
    });
    expect(signals[0].decision).toBe("buy");
  });
});

// =============================================================================
// probability: convergence-exit policy
// =============================================================================

describe("evaluateConvergenceExit", () => {
  const base = { forecast: 0.6, entryPrice: 0.42, tolerance: 0.02, stopEdge: 0.1 };

  it("holds while price is inside the thesis band", () => {
    expect(evaluateConvergenceExit({ ...base, currentPrice: 0.5 }).action).toBe("hold");
    expect(evaluateConvergenceExit({ ...base, currentPrice: 0.55 }).action).toBe("hold");
  });

  it("sells on convergence when price reaches forecast − tolerance", () => {
    const exit = evaluateConvergenceExit({ ...base, currentPrice: 0.58 });
    expect(exit.action).toBe("sell-convergence");
    expect(exit.reason).toMatch(/converged/);
  });

  it("sells above convergence too (price overshooting the forecast)", () => {
    expect(evaluateConvergenceExit({ ...base, currentPrice: 0.9 }).action).toBe("sell-convergence");
  });

  it("stops when price falls stopEdge below entry", () => {
    const exit = evaluateConvergenceExit({ ...base, currentPrice: 0.3 });
    expect(exit.action).toBe("sell-stop");
    expect(exit.reason).toMatch(/stopped/);
  });

  it("holds on degenerate prices rather than acting on garbage", () => {
    expect(evaluateConvergenceExit({ ...base, currentPrice: 0 }).action).toBe("hold");
    expect(evaluateConvergenceExit({ ...base, currentPrice: 1 }).action).toBe("hold");
    expect(evaluateConvergenceExit({ ...base, currentPrice: -0.2 }).action).toBe("hold");
  });

  it("tolerance edge: exactly forecast − tolerance sells", () => {
    // currentPrice = 0.58 = forecast 0.6 − tolerance 0.02 → converged.
    expect(evaluateConvergenceExit({ ...base, currentPrice: 0.58 }).action).toBe("sell-convergence");
    // Just below the band → hold.
    expect(evaluateConvergenceExit({ ...base, currentPrice: 0.579 }).action).toBe("hold");
  });
});

// =============================================================================
// probability: web briefing context injection (prompt-level)
// =============================================================================

describe("estimateProbability — briefing + vol baseline on the injected path", () => {
  const inputWithBriefing: MarketEstimateInput = {
    marketAddress: "0xM",
    question: "Will BTC close above $150k on Aug 24?",
    category: "crypto",
    impliedProbabilities: [0.4, 0.6],
    outcomes: ["Yes", "No"],
    webBriefing: {
      text: "BTC trades at $142k. Futures open interest is elevated.",
      sources: ["https://example.com/btc"],
      cached: false,
      budgetExhausted: false,
    },
  };

  it("passes the briefing through to the estimator (the injected estimator can see it)", async () => {
    let sawBriefing = false;
    await estimateProbability(inputWithBriefing, {
      estimator: (input) => {
        sawBriefing = input.webBriefing?.text.includes("Futures open interest") === true;
        return sample(0.5, 0.5, input.question, input.marketAddress);
      },
    });
    expect(sawBriefing).toBe(true);
  });

  it("inherits category from the input when the estimator omits it", async () => {
    const result = await estimateProbability(inputWithBriefing, {
      estimator: () => sample(0.5, 0.5),
    });
    expect(result!.category).toBe("crypto");
  });
});

// =============================================================================
// web-search: source extraction, budget, cache
// =============================================================================

describe("extractSourceUrls", () => {
  it("extracts, dedupes, and caps URLs", () => {
    const text =
      "See https://a.com/1 and https://a.com/1. Also https://b.com/2, https://c.com/3, " +
      "https://d.com/4, https://e.com/5 and https://f.com/6.";
    const urls = extractSourceUrls(text);
    expect(urls).toHaveLength(5); // capped
    expect(urls[0]).toBe("https://a.com/1"); // trailing "." stripped, deduped
  });

  it("returns an empty array when no URLs are present", () => {
    expect(extractSourceUrls("no links here")).toEqual([]);
  });
});

describe("DelphiWebSearch — budget + cache", () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.VERCEL_AI_GATEWAY_API_KEY;
    process.env.VERCEL_AI_GATEWAY_API_KEY = "test-key";
    // The gateway breaker lives on globalThis — reset it so a tripped breaker
    // from another test (or the trip in this block) can't leak across tests.
    delete (globalThis as Record<string, unknown>)["__llmProviderBreakerOpenUntil"];
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.VERCEL_AI_GATEWAY_API_KEY;
    else process.env.VERCEL_AI_GATEWAY_API_KEY = savedKey;
    delete (globalThis as Record<string, unknown>)["__llmProviderBreakerOpenUntil"];
  });

  it("still serves briefings with NO keys at all (firecrawl/parallel rungs are keyless)", async () => {
    // Contract change 2026-08-18: briefings no longer depend on the gateway
    // key. Only the Exa rung needs it — the two search APIs above are
    // keyless, which is why they exist in the ladder.
    const saved = process.env.VERCEL_AI_GATEWAY_API_KEY;
    delete process.env.VERCEL_AI_GATEWAY_API_KEY;
    try {
      let exaCalls = 0;
      const ws = new DelphiWebSearch({
        runFirecrawlSearch: async () => ({
          text: "keyless brief", sources: [], cached: false, budgetExhausted: false, source: "firecrawl",
        }),
        runParallelSearch: async () => null,
        runGatewaySearch: async () => { exaCalls++; return { text: "exa", sources: [], cached: false, budgetExhausted: false, source: "exa" }; },
      });
      const briefing = await ws.briefing("Q");
      expect(briefing?.text).toBe("keyless brief");
      expect(exaCalls).toBe(0); // the Exa rung is ineligible without the key
    } finally {
      if (saved === undefined) delete process.env.VERCEL_AI_GATEWAY_API_KEY;
      else process.env.VERCEL_AI_GATEWAY_API_KEY = saved;
    }
  });

  it("calls the injected search runner once and serves repeats from cache", async () => {
    let calls = 0;
    const ws = new DelphiWebSearch({
      apiKey: "k",
      cacheTtlMs: 60_000,
      runSearch: async () => {
        calls++;
        return { text: "brief", sources: [], cached: false, budgetExhausted: false };
      },
    });
    const first = await ws.briefing("Will BTC close above $150k?");
    const second = await ws.briefing("will btc close above $150k?"); // case-insensitive key
    expect(first!.text).toBe("brief");
    expect(first!.cached).toBe(false);
    expect(second!.cached).toBe(true);
    expect(calls).toBe(1);
  });

  it("enforces the per-cycle budget for fresh searches", async () => {
    let calls = 0;
    const ws = new DelphiWebSearch({
      apiKey: "k",
      maxCallsPerCycle: 2,
      cacheTtlMs: 60_000,
      runSearch: async (q) => {
        calls++;
        return { text: q, sources: [], cached: false, budgetExhausted: false };
      },
    });
    expect(await ws.briefing("Q1")).not.toBeNull();
    expect(await ws.briefing("Q2")).not.toBeNull();
    expect(await ws.briefing("Q3")).toBeNull(); // budget exhausted
    expect(calls).toBe(2);

    // Reset the budget → fresh searches work again.
    ws.resetCycleBudget();
    expect(await ws.briefing("Q3")).not.toBeNull();
    expect(calls).toBe(3);
  });

  it("returns null when the search runner throws (never propagates)", async () => {
    const ws = new DelphiWebSearch({
      apiKey: "k",
      runSearch: async () => {
        throw new Error("gateway down");
      },
    });
    expect(await ws.briefing("Q")).toBeNull();
    expect(ws.cycleCalls).toBe(1); // the attempt still consumed budget
  });

  it("expired cache entries re-fetch", async () => {
    let calls = 0;
    const ws = new DelphiWebSearch({
      apiKey: "k",
      cacheTtlMs: -1, // everything is immediately expired
      runSearch: async () => {
        calls++;
        return { text: "brief", sources: [], cached: false, budgetExhausted: false };
      },
    });
    await ws.briefing("Q");
    await ws.briefing("Q");
    expect(calls).toBe(2);
  });

  it("a credit-exhaustion failure trips the rung's breaker and skips later searches", async () => {
    // Production incident 2026-08-18: the Vercel gateway's promo credit ran
    // dry mid-promo. The briefing budget kept burning 10 calls/cycle on
    // doomed searches (~150/day). Any rung's quota/credit death must trip
    // its breaker so the cost is one discovery call, not one per market.
    const ws = new DelphiWebSearch({
      runFirecrawlSearch: async () => {
        throw new Error(
          "A positive credit balance is required for all requests, including BYOK",
        );
      },
      // Stub the downstream rungs so the cascade never touches the network.
      runParallelSearch: async () => null,
      runGatewaySearch: async () => null,
    });
    expect(providerCircuitOpen("firecrawl")).toBe(false);
    expect(await ws.briefing("Q1")).toBeNull(); // firecrawl dies → cascade finds nothing else
    expect(providerCircuitOpen("firecrawl")).toBe(true);
    // Q1 burned 2 calls: firecrawl (throws) + parallel (null). The Exa/gateway
    // rung is gated off by VERCEL_GATEWAY_PROMO_ENDS (the 2026-08-28 cutoff
    // has passed; `vercelGatewayFreeActive()` returns false, so the rung is
    // skipped before the counter increments — see web-search.ts briefing()).
    expect(ws.cycleCalls).toBe(2);
    // Subsequent fresh searches skip the dead rung entirely — Q2 costs only
    // the one healthy rung (parallel), not the broken firecrawl.
    expect(await ws.briefing("Q2")).toBeNull();
    expect(ws.cycleCalls).toBe(3);
  });

  it("falls through the ladder when the first rung fails", async () => {
    // Redundancy: a dead Firecrawl tier must hand off to Parallel, then the
    // gateway Exa rung — the same cascade principle as the LLM ladder.
    let parallelCalls = 0;
    const ws = new DelphiWebSearch({
      apiKey: "k",
      runFirecrawlSearch: async () => {
        throw new Error("Firecrawl search error: 429");
      },
      runParallelSearch: async () => {
        parallelCalls++;
        return { text: "parallel brief", sources: ["https://p.test/1"], cached: false, budgetExhausted: false, source: "parallel" };
      },
      // Tier 3 corroboration queries the next rung (gateway) after the
      // primary answers — stub it so the test never touches the network.
      runGatewaySearch: async () => null,
    });
    const briefing = await ws.briefing("Q");
    expect(briefing?.text).toBe("parallel brief");
    expect(briefing?.source).toBe("parallel");
    expect(parallelCalls).toBe(1);
    // 2 calls: firecrawl (throws) + parallel (succeeded). The cross-check rung
    // is the Exa/gateway tier, which is gated off past the 2026-08-28 promo
    // cutoff — it's skipped before the counter increments, so no third call.
    expect(ws.cycleCalls).toBe(2);
    // The cross-check rung was skipped (not attempted) → corroborated stays
    // undefined (unattempted), never false.
    expect(briefing?.corroborated).toBeUndefined();
  });

  it("falls through a null rung (no relevant results) without tripping a breaker", async () => {
    const ws = new DelphiWebSearch({
      apiKey: "k",
      runFirecrawlSearch: async () => null, // answered, but nothing relevant
      runParallelSearch: async () => ({
        text: "parallel brief", sources: [], cached: false, budgetExhausted: false, source: "parallel",
      }),
      // Tier 3 corroboration reaches the gateway rung next — stub it.
      runGatewaySearch: async () => null,
    });
    const briefing = await ws.briefing("Q");
    expect(briefing?.source).toBe("parallel");
    expect(providerCircuitOpen("firecrawl")).toBe(false); // null ≠ unhealthy
  });

  it("serves cached briefings while the breaker is open (cache costs nothing)", async () => {
    let calls = 0;
    const ws = new DelphiWebSearch({
      cacheTtlMs: 60_000,
      runFirecrawlSearch: async () => {
        calls++;
        return { text: "cached brief", sources: [], cached: false, budgetExhausted: false, source: "firecrawl" };
      },
      // Tier 3 corroboration reaches the parallel rung after the primary —
      // stub it so the test never touches the network.
      runParallelSearch: async () => null,
      runGatewaySearch: async () => null,
    });
    // Prime the cache BEFORE the breaker opens.
    await ws.briefing("Q");
    expect(calls).toBe(1);

    tripProviderCircuit("firecrawl");
    const hit = await ws.briefing("Q");
    expect(hit?.text).toBe("cached brief");
    expect(hit?.cached).toBe(true);
    expect(calls).toBe(1); // cache hit — no network call while the breaker is open
  });

  it("skips fresh searches when every rung's breaker is open (miss → null, no budget spent)", async () => {
    tripProviderCircuit("firecrawl");
    tripProviderCircuit("parallel");
    tripProviderCircuit("vercel-gateway");
    let calls = 0;
    const ws = new DelphiWebSearch({
      apiKey: "k",
      runFirecrawlSearch: async () => { calls++; return { text: "x", sources: [], cached: false, budgetExhausted: false, source: "firecrawl" }; },
      runParallelSearch: async () => { calls++; return { text: "y", sources: [], cached: false, budgetExhausted: false, source: "parallel" }; },
      runGatewaySearch: async () => { calls++; return { text: "z", sources: [], cached: false, budgetExhausted: false, source: "exa" }; },
    });
    expect(await ws.briefing("never-cached")).toBeNull();
    expect(calls).toBe(0);
    expect(ws.cycleCalls).toBe(0);
  });

  it("the legacy runSearch injection replaces the whole ladder (single rung)", async () => {
    // Older tests/configs inject one runner — it must stay first-class.
    let calls = 0;
    const ws = new DelphiWebSearch({
      runSearch: async () => {
        calls++;
        return { text: "legacy brief", sources: [], cached: false, budgetExhausted: false };
      },
    });
    const briefing = await ws.briefing("Q");
    expect(briefing?.text).toBe("legacy brief");
    expect(calls).toBe(1);
  });
});

describe("web-search composition helpers (pure)", () => {
  it("firecrawlResultsToBriefing merges web + news with cited URLs", () => {
    const out = firecrawlResultsToBriefing(
      [
        { url: "https://a.test/1", title: "A", description: "Dolphin is very strong per JMA." },
        { url: "https://a.test/2", title: "B", description: "" }, // empty passage dropped
        { url: "https://a.test/3", title: "C", description: "Warnings issued for Kyushu." },
      ],
      [{ url: "https://news.test/1", title: "N", snippet: "Typhoon approaching." }],
    );
    expect(out?.text).toContain("Dolphin is very strong per JMA.");
    expect(out?.text).toContain("(https://a.test/1)");
    expect(out?.text).toContain("[news] Typhoon approaching.");
    expect(out?.text).not.toContain("a.test/2");
    expect(out?.sources).toEqual(["https://a.test/1", "https://a.test/3", "https://news.test/1"]);
  });

  it("firecrawlResultsToBriefing returns null when nothing has a passage", () => {
    expect(firecrawlResultsToBriefing([{ url: "u", description: "" }], [])).toBeNull();
    expect(firecrawlResultsToBriefing([], [])).toBeNull();
  });

  it("parallelResultsToBriefing joins excerpts and cites URLs", () => {
    const out = parallelResultsToBriefing([
      { url: "https://p.test/1", title: "P", excerpts: ["Excerpt one.", "Excerpt two."] },
      { url: "https://p.test/2", title: "Q", excerpts: [] }, // no excerpts dropped
    ]);
    expect(out?.text).toContain("Excerpt one. Excerpt two.");
    expect(out?.text).toContain("(https://p.test/1)");
    expect(out?.sources).toEqual(["https://p.test/1"]);
  });

  it("parseMcpTextResult handles plain JSON and SSE-framed bodies", () => {
    const json = JSON.stringify({ result: { content: [{ type: "text", text: "{\"results\":[]}" }] } });
    expect(parseMcpTextResult(json)).toBe("{\"results\":[]}");
    const sse = `event: message\ndata: ${json}\n\n`;
    expect(parseMcpTextResult(sse)).toBe("{\"results\":[]}");
  });

  it("parseMcpTextResult surfaces MCP errors and tolerates junk", () => {
    expect(() =>
      parseMcpTextResult(JSON.stringify({ error: { message: "rate limited" } })),
    ).toThrow(/rate limited/);
    expect(parseMcpTextResult("")).toBeNull();
    expect(parseMcpTextResult("<html>not json</html>")).toBeNull();
  });

  it("isQuotaExhaustionError matches credit/quota language, not plain faults", () => {
    expect(isQuotaExhaustionError(new Error("A positive credit balance is required"))).toBe(true);
    expect(isQuotaExhaustionError(new Error("insufficient credits for this request"))).toBe(true);
    expect(isQuotaExhaustionError(new Error("Firecrawl search error: 402"))).toBe(true);
    expect(isQuotaExhaustionError(new Error("Firecrawl search error: 429"))).toBe(false);
    expect(isQuotaExhaustionError(new Error("The operation was aborted due to timeout"))).toBe(false);
  });
});

// =============================================================================
// probability: ensemble + provenance (mocked LLM ladder)
// =============================================================================

describe("estimateProbability — ensemble + provenance (mocked ladder)", () => {
  const ensembleInput: MarketEstimateInput = {
    marketAddress: "0xM",
    question: "Will BTC close above $150k on Aug 24?",
    category: "crypto",
    impliedProbabilities: [0.4, 0.6],
    outcomes: ["Yes", "No"],
  };

  /** A mocked chatCompletion reply with the given Yes probability. */
  const llmReply = (yesProb: number) => ({
    provider: "vercel-gateway" as const,
    model: "zai/glm-5.2",
    content: JSON.stringify({
      outcomes: [
        { outcomeIdx: 0, probability: yesProb, reasoning: "s" },
        { outcomeIdx: 1, probability: 1 - yesProb, reasoning: "" },
      ],
    }),
  });

  beforeEach(() => {
    mockChatCompletion.mockReset();
  });

  it("combines 3 samples by median and records full provenance", async () => {
    mockChatCompletion
      .mockResolvedValueOnce(llmReply(0.5))
      .mockResolvedValueOnce(llmReply(0.6))
      .mockResolvedValueOnce(llmReply(0.95));

    const result = await estimateProbability(
      { ...ensembleInput, volBaselineProbability: 0.55 },
      { ensembleSamples: 3, volBaselineWeight: 0.4 },
    );
    expect(result).not.toBeNull();
    expect(mockChatCompletion).toHaveBeenCalledTimes(3);
    // median(0.5, 0.6, 0.95) = 0.6 → blend 0.6·0.6 + 0.4·0.55 = 0.58
    expect(result!.outcomes[0].probability).toBeCloseTo(0.58, 9);

    const prov = result!.provenance!;
    expect(prov.provider).toBe("vercel-gateway");
    expect(prov.model).toBe("zai/glm-5.2 ×3 median");
    expect(prov.samples).toBe(3);
    expect(prov.webEvidence).toBe(false);
    expect(prov.volAnchor).toBeCloseTo(0.55, 9);
  });

  it("records webEvidence when a briefing was injected", async () => {
    mockChatCompletion.mockResolvedValue(llmReply(0.3));
    const result = await estimateProbability(
      {
        ...ensembleInput,
        webBriefing: { text: "brief", sources: [], cached: false, budgetExhausted: false, source: "firecrawl" },
      },
      { ensembleSamples: 1, volBaselineWeight: 0 },
    );
    expect(result!.provenance!.webEvidence).toBe(true);
    expect(result!.provenance!.webSource).toBe("firecrawl");
    expect(result!.provenance!.volAnchor).toBeUndefined();
    // Single sample → no ensemble suffix, samples field omitted.
    expect(result!.provenance!.samples).toBeUndefined();
    expect(result!.provenance!.model).toBe("zai/glm-5.2");
  });

  it("ships a degraded ensemble (with a sample missing) instead of failing", async () => {
    mockChatCompletion
      .mockResolvedValueOnce(llmReply(0.5))
      .mockResolvedValueOnce(llmReply(0.6))
      .mockRejectedValueOnce(new Error("gateway 429"));

    const result = await estimateProbability(ensembleInput, { ensembleSamples: 3 });
    expect(result).not.toBeNull();
    // median(0.5, 0.6) = 0.55 from the 2 surviving samples.
    expect(result!.outcomes[0].probability).toBeCloseTo(0.55, 9);
    expect(result!.provenance!.samples).toBe(2);
    expect(result!.provenance!.model).toBe("zai/glm-5.2 ×2 median");
  });

  it("returns null when every sample fails", async () => {
    mockChatCompletion.mockRejectedValue(new Error("down"));
    expect(await estimateProbability(ensembleInput, { ensembleSamples: 3 })).toBeNull();
  });

  it("records provenance on the injected-estimator path too", async () => {
    const result = await estimateProbability(
      { ...ensembleInput, volBaselineProbability: 0.5 },
      { estimator: () => sample(0.7, 0.3), volBaselineWeight: 0.4 },
    );
    // The sample() fixture carries provider "vercel-gateway" — the injected
    // path passes it through untouched.
    expect(result!.provenance!.provider).toBe("vercel-gateway");
    expect(result!.provenance!.volAnchor).toBeCloseTo(0.5, 9);
    // blend: 0.6·0.7 + 0.4·0.5 = 0.62
    expect(result!.outcomes[0].probability).toBeCloseTo(0.62, 9);
  });
});
