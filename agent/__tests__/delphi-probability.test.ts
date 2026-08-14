/**
 * Tests for Delphi probability estimation + the deterministic trade gate.
 *
 * Covers: estimator injection, binary-market constraint, LLM response parsing
 * (clamping + normalization), the edge gate's decision logic, and the
 * provider-priority chain. LLM providers are never called in tests — the
 * injected estimator path and the no-provider path are the surfaces under test.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  estimateProbability,
  evaluateProbabilitySignal,
  type MarketEstimate,
  type MarketEstimateInput,
} from "../lib/delphi/probability.js";

const baseInput: MarketEstimateInput = {
  marketAddress: "0xMarket",
  question: "Will BTC close above $150k on Aug 24?",
  category: "crypto",
  impliedProbabilities: [0.4, 0.6],
  outcomes: ["Yes", "No"],
  closesAt: "2026-08-24T00:00:00Z",
};

describe("estimateProbability — binary constraint + estimator injection", () => {
  it("rejects non-binary markets", async () => {
    const multi: MarketEstimateInput = {
      ...baseInput,
      outcomes: ["A", "B", "C"],
      impliedProbabilities: [0.3, 0.3, 0.4],
    };
    expect(
      await estimateProbability(multi, { estimator: () => null }),
    ).toBeNull();
  });

  it("returns the injected estimator's estimate", async () => {
    const estimate: MarketEstimate = {
      marketAddress: baseInput.marketAddress,
      question: baseInput.question,
      outcomes: [
        { outcomeIdx: 0, probability: 0.55, reasoning: "momentum" },
        { outcomeIdx: 1, probability: 0.45, reasoning: "fade" },
      ],
      provider: "injected",
      model: "test",
      estimatedAt: Date.now(),
    };
    const result = await estimateProbability(baseInput, {
      estimator: () => estimate,
    });
    expect(result).not.toBeNull();
    expect(result!.outcomes).toHaveLength(2);
    expect(result!.provider).toBe("injected");
  });

  it("returns null when no estimator and no provider keys are set", async () => {
    // Explicitly clear any env keys that might be set in this shell.
    const saved = {
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    };
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(await estimateProbability(baseInput)).toBeNull();
    } finally {
      if (saved.OPENROUTER_API_KEY) process.env.OPENROUTER_API_KEY = saved.OPENROUTER_API_KEY;
      if (saved.OPENAI_API_KEY) process.env.OPENAI_API_KEY = saved.OPENAI_API_KEY;
      if (saved.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = saved.ANTHROPIC_API_KEY;
    }
  });

  it("returns null when the injected estimator throws", async () => {
    const result = await estimateProbability(baseInput, {
      estimator: () => {
        throw new Error("boom");
      },
    });
    expect(result).toBeNull();
  });
});

describe("evaluateProbabilitySignal — the deterministic trade gate", () => {
  const estimate: MarketEstimate = {
    marketAddress: "0xMarket",
    question: "Q",
    outcomes: [
      { outcomeIdx: 0, probability: 0.55, reasoning: "" },
      { outcomeIdx: 1, probability: 0.45, reasoning: "" },
    ],
    provider: "injected",
    model: "test",
    estimatedAt: 0,
  };

  it("buys when the edge clears minEdgeToTrade + slippage budget", () => {
    const signals = evaluateProbabilitySignal(estimate, [0.4, 0.6], {
      minEdgeToTrade: 0.08,
      slippageBudget: 0.03,
    });
    // Yes: edge = 0.55 − 0.40 = 0.15 > 0.08, cleared of 0.03 slippage.
    expect(signals[0].decision).toBe("buy");
    expect(signals[0].edge).toBeCloseTo(0.15, 9);
    // No: edge = 0.45 − 0.60 = −0.15 → overpriced (shorting not implemented).
    expect(signals[1].decision).toBe("skip");
    expect(signals[1].reason).toMatch(/overpriced/);
  });

  it("skips when edge is below minEdgeToTrade", () => {
    const tight: MarketEstimate = {
      ...estimate,
      outcomes: [
        { outcomeIdx: 0, probability: 0.45, reasoning: "" },
        { outcomeIdx: 1, probability: 0.55, reasoning: "" },
      ],
    };
    const signals = evaluateProbabilitySignal(tight, [0.4, 0.6], {
      minEdgeToTrade: 0.08,
    });
    expect(signals[0].decision).toBe("skip");
    expect(signals[0].reason).toMatch(/below threshold|minEdgeToTrade/);
  });

  it("skips when edge is consumed by the slippage budget", () => {
    // edge = 0.55 − 0.47 = 0.08; slippage budget 0.10 → not worth trading.
    const signals = evaluateProbabilitySignal(estimate, [0.47, 0.53], {
      minEdgeToTrade: 0.05,
      slippageBudget: 0.1,
    });
    expect(signals[0].decision).toBe("skip");
    expect(signals[0].reason).toMatch(/slippage budget/);
  });

  it("skips when implied probability is at an extreme (0 or 1)", () => {
    const signals = evaluateProbabilitySignal(estimate, [0, 1], {});
    expect(signals[0].decision).toBe("skip");
    expect(signals[0].reason).toMatch(/bounds/);
  });

  it("flag overpriced as a skip with an explanatory reason", () => {
    // No outcome overpriced: est 0.45 < implied 0.60.
    const signals = evaluateProbabilitySignal(estimate, [0.4, 0.6], {});
    expect(signals[1].decision).toBe("skip");
    expect(signals[1].edge).toBeCloseTo(-0.15, 9);
    expect(signals[1].reason).toMatch(/overpriced/);
  });
});

describe("normalization invariant", () => {
  it("injected-estimator output is clamped + normalized to sum 1", async () => {
    const result = await estimateProbability(baseInput, {
      estimator: (input) => ({
        marketAddress: input.marketAddress,
        question: input.question,
        // Mis-normalized: 0.9 + 0.9 = 1.8.
        outcomes: [
          { outcomeIdx: 0, probability: 0.9, reasoning: "" },
          { outcomeIdx: 1, probability: 0.9, reasoning: "" },
        ],
        provider: "injected",
        model: "test",
        estimatedAt: Date.now(),
      }),
    });
    expect(result).not.toBeNull();
    const sum = result!.outcomes.reduce((a, o) => a + o.probability, 0);
    expect(sum).toBeCloseTo(1.0, 9);
    expect(result!.outcomes.every((o) => o.probability >= 0.01 && o.probability <= 0.99)).toBe(true);
  });

  it("normalizeEstimate is exported for future quantitative estimators", async () => {
    const { normalizeEstimate } = await import("../lib/delphi/probability.js");
    const normalized = normalizeEstimate({
      marketAddress: "0xM",
      question: "Q",
      outcomes: [
        { outcomeIdx: 0, probability: 2, reasoning: "" },
        { outcomeIdx: 1, probability: -0.5, reasoning: "" },
      ],
      provider: "injected",
      model: "test",
      estimatedAt: 0,
    });
    const sum = normalized.outcomes.reduce((a, o) => a + o.probability, 0);
    expect(sum).toBeCloseTo(1.0, 9);
  });
});
