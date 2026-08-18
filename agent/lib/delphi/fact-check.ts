/**
 * Delphi fact checkers — deterministic resolution authorities.
 *
 * Search results and LLM samples are evidence; a resolution authority is
 * ground truth. Some market questions can be answered by fetching ONE number
 * from the exact source the market resolves against — no search, no LLM, no
 * opinion. Production motivation (2026-08-18): the Chess-pageviews market
 * was forecast at 0.95 by an LLM ensemble and re-entered four times (net
 * −89 TST) while the Wikimedia REST API — the market's literal resolution
 * authority — serves the daily pageview count keyless in ~0.3s.
 *
 * Design:
 *   - A verifier REGISTRY: each verifier declares a `match(question)` regex
 *     test and an async `verify()` that fetches the authority. New
 *     authorities (Treasury yields, Federal Register, sports feeds) plug in
 *     by registration — no runner changes.
 *   - First matching verifier wins; mismatches and fetch failures return
 *     null and the market falls back to the ordinary evidence path.
 *   - Output has two parts: `facts` (rendered, prompt-injectable text —
 *     used even when no direct probability is possible) and an OPTIONAL
 *     `probability` for outcome 0. A probability is only produced when the
 *     authority's data already covers the resolution window (e.g. a
 *     completed day's pageview count vs the threshold) — never extrapolated
 *     for an in-progress window. For in-progress windows the facts alone
 *     sharpen the LLM estimate.
 *   - Probabilities are capped at [0.01, 0.99]: LMSR shares resolve 1/0 and
 *     Brier punishes hard zeros; a data error must never become certainty.
 *
 * All fetches carry a descriptive User-Agent (Wikimedia policy) and run
 * through fetchWithBackoff so a throttled authority degrades to null
 * instead of stalling the cycle.
 */

import { fetchWithBackoff } from "../llm-providers.js";

// =============================================================================
// Types
// =============================================================================

/** The result of checking one market question against one authority. */
export interface FactCheck {
  /** Verifier name (provenance + logging), e.g. "wikimedia-pageviews". */
  authority: string;
  /** The question that was checked. */
  question: string;
  /** Rendered evidence text for prompt injection (1-4 short lines). */
  facts: string;
  /**
   * Direct P(outcome 0) when the authority's data already covers the
   * resolution window. Undefined when the window is still open — the facts
   * are injected as evidence instead and the LLM estimates normally.
   */
  probability?: number;
  fetchedAt: number;
}

/** A resolution-authority verifier. */
export interface FactVerifier {
  /** Unique name; appears in provenance (`factAuthority`). */
  name: string;
  /** Does this verifier apply to the question? (cheap, pure) */
  match(question: string): boolean;
  /** Fetch the authority. Return null when the data is unavailable —
   *  never throw (the registry treats throws as null). */
  verify(question: string, now: number): Promise<FactCheck | null>;
}

// =============================================================================
// Registry
// =============================================================================

const verifiers: FactVerifier[] = [];

/** Register a verifier (idempotent by name — re-registration replaces). */
export function registerFactVerifier(verifier: FactVerifier): void {
  const idx = verifiers.findIndex((v) => v.name === verifier.name);
  if (idx >= 0) verifiers.splice(idx, 1, verifier);
  else verifiers.push(verifier);
}

/** Remove all verifiers (test isolation). */
export function clearFactVerifiers(): void {
  verifiers.length = 0;
}

/** Names of registered verifiers (observability/tests). */
export function registeredFactVerifiers(): string[] {
  return verifiers.map((v) => v.name);
}

/**
 * Run the first matching verifier for a question. Returns null when no
 * verifier matches, or the matching verifier can't produce data. Failures
 * are swallowed — a broken authority must never block the ordinary path.
 */
