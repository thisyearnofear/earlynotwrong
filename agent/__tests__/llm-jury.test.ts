import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  deliberateConviction,
  applyJuryVerdicts,
  computeDeliberationDigest,
  type JuryTokenContext,
} from "../lib/llm-jury.js";
import type { ConvictionSignal, MarketRegime } from "../lib/conviction-signal.js";
import type { TokenQuote } from "../lib/data-providers.js";

// =============================================================================
// Test helpers
// =============================================================================

const makeQuote = (overrides: Partial<TokenQuote> = {}): TokenQuote => ({
  symbol: "TWT",
  name: "Trust Wallet Token",
  price: 1.0,
  percentChange1h: 0,
  percentChange24h: -5,
  percentChange7d: -20,
  marketCap: 500_000_000,
  volume24h: 25_000_000,
  circulatingSupply: 500_000_000,
  maxSupply: null,
  cmcRank: 100,
  lastUpdated: new Date().toISOString(),
  ...overrides,
});

const makeSignal = (overrides: Partial<ConvictionSignal> = {}): ConvictionSignal => ({
  symbol: "TWT",
  score: 65,
  breakdown: {
    contrarian: 25,
    rsi: 8,
    quality: 15,
    regime: 18,
    holders: 5,
    volatilityPenalty: 3,
    news: 0,
  },
  weights: {
    contrarian: 30,
    rsi: 10,
    quality: 20,
    regime: 20,
    holders: 10,
    volatilityPenaltyMax: 15,
    newsMax: 10,
  },
  holderCount: 100_000,
  holderGrowthPercent: 3.5,
  newsSentiment: null,
  rationale: "down 20% (early) · fear regime · deep liquidity · +3.5% holders",
  ...overrides,
});

const makeRegime = (overrides: Partial<MarketRegime> = {}): MarketRegime => ({
  score: 75,
  label: "FEAR — FAVORABLE ENTRY",
  fearGreedIndex: 30,
  fearLevel: "fear",
  ssiConfirmation: null,
  ...overrides,
});

const makeContext = (
  signalOverrides: Partial<ConvictionSignal> = {},
  quoteOverrides: Partial<TokenQuote> = {},
): JuryTokenContext => ({
  symbol: signalOverrides.symbol ?? "TWT",
  signal: makeSignal(signalOverrides),
  quote: makeQuote(quoteOverrides),
});

// =============================================================================
// Tests
// =============================================================================

