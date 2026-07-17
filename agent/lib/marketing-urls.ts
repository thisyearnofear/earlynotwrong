/**
 * Traffic attribution for agent-side outbound links (Telegram, MCP teaser).
 * Keep in sync with src/lib/marketing-urls.ts.
 */

export const CROO_STORE_BASE =
  "https://agent.croo.network/agents/90dd0e5a-a551-4dfb-aa64-b3c0274c2205";

export const DASHBOARD_HIRE_BASE = "https://earlynotwrong.vercel.app/agent";

export type UtmSource =
  | "dashboard"
  | "landing"
  | "telegram"
  | "proof-ladder"
  | "hire-cta"
  | "mcp-teaser"
  | "analyzer"
  | "integration-hub";

export interface UtmParams {
  source: UtmSource;
  medium: string;
  campaign?: string;
  content?: string;
}

export function withUtm(url: string, params: UtmParams): string {
  const parsed = new URL(url);
  parsed.searchParams.set("utm_source", params.source);
  parsed.searchParams.set("utm_medium", params.medium);
  if (params.campaign) parsed.searchParams.set("utm_campaign", params.campaign);
  if (params.content) parsed.searchParams.set("utm_content", params.content);
  return parsed.toString();
}

export function crooStoreUrl(source: UtmSource, content?: string): string {
  return withUtm(CROO_STORE_BASE, {
    source,
    medium: source === "telegram" ? "telegram" : "web",
    campaign: "signals-live",
    content,
  });
}

export function dashboardHireUrl(source: UtmSource): string {
  const parsed = new URL(DASHBOARD_HIRE_BASE);
  parsed.hash = "hire";
  parsed.searchParams.set("utm_source", source);
  parsed.searchParams.set("utm_medium", source === "telegram" ? "telegram" : "web");
  parsed.searchParams.set("utm_campaign", "signals-live");
  return parsed.toString();
}
