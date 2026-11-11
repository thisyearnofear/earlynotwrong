/**
 * RYO-CHAN research client — RYO-CHAN Hackathon 2026.
 *
 * Two transports, one interface:
 *   - REST  : https://app-ryochan.com/api/<tool-path>   (Bearer <ryo_mcp_key>)
 *   - MCP   : https://app-ryochan.com/api/mcp           (JSON-RPC, same Bearer)
 *
 * Auth: `Authorization: Bearer ryo_mcp_...` (RYO_MCP_KEY env).
 */

const API_BASE = process.env.RYO_API_BASE ?? 'https://app-ryochan.com/api';

export interface ToolResult {
  tool: string;
  transport: 'rest' | 'mcp';
  ok: boolean;
  latencyMs: number;
  data: unknown;
  error?: string;
}

const REST_PATHS: Record<string, (args: Record<string, unknown>) => string> = {
  market_overview: () => '/market/overview',
  market_intelligence: () => '/market/intelligence',
  scan_market: (a) => `/market/scan${a.chain ? `?chain=${a.chain}` : ''}`,
  supported_tokens: () => '/market/intelligence',
  analyze_token: (a) => `/market/token/${String(a.symbol ?? a.token ?? '').toUpperCase()}`,
  check_safety: (a) => `/market/token/${String(a.symbol ?? a.token ?? '').toUpperCase()}`,
};

export class RyoClient {
  private rpcId = 0;
  private mcpSession?: string;
  private readonly key: string;

  constructor(key: string = process.env.RYO_MCP_KEY ?? '') {
    this.key = key;
    if (!key) throw new Error('RYO_MCP_KEY is required');
  }

  async tool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    const t0 = Date.now();
    const restPath = REST_PATHS[name]?.(args);
    if (restPath) {
      try {
        const res = await fetch(`${API_BASE}${restPath}`, {
          headers: { Authorization: `Bearer ${this.key}` },
          signal: AbortSignal.timeout(20_000),
        });
        if (res.status !== 404) {
          const body = await res.json().catch(() => null);
          return { tool: name, transport: 'rest', ok: res.ok, latencyMs: Date.now() - t0, data: body, error: res.ok ? undefined : `HTTP ${res.status}` };
        }
      } catch (e) {
        return { tool: name, transport: 'rest', ok: false, latencyMs: Date.now() - t0, data: null, error: String(e) };
      }
    }
    return this.mcpTool(name, args, t0);
  }

  private async mcpTool(name: string, args: Record<string, unknown>, t0: number): Promise<ToolResult> {
    try {
      if (!this.mcpSession) await this.mcpInit();
      const res = await fetch(`${API_BASE}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...(this.mcpSession ? { 'Mcp-Session-Id': this.mcpSession } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++this.rpcId, method: 'tools/call', params: { name, arguments: args } }),
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text();
      return { tool: name, transport: 'mcp', ok: res.ok, latencyMs: Date.now() - t0, data: parseSseOrJson(text), error: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (e) {
      return { tool: name, transport: 'mcp', ok: false, latencyMs: Date.now() - t0, data: null, error: String(e) };
    }
  }

  private async mcpInit(): Promise<void> {
    const res = await fetch(`${API_BASE}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++this.rpcId,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'early-not-wrong-ryo-agent', version: '0.1.0' } },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    this.mcpSession = res.headers.get('mcp-session-id') ?? undefined;
    await fetch(`${API_BASE}/mcp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(this.mcpSession ? { 'Mcp-Session-Id': this.mcpSession } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    }).catch(() => undefined);
  }
}

function parseSseOrJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const dataLines = text.split('\n').filter((l) => l.startsWith('data:'));
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
