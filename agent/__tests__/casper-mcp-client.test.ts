import { describe, it, expect, afterEach, vi } from "vitest";
import {
  fetchCasperDexTokens,
  fetchCasperDexPairs,
  fetchCsprUsdcQuote,
  fetchCasperNetworkStatus,
  fetchCasperEcosystemContext,
  summarizeCasperContextForJury,
} from "../lib/casper-mcp-client.js";

// =============================================================================
// Helpers — build MCP JSON-RPC responses wrapped in the standard MCP envelope
// =============================================================================

function mcpResponse(data: unknown): Response {
  const body = JSON.stringify({
    result: {
      content: [{ type: "text", text: JSON.stringify(data) }],
    },
  });
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => body,
    json: async () => JSON.parse(body),
  } as Response;
}

/** MCP initialize response — returns session ID in headers. */
function mcpInitResponse(sessionId = "test-session-id"): Response {
  const body = JSON.stringify({
    result: {
      protocolVersion: "2024-11-05",
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: "cspr-trade", version: "0.7.0" },
    },
    jsonrpc: "2.0",
    id: 1,
  });
  return {
    ok: true,
    status: 200,
    headers: new Headers({
      "content-type": "text/event-stream",
      "mcp-session-id": sessionId,
    }),
    text: async () => `event: message\ndata: ${body}\n`,
    json: async () => JSON.parse(body),
  } as Response;
}

/** Notification response — empty body, just an ack. */
function mcpNotificationResponse(): Response {
  return {
    ok: true,
    status: 202,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => "",
    json: async () => ({}),
  } as Response;
}

/** Casper RPC response — plain JSON-RPC, no MCP envelope. */
function rpcResponse(result: unknown): Response {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result });
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => body,
    json: async () => JSON.parse(body),
  } as Response;
}

/**
 * Mock fetch that handles the MCP session protocol:
 *   - initialize → returns session ID in headers
 *   - notifications/initialized → empty ack
 *   - tools/call → routes to the handler based on tool name
 * Also handles direct Casper RPC calls (chain_get_block, chain_get_era_info_*).
 */
function makeSessionMock(
  toolHandlers: Record<string, (args: any) => unknown>,
  rpcHandlers: Record<string, () => unknown> = {},
): typeof fetch {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    const method = body?.method;

    // MCP session protocol
    if (method === "initialize") return mcpInitResponse();
    if (method === "notifications/initialized") return mcpNotificationResponse();

    // MCP tool call
    if (method === "tools/call") {
      const toolName = body?.params?.name;
      const handler = toolHandlers[toolName];
      if (!handler) throw new Error(`No mock for tool: ${toolName}`);
      return mcpResponse(handler(body?.params?.arguments));
    }

    // Direct Casper RPC
    if (method && rpcHandlers[method]) {
      return rpcResponse(rpcHandlers[method]());
    }

    throw new Error(`Unhandled fetch method: ${method}`);
  }) as any;
}

// =============================================================================
// Tests
// =============================================================================

