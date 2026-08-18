/**
 * Tests for the 4-tier evidence-validation stack:
 *
 *   Tier 1 — fact-check.ts: deterministic resolution authorities
 *            (registry, question parsing, completed-day probability,
 *             evidence-only open windows, clamp + failure isolation).
 *   Tier 2 — evidence-filter.ts: deterministic plausibility filter
 *            (stale-year passage dropping, passage splitting, year anchor).
 *   Tier 3 — web-search corroboration: pure overlap arithmetic
 *            (domain match, content match, DelphiWebSearch cross-check flow).
 *   Tier 4 — verification.ts: cross-family ordering + probability adjustment.
 *
 * All network is mocked: the Wikimedia verifier gets a stubbed globalThis
 * fetch; the DelphiWebSearch corroboration tests inject both rungs. No live
 * inference or search call ever fires from this file.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  runFactCheck,
  registerFactVerifier,
  clearFactVerifiers,
  registeredFactVerifiers,
  parseWikiPageviewsQuestion,
  wikimediaPageviewsVerifier,
  clampProbability,
  type FactVerifier,
} from "../lib/delphi/fact-check.js";
import {
  questionYear,
  splitPassages,
  filterEvidencePlausibility,
} from "../lib/delphi/evidence-filter.js";
import {
  urlDomain,
  significantTokens,
  corroborationOverlap,
  DelphiWebSearch,
} from "../lib/delphi/web-search.js";
import {
  crossFamilyOrder,
  applyVerificationToProbability,
  dedicatedVerifierProvider,
} from "../lib/delphi/verification.js";
import { factAuthorityEstimate, type MarketEstimateInput } from "../lib/delphi/probability.js";

// =============================================================================
// Tier 1 — fact-check registry + parsing
// =============================================================================

describe("fact-check registry", () => {
  afterEach(() => {
    clearFactVerifiers();
    registerFactVerifier(wikimediaPageviewsVerifier); // restore default
  });

  it("runs the FIRST matching verifier and does not fall through", async () => {
    clearFactVerifiers();
    const calls: string[] = [];
    registerFactVerifier({
      name: "first",
      match: () => true,
      verify: async () => {
        calls.push("first");
        return null; // matched but produced nothing
      },
    });
    registerFactVerifier({
      name: "second",
      match: () => true,
      verify: async () => {
        calls.push("second");
        return { authority: "second", question: "q", facts: "f", fetchedAt: 0 };
      },
    });
    const result = await runFactCheck("anything");
    expect(calls).toEqual(["first"]); // second never runs — no fall-through
    expect(result).toBeNull();
  });

  it("re-registration replaces by name (idempotent)", () => {
    clearFactVerifiers();
    const v: FactVerifier = { name: "dup", match: () => false, verify: async () => null };
    registerFactVerifier(v);
    registerFactVerifier(v);
    expect(registeredFactVerifiers()).toEqual(["dup", "dup"].slice(0, 1));
  });

  it("swallows verifier exceptions as null (never blocks the ordinary path)", async () => {
    clearFactVerifiers();
    registerFactVerifier({
      name: "exploder",
      match: () => true,
      verify: async () => {
        throw new Error("authority offline");
      },
    });
    expect(await runFactCheck("q")).toBeNull();
  });

  it("returns null when no verifier matches", async () => {
    expect(await runFactCheck("Will the Fed cut rates?")).toBeNull();
  });
});

describe("clampProbability", () => {
  it("keeps probabilities inside [0.01, 0.99] — data errors must never become certainty", () => {
    expect(clampProbability(0)).toBe(0.01);
    expect(clampProbability(1)).toBe(0.99);
    expect(clampProbability(2)).toBe(0.99);
    expect(clampProbability(-1)).toBe(0.01);
    expect(clampProbability(0.62)).toBe(0.62);
  });
});

describe("parseWikiPageviewsQuestion", () => {
  it("parses the live competition phrasing", () => {
    const parsed = parseWikiPageviewsQuestion(
      'Will the English Wikipedia article "Chess" receive more than 2,250 pageviews on 2026-08-18 UTC?',
    );
    expect(parsed).toEqual({ article: "Chess", threshold: 2250, date: "2026-08-18" });
  });

  it("parses multi-word articles and ungrouped thresholds", () => {
    const parsed = parseWikiPageviewsQuestion(
      'Will the English Wikipedia article "World Chess Championship" receive more than 12000 pageviews on 2026-09-01 UTC?',
    );
    expect(parsed?.article).toBe("World Chess Championship");
    expect(parsed?.threshold).toBe(12000);
  });

  it("returns null for non-pageview questions and degenerate thresholds", () => {
    expect(parseWikiPageviewsQuestion("Will BTC close above $150k?")).toBeNull();
    expect(
      parseWikiPageviewsQuestion('Will the English Wikipedia article "X" receive more than 0 pageviews on 2026-08-18 UTC?'),
    ).toBeNull();
  });
});

describe("wikimediaPageviewsVerifier", () => {
  // The verifier uses fetchWithBackoff → globalThis.fetch. Stub it per test.
  let savedFetch: typeof globalThis.fetch;

  beforeEach(() => {
    savedFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = savedFetch;
  });

  /** A fetch stub answering with the given pageview items. */
  const stubFetch = (views: Array<{ timestamp: string; views: number } | null> | "http-error") => {
    globalThis.fetch = vi.fn(async () => {
      if (views === "http-error") return { ok: false, status: 500 } as unknown as Response;
      return {
        ok: true,
        json: async () => ({ items: views.filter((v): v is NonNullable<typeof v> => v !== null) }),
      } as unknown as Response;
    }) as typeof globalThis.fetch;
  };

  const QUESTION =
    'Will the English Wikipedia article "Chess" receive more than 2,250 pageviews on 2026-08-17 UTC?';

  it("does not match non-pageview questions", () => {
    expect(wikimediaPageviewsVerifier.match("Will BTC moon?")).toBe(false);
    expect(wikimediaPageviewsVerifier.match(QUESTION)).toBe(true);
  });

  it("returns a DIRECT probability for a completed resolution day", async () => {
    // 2026-08-18 is the day AFTER 08-17 → the day is complete.
    stubFetch([{ timestamp: "2026081700", views: 2828 }]);
    const now = Date.parse("2026-08-18T10:00:00Z");
    const result = await wikimediaPageviewsVerifier.verify(QUESTION, now);
    expect(result?.probability).toBe(0.99); // 2828 > 2250 → YES wins
    expect(result?.authority).toBe("wikimedia-pageviews");
    expect(result?.facts).toContain("2,828");
  });

  it("returns the losing-side probability when the count is at/below the threshold", async () => {
    stubFetch([{ timestamp: "2026081700", views: 2250 }]); // "more than" → not above
    const now = Date.parse("2026-08-18T10:00:00Z");
    const result = await wikimediaPageviewsVerifier.verify(QUESTION, now);
    expect(result?.probability).toBe(0.01);
  });

  it("returns EVIDENCE ONLY (no probability) while the resolution day is still open", async () => {
    stubFetch([
      { timestamp: "2026081100", views: 2426 },
      { timestamp: "2026081200", views: 1900 },
      { timestamp: "2026081300", views: 2600 },
    ]);
    const now = Date.parse("2026-08-17T10:00:00Z"); // resolution day is TODAY
    const result = await wikimediaPageviewsVerifier.verify(QUESTION, now);
    expect(result?.probability).toBeUndefined(); // no extrapolation — by design
    expect(result?.facts).toContain("2/3"); // 2 of 3 trailing days above threshold
    expect(result?.facts).toContain("still open");
  });

  it("returns null when the authority has no data or errors", async () => {
    stubFetch([]);
    expect(await wikimediaPageviewsVerifier.verify(QUESTION, Date.parse("2026-08-18T10:00:00Z"))).toBeNull();
    stubFetch("http-error");
    expect(await wikimediaPageviewsVerifier.verify(QUESTION, Date.parse("2026-08-18T10:00:00Z"))).toBeNull();
  });

  it("queries the API with underscores in multi-word article titles", async () => {
    const seenUrls: string[] = [];
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      seenUrls.push(String(url));
      return { ok: true, json: async () => ({ items: [{ timestamp: "2026081700", views: 10 }] }) } as unknown as Response;
    }) as typeof globalThis.fetch;
    const q = 'Will the English Wikipedia article "World Chess Championship" receive more than 5 pageviews on 2026-08-17 UTC?';
    await wikimediaPageviewsVerifier.verify(q, Date.parse("2026-08-18T10:00:00Z"));
    expect(seenUrls[0]).toContain("World_Chess_Championship");
  });
});

