/**
 * Tests for agent/lib/telegram.ts
 *
 * Covers: message formatting, env var gating, HTML escaping, error handling.
 * Mocks the mantle dependency to avoid import chain issues.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock mantle module before importing telegram
vi.mock("../lib/mantle.js", () => ({
  getBscExplorerTxUrl: vi.fn((hash: string) => `https://testnet.bscscan.com/tx/${hash}`),
}));

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("Telegram module", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // =========================================================================
  // Flow: Graceful no-op when env vars not set
  // =========================================================================

  it("does not fetch when env vars are not set", async () => {
    const { sendStartup } = await import("../lib/telegram.js");
    await sendStartup({
      twakMode: "simulator",
      cmcConnected: false,
      walletAddress: null,
      isTestnet: true,
      topK: 3,
      intervalMinutes: 240,
      maxDrawdown: 25,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Flow: Sends message when env vars are set
  // =========================================================================

  it("sends a message when TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-100123456");
    mockFetch.mockResolvedValueOnce({ ok: true });

    const { sendStartup } = await import("../lib/telegram.js");
    await sendStartup({
      twakMode: "simulator",
      cmcConnected: true,
      walletAddress: "0xA1Dd482E4D6C8cf6f5f7BF80FEc6Bd3F11F5888a",
      isTestnet: true,
      topK: 3,
      intervalMinutes: 240,
      maxDrawdown: 25,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call = mockFetch.mock.calls[0];
    expect(call[0]).toContain("api.telegram.org/bot123:abc/sendMessage");
    expect(call[1].method).toBe("POST");

    const body = JSON.parse(call[1].body);
    expect(body.chat_id).toBe("-100123456");
    expect(body.parse_mode).toBe("HTML");
    expect(body.text).toContain("Early, Not Wrong");
    expect(body.text).toContain("simulator");
  });

  // =========================================================================
  // Flow: sendCycleSummary formatting
  // =========================================================================

  it("formats a cycle summary with trade details", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-100123456");
    mockFetch.mockResolvedValueOnce({ ok: true });
    mockFetch.mockResolvedValueOnce({ ok: true });
    mockFetch.mockResolvedValueOnce({ ok: true });

    const { sendCycleSummary } = await import("../lib/telegram.js");
    await sendCycleSummary({
      cycle: 5,
      duration: "12.3s",
      status: "idle",
      tradesSucceeded: 2,
      tradesFailed: 0,
      totalVolumeUsd: 1500,
      portfolioValueUsd: 11200,
      drawdownPercent: 3.2,
      regimeScore: 42,
      sentimentLabel: "HIGH CONVICTION",
      anchoring: { mode: "on-chain", blockNumber: 54321, gasUsed: "21000" },
      executedTrades: [
        {
          success: true,
          txHash: "0xabc123def456",
          tokenIn: "USDC",
          tokenOut: "ETH",
          amountIn: "500",
          amountOut: "0.25",
          timestamp: Date.now(),
        },
      ],
      errors: [],
    });

    expect(mockFetch).toHaveBeenCalledTimes(3);
    // Message 1: Cycle Header + Regime
    const msg1 = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(msg1.text).toContain("Cycle #5");
    // Message 2: Signals + Trades + Narrative
    const msg2 = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(msg2.text).toContain("USDC→ETH");
    // Message 3: Portfolio + P&L + Anchoring
    const msg3 = JSON.parse(mockFetch.mock.calls[2][1].body);
    expect(msg3.text).toContain("Portfolio");
    expect(msg3.text).toContain("on-chain");
  });

  // =========================================================================
  // Flow: sendErrorAlert formatting
  // =========================================================================

  it("formats an error alert with HTML-safe content", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-100123456");
    mockFetch.mockResolvedValueOnce({ ok: true });

    const { sendErrorAlert } = await import("../lib/telegram.js");
    await sendErrorAlert({
      cycle: 3,
      error: "Connection timeout: <broken> & not safe",
      stack: "Error: test\n    at main (index.ts:1:1)",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // HTML special chars should be escaped inside <code>/<pre> blocks
    expect(body.text).toContain("&lt;broken&gt;");
    expect(body.text).toContain("&amp; not safe");
    expect(body.text).toContain("Cycle #3");
  });

  // =========================================================================
  // Flow: Non-200 response is logged, not thrown
  // =========================================================================

  it("handles non-ok response gracefully (no throw)", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-100123456");
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: () => Promise.resolve("Too Many Requests"),
    });

    const { sendStartup } = await import("../lib/telegram.js");
    await expect(
      sendStartup({
        twakMode: "live",
        cmcConnected: true,
        walletAddress: null,
        isTestnet: false,
        topK: 3,
        intervalMinutes: 240,
        maxDrawdown: 25,
      })
    ).resolves.toBeUndefined();
  });

  // =========================================================================
  // Flow: Network error is caught gracefully
  // =========================================================================

  it("handles network errors gracefully (no throw)", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-100123456");
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const { sendStartup } = await import("../lib/telegram.js");
    await expect(
      sendStartup({
        twakMode: "live",
        cmcConnected: true,
        walletAddress: null,
        isTestnet: false,
        topK: 3,
        intervalMinutes: 240,
        maxDrawdown: 25,
      })
    ).resolves.toBeUndefined();
  });
});