describe("Casper MCP Client", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── fetchCasperDexTokens ─────────────────────────────────────────────────

  describe("fetchCasperDexTokens", () => {
    it("parses token list from CSPR.trade MCP (session-aware)", async () => {
      globalThis.fetch = makeSessionMock({
        get_tokens: () => ({
          data: [
            { symbol: "CSPR", packageHash: "cspr-pkg-1", decimals: 9, fiatPrice: 0.0123 },
            { symbol: "USDC", packageHash: "usdc-pkg-2", decimals: 6, fiatPrice: 1.0 },
          ],
        }),
      });

      const tokens = await fetchCasperDexTokens();
      expect(tokens).toHaveLength(2);
      expect(tokens[0].symbol).toBe("CSPR");
      expect(tokens[0].priceUsd).toBe(0.0123);
      expect(tokens[0].address).toBe("cspr-pkg-1");
      expect(tokens[1].symbol).toBe("USDC");
    });

    it("handles flat array response (no data wrapper)", async () => {
      globalThis.fetch = makeSessionMock({
        get_tokens: () => [
          { symbol: "CSPR", packageHash: "pkg-1", decimals: 9, fiatPrice: 0.01 },
        ],
      });

      const tokens = await fetchCasperDexTokens();
      expect(tokens).toHaveLength(1);
      expect(tokens[0].symbol).toBe("CSPR");
    });

    it("returns empty array when MCP server is unreachable", async () => {
      globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error("Network error"));
      const tokens = await fetchCasperDexTokens();
      expect(tokens).toEqual([]);
    });

    it("filters out tokens without symbol or address", async () => {
      globalThis.fetch = makeSessionMock({
        get_tokens: () => ({
          data: [
            { symbol: "CSPR", packageHash: "hash-1", decimals: 9 },
            { symbol: "", packageHash: "hash-2" },
            { symbol: "BAD", packageHash: "" },
          ],
        }),
      });

      const tokens = await fetchCasperDexTokens();
      expect(tokens).toHaveLength(1);
      expect(tokens[0].symbol).toBe("CSPR");
    });
  });

  // ── fetchCasperDexPairs ──────────────────────────────────────────────────

  describe("fetchCasperDexPairs", () => {
    it("parses pair list from CSPR.trade MCP", async () => {
      globalThis.fetch = makeSessionMock({
        get_pairs: () => ({
          data: [
            {
              contractPackageHash: "pair-1",
              token0: { symbol: "WCSPR", packageHash: "hash-1" },
              token1: { symbol: "USDC", packageHash: "hash-2" },
              reserve0: "5000000000000",
              reserve1: "60000000",
            },
          ],
        }),
      });

      const pairs = await fetchCasperDexPairs(10);
      expect(pairs).toHaveLength(1);
      expect(pairs[0].token0.symbol).toBe("WCSPR");
      expect(pairs[0].pairAddress).toBe("pair-1");
    });
  });

  // ── fetchCsprUsdcQuote ───────────────────────────────────────────────────

  describe("fetchCsprUsdcQuote", () => {
    it("derives CSPR price from pair reserves", async () => {
      globalThis.fetch = makeSessionMock({
        get_pairs: () => ({
          data: [
            {
              contractPackageHash: "pair-1",
              token0: { symbol: "WCSPR", packageHash: "hash-1" },
              token1: { symbol: "USDC", packageHash: "hash-2" },
              reserve0: "5000000000000", // 5000 CSPR (9 decimals)
              reserve1: "60000000", // 60 USDC (6 decimals)
            },
          ],
        }),
        get_tokens: () => ({ data: [] }),
      });

      const quote = await fetchCsprUsdcQuote();
      expect(quote).not.toBeNull();
      expect(quote!.priceUsd).toBeCloseTo(0.012, 4); // 60 USDC / 5000 CSPR
    });

    it("falls back to token price when no pair found", async () => {
      globalThis.fetch = makeSessionMock({
        get_pairs: () => ({ data: [] }),
        get_tokens: () => ({
          data: [
            { symbol: "CSPR", packageHash: "hash-1", decimals: 9, fiatPrice: 0.015 },
          ],
        }),
      });

      const quote = await fetchCsprUsdcQuote();
      expect(quote).not.toBeNull();
      expect(quote!.priceUsd).toBe(0.015);
    });

    it("returns null when no price data available", async () => {
      globalThis.fetch = makeSessionMock({
        get_pairs: () => ({ data: [] }),
        get_tokens: () => ({ data: [] }),
      });

      const quote = await fetchCsprUsdcQuote();
      expect(quote).toBeNull();
    });
  });

  // ── fetchCasperNetworkStatus ─────────────────────────────────────────────

  describe("fetchCasperNetworkStatus", () => {
    it("parses network status from Casper RPC", async () => {
      globalThis.fetch = makeSessionMock({}, {
        "chain_get_block": () => ({
          block: {
            Version2: {
              header: {
                era_id: 23040,
                height: 8590465,
                timestamp: "2026-07-22T18:22:07.509Z",
              },
            },
          },
        }),
        "chain_get_era_info_by_switch_block": () => ({
          era_summary: {
            era_id: 23039,
            stored_value: {
              EraInfo: {
                seigniorage_allocations: [
                  { Validator: { validator_public_key: "key1", amount: "400000000000" } },
                  { Validator: { validator_public_key: "key2", amount: "600000000000" } },
                  { Delegator: { delegator_public_key: "key3", amount: "1000000000" } },
                ],
              },
            },
          },
        }),
      });

      const status = await fetchCasperNetworkStatus();
      expect(status).not.toBeNull();
      expect(status!.eraId).toBe(23040);
      expect(status!.blockHeight).toBe(8590465);
      expect(status!.activeValidators).toBe(2); // 2 Validator allocs, 1 Delegator excluded
      expect(status!.totalStakeCspr).toBe(1000); // (400B + 600B) / 1e9 = 1000 CSPR
    });

    it("returns null when RPC is unreachable", async () => {
      globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error("Network error"));
      const status = await fetchCasperNetworkStatus();
      expect(status).toBeNull();
    });

    it("returns partial data when era info fails but block succeeds", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          return rpcResponse({
            block: {
              Version2: {
                header: { era_id: 100, height: 999, timestamp: "2026-07-22T00:00:00Z" },
              },
            },
          });
        }
        throw new Error("era info failed");
      }) as any;

      const status = await fetchCasperNetworkStatus();
      expect(status).not.toBeNull();
      expect(status!.eraId).toBe(100);
      expect(status!.blockHeight).toBe(999);
      expect(status!.activeValidators).toBe(0);
    });
  });

  // ── fetchCasperEcosystemContext ──────────────────────────────────────────

  describe("fetchCasperEcosystemContext", () => {
    it("aggregates data from MCP + RPC", async () => {
      globalThis.fetch = makeSessionMock(
        {
          get_tokens: () => ({
            data: [
              { symbol: "CSPR", packageHash: "hash-1", decimals: 9, fiatPrice: 0.012 },
            ],
          }),
          get_pairs: () => ({
            data: [
              {
                contractPackageHash: "pair-1",
                token0: { symbol: "WCSPR", packageHash: "hash-1" },
                token1: { symbol: "USDC", packageHash: "hash-2" },
                reserve0: "5000000000000",
                reserve1: "60000000",
              },
            ],
          }),
        },
        {
          "chain_get_block": () => ({
            block: { Version2: { header: { era_id: 5420, height: 123456 } } },
          }),
          "chain_get_era_info_by_switch_block": () => ({
            era_summary: {
              era_id: 5419,
              stored_value: {
                EraInfo: {
                  seigniorage_allocations: Array.from({ length: 100 }, (_, i) => ({
                    Validator: { validator_public_key: `key-${i}`, amount: "40000000000" },
                  })),
                },
              },
            },
          }),
        },
      );

      const ctx = await fetchCasperEcosystemContext();

      expect(ctx.dexMcpReachable).toBe(true);
      expect(ctx.chainMcpReachable).toBe(true);
      expect(ctx.csprPriceUsd).not.toBeNull();
      expect(ctx.networkStatus).not.toBeNull();
      expect(ctx.networkStatus!.eraId).toBe(5420);
      expect(ctx.networkStatus!.activeValidators).toBe(100);
      expect(ctx.topDexTokens).toHaveLength(1);
    });

    it("degrades gracefully when all sources are unreachable", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const ctx = await fetchCasperEcosystemContext();

      expect(ctx.dexMcpReachable).toBe(false);
      expect(ctx.chainMcpReachable).toBe(false);
      expect(ctx.csprPriceUsd).toBeNull();
      expect(ctx.networkStatus).toBeNull();
      expect(ctx.topDexTokens).toEqual([]);
    });
  });

  // ── summarizeCasperContextForJury ────────────────────────────────────────

  describe("summarizeCasperContextForJury", () => {
    it("produces a readable summary with all data present", () => {
      const ctx = {
        dexMcpReachable: true,
        chainMcpReachable: true,
        csprPriceUsd: 0.0123,
        csprUsdcLiquidityUsd: 50000,
        topDexTokens: [
          { symbol: "CSPR", address: "h1", decimals: 9, priceUsd: 0.0123 },
          { symbol: "USDC", address: "h2", decimals: 6, priceUsd: 1.0 },
        ],
        networkStatus: {
          eraId: 5420,
          activeValidators: 100,
          totalStakeCspr: 4_000_000_000,
          circulatingSupplyCspr: 12_000_000_000,
          blockHeight: 123456,
        },
        fetchedAt: new Date().toISOString(),
      };

      const summary = summarizeCasperContextForJury(ctx);
      expect(summary).toContain("CSPR price: $0.0123");
      expect(summary).toContain("liquidity: $50.0K");
      expect(summary).toContain("era 5420");
      expect(summary).toContain("100 validators");
      expect(summary).toContain("Casper DEX tokens: CSPR");
    });

    it("returns unreachable message when no data available", () => {
      const ctx = {
        dexMcpReachable: false,
        chainMcpReachable: false,
        csprPriceUsd: null,
        csprUsdcLiquidityUsd: null,
        topDexTokens: [],
        networkStatus: null,
        fetchedAt: new Date().toISOString(),
      };

      const summary = summarizeCasperContextForJury(ctx);
      expect(summary).toContain("unreachable");
    });

    it("handles partial data (only DEX, no chain status)", () => {
      const ctx = {
        dexMcpReachable: true,
        chainMcpReachable: false,
        csprPriceUsd: 0.012,
        csprUsdcLiquidityUsd: null,
        topDexTokens: [
          { symbol: "CSPR", address: "h1", decimals: 9, priceUsd: 0.012 },
        ],
        networkStatus: null,
        fetchedAt: new Date().toISOString(),
      };

      const summary = summarizeCasperContextForJury(ctx);
      expect(summary).toContain("CSPR price: $0.0120");
      expect(summary).not.toContain("era");
      expect(summary).toContain("Casper DEX tokens: CSPR");
    });
  });
});
