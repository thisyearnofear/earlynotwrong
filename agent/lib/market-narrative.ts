/**
 * Market Narrative Generator
 *
 * Produces natural-language market commentary from SoSoValue news feeds,
 * macroeconomic events, and the agent's own conviction data.
 *
 * Two modes:
 *   1. Template mode (default) — structured narrative using the agent's
 *      regime data, top conviction signals, news headlines, and macro events.
 *      No external API key required.
 *   2. LLM-enhanced mode — feeds the same data into an LLM for richer
 *      commentary. Requires an LLM API key (OPENAI_API_KEY or ANTHROPIC_API_KEY).
 *
 * The narrative is generated once per cycle and surfaced in:
 *   - Telegram cycle summaries (Phase 3)
 *   - /conviction HTTP endpoint (dashboard)
 *   - /status endpoint
 *
 * SoSoValue data sources (via sosovalue-client.ts):
 *   - /news/hot (hot/trending news)
 *   - /news/featured (curated news)
 *   - /macro/events (macroeconomic calendar)
 */

import { sosovalueClient } from "./data-providers.js";
import { flattenMacroEvents } from "./sosovalue-signals.js";
import type { MacroPauseEvent } from "./sosovalue-signals.js";
import type { MarketRegime } from "./conviction-signal.js";

/**
 * A news item normalised for narrative composition. The live SoSoValue
 * responses use snake_case (/news/hot) or camelCase (/news/featured) — we
 * accept either and only require `title` for display.
 */
interface NarrativeNewsItem {
  id: string;
  title: string;
  source?: string;
}

// =============================================================================
// Types
// =============================================================================

export interface MarketNarrative {
  /** One-paragraph summary (2-4 sentences). */
  summary: string;
  /** Optional headline from top news. */
  headline: string | null;
  /** Number of news items used. */
  newsCount: number;
  /** Number of upcoming macro events. */
  macroEventCount: number;
  /** ISO timestamp of generation. */
  generatedAt: string;
}

export interface NarrativeContext {
  regime: MarketRegime | null;
  topSignals: Array<{
    symbol: string;
    score: number;
    rationale: string;
    percentChange7d: number;
  }>;
  portfolioValueUsd: number;
  positionsHeld: number;
  cycle: number;
}

// =============================================================================
// Narrative Builder
// =============================================================================

/**
 * Generate a market narrative from the agent's current state.
 *
 * 1. Fetches hot news + featured news from SoSoValue (up to 5 total)
 * 2. Fetches macro events for today/tomorrow
 * 3. Composes a 2-4 sentence narrative from:
 *    - Market regime (fear level + contrarian score)
 *    - Top news headlines
 *    - Top conviction signals with reasons
 *    - Relevant macro events
 *    - Portfolio health note
 *
 * Returns a structured MarketNarrative. When SoSoValue is unreachable,
 * returns a narrative from regime data alone (graceful degradation).
 */
export async function generateNarrative(
  context: NarrativeContext,
): Promise<MarketNarrative> {
  const [newsItems, macroEvents] = await Promise.all([
    fetchNewsHeadlines(),
    fetchMacroEvents(),
  ]);

  const headline = newsItems[0]?.title ?? null;
  const topNews = newsItems.slice(0, 3);

  return {
    summary: composeSummary(context, topNews, macroEvents),
    headline,
    newsCount: topNews.length,
    macroEventCount: macroEvents.length,
    generatedAt: new Date().toISOString(),
  };
}

// =============================================================================
// News + Macro Fetching
// =============================================================================

/**
 * Fetch up to 5 news items total from SoSoValue (hot + featured), normalising
 * the snake_case (/news/hot) and camelCase (/news/featured) variants into a
 * single shape with a guaranteed title and id. Returns an empty array if
 * SoSoValue is unreachable or returns no usable items.
 */
async function fetchNewsHeadlines(): Promise<NarrativeNewsItem[]> {
  try {
    const [hot, featured] = await Promise.all([
      sosovalueClient.fetchHotNews(3).catch(() => [] as unknown[]),
      sosovalueClient.fetchFeaturedNews(3).catch(() => [] as unknown[]),
    ]);

    const seen = new Set<string>();
    const merged: NarrativeNewsItem[] = [];
    for (const raw of [...hot, ...featured] as Array<Record<string, unknown>>) {
      const title = typeof raw.title === "string" ? raw.title : "";
      if (!title) continue;
      const id = typeof raw.id === "string" || typeof raw.id === "number" ? String(raw.id) : title;
      const key = title.toLowerCase().trim();
      if (seen.has(key)) continue;
      seen.add(key);
      // /news/featured carries `author`; /news/hot has no source field.
      const author = typeof raw.author === "string" ? raw.author : undefined;
      merged.push({ id, title, source: author });
      if (merged.length >= 5) break;
    }
    return merged;
  } catch {
    return [];
  }
}

