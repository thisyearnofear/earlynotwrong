/**
 * Tests for the Delphi alpha stack (Phase 5):
 *
 *   - vol-baseline.ts: normCdf, realized vol, threshold probability,
 *     question parsing (threshold/date/symbol), market matching
 *   - probability.ts additions: ensemble combine (median), vol-baseline
 *     blend, category-aware edge gate, convergence-exit policy
 *   - web-search.ts: source extraction, per-cycle budget, TTL cache
 *
 * Everything here is pure — no network, no gateway key.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
import { extractSourceUrls, DelphiWebSearch } from "../lib/delphi/web-search.js";

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
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.VERCEL_AI_GATEWAY_API_KEY;
    else process.env.VERCEL_AI_GATEWAY_API_KEY = savedKey;
  });

  it("returns null when no gateway key is configured", async () => {
    const saved = process.env.VERCEL_AI_GATEWAY_API_KEY;
    delete process.env.VERCEL_AI_GATEWAY_API_KEY;
    try {
      const noKey = new DelphiWebSearch();
      expect(await noKey.briefing("Q")).toBeNull();
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
});