export async function runFactCheck(
  question: string,
  now: number = Date.now(),
): Promise<FactCheck | null> {
  for (const v of verifiers) {
    if (!v.match(question)) continue;
    try {
      const result = await v.verify(question, now);
      if (result) return result;
    } catch (err) {
      console.warn(
        `  [delphi-fact] verifier ${v.name} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // Matched but produced nothing — don't fall through to unrelated
    // verifiers; the ordinary evidence path takes over.
    return null;
  }
  return null;
}

// =============================================================================
// Shared helpers
// =============================================================================

/** Clamp a data-derived probability away from 0/1 (Brier + data-error guard). */
export function clampProbability(p: number): number {
  return Math.min(0.99, Math.max(0.01, p));
}

/** Fetch JSON with a descriptive UA + bounded backoff. Null on any failure. */
async function fetchJsonAuthority(url: string, timeoutMs = 20_000): Promise<unknown | null> {
  try {
    const response = await fetchWithBackoff(url, {
      headers: { "User-Agent": "earlynotwrong-delphi-agent/1.0 (prediction-market research)" },
      signal: AbortSignal.timeout(timeoutMs),
    }, { retries: 1, baseDelayMs: 1_000 });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

// =============================================================================
// Verifier: Wikipedia pageviews (Wikimedia REST API — keyless)
// =============================================================================

/**
 * Matches questions like:
 *   Will the English Wikipedia article "Chess" receive more than 2,250
 *   pageviews on 2026-08-18 UTC?
 * The market resolves against en.wikipedia's published daily pageview
 * counts — this verifier queries the same source of record.
 */
const WIKI_PAGEVIEWS_RE =
  /english wikipedia article\s+"([^"]+)"\s+receive more than\s+([\d,]+)\s+pageviews on (\d{4}-\d{2}-\d{2})/i;

/** Parse the market's wiki question. Exported for tests. */
export function parseWikiPageviewsQuestion(
  question: string,
): { article: string; threshold: number; date: string } | null {
  const m = question.match(WIKI_PAGEVIEWS_RE);
  if (!m) return null;
  const threshold = parseInt(m[2].replace(/,/g, ""), 10);
  if (!Number.isFinite(threshold) || threshold <= 0) return null;
  return { article: m[1], threshold, date: m[3] };
}

/** YYYY-MM-DD → YYYYMMDD00 (Wikimedia daily granularity format). */
function wikiDay(date: string): string {
  return `${date.replace(/-/g, "")}00`;
}

/** Number of milliseconds in a day. */
const DAY_MS = 24 * 60 * 60 * 1000;

interface WikiPageviewsItem {
  timestamp?: string;
  views?: number;
}

/**
 * The Wikimedia verifier. Two regimes:
 *   - Resolution day COMPLETED (strictly before today UTC): the API has the
 *     exact count → direct probability (count > threshold → 0.99 else 0.01).
 *   - Resolution day today/future: only evidence — the trailing 7 completed
 *     days' counts, which the forecaster can weigh against the threshold.
 *     No extrapolated probability (the point of this tier is authority,
 *     not opinion).
 */
export const wikimediaPageviewsVerifier: FactVerifier = {
  name: "wikimedia-pageviews",
  match: (question) => WIKI_PAGEVIEWS_RE.test(question),
  verify: async (question, now) => {
    const parsed = parseWikiPageviewsQuestion(question);
    if (!parsed) return null;
    const { article, threshold, date } = parsed;
    // Wikimedia uses underscores in article titles.
    const title = encodeURIComponent(article.replace(/ /g, "_"));

    const resolutionDay = Date.parse(`${date}T00:00:00Z`);
    const todayUtc = Date.parse(
      new Date(now).toISOString().slice(0, 10) + "T00:00:00Z",
    );

    if (resolutionDay < todayUtc) {
      // The day is complete — the authority has the exact count.
      const data = (await fetchJsonAuthority(
        `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${title}/daily/${wikiDay(date)}/${wikiDay(date)}`,
      )) as { items?: WikiPageviewsItem[] } | null;
      const views = data?.items?.[0]?.views;
      if (typeof views !== "number") return null;
      const won = views > threshold;
      return {
        authority: "wikimedia-pageviews",
        question,
        facts:
          `Wikimedia REST API (source of record): "${article}" received ` +
          `${views.toLocaleString("en-US")} pageviews on ${date} (UTC). ` +
          `Market threshold: more than ${threshold.toLocaleString("en-US")}. ` +
          `The day is complete; the count is final.`,
        probability: clampProbability(won ? 0.99 : 0.01),
        fetchedAt: now,
      };
    }

    // Window still open — fetch the trailing 7 completed days as evidence.
    const start = new Date(now - 7 * DAY_MS).toISOString().slice(0, 10);
    const end = new Date(now - DAY_MS).toISOString().slice(0, 10);
    const data = (await fetchJsonAuthority(
      `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${title}/daily/${wikiDay(start)}/${wikiDay(end)}`,
    )) as { items?: WikiPageviewsItem[] } | null;
    const items = (data?.items ?? []).filter((i) => typeof i.views === "number");
    if (items.length === 0) return null;
    const counts = items
      .map((i) => `${(i.timestamp ?? "").slice(0, 8)}: ${i.views?.toLocaleString("en-US")}`)
      .join("; ");
    const above = items.filter((i) => (i.views ?? 0) > threshold).length;
    return {
      authority: "wikimedia-pageviews",
      question,
      facts:
        `Wikimedia REST API (source of record): "${article}" daily pageviews for the ` +
        `last ${items.length} completed days (UTC) — ${counts}. Threshold: more than ` +
        `${threshold.toLocaleString("en-US")} on ${date} (still open). ` +
        `${above}/${items.length} of the recent days were above the threshold.`,
      // Deliberately no `probability` — the resolution window is not
      // covered by the data yet; the forecaster weighs the evidence.
      fetchedAt: now,
    };
  },
};

// Default registration: the scaffold ships with the one verified authority.
// Additional verifiers register here (or from their own modules) — the
// runner only ever calls runFactCheck().
registerFactVerifier(wikimediaPageviewsVerifier);