/**
 * Fetch the macro calendar from SoSoValue and keep high/medium-impact events
 * within the next ~3 days. Impact is keyword-inferred from event names since
 * the live API doesn't carry an impact tier. Returns an empty array if
 * SoSoValue is unreachable.
 */
async function fetchMacroEvents(): Promise<MacroPauseEvent[]> {
  try {
    // The macro endpoint returns the full upcoming calendar in one call; we
    // flatten the daily groups via the shared helper from sosovalue-signals.
    const raw = await sosovalueClient.fetchMacroEvents().catch(() => [] as unknown[]);
    const flat = flattenMacroEvents(raw);

    const now = Date.now();
    const horizon = now + 3 * 86_400_000;
    const upcoming = flat
      .filter((e) => e.impact === "high" || e.impact === "medium")
      .filter((e) => {
        const t = Date.parse(e.date.includes("T") ? e.date : `${e.date}T12:00:00Z`);
        return Number.isFinite(t) && t >= now && t <= horizon;
      });

    return upcoming.slice(0, 3);
  } catch {
    return [];
  }
}

// =============================================================================
// Summary Composition
// =============================================================================

/**
 * Compose a 2-4 sentence market narrative from structured inputs.
 * Template-based — no LLM required.
 */
function composeSummary(
  context: NarrativeContext,
  news: NarrativeNewsItem[],
  macroEvents: MacroPauseEvent[],
): string {
  const parts: string[] = [];

  // ── Sentence 1: Market regime ──
  if (context.regime) {
    parts.push(describeRegime(context.regime));
  }

  // ── Sentence 2: Top conviction signal ──
  if (context.topSignals.length > 0) {
    parts.push(describeTopSignals(context.topSignals));
  }

  // ── Sentence 3: News headline (if available) ──
  if (news.length > 0) {
    parts.push(describeNews(news[0]));
  }

  // ── Sentence 4: Macro events (if any this week) ──
  if (macroEvents.length > 0) {
    parts.push(describeMacroEvents(macroEvents));
  }

  // ── Optional: Portfolio health note ──
  if (context.positionsHeld > 0) {
    parts.push(describePortfolio(context));
  }

  return parts.join(" ");
}

// =============================================================================
// Sentence Builders
// =============================================================================

function describeRegime(regime: MarketRegime): string {
  const fgi = regime.fearGreedIndex;
  const fgiNote = fgi !== null
    ? ` (FGI ${fgi}/100)`
    : "";
  return [
    `Market regime: ${regime.label.toLowerCase()}${fgiNote}.`,
    `Contrarian opportunity scores ${regime.score}/100 — ${regime.score >= 60 ? "favorable entry conditions" : regime.score >= 40 ? "selective entry conditions" : "defensive posture"}.`,
  ].join(" ");
}

function describeTopSignals(
  signals: NarrativeContext["topSignals"],
): string {
  const top = signals[0];
  if (!top) return "";

  const dir = top.percentChange7d < 0
    ? `down ${Math.abs(top.percentChange7d).toFixed(0)}%`
    : `up ${top.percentChange7d.toFixed(0)}%`;

  const scoreDetail = top.score >= 70
    ? "strong contrarian opportunity"
    : top.score >= 58
      ? "notable entry signal"
      : "moderate signal";

  const extraSignals = signals.slice(1, 3);
  const extraText = extraSignals.length > 0
    ? ` Also watching: ${extraSignals.map((s) => `${s.symbol} (${s.score}/100)`).join(", ")}.`
    : "";

  return `Top conviction: ${top.symbol} scores ${top.score}/100 (${dir}, ${scoreDetail}).${extraText}`;
}

function describeNews(item: NarrativeNewsItem): string {
  const source = item.source ? ` [${item.source}]` : "";
  return `Headline: "${item.title}"${source}`;
}

function describeMacroEvents(events: MacroPauseEvent[]): string {
  const lines = events.map((e) => {
    const impact = e.impact === "high" ? "🔴" : e.impact === "medium" ? "🟡" : "";
    return `${impact} ${e.name}`;
  });
  return `Upcoming: ${lines.join(" · ")}.`;
}