// =============================================================================
// Tier 2 — evidence plausibility filter
// =============================================================================

describe("questionYear", () => {
  it("extracts the first plausible 4-digit year from the question", () => {
    expect(questionYear("Will BTC close above $150k in 2026?")).toBe(2026);
    expect(questionYear('Will "Chess" get pageviews on 2026-08-18?')).toBe(2026);
  });

  it("ignores implausible year-shaped numbers", () => {
    // 2250 looks year-shaped but fails the 1900-2100 sanity range.
    expect(questionYear("Will the article receive more than 2250 pageviews?")).toBe(
      new Date().getUTCFullYear(), // falls back to the current year
    );
  });

  it("anchors on the current year when the question has no year", () => {
    expect(questionYear("Will the Fed cut rates?", Date.parse("2026-08-18T00:00:00Z"))).toBe(2026);
  });
});

describe("splitPassages", () => {
  it("splits dash-prefixed briefing lines into passages", () => {
    const passages = splitPassages("- first fact (url1)\n- second fact (url2)");
    expect(passages).toEqual(["first fact (url1)", "second fact (url2)"]);
  });

  it("falls back to sentence splitting for a single block", () => {
    const passages = splitPassages("One sentence. Two sentences! Three?");
    expect(passages).toHaveLength(3);
  });
});

