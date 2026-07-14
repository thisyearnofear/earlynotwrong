/**
 * Tests for agent/lib/telegram-subscribers.ts
 *
 * Covers: /start subscribe (+welcome), /stop unsubscribe (+confirm), dedupe,
 * getUpdates offset advancement (within a session and across restarts),
 * getMe bot-username caching, and graceful no-op without a token.
 * Mocks fetch; persists to a per-test temp AGENT_DATA_DIR.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

type SubsModule = typeof import("../lib/telegram-subscribers.js");

let dataDir: string;

/** Fresh module instance so the in-memory cache starts empty (like a restart). */
async function loadModule(): Promise<SubsModule> {
  vi.resetModules();
  return import("../lib/telegram-subscribers.js");
}

function updatesResponse(updates: Array<{ update_id: number; message?: unknown }>) {
  return {
    ok: true,
    json: () => Promise.resolve({ ok: true, result: updates }),
  };
}

function messageUpdate(updateId: number, chatId: number, text: string) {
  return { update_id: updateId, message: { chat: { id: chatId }, text } };
}

function calledUrls(): string[] {
  return mockFetch.mock.calls.map((c) => String(c[0]));
}

function sendMessageBodies(): Array<{ chat_id: string; text: string }> {
  return mockFetch.mock.calls
    .filter((c) => String(c[0]).includes("/sendMessage"))
    .map((c) => JSON.parse((c[1] as { body: string }).body));
}

describe("Telegram subscriber registry", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mockFetch.mockReset();
    dataDir = mkdtempSync(join(tmpdir(), "enw-telegram-subs-"));
    vi.stubEnv("AGENT_DATA_DIR", dataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  // =========================================================================
  // Flow: Graceful no-op without a token
  // =========================================================================

  it("pollTelegramUpdates does not fetch without TELEGRAM_BOT_TOKEN", async () => {
    const mod = await loadModule();
    await mod.pollTelegramUpdates();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("startSubscriberPolling is a no-op without TELEGRAM_BOT_TOKEN", async () => {
    const mod = await loadModule();
    mod.startSubscriberPolling(1_000);
    expect(mockFetch).not.toHaveBeenCalled();
    mod.stopSubscriberPolling();
  });

  // =========================================================================
  // Flow: /start subscribes, replies with a welcome, advances the offset
  // =========================================================================

  it("subscribes on /start, replies with a welcome, and persists the offset", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    const mod = await loadModule();

    mockFetch.mockResolvedValueOnce(updatesResponse([messageUpdate(10, 111, "/start")]));
    mockFetch.mockResolvedValueOnce({ ok: true }); // welcome reply

    await mod.pollTelegramUpdates();

    expect(mod.getSubscriberChatIds()).toEqual(["111"]);
    expect(mod.getSubscriberCount()).toBe(1);

    const replies = sendMessageBodies();
    expect(replies).toHaveLength(1);
    expect(replies[0].chat_id).toBe("111");
    expect(replies[0].text).toContain("/stop");

    // Offset persisted as update_id + 1 alongside the agent's other state.
    const persisted = JSON.parse(readFileSync(join(dataDir, "telegram-subscribers.json"), "utf-8"));
    expect(persisted.offset).toBe(11);
    expect(persisted.subscribers).toEqual(["111"]);
  });

  it("passes the saved offset to the next getUpdates call", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    const mod = await loadModule();

    mockFetch.mockResolvedValueOnce(updatesResponse([messageUpdate(41, 222, "/start")]));
    mockFetch.mockResolvedValueOnce({ ok: true }); // reply
    await mod.pollTelegramUpdates();

    mockFetch.mockResolvedValueOnce(updatesResponse([]));
    await mod.pollTelegramUpdates();

    const getUpdatesUrls = calledUrls().filter((u) => u.includes("/getUpdates"));
    expect(getUpdatesUrls).toHaveLength(2);
    expect(getUpdatesUrls[0]).toContain("offset=0");
    expect(getUpdatesUrls[1]).toContain("offset=42");
  });

  it("restores subscribers and offset across a restart (fresh module)", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    const mod = await loadModule();

    mockFetch.mockResolvedValueOnce(updatesResponse([messageUpdate(7, 333, "/start")]));
    mockFetch.mockResolvedValueOnce({ ok: true });
    await mod.pollTelegramUpdates();

    // Simulate a restart: new module instance, same data dir.
    const restarted = await loadModule();
    expect(restarted.getSubscriberChatIds()).toEqual(["333"]);

    mockFetch.mockResolvedValueOnce(updatesResponse([]));
    await restarted.pollTelegramUpdates();
    const lastUrl = calledUrls().filter((u) => u.includes("/getUpdates")).pop();
    expect(lastUrl).toContain("offset=8");
  });

  // =========================================================================
  // Flow: Dedupe + /stop unsubscribe
  // =========================================================================

  it("dedupes repeat /start and removes on /stop with a confirmation", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    const mod = await loadModule();

    mockFetch.mockResolvedValue({ ok: true }); // all replies ok
    mockFetch.mockResolvedValueOnce(
      updatesResponse([
        messageUpdate(1, 111, "/start"),
        messageUpdate(2, 111, "/start"), // duplicate — deduped
        messageUpdate(3, 222, "/start@EarlyNotWrongBot"),
      ])
    );
    await mod.pollTelegramUpdates();

    expect(mod.getSubscriberChatIds()).toEqual(["111", "222"]);

    mockFetch.mockResolvedValueOnce(updatesResponse([messageUpdate(4, 111, "/stop")]));
    await mod.pollTelegramUpdates();

    expect(mod.getSubscriberChatIds()).toEqual(["222"]);
    const lastReply = sendMessageBodies().pop();
    expect(lastReply?.chat_id).toBe("111");
    expect(lastReply?.text).toContain("/start");
  });

  it("ignores non-command messages but still advances the offset", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    const mod = await loadModule();

    mockFetch.mockResolvedValueOnce(
      updatesResponse([messageUpdate(99, 444, "hello, what do you trade?")])
    );
    await mod.pollTelegramUpdates();

    expect(mod.getSubscriberCount()).toBe(0);
    expect(sendMessageBodies()).toHaveLength(0);

    const persisted = JSON.parse(readFileSync(join(dataDir, "telegram-subscribers.json"), "utf-8"));
    expect(persisted.offset).toBe(100);
  });

  // =========================================================================
  // Flow: Errors never propagate to the trading loop
  // =========================================================================

  it("swallows network errors from getUpdates", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    const mod = await loadModule();

    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(mod.pollTelegramUpdates()).resolves.toBeUndefined();
  });

  it("handles a non-ok getUpdates response gracefully", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    const mod = await loadModule();

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: () => Promise.resolve("Bad Gateway"),
    });
    await expect(mod.pollTelegramUpdates()).resolves.toBeUndefined();
    expect(mod.getSubscriberCount()).toBe(0);
  });

  // =========================================================================
  // Flow: getMe caches the bot username for GET /status
  // =========================================================================

  it("resolves and caches the bot username via getMe on start", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    const mod = await loadModule();

    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes("/getMe")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: { username: "EarlyNotWrongBot" } }),
        });
      }
      return Promise.resolve(updatesResponse([]));
    });

    expect(mod.getBotUsername()).toBeNull();
    mod.startSubscriberPolling(60_000);
    await vi.waitFor(() => expect(mod.getBotUsername()).toBe("EarlyNotWrongBot"));
    mod.stopSubscriberPolling();
  });
});