function describePortfolio(context: NarrativeContext): string {
  return `Portfolio: $${context.portfolioValueUsd.toFixed(2)} across ${context.positionsHeld} held position(s).`;
}

// =============================================================================
// LLM-Enhanced Mode (Optional)
// =============================================================================

/**
 * Generate a richer narrative using an LLM.
 *
 * Only used when an LLM API key is available (OPENROUTER_API_KEY,
 * OPENAI_API_KEY, or ANTHROPIC_API_KEY). Falls back to template mode otherwise.
 *
 * Provider priority: OpenRouter > OpenAI > Anthropic > template.
 *
 * The prompt is constructed from the same data as the template mode,
 * plus raw news text and macro event details for richer synthesis.
 */
export async function generateLLMNarrative(
  context: NarrativeContext,
): Promise<MarketNarrative | null> {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!openrouterKey && !openaiKey && !anthropicKey) return null;

  const [news, macroEvents] = await Promise.all([
    fetchNewsHeadlines(),
    fetchMacroEvents(),
  ]);

  const prompt = buildLLMPrompt(context, news, macroEvents);

  try {
    if (openrouterKey) {
      return await callOpenRouter(prompt, news, macroEvents);
    }
    if (openaiKey) {
      return await callOpenAI(prompt, news, macroEvents);
    }
    if (anthropicKey) {
      return await callAnthropic(prompt, news, macroEvents);
    }
  } catch {
    // Fall through to template mode on error
  }

  return null;
}

/**
 * Build a structured prompt for LLM market narrative generation.
 */
function buildLLMPrompt(
  context: NarrativeContext,
  news: NarrativeNewsItem[],
  macroEvents: MacroPauseEvent[],
): string {
  const regime = context.regime;
  const signals = context.topSignals.slice(0, 5);

  return [
    "You are a crypto market analyst. Write a concise 2-3 sentence market narrative.",
    "",
    "Context:",
    `- Market regime: ${regime?.label ?? "unknown"} (score: ${regime?.score ?? 50}/100, FGI: ${regime?.fearGreedIndex ?? "N/A"})`,
    ...signals.map((s) => `- ${s.symbol}: ${s.score}/100 conviction, ${s.rationale}`),
    ...news.map((n) => `- News: ${n.title}${n.source ? ` (${n.source})` : ""}`),
    ...macroEvents.map((e) => `- Macro: ${e.name} (${e.date}, impact: ${e.impact})`),
    "",
    "Write a natural, insight-driven narrative that explains what's happening in markets right now.",
  ].join("\n");
}

/**
 * Call OpenRouter's OpenAI-compatible API for narrative generation.
 * OpenRouter is the preferred provider — routes to any model via a single key.
 */
async function callOpenRouter(
  prompt: string,
  news: NarrativeNewsItem[],
  macroEvents: MacroPauseEvent[],
): Promise<MarketNarrative> {
  const model = process.env.OPENROUTER_NARRATIVE_MODEL || "openrouter/auto";

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://earlynotwrong.vercel.app",
      "X-Title": "Early Not Wrong - Market Narrative",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(45000),
  });

  if (!response.ok) throw new Error(`OpenRouter API error: ${response.status}`);

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content?.trim() ?? "";

  return {
    summary: content,
    headline: news[0]?.title ?? null,
    newsCount: news.length,
    macroEventCount: macroEvents.length,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Call OpenAI's chat completions API for narrative generation.
 */
async function callOpenAI(
  prompt: string,
  news: NarrativeNewsItem[],
  macroEvents: MacroPauseEvent[],
): Promise<MarketNarrative> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content?.trim() ?? "";

  return {
    summary: content,
    headline: news[0]?.title ?? null,
    newsCount: news.length,
    macroEventCount: macroEvents.length,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Call Anthropic's messages API for narrative generation.
 */
async function callAnthropic(
  prompt: string,
  news: NarrativeNewsItem[],
  macroEvents: MacroPauseEvent[],
): Promise<MarketNarrative> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-3-haiku-20240307",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`);

  const json = (await response.json()) as {
    content?: Array<{ text?: string }>;
  };
  const content = json.content?.[0]?.text?.trim() ?? "";

  return {
    summary: content,
    headline: news[0]?.title ?? null,
    newsCount: news.length,
    macroEventCount: macroEvents.length,
    generatedAt: new Date().toISOString(),
  };
}
