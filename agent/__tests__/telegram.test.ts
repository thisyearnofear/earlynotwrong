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

// Mock the subscriber registry so broadcast fan-out is controllable per test
const { mockGetSubscriberChatIds } = vi.hoisted(() => ({
  mockGetSubscriberChatIds: vi.fn((): string[] => []),
}));
vi.mock("../lib/telegram-subscribers.js", () => ({
  getSubscriberChatIds: mockGetSubscriberChatIds,
}));

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("Telegram module", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mockFetch.mockReset();
    mockGetSubscriberChatIds.mockReset();
    mockGetSubscriberChatIds.mockReturnValue([]);
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
  // Flow: Broadcast fan-out — public alerts reach subscribers, operator-only
  // alerts do not
  // =========================================================================

  it("sendEntryAlert broadcasts to the operator chat AND all subscribers", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-100123456");
    mockGetSubscriberChatIds.mockReturnValue(["111", "222"]);
    mockFetch.mockResolvedValue({ ok: true });

    const { sendEntryAlert } = await import("../lib/telegram.js");
    await sendEntryAlert({
      cycle: 7,
      symbol: "CAKE",
      amountUsd: 25,
      convictionScore: 82,
      rationale: "quality asset down 18% during extreme fear",
      txHash: "0xabc123",
    });

    expect(mockFetch).toHaveBeenCalledTimes(3);
    const bodies = mockFetch.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(bodies.map((b) => b.chat_id)).toEqual(["-100123456", "111", "222"]);
    for (const body of bodies) {
      expect(body.text).toContain("ENTRY");
      expect(body.text).toContain("CAKE");
      expect(body.text).toContain("82/100");
      expect(body.text).toContain("extreme fear");
    }
  });

  it("sendExitAlert broadcasts to subscribers with P&L intact", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-100123456");
    mockGetSubscriberChatIds.mockReturnValue(["111"]);
    mockFetch.mockResolvedValue({ ok: true });

    const { sendExitAlert } = await import("../lib/telegram.js");
    await sendExitAlert({
      cycle: 9,
      symbol: "UNI",
      action: "EXIT_TRAIL",
      reason: "trailing stop after +120% run",
      pnlPercent: 84.2,
      amountUsd: 42.5,
      sellFraction: 1,
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const bodies = mockFetch.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(bodies.map((b) => b.chat_id)).toEqual(["-100123456", "111"]);
    expect(bodies[1].text).toContain("+84.2% PnL");
  });

  it("does not double-send when the operator chat is also subscribed", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-100123456");
    mockGetSubscriberChatIds.mockReturnValue(["-100123456", "111"]);
    mockFetch.mockResolvedValue({ ok: true });

    const { sendEntryAlert } = await import("../lib/telegram.js");
    await sendEntryAlert({
      cycle: 1,
      symbol: "LINK",
      amountUsd: 10,
      convictionScore: 75,
      rationale: "contrarian entry",
    });

    const bodies = mockFetch.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(bodies.map((b) => b.chat_id)).toEqual(["-100123456", "111"]);
  });

  it("sendErrorAlert stays operator-only (never fans out to subscribers)", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-100123456");
    mockGetSubscriberChatIds.mockReturnValue(["111", "222"]);
    mockFetch.mockResolvedValue({ ok: true });

    const { sendErrorAlert } = await import("../lib/telegram.js");
    await sendErrorAlert({ cycle: 4, error: "RPC timeout" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.chat_id).toBe("-100123456");
  });

  it("sendEntryAlert is a no-op without TELEGRAM_BOT_TOKEN", async () => {
    mockGetSubscriberChatIds.mockReturnValue(["111"]);

    const { sendEntryAlert } = await import("../lib/telegram.js");
    await sendEntryAlert({
      cycle: 1,
      symbol: "CAKE",
      amountUsd: 10,
      convictionScore: 70,
      rationale: "contrarian entry",
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("broadcasts to subscribers even when only the token is set (no operator chat)", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    mockGetSubscriberChatIds.mockReturnValue(["111"]);
    mockFetch.mockResolvedValue({ ok: true });

    const { sendExitAlert } = await import("../lib/telegram.js");
    await sendExitAlert({
      cycle: 2,
      symbol: "DOGE",
      action: "EXIT_STOP",
      reason: "thesis broke at -35%",
      pnlPercent: -35.1,
      amountUsd: 9.5,
      sellFraction: 1,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.chat_id).toBe("111");
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

  it("broadcasts public-safe guidance to operator and subscribers", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-100123456");
    mockGetSubscriberChatIds.mockReturnValue(["999888"]);
    mockFetch.mockResolvedValue({ ok: true });

    const { sendGuidanceBroadcast } = await import("../lib/telegram.js");
    await sendGuidanceBroadcast({
      cycle: 42,
      guidance: {
        recommendedAction: "evaluate",
        reason: "Top candidate XRP — apply your sizing rules",
        topCandidate: "XRP",
        sizeMultiplier: 1,
      },
      stale: false,
      signalCount: 5,
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const payloads = mockFetch.mock.calls.map(
      (c) => JSON.parse((c[1] as RequestInit).body as string) as { text: string; chat_id: string },
    );
    expect(payloads[0].text).toContain("Cycle #42 guidance");
    expect(payloads[0].text).toContain("Evaluate");
    expect(payloads[0].text).toContain("XRP");
    expect(payloads[0].text).toContain("Hire on CROO");
    expect(payloads[0].text).toContain("Integrate");
    expect(payloads[0].text).toContain("signals-live");
    expect(payloads[1].chat_id).toBe("999888");
  });
});