describe("filterEvidencePlausibility", () => {
  // The production incident: a 1986 WTI price table injected into a 2026
  // crude-oil market must be dropped; current evidence must survive.
  it("drops passages whose only years are far outside the question's year", () => {
    const question = "Will WTI crude oil close above $95 on 2026-08-22 UTC?";
    const evidence =
      "- In 1986 WTI crude collapsed to $10 amid the Saudi production surge (history.com)\n" +
      "- Crude futures settled $91.40 in August 2026 on supply concerns (reuters.com)";
    const result = filterEvidencePlausibility(question, evidence);
    expect(result.dropped).toBe(1);
    expect(result.text).not.toContain("1986");
    expect(result.text).toContain("91.40");
    expect(result.empty).toBe(false);
  });

  it("keeps passages that mention the question's year or an adjacent year", () => {
    const question = "Will X happen on 2026-08-20?";
    const evidence = "- reported late 2025 (a.com)\n- expected 2026 (b.com)";
    const result = filterEvidencePlausibility(question, evidence);
    expect(result.dropped).toBe(0);
  });

  it("passes dateless passages through untouched", () => {
    const result = filterEvidencePlausibility(
      "Will X happen in 2026?",
      "- The JMA upgraded Dolphin to a severe typhoon",
    );
    expect(result.dropped).toBe(0);
    expect(result.text).toContain("severe typhoon");
  });

  it("reports empty when nothing plausible survives (caller injects nothing)", () => {
    const result = filterEvidencePlausibility(
      "Will X happen in 2026?",
      "- In 1999 this was predicted (old.com)",
    );
    expect(result.dropped).toBe(1);
    expect(result.empty).toBe(true);
    expect(result.text).toBe("");
  });

  it("exposes per-line audit verdicts with reasons", () => {
    const result = filterEvidencePlausibility(
      "Will X happen in 2026?",
      "- ancient 1950 claim\n- fresh claim",
    );
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].plausible).toBe(false);
    expect(result.lines[0].reason).toMatch(/from the question's 2026/);
    expect(result.lines[1].plausible).toBe(true);
  });
});

// =============================================================================
// Tier 3 — deterministic corroboration
// =============================================================================

describe("urlDomain", () => {
  it("extracts the last two labels, stripping www and protocol", () => {
    expect(urlDomain("https://www.reuters.com/world/asia/story")).toBe("reuters.com");
    expect(urlDomain("http://sub.example.co.uk/x")).toBe("co.uk"); // naive two-label rule
    expect(urlDomain("no-protocol.com/path")).toBe("no-protocol.com");
  });

  it("returns null for unparseable hosts", () => {
    expect(urlDomain("localhost")).toBeNull();
    expect(urlDomain("")).toBeNull();
  });
});

