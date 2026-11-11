/**
 * RYO-CHAN research client — RYO-CHAN Hackathon 2026.
 *
 * Implements the published Builder contract (docs/MCP-Builder-Guide.md):
 *   - Published REST : POST {RYO_MCP_URL}/tools/{tool}/call  (Bearer ryo_mcp_…)
 *                      → public envelope {schema_version, tool, status,
 *                        data_mode, as_of, request, data, summary,
 *                        availability, warnings}
 *   - MCP JSON-RPC   : POST {RYO_MCP_URL}                  (tools/call)
 *   - Internal REST  : GET  {RYO_API_BASE}/market/*         (app session JWT —
 *                      fallback for surfaces the published six don't cover,
 *                      e.g. OHLCV klines; every internal read is labeled)
 *
 * Contract rules honored:
 *   - `status` ok|partial|unavailable is surfaced to callers verbatim —
 *     never collapsed to a boolean and never converted into fake data.
 *   - 429/503 retry with backoff+jitter, Retry-After respected.
 *   - The tool catalog (GET /tools) and whoami are first-class methods.
 */

const MCP_BASE = (process.env.RYO_MCP_URL ?? "https://app-ryochan.com/api/mcp").replace(/\/$/, "");
const API_BASE = (process.env.RYO_API_BASE ?? "https://app-ryochan.com/api").replace(/\/$/, "");

export type ToolStatus = "ok" | "partial" | "unavailable" | "error" | "unknown";

export interface ToolEnvelope {
  schema_version?: string;
  tool?: string;
  status?: ToolStatus;
  data_mode?: string;
  as_of?: string;
  request?: Record<string, unknown>;
  data?: unknown;
  summary?: unknown;
  availability?: Record<string, unknown>;
  warnings?: unknown;
}

export interface ToolResult {
  tool: string;
  /** 'rest' = published tools/call · 'internal' = app REST (labeled) · 'mcp' = JSON-RPC */
  transport: "rest" | "internal" | "mcp";
  ok: boolean;
  latencyMs: number;
  /** Envelope status, verbatim — 'ok' | 'partial' | 'unavailable'. */
  status: ToolStatus;
  /** Envelope `data` — the only field application logic should read. */
  data: unknown;
  summary: unknown;
  availability: unknown;
  warnings: unknown;
  /** Full envelope for evidence digests (published transport only). */
  envelope?: ToolEnvelope;
  error?: string;
}

const INTERNAL_PATHS: Record<string, (args: Record<string, unknown>) => string> = {
  market_overview: () => "/market/overview",
  market_intelligence: () => "/market/intelligence",
  scan_market: (a) => `/market/scan${a.chain ? `?chain=${encodeURIComponent(String(a.chain))}` : ""}`,
  analyze_token: (a) => `/market/token/${encodeURIComponent(String(a.symbol ?? "").toUpperCase())}`,
  deep_analysis: (a) => `/market/token/${encodeURIComponent(String(a.symbol ?? "").toUpperCase())}`,
  check_safety: (a) => `/market/token/${encodeURIComponent(String(a.symbol ?? "").toUpperCase())}`,
  ohlcv: (a) => `/market/ohlcv/${encodeURIComponent(String(a.symbol ?? "").toUpperCase())}${a.days ? `?days=${a.days}` : ""}`,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms: number) => ms + Math.floor(Math.random() * 250);

export class RyoClient {
  private rpcId = 0;
  private readonly key: string;

  constructor(key: string = process.env.RYO_MCP_KEY ?? "") {
    this.key = key;
    if (!key) throw new Error("RYO_MCP_KEY is required");
  }

  /** Unauthenticated health check — per the published guide. */
  async health(): Promise<{ ok: boolean; tools?: number }> {
    try {
      const res = await fetch(`${MCP_BASE}/health`, { signal: AbortSignal.timeout(10_000) });
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      return { ok: res.ok && body?.status === "ok", tools: typeof body?.tools === "number" ? body.tools : undefined };
    } catch {
      return { ok: false };
    }
  }