describe("LLM Conviction Jury", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear LLM keys by default — tests template mode unless explicitly set.
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.LLM_JURY_DISABLED;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ── Template mode (no API key) ──────────────────────────────────────────

  describe("template mode (no API key)", () => {
    it("returns a deliberation with zero adjustments", async () => {
      const candidates = [makeContext()];
      const result = await deliberateConviction(candidates, makeRegime(), []);

      expect(result).not.toBeNull();
      expect(result!.provider).toBe("template");
      expect(result!.model).toBe("template-v1");
      expect(result!.verdicts).toHaveLength(1);
      expect(result!.verdicts[0].adjustment).toBe(0);
      expect(result!.verdicts[0].adjustedScore).toBe(65);
    });

    it("generates reasoning from signal data", async () => {
      const candidates = [makeContext()];
      const result = await deliberateConviction(candidates, makeRegime(), []);

      expect(result!.verdicts[0].reasoning).toContain("TWT");
      expect(result!.verdicts[0].reasoning).toContain("20%");
      expect(result!.verdicts[0].reasoning.length).toBeGreaterThan(20);
    });

    it("assesses agreement based on score and dip depth", async () => {
      // Strong signal + deep dip → strong-agree
      const strongCandidate = makeContext(
        { score: 75 },
        { percentChange7d: -25 },
      );
      const result = await deliberateConviction([strongCandidate], makeRegime(), []);
      expect(result!.verdicts[0].agreement).toBe("strong-agree");

      // Weak signal + positive return → disagree
      const weakCandidate = makeContext(
        { score: 35, symbol: "WEAK" },
        { percentChange7d: 10 },
      );
      const result2 = await deliberateConviction([weakCandidate], makeRegime(), []);
      expect(result2!.verdicts[0].agreement).toBe("disagree");
    });

    it("identifies key risks from signal data", async () => {
      // Volatility penalty → falling knife risk
      const volatileCandidate = makeContext(
        { breakdown: { contrarian: 25, rsi: 8, quality: 15, regime: 18, holders: 5, volatilityPenalty: 12, news: 0 } },
      );
      const result = await deliberateConviction([volatileCandidate], makeRegime(), []);
      expect(result!.verdicts[0].keyRisk).toContain("Erratic");

      // Thin liquidity → exit risk
      const thinCandidate = makeContext(
        { breakdown: { contrarian: 25, rsi: 8, quality: 3, regime: 18, holders: 5, volatilityPenalty: 0, news: 0 } },
        { volume24h: 100_000 },
      );
      const result2 = await deliberateConviction([thinCandidate], makeRegime(), []);
      expect(result2!.verdicts[0].keyRisk).toContain("liquidity");
    })

    it("sorts verdicts by adjusted score descending", async () => {
      const candidates = [
        makeContext({ score: 50, symbol: "LOW" }),
        makeContext({ score: 80, symbol: "HIGH" }),
        makeContext({ score: 65, symbol: "MID" }),
      ];
      const result = await deliberateConviction(candidates, makeRegime(), []);

      expect(result!.verdicts[0].symbol).toBe("HIGH");
      expect(result!.verdicts[1].symbol).toBe("MID");
      expect(result!.verdicts[2].symbol).toBe("LOW");
    });

    it("includes market assessment", async () => {
      const result = await deliberateConviction([makeContext()], makeRegime(), []);
      expect(result!.marketAssessment.toLowerCase()).toContain("template");
      expect(result!.marketAssessment).toContain("75");
    });
  });

  // ── Disabled mode ────────────────────────────────────────────────────────

  describe("disabled mode", () => {
    it("returns null when LLM_JURY_DISABLED=1", async () => {
      process.env.LLM_JURY_DISABLED = "1";
      const result = await deliberateConviction([makeContext()], makeRegime(), []);
      expect(result).toBeNull();
    });

    it("returns null when no candidates provided", async () => {
      const result = await deliberateConviction([], makeRegime(), []);
      expect(result).toBeNull();
    });
  });

  // ── applyJuryVerdicts ────────────────────────────────────────────────────

  describe("applyJuryVerdicts", () => {
    it("applies adjustment to matching signals", () => {
      const signals = [
        makeSignal({ symbol: "TWT", score: 65 }),
        makeSignal({ symbol: "ETH", score: 55 }),
      ];
      const deliberation = {
        deliberatedAt: new Date().toISOString(),
        provider: "template" as const,
        model: "template-v1",
        tokensEvaluated: 2,
        marketAssessment: "test",
        verdicts: [
          { symbol: "TWT", adjustment: 10, adjustedScore: 75, reasoning: "bullish", agreement: "agree" as const, keyRisk: "none" },
          { symbol: "ETH", adjustment: -5, adjustedScore: 50, reasoning: "bearish", agreement: "disagree" as const, keyRisk: "regulation" },
        ],
      };

      const result = applyJuryVerdicts(signals, deliberation);
      expect(result[0].score).toBe(75);
      expect(result[0].breakdown.llmJury).toBe(10);
      expect(result[0].juryReasoning).toBe("bullish");
      expect(result[0].juryAgreement).toBe("agree");
      expect(result[0].juryKeyRisk).toBe("none");
      expect(result[1].score).toBe(50);
      expect(result[1].breakdown.llmJury).toBe(-5);
    });

    it("leaves unmatched signals unchanged", () => {
      const signals = [
        makeSignal({ symbol: "TWT", score: 65 }),
        makeSignal({ symbol: "UNMATCHED", score: 40 }),
      ];
      const deliberation = {
        deliberatedAt: new Date().toISOString(),
        provider: "template" as const,
        model: "template-v1",
        tokensEvaluated: 1,
        marketAssessment: "test",
        verdicts: [
          { symbol: "TWT", adjustment: 5, adjustedScore: 70, reasoning: "ok", agreement: "agree" as const, keyRisk: "none" },
        ],
      };

      const result = applyJuryVerdicts(signals, deliberation);
      expect(result[1].score).toBe(40);
      expect(result[1].breakdown.llmJury).toBeUndefined();
      expect(result[1].juryReasoning).toBeUndefined();
    });

    it("returns signals unchanged when deliberation is null", () => {
      const signals = [makeSignal({ score: 65 })];
      const result = applyJuryVerdicts(signals, null);
      expect(result[0].score).toBe(65);
      expect(result[0].breakdown.llmJury).toBeUndefined();
    });

    it("updates rationale with jury info", () => {
      const signals = [makeSignal({ symbol: "TWT", score: 65, rationale: "down 20%" })];
      const deliberation = {
        deliberatedAt: new Date().toISOString(),
        provider: "template" as const,
        model: "template-v1",
        tokensEvaluated: 1,
        marketAssessment: "test",
        verdicts: [
          { symbol: "TWT", adjustment: 8, adjustedScore: 73, reasoning: "strong", agreement: "strong-agree" as const, keyRisk: "low" },
        ],
      };

      const result = applyJuryVerdicts(signals, deliberation);
      expect(result[0].rationale).toContain("jury +8");
      expect(result[0].rationale).toContain("strong-agree");
      expect(result[0].rationale).toContain("down 20%");
    });
  });

  // ── computeDeliberationDigest ────────────────────────────────────────────

  describe("computeDeliberationDigest", () => {
    it("produces a deterministic string for the same deliberation", () => {
      const del = {
        deliberatedAt: "2026-01-01T00:00:00Z",
        provider: "openai" as const,
        model: "gpt-4o-mini",
        tokensEvaluated: 2,
        marketAssessment: "test",
        verdicts: [
          { symbol: "TWT", adjustment: 5, adjustedScore: 70, reasoning: "ok", agreement: "agree" as const, keyRisk: "none" },
          { symbol: "ETH", adjustment: -3, adjustedScore: 52, reasoning: "meh", agreement: "neutral" as const, keyRisk: "reg" },
        ],
      };

      const digest1 = computeDeliberationDigest(del);
      const digest2 = computeDeliberationDigest(del);
      expect(digest1).toBe(digest2);
    });

    it("changes when adjustments change", () => {
      const baseDel = {
        deliberatedAt: "2026-01-01T00:00:00Z",
        provider: "openai" as const,
        model: "gpt-4o-mini",
        tokensEvaluated: 1,
        marketAssessment: "test",
        verdicts: [
          { symbol: "TWT", adjustment: 5, adjustedScore: 70, reasoning: "ok", agreement: "agree" as const, keyRisk: "none" },
        ],
      };

      const modifiedDel = {
        ...baseDel,
        verdicts: [{ ...baseDel.verdicts[0], adjustment: 10, adjustedScore: 75 }],
      };

      expect(computeDeliberationDigest(baseDel)).not.toBe(computeDeliberationDigest(modifiedDel));
    });

    it("excludes reasoning text from digest (only structural data)", () => {
      const del1 = {
        deliberatedAt: "2026-01-01T00:00:00Z",
        provider: "openai" as const,
        model: "gpt-4o-mini",
        tokensEvaluated: 1,
        marketAssessment: "test",
        verdicts: [
          { symbol: "TWT", adjustment: 5, adjustedScore: 70, reasoning: "reasoning A", agreement: "agree" as const, keyRisk: "risk A" },
        ],
      };
      const del2 = {
        ...del1,
        verdicts: [{ ...del1.verdicts[0], reasoning: "reasoning B", keyRisk: "risk B" }],
      };

      // Same digest because only reasoning/keyRisk text changed, not structural data
      expect(computeDeliberationDigest(del1)).toBe(computeDeliberationDigest(del2));
    });
  });

  // ── LLM mode (mocked fetch) ──────────────────────────────────────────────

  describe("LLM mode (mocked OpenAI)", () => {
    it("calls OpenAI and parses the response", async () => {
      process.env.OPENAI_API_KEY = "test-key";

      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                marketAssessment: "Fear dominates. Contrarian entries favored.",
                verdicts: [
                  {
                    symbol: "TWT",
                    adjustment: 8,
                    reasoning: "Healthy dip with strong holder growth. The 20% decline is market-wide fear, not project-specific.",
                    agreement: "strong-agree",
                    keyRisk: "If FGI drops below 15, the dip could deepen further.",
                  },
                ],
              }),
            },
          }],
        }),
      };

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse as any);

      const candidates = [makeContext()];
      const result = await deliberateConviction(candidates, makeRegime(), []);

      expect(result).not.toBeNull();
      expect(result!.provider).toBe("openai");
      expect(result!.verdicts[0].adjustment).toBe(8);
      expect(result!.verdicts[0].adjustedScore).toBe(73); // 65 + 8
      expect(result!.verdicts[0].agreement).toBe("strong-agree");
      expect(result!.verdicts[0].reasoning).toContain("Healthy dip");
      expect(result!.marketAssessment).toContain("Fear dominates");

      fetchSpy.mockRestore();
    });

    it("clamps adjustments to ±15", async () => {
      process.env.OPENAI_API_KEY = "test-key";

      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                marketAssessment: "test",
                verdicts: [
                  { symbol: "TWT", adjustment: 50, reasoning: "extreme", agreement: "strong-agree", keyRisk: "none" },
                ],
              }),
            },
          }],
        }),
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse as any);

      const result = await deliberateConviction([makeContext()], makeRegime(), []);
      expect(result!.verdicts[0].adjustment).toBe(15); // clamped
      expect(result!.verdicts[0].adjustedScore).toBe(80); // 65 + 15

      vi.restoreAllMocks();
    });

    it("clamps adjusted score to 0-100", async () => {
      process.env.OPENAI_API_KEY = "test-key";

      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                marketAssessment: "test",
                verdicts: [
                  { symbol: "TWT", adjustment: -15, reasoning: "dump it", agreement: "strong-disagree", keyRisk: "dead" },
                ],
              }),
            },
          }],
        }),
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse as any);

      // Score 10 - 15 = -5 → clamped to 0
      const result = await deliberateConviction(
        [makeContext({ score: 10 })],
        makeRegime(),
        [],
      );
      expect(result!.verdicts[0].adjustment).toBe(-15);
      expect(result!.verdicts[0].adjustedScore).toBe(0);

      vi.restoreAllMocks();
    });

    it("falls back to template when LLM returns non-JSON", async () => {
      process.env.OPENAI_API_KEY = "test-key";

      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "This is not JSON" } }],
        }),
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse as any);

      const result = await deliberateConviction([makeContext()], makeRegime(), []);
      expect(result!.provider).toBe("template");
      expect(result!.verdicts[0].adjustment).toBe(0);

      vi.restoreAllMocks();
    });

    it("falls back to template when fetch fails", async () => {
      process.env.OPENAI_API_KEY = "test-key";

      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));

      const result = await deliberateConviction([makeContext()], makeRegime(), []);
      expect(result!.provider).toBe("template");

      vi.restoreAllMocks();
    });

    it("fills in candidates the LLM skipped", async () => {
      process.env.OPENAI_API_KEY = "test-key";

      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                marketAssessment: "test",
                verdicts: [
                  { symbol: "TWT", adjustment: 5, reasoning: "ok", agreement: "agree", keyRisk: "none" },
                  // ETH was a candidate but the LLM didn't include it
                ],
              }),
            },
          }],
        }),
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse as any);

      const candidates = [
        makeContext({ symbol: "TWT" }),
        makeContext({ symbol: "ETH", score: 55 }),
      ];
      const result = await deliberateConviction(candidates, makeRegime(), []);

      expect(result!.verdicts).toHaveLength(2);
      const ethVerdict = result!.verdicts.find((v) => v.symbol === "ETH");
      expect(ethVerdict).toBeDefined();
      expect(ethVerdict!.adjustment).toBe(0);
      expect(ethVerdict!.reasoning).toContain("did not evaluate");

      vi.restoreAllMocks();
    });
  });
});
