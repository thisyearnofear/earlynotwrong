/** Traffic attribution + canonical outbound links for hire CTAs. */

export const GITHUB_REPO =
  "https://github.com/thisyearnofear/earlynotwrong";

export const CROO_STORE_BASE =
  "https://agent.croo.network/agents/90dd0e5a-a551-4dfb-aa64-b3c0274c2205";

export const DASHBOARD_HIRE_BASE = "https://earlynotwrong.vercel.app/agent";

export const MCP_ENDPOINT = "http://144.202.117.160:31777/mcp";

export const SIGNALS_SCHEMA_URL =
  "https://earlynotwrong.vercel.app/schemas/signals-live-v1.1.schema.json";

export const SIGNALS_EXAMPLE_URL =
  "https://earlynotwrong.vercel.app/samples/signals-live-v1.1.example.json";

export const DOCS_MCP_INTEGRATION = `${GITHUB_REPO}/blob/main/docs/MCP_INTEGRATION.md`;
export const DOCS_CROO_INTEGRATION = `${GITHUB_REPO}/blob/main/docs/CROO_INTEGRATION.md`;
export const DOCS_CROO_STORE_LISTING = `${GITHUB_REPO}/blob/main/docs/croo-store-listing.md`;
export const CROO_REQUESTER_PATH = `${GITHUB_REPO}/tree/main/examples/croo-requester`;

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

/** CROO Store listing with attribution (default campaign: signals-live). */
export function crooStoreUrl(
  source: UtmSource,
  content?: string,
): string {
  return withUtm(CROO_STORE_BASE, {
    source,
    medium: source === "telegram" ? "telegram" : "web",
    campaign: "signals-live",
    content,
  });
}

/** Public dashboard hire section — preserves #hire hash with query params. */
export function dashboardHireUrl(source: UtmSource): string {
  const parsed = new URL(DASHBOARD_HIRE_BASE);
  parsed.hash = "hire";
  parsed.searchParams.set("utm_source", source);
  parsed.searchParams.set("utm_medium", source === "telegram" ? "telegram" : "web");
  parsed.searchParams.set("utm_campaign", "signals-live");
  return parsed.toString();
}