describe("significantTokens", () => {
  it("keeps numbers and 5+-letter words, drops stopwords and short words", () => {
    const tokens = significantTokens("The dolphin upgraded typhoon 2026 winds reached 185 kph per JMA reports");
    expect(tokens.has("dolphin")).toBe(true);
    expect(tokens.has("typhoon")).toBe(true);
    expect(tokens.has("2026")).toBe(true); // 4 digits — no (3+ required), actually 2026 is 4 digits ≥3 ✓
    expect(tokens.has("the")).toBe(false);
    expect(tokens.has("per")).toBe(false);
    expect(tokens.has("reported")).toBe(false); // stopword
  });
});

describe("corroborationOverlap", () => {
  it("corroborates on a shared source domain", () => {
    const result = corroborationOverlap(
      { text: "unrelated words aaaa bbbb cccc", sources: ["https://www.reuters.com/a"] },
      { text: "completely different dddd eeee ffff", sources: ["https://reuters.com/b"] },
    );
    expect(result.corroborated).toBe(true);
    expect(result.basis).toBe("domain");
  });

  it("corroborates on shared significant content tokens", () => {
    const result = corroborationOverlap(
      { text: "JMA says dolphin typhoon winds reached 185 kph near okinawa", sources: [] },
      { text: "dolphin typhoon intensified, winds 185 kph per agency bulletin", sources: [] },
    );
    expect(result.corroborated).toBe(true);
    expect(result.basis).toBe("content");
  });

  it("does not corroborate unrelated briefings", () => {
    const result = corroborationOverlap(
      { text: "stocks rally on earnings beats", sources: ["https://cnbc.com/x"] },
      { text: "chess championship draws record crowds", sources: ["https://fide.com/y"] },
    );
    expect(result.corroborated).toBe(false);
    expect(result.basis).toBeUndefined();
  });

  it("reports both bases when both match", () => {
    const result = corroborationOverlap(
      { text: "dolphin typhoon 185 kph winds okinawa", sources: ["https://reuters.com/a"] },
      { text: "dolphin typhoon 185 kph winds update", sources: ["https://reuters.com/b"] },
    );
    expect(result.basis).toBe("domain+content");
  });
});

