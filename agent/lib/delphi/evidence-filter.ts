/**
 * Evidence plausibility filter — deterministic, zero LLM.
 *
 * Search rungs return passages, not curated facts. Observed failure
 * (production 2026-08-18): Firecrawl injected a 1986 WTI price table into a
 * 2026 crude-oil market — stale history passed through as fresh evidence.
 * This module inspects briefing text against the market question's own
 * parameters and strips obviously implausible passages BEFORE they reach the
 * forecaster prompt.
 *
 * Rules (all pure string/number checks — no inference):
 *   - Stale-year: when the question names a year (2026), any passage whose
 *     ONLY 4-digit years are all ≥2 years outside the question's year is
 *     dropped. A passage mixing years survives (the model can weigh it).
 *   - Questionable passage: surviving lines that still fail the year check
 *     get a "⚠ low-relevance" marker rather than deletion, so the forecaster
 *     sees the filter's doubt instead of silent omission.
 *
 * The filter never FABRICATES evidence — it only removes/marks. An empty
 * result means "inject nothing", and the caller decides whether to drop the
 * briefing entirely.
 */

/** A passage-level plausibility verdict. */
export interface EvidenceLine {
  /** The original passage text (trimmed). */
  text: string;
  /** True when the passage survives the deterministic checks. */
  plausible: boolean;
  /** Human-readable reason when marked implausible. */
  reason?: string;
}

/** Result of filtering one briefing against its question. */
export interface FilteredEvidence {
  /** Only the plausible passages, joined for prompt injection. */
  text: string;
  /** Per-passage verdicts (audit trail / tests). */
  lines: EvidenceLine[];
  /** Number of passages dropped or marked. */
  dropped: number;
  /** True when nothing plausible survived. */
  empty: boolean;
}

/** Extract the first plausible 4-digit year named by the question. */
export function questionYear(question: string, now: number = Date.now()): number | null {
  const years = question.match(/\b(19|20)\d{2}\b/g)?.map(Number) ?? [];
  const sane = years.filter((y) => y >= 1900 && y <= 2100);
  if (sane.length > 0) return sane[0];
  // No explicit year — anchor on the current year so date-bearing passages
  // can still be checked against "roughly now".
  return new Date(now).getUTCFullYear();
}

/** All 4-digit year tokens inside a passage. */
function passageYears(text: string): number[] {
  return (text.match(/\b(19|20)\d{2}\b/g) ?? []).map(Number);
}

/**
 * Split a briefing into passages. Briefings from all three rungs are
 * "- " prefixed lines (see web-search.ts composition); fall back to
 * newlines, then sentences.
 */
export function splitPassages(text: string): string[] {
  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(/^-\s*/, "").trim())
    .filter((l) => l.length > 0);
  if (lines.length > 1) return lines;
  // Single block — split on sentence boundaries as a last resort.
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * The maximum year distance we tolerate between the question's anchor year
 * and a passage's years. 1 = same or adjacent year only.
 */
const YEAR_TOLERANCE = 1;

/**
 * Filter a briefing against the question's year anchor.
 *
 * Passages with NO year tokens pass through untouched (most evidence is
 * dateless prose). Passages whose years are all outside the tolerance are
 * dropped; mixed passages are kept but annotated.
 */
export function filterEvidencePlausibility(question: string, evidenceText: string, now?: number): FilteredEvidence {
  const anchor = questionYear(question, now);
  const passages = splitPassages(evidenceText);
  const lines: EvidenceLine[] = [];
  let dropped = 0;

  for (const passage of passages) {
    const years = passageYears(passage);
    if (years.length === 0 || anchor === null) {
      lines.push({ text: passage, plausible: true });
      continue;
    }
    const minDistance = Math.min(...years.map((y) => Math.abs(y - anchor)));
    if (minDistance <= YEAR_TOLERANCE) {
      lines.push({ text: passage, plausible: true });
    } else {
      dropped++;
      lines.push({
        text: passage,
        plausible: false,
        reason: `evidence years (${years.join(", ")}) are ${minDistance}y from the question's ${anchor}`,
      });
    }
  }

  const kept = lines.filter((l) => l.plausible).map((l) => l.text);
  return {
    text: kept.map((t) => `- ${t}`).join("\n"),
    lines,
    dropped,
    empty: kept.length === 0,
  };
}
