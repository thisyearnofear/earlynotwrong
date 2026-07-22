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
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => body,
    json: async () => JSON.parse(body),
  } as Response;
}

/** Mock fetch that routes based on the tool name in the JSON-RPC body. */
function makeRoutingMock(handlers: Record<string, (body: any) => unknown>): typeof fetch {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    const toolName = body?.params?.name;
    const handler = handlers[toolName];
    if (!handler) throw new Error(`No mock for tool: ${toolName}`);
    return mcpResponse(handler(body?.params?.arguments));
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
    it("parses token list from CSPR.trade MCP", async () => {
      globalThis.fetch = makeRoutingMock({
        get_tokens: () => [
          { symbol: "CSPR", address: "casper-hash-1", decimals: 9, price_usd: 0.0123 },
          { symbol: "USDC", address: "casper-hash-2", decimals: 6, price_usd: 1.0 },
        ],
      });

      const tokens = await fetchCasperDexTokens();
      expect(tokens).toHaveLength(2);
      expect(tokens[0].symbol).toBe("CSPR");
      expect(tokens[0].priceUsd).toBe(0.0123);
      expect(tokens[1].symbol).toBe("USDC");
    });

    it("returns empty array when MCP server is unreachable", async () => {
      globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error("Network error"));
      const tokens = await fetchCasperDexTokens();
      expect(tokens).toEqual([]);
    });

    it("filters out tokens without symbol or address", async () => {
      globalThis.fetch = makeRoutingMock({
        get_tokens: () => [
          { symbol: "CSPR", address: "hash-1", decimals: 9 },
          { symbol: "", address: "hash-2" },
          { symbol: "BAD", address: "" },
        ],
      });

      const tokens = await fetchCasperDexTokens();
      expect(tokens).toHaveLength(1);
      expect(tokens[0].symbol).toBe("CSPR");
    });
  });

  // ── fetchCasperDexPairs ──────────────────────────────────────────────────

  describe("fetchCasperDexPairs", () => {
    it("parses pair list from CSPR.trade MCP", async () => {
      globalThis.fetch = makeRoutingMock({
        get_pairs: () => [
          {
            pair_address: "pair-1",
            token0: { symbol: "CSPR", address: "hash-1" },
            token1: { symbol: "USDC", address: "hash-2" },
            reserve0: "5000000000000",
            reserve1: "60000000",
            reserve_usd: 60,
          },
        ],
      });

      const pairs = await fetchCasperDexPairs(10);
      expect(pairs).toHaveLength(1);
      expect(pairs[0].token0.symbol).toBe("CSPR");
      expect(pairs[0].reserveUsd).toBe(60);
    });
  });

  // ── fetchCsprUsdcQuote ───────────────────────────────────────────────────

  describe("fetchCsprUsdcQuote", () => {
    it("derives CSPR price from pair reserves", async () => {
      globalThis.fetch = makeRoutingMock({
        get_pairs: () => [
          {
            pair_address: "pair-1",
            token0: { symbol: "CSPR", address: "hash-1" },
            token1: { symbol: "USDC", address: "hash-2" },
            reserve0: "5000000000000", // 5000 CSPR (9 decimals)
            reserve1: "60000000", // 60 USDC (6 decimals)
            reserve_usd: 60,
          },
        ],
        get_tokens: () => [],
      });

      const quote = await fetchCsprUsdcQuote();
      expect(quote).not.toBeNull();
      expect(quote!.priceUsd).toBeCloseTo(0.012, 4); // 60 USDC / 5000 CSPR
      expect(quote!.liquidityUsd).toBe(60);
    });

    it("falls back to token price when no pair found", async () => {
      globalThis.fetch = makeRoutingMock({
        get_pairs: () => [], // no pairs
        get_tokens: () => [
          { symbol: "CSPR", address: "hash-1", decimals: 9, price_usd: 0.015 },
        ],
      });

      const quote = await fetchCsprUsdcQuote();
      expect(quote).not.toBeNull();
      expect(quote!.priceUsd).toBe(0.015);
    });

    it("returns null when no price data available", async () => {
      globalThis.fetch = makeRoutingMock({
        get_pairs: () => [],
        get_tokens: () => [],
      });

      const quote = await fetchCsprUsdcQuote();
      expect(quote).toBeNull();
    });
  });

  // ── fetchCasperNetworkStatus ─────────────────────────────────────────────

  describe("fetchCasperNetworkStatus", () => {
    it("parses network status from blockchain MCP", async () => {
      globalThis.fetch = makeRoutingMock({
        casper_get_network_status: () => ({
          era_id: 5420,
          active_validators: 100,
          total_stake: 4_000_000_000,
          circulating_supply: 12_000_000_000,
          block_height: 123456,
        }),
      });

      const status = await fetchCasperNetworkStatus();
      expect(status).not.toBeNull();
      expect(status!.eraId).toBe(5420);
      expect(status!.activeValidators).toBe(100);
      expect(status!.totalStakeCspr).toBe(4_000_000_000);
    });

    it("returns null when MCP server is unreachable", async () => {
      globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error("Network error"));
      const status = await fetchCasperNetworkStatus();
      expect(status).toBeNull();
    });
  });

  // ── fetchCasperEcosystemContext ──────────────────────────────────────────

  describe("fetchCasperEcosystemContext", () => {
    it("aggregates data from both MCP servers", async () => {
      globalThis.fetch = makeRoutingMock({
        get_tokens: () => [
          { symbol: "CSPR", address: "hash-1", decimals: 9, price_usd: 0.012 },
        ],
        get_pairs: () => [
          {
            pair_address: "pair-1",
            token0: { symbol: "CSPR", address: "hash-1" },
            token1: { symbol: "USDC", address: "hash-2" },
            reserve0: "5000000000000",
            reserve1: "60000000",
            reserve_usd: 60,
          },
        ],
        casper_get_network_status: () => ({
          era_id: 5420,
          active_validators: 100,
          total_stake: 4_000_000_000,
          circulating_supply: 12_000_000_000,
          block_height: 123456,
        }),
      });

      const ctx = await fetchCasperEcosystemContext();

      expect(ctx.dexMcpReachable).toBe(true);
      expect(ctx.chainMcpReachable).toBe(true);
      expect(ctx.csprPriceUsd).not.toBeNull();
      expect(ctx.networkStatus).not.toBeNull();
      expect(ctx.networkStatus!.eraId).toBe(5420);
      expect(ctx.topDexTokens).toHaveLength(1);
    });

    it("degrades gracefully when both servers are unreachable", async () => {
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