  /** GET /whoami — key scope, expiry, quota. No tool-call quota consumed. */
  async whoami(): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch(`${MCP_BASE}/whoami`, {
        headers: { Authorization: `Bearer ${this.key}` },
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  /** GET /tools — the authoritative live catalog. */
  async catalog(): Promise<unknown[]> {
    try {
      const res = await fetch(`${MCP_BASE}/tools`, {
        headers: { Authorization: `Bearer ${this.key}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return [];
      const body = await res.json();
      return Array.isArray(body) ? body : Array.isArray((body as Record<string, unknown>)?.tools) ? ((body as Record<string, unknown>).tools as unknown[]) : [];
    } catch {
      return [];
    }
  }

  /** Call a research tool. Published REST first, then internal REST
   *  (when the published route 401/404s — e.g. a session JWT), then MCP. */
  async tool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    const t0 = Date.now();
    const published = await this.publishedCall(name, args, t0);
    if (published) return published;
    const internal = await this.internalCall(name, args, t0);
    if (internal) return internal;
    return this.mcpCall(name, args, t0);
  }

  // ─── Published contract: POST {MCP_BASE}/tools/{tool}/call ────────────────

  private async publishedCall(name: string, args: Record<string, unknown>, t0: number): Promise<ToolResult | null> {
    const url = `${MCP_BASE}/tools/${encodeURIComponent(name)}/call`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
          body: JSON.stringify(args),
          signal: AbortSignal.timeout(45_000),
        });
        if (res.status === 401 || res.status === 403) return null; // try internal transport
        if (res.status === 404) return null; // tool not on the published surface
        if (res.status === 429 || res.status === 503) {
          const retryAfter = Number(res.headers.get("retry-after") ?? 0);
          await sleep(jitter(retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt));
          continue;
        }
        const body = await res.json().catch(() => null) as Record<string, unknown> | null;
        const envelope = (body?.result ?? body) as ToolEnvelope | null;
        const status = (envelope?.status ?? "unknown") as ToolStatus;
        return {
          tool: name,
          transport: "rest",
          ok: res.ok && status !== "unavailable" && status !== "error",
          latencyMs: Date.now() - t0,
          status,
          data: envelope?.data ?? null,
          summary: envelope?.summary ?? null,
          availability: envelope?.availability ?? null,
          warnings: envelope?.warnings ?? null,
          envelope: envelope ?? undefined,
          error: res.ok ? undefined : `HTTP ${res.status}`,
        };
      } catch (e) {
        if (attempt === 2) {
          return { tool: name, transport: "rest", ok: false, latencyMs: Date.now() - t0, status: "error", data: null, summary: null, availability: null, warnings: null, error: String(e) };
        }
        await sleep(jitter(500 * 2 ** attempt));
      }
    }
    return null;
  }

  // ─── Internal app REST (session JWT or unpublished routes) ────────────────

  private async internalCall(name: string, args: Record<string, unknown>, t0: number): Promise<ToolResult | null> {
    const path = INTERNAL_PATHS[name]?.(args);
    if (!path) return null;
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${this.key}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 404 || res.status === 401 || res.status === 403) return null;
      const body = await res.json().catch(() => null);
      return {
        tool: name,
        transport: "internal",
        ok: res.ok,
        latencyMs: Date.now() - t0,
        status: res.ok ? "ok" : "unavailable",
        data: body,
        summary: null,
        availability: null,
        warnings: ["internal-route — outside the published six-tool surface"],
        error: res.ok ? undefined : `HTTP ${res.status}`,
      };
    } catch {
      return null;
    }
  }

  // ─── MCP JSON-RPC fallback ─────────────────────────────────────────────────

  private async mcpCall(name: string, args: Record<string, unknown>, t0: number): Promise<ToolResult> {
    try {
      const res = await fetch(MCP_BASE, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.key}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++this.rpcId, method: "tools/call", params: { name, arguments: args } }),
        signal: AbortSignal.timeout(45_000),
      });
      const parsed = parseSseOrJson(await res.text()) as {
        result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean };
        error?: { message?: string };
      } | null;
      const isError = parsed?.result?.isError === true || !res.ok;
      const text = parsed?.result?.content?.find((c) => c.type === "text")?.text;
      let envelope: ToolEnvelope | null = null;
      if (text) { try { envelope = JSON.parse(text) as ToolEnvelope; } catch { /* raw text */ } }
      const status = (envelope?.status ?? (isError ? "error" : "unknown")) as ToolStatus;
      return {
        tool: name,
        transport: "mcp",
        ok: !isError && status !== "unavailable",
        latencyMs: Date.now() - t0,
        status,
        data: envelope?.data ?? (text ?? parsed ?? null),
        summary: envelope?.summary ?? null,
        availability: envelope?.availability ?? null,
        warnings: envelope?.warnings ?? null,
        envelope: envelope ?? undefined,
        error: isError ? (parsed?.error?.message ?? text ?? `HTTP ${res.status}`) : undefined,
      };
    } catch (e) {
      return { tool: name, transport: "mcp", ok: false, latencyMs: Date.now() - t0, status: "error", data: null, summary: null, availability: null, warnings: null, error: String(e) };
    }
  }
}

function parseSseOrJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const dataLines = text.split("\n").filter((l) => l.startsWith("data:"));
    if (dataLines.length) {
      try {
        return JSON.parse(dataLines[dataLines.length - 1].slice(5).trim());
      } catch {
        return { raw: text.slice(0, 2000) };
      }
    }
    return { raw: text.slice(0, 2000) };
  }
}
