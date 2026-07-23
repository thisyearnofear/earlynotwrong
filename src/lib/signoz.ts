/**
 * SigNoz URL helpers for the /agent observability panel.
 * Set NEXT_PUBLIC_SIGNOZ_URL (e.g. http://localhost:8080) on the web app.
 */

const raw = process.env.NEXT_PUBLIC_SIGNOZ_URL?.replace(/\/$/, "") ?? "";

/** Public SigNoz base URL, or empty when unset. */
export function getSignozUrl(): string | null {
  return raw || null;
}

/** Deep link to a trace waterfall in SigNoz. */
export function signozTraceUrl(traceId: string): string | null {
  const base = getSignozUrl();
  if (!base || !traceId) return null;
  return `${base}/trace/${traceId}`;
}

/** SigNoz home / dashboards entry point. */
export function signozHomeUrl(): string | null {
  return getSignozUrl();
}

export function formatCycleDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}