describe("DelphiWebSearch — Tier 3 cross-check flow", () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>)["__llmProviderBreakerOpenUntil"];
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>)["__llmProviderBreakerOpenUntil"];
  });

  const briefing = (source: "firecrawl" | "parallel", text: string, sources: string[] = []) => ({
    text,
    sources,
    cached: false,
    budgetExhausted: false,
    source,
  });

  it("marks the briefing corroborated when the second rung agrees", async () => {
    let parallelCalls = 0;
    const ws = new DelphiWebSearch({
      runFirecrawlSearch: async () =>
        briefing("firecrawl", "dolphin typhoon winds reached 185 kph okinawa", ["https://reuters.com/a"]),
      runParallelSearch: async () => {
        parallelCalls++;
        return briefing("parallel", "dolphin typhoon 185 kph winds near okinawa", ["https://reuters.com/b"]);
      },
      runGatewaySearch: async () => null,
    });
    const result = await ws.briefing("Q");
    expect(result?.corroborated).toBe(true);
    expect(result?.corroboratedBy).toBe("parallel");
    expect(parallelCalls).toBe(1);
    expect(ws.cycleCalls).toBe(2); // primary + cross-check, counted in the budget
  });

  it("marks corroborated=false when the second rung disagrees", async () => {
    const ws = new DelphiWebSearch({
      runFirecrawlSearch: async () => briefing("firecrawl", "stocks rally on earnings beats today", ["https://cnbc.com/a"]),
      runParallelSearch: async () => briefing("parallel", "chess championship draws record crowds", ["https://fide.com/b"]),
      runGatewaySearch: async () => null,
    });
    const result = await ws.briefing("Q");
    expect(result?.corroborated).toBe(false);
    expect(result?.text).toContain("stocks rally"); // primary still served
  });

  it("leaves corroborated undefined when corroboration is disabled", async () => {
    const ws = new DelphiWebSearch({
      corroborate: false,
      runFirecrawlSearch: async () => briefing("firecrawl", "some text here"),
      runParallelSearch: async () => briefing("parallel", "other text"),
    });
    const result = await ws.briefing("Q");
    expect(result?.corroborated).toBeUndefined();
    expect(ws.cycleCalls).toBe(1);
  });

  it("leaves corroborated undefined when no second rung is eligible", async () => {
    const ws = new DelphiWebSearch({
      runFirecrawlSearch: async () => briefing("firecrawl", "some text here"),
      runParallelSearch: async () => null,
      runGatewaySearch: async () => null, // no gateway key → ineligible anyway
    });
    const result = await ws.briefing("Q");
    expect(result?.corroborated).toBeUndefined();
  });

  it("does not block the primary when the cross-check rung throws", async () => {
    const ws = new DelphiWebSearch({
      runFirecrawlSearch: async () => briefing("firecrawl", "primary text here"),
      runParallelSearch: async () => {
        throw new Error("Parallel search error: 500");
      },
      runGatewaySearch: async () => null,
    });
    const result = await ws.briefing("Q");
    expect(result?.text).toBe("primary text here");
    expect(result?.corroborated).toBeUndefined(); // check failed → unattempted label
  });

  it("respects the shared budget: no cross-check when the budget is exhausted", async () => {
    let parallelCalls = 0;
    const ws = new DelphiWebSearch({
      maxCallsPerCycle: 1,
      runFirecrawlSearch: async () => briefing("firecrawl", "primary text"),
      runParallelSearch: async () => {
        parallelCalls++;
        return briefing("parallel", "cross text");
      },
    });
    const result = await ws.briefing("Q");
    expect(result?.text).toBe("primary text");
    expect(result?.corroborated).toBeUndefined(); // budget exhausted before the cross-check
    expect(parallelCalls).toBe(0);
    expect(ws.cycleCalls).toBe(1);
  });

  it("serves the corroborated flag from cache on repeat questions", async () => {
    let firecrawlCalls = 0;
    const ws = new DelphiWebSearch({
      cacheTtlMs: 60_000,
      runFirecrawlSearch: async () => {
        firecrawlCalls++;
        return briefing("firecrawl", "dolphin typhoon 185 kph winds okinawa");
      },
      runParallelSearch: async () => briefing("parallel", "dolphin typhoon 185 kph winds okinawa"),
      runGatewaySearch: async () => null,
    });
    const first = await ws.briefing("Q");
    const second = await ws.briefing("q");
    expect(first?.corroborated).toBe(true);
    expect(second?.cached).toBe(true);
    expect(second?.corroborated).toBe(true); // persisted with the cache entry
    expect(firecrawlCalls).toBe(1);
  });
});

// =============================================================================
// Tier 4 — adversarial verification
// =============================================================================

describe("crossFamilyOrder", () => {
  afterEach(() => {
    delete process.env.DELPHI_VERIFIER_PROVIDER;
  });

  it("pushes the estimator's own family to the back (Qwen estimate → GLM first)", () => {
    const order = crossFamilyOrder("hf-qwen"); // qwen family
    expect(order[0]).not.toBe("hf-qwen");
    expect(order[0]).not.toBe("orcarouter");
    expect(order.indexOf("hf-qwen")).toBeGreaterThan(order.indexOf("openrouter"));
    expect(order.indexOf("orcarouter")).toBe(order.length - 1); // qwen family both last
  });

  it("leaves the default order when the estimator family is unknown", () => {
    const order = crossFamilyOrder("injected");
    expect(order[0]).toBe("vercel-gateway");
    expect(order).toHaveLength(6);
  });

  it("promotes the dedicated verifier provider when it is cross-family", () => {
    process.env.DELPHI_VERIFIER_PROVIDER = "openai";
    const order = crossFamilyOrder("hf-qwen");
    expect(order[0]).toBe("openai");
  });

  it("does NOT promote a dedicated provider from the estimator's own family", () => {
    process.env.DELPHI_VERIFIER_PROVIDER = "orcarouter"; // qwen family
    const order = crossFamilyOrder("hf-qwen"); // qwen estimate
    expect(order[0]).not.toBe("orcarouter");
  });

  it("dedicatedVerifierProvider validates the env var", () => {
    expect(dedicatedVerifierProvider()).toBeNull();
    process.env.DELPHI_VERIFIER_PROVIDER = "anthropic";
    expect(dedicatedVerifierProvider()).toBe("anthropic");
    process.env.DELPHI_VERIFIER_PROVIDER = "not-a-provider";
    expect(dedicatedVerifierProvider()).toBeNull();
  });
});

describe("applyVerificationToProbability", () => {
  const cfg = { weight: 0.5, disagreementThreshold: 0.15 };

  it("leaves the estimate alone when the verifier agrees", () => {
    const out = applyVerificationToProbability(
      0.7,
      { ran: true, verdict: "agree", verifierProbability: 0.68 },
      cfg,
    );
    expect(out.adjusted).toBe(false);
    expect(out.probability).toBe(0.7);
  });

  it("does not adjust on sub-threshold disagreement (small gaps = confirmation)", () => {
    const out = applyVerificationToProbability(
      0.7,
      { ran: true, verdict: "overconfident", verifierProbability: 0.6 }, // gap 0.1 < 0.15
      cfg,
    );
    expect(out.adjusted).toBe(false);
    expect(out.probability).toBe(0.7);
  });

  it("discounts toward the verifier on flagged overconfidence beyond the threshold", () => {
    // est 0.95, verifier 0.5, gap 0.45 ≥ 0.15 → adjusted = 0.5·0.95 + 0.5·0.5 = 0.725
    const out = applyVerificationToProbability(
      0.95,
      { ran: true, verdict: "overconfident", verifierProbability: 0.5 },
      cfg,
    );
    expect(out.adjusted).toBe(true);
    expect(out.probability).toBeCloseTo(0.725, 9);
    expect(out.reason).toMatch(/overconfident/);
  });

  it("nudges up on flagged underconfidence beyond the threshold", () => {
    const out = applyVerificationToProbability(
      0.3,
      { ran: true, verdict: "underconfident", verifierProbability: 0.7 },
      cfg,
    );
    expect(out.adjusted).toBe(true);
    expect(out.probability).toBeCloseTo(0.5, 9); // 0.5·0.3 + 0.5·0.7
  });

  it("treats a non-ran verification as unadjusted (never blocks)", () => {
    const out = applyVerificationToProbability(0.8, { ran: false }, cfg);
    expect(out.adjusted).toBe(false);
    expect(out.probability).toBe(0.8);
    expect(out.reason).toMatch(/unavailable/);
  });

  it("clamps the adjusted probability into (0.01, 0.99)", () => {
    const out = applyVerificationToProbability(
      0.99,
      { ran: true, verdict: "overconfident", verifierProbability: 0.02 },
      { weight: 0.9, disagreementThreshold: 0.15 },
    );
    expect(out.adjusted).toBe(true);
    expect(out.probability).toBeLessThan(0.99);
    expect(out.probability).toBeGreaterThan(0.01);
  });
});

describe("factAuthorityEstimate (Tier 1 → estimate bridge)", () => {
  const input: MarketEstimateInput = {
    marketAddress: "0xW",
    question: 'Will the English Wikipedia article "Chess" receive more than 2,250 pageviews on 2026-08-17 UTC?',
    impliedProbabilities: [0.5, 0.5],
    outcomes: ["Yes", "No"],
  };

  it("builds a deterministic binary estimate from the authority probability", () => {
    const est = factAuthorityEstimate(input, 0.99, "wikimedia-pageviews", "count 2828 vs threshold 2250", 1234);
    expect(est).not.toBeNull();
    expect(est!.outcomes[0].probability).toBeCloseTo(0.99, 9);
    expect(est!.outcomes[1].probability).toBeCloseTo(0.01, 9);
    expect(est!.provider).toBe("injected");
    expect(est!.model).toBe("authority:wikimedia-pageviews");
    expect(est!.provenance?.factAuthority).toBe("wikimedia-pageviews");
    expect(est!.estimatedAt).toBe(1234);
  });

  it("clamps extreme authority values", () => {
    const est = factAuthorityEstimate(input, 5, "x", "f");
    expect(est!.outcomes[0].probability).toBe(0.99);
  });

  it("returns null for non-binary markets", () => {
    const multi = { ...input, outcomes: ["A", "B", "C"], impliedProbabilities: [0.3, 0.3, 0.4] };
    expect(factAuthorityEstimate(multi, 0.9, "x", "f")).toBeNull();
  });
});
