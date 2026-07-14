/**
 * Telegram Subscriber Registry + Polling Loop
 *
 * Lets ANYONE watch the agent: DM the bot /start to subscribe to the agent's
 * public trade narrative (entries, exits), /stop to unsubscribe. Operator-only
 * messages (errors, guardrail blocks, cycle summaries) never go to subscribers.
 *
 * Subscribers + the getUpdates offset are persisted to a JSON file alongside
 * the agent's other persisted state (same AGENT_DATA_DIR convention as
 * lib/persistence.ts) so updates are consumed exactly once across restarts.
 *
 * Uses Node's built-in fetch (18+) — no extra dependencies.
 * Reads TELEGRAM_BOT_TOKEN from env; gracefully no-ops when unset.
 * The polling loop must never crash the trading loop: everything is caught,
 * logged, and retried on the next tick.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getStatePath } from "./persistence.js";

const TELEGRAM_API = "https://api.telegram.org/bot";
const SUBSCRIBERS_FILE = "telegram-subscribers.json";
const DEFAULT_POLL_INTERVAL_MS = 60_000;
const LONG_POLL_TIMEOUT_SECONDS = 30;
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_BACKOFF_MS = 300_000;

// =============================================================================
// Types
// =============================================================================

interface SubscriberState {
  /** Deduped Telegram chat IDs (stored as strings, same as TELEGRAM_CHAT_ID). */
  subscribers: string[];
  /** getUpdates offset — next update_id to consume. */
  offset: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat?: { id: number };
    text?: string;
  };
}

// =============================================================================
// Persistence (same data-dir convention as lib/persistence.ts)
// =============================================================================

/** Path to the subscriber registry, next to the agent's state.json. */
function getSubscribersPath(): string {
  return join(dirname(getStatePath()), SUBSCRIBERS_FILE);
}

let cachedState: SubscriberState | null = null;

function loadState(): SubscriberState {
  if (cachedState) return cachedState;
  try {
    const path = getSubscribersPath();
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<SubscriberState>;
      cachedState = {
        subscribers: Array.isArray(raw.subscribers)
          ? [...new Set(raw.subscribers.map(String))]
          : [],
        offset: Number.isFinite(raw.offset) ? Number(raw.offset) : 0,
      };
      return cachedState;
    }
  } catch (err) {
    console.warn("[telegram-subs] Failed to read subscriber file:", (err as Error)?.message || String(err));
  }
  cachedState = { subscribers: [], offset: 0 };
  return cachedState;
}

function saveState(state: SubscriberState): void {
  cachedState = state;
  try {
    writeFileSync(getSubscribersPath(), JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.warn("[telegram-subs] Failed to write subscriber file:", (err as Error)?.message || String(err));
  }
}

// =============================================================================
// Registry API
// =============================================================================

/** All subscriber chat IDs (for broadcast fan-out in telegram.ts). */
export function getSubscriberChatIds(): string[] {
  return [...loadState().subscribers];
}

export function getSubscriberCount(): number {
  return loadState().subscribers.length;
}

/** Add a subscriber. Returns true if newly added (deduped). */
function addSubscriber(chatId: string): boolean {
  const state = loadState();
  if (state.subscribers.includes(chatId)) return false;
  state.subscribers.push(chatId);
  saveState(state);
  return true;
}

/** Remove a subscriber. Returns true if it was present. */
function removeSubscriber(chatId: string): boolean {
  const state = loadState();
  const idx = state.subscribers.indexOf(chatId);
  if (idx === -1) return false;
  state.subscribers.splice(idx, 1);
  saveState(state);
  return true;
}

// =============================================================================
// Bot identity (getMe) — cached for GET /status
// =============================================================================

let cachedBotUsername: string | null = null;

/** The bot's @username, or null before getMe resolves / when unconfigured. */
export function getBotUsername(): string | null {
  return cachedBotUsername;
}

async function fetchBotUsername(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || cachedBotUsername) return;

  try {
    const res = await fetch(`${TELEGRAM_API}${token}/getMe`);
    if (!res.ok) {
      console.error(`[telegram-subs] getMe failed (${res.status})`);
      return;
    }
    const data = (await res.json()) as { ok?: boolean; result?: { username?: string } };
    if (data.ok && data.result?.username) {
      cachedBotUsername = data.result.username;
      console.log(`[telegram-subs] Bot identity: @${cachedBotUsername}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[telegram-subs] getMe error: ${message}`);
  }
}

// =============================================================================
// Command replies
// =============================================================================

const WELCOME_MESSAGE = [
  `👋 <b>You're watching Early, Not Wrong</b> — a contrarian trading agent on BSC Mainnet.`,
  ``,
  `You'll get an alert when the agent:`,
  `🟢 opens a position (symbol, size, conviction score)`,
  `🛑 exits — stop, trailing, or partial, with P&amp;L`,
  ``,
  `It buys quality assets during fear and holds through drawdown. Early, not wrong.`,
  ``,
  `Send /stop anytime to unsubscribe.`,
].join("\n");

const ALREADY_SUBSCRIBED_MESSAGE = `You're already subscribed — trade alerts are on their way. Send /stop to unsubscribe.`;

const GOODBYE_MESSAGE = `✅ Unsubscribed. Send /start anytime to watch the agent again.`;

/** Send a reply to one chat. Never throws. */
async function replyTo(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  try {
    const res = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "(no body)");
      console.error(`[telegram-subs] reply failed (${res.status}): ${body}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[telegram-subs] reply error: ${message}`);
  }
}

// =============================================================================
// getUpdates polling
// =============================================================================

/**
 * Abortable fetch wrapper. Telegram long-polling can hang on gateway issues,
 * so we never wait longer than REQUEST_TIMEOUT_MS.
 */
function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * Consume pending updates once: subscribe on /start, unsubscribe on /stop,
 * ignore everything else. The offset is persisted after each poll so each
 * update is handled exactly once across restarts. Never throws.
 *
 * Uses long-polling (timeout=30s) so Telegram holds the connection until
 * there is an update, which is far gentler than hammering every 60s.
 */
export async function pollTelegramUpdates(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  try {
    const state = loadState();
    const params = new URLSearchParams({
      offset: String(state.offset),
      timeout: String(LONG_POLL_TIMEOUT_SECONDS),
      allowed_updates: JSON.stringify(["message"]),
    });
    const res = await fetchWithTimeout(`${TELEGRAM_API}${token}/getUpdates?${params}`);
    if (!res.ok) {
      const body = await res.text().catch(() => "(no body)");
      console.error(`[telegram-subs] getUpdates failed (${res.status}): ${body}`);
      return;
    }

    const data = (await res.json()) as { ok?: boolean; result?: TelegramUpdate[] };
    if (!data.ok || !Array.isArray(data.result) || data.result.length === 0) return;

    for (const update of data.result) {
      // Advance the offset first — a bad message must not be re-consumed forever.
      if (Number.isFinite(update.update_id) && update.update_id >= state.offset) {
        state.offset = update.update_id + 1;
      }

      const chatId = update.message?.chat?.id;
      const text = update.message?.text?.trim();
      if (chatId == null || !text) continue;

      // "/start", "/start@BotName", "/stop payload" all normalize to the command.
      const command = text.split(/[\s@]/)[0].toLowerCase();

      if (command === "/start") {
        const added = addSubscriber(String(chatId));
        console.log(`[telegram-subs] /start from ${chatId} — ${added ? "subscribed" : "already subscribed"} (${getSubscriberCount()} total)`);
        await replyTo(String(chatId), added ? WELCOME_MESSAGE : ALREADY_SUBSCRIBED_MESSAGE);
      } else if (command === "/stop") {
        const removed = removeSubscriber(String(chatId));
        if (removed) {
          console.log(`[telegram-subs] /stop from ${chatId} — unsubscribed (${getSubscriberCount()} total)`);
        }
        await replyTo(String(chatId), GOODBYE_MESSAGE);
      }
      // All other messages are ignored — this bot only broadcasts.
    }

    saveState(state);
  } catch (err) {
    // Never let the poller take the trading loop down with it.
    const message = err instanceof Error ? err.message : String(err);
    // AbortController timeouts are expected noise; keep other errors visible.
    if (message.includes("AbortError") || message.includes("The operation was aborted")) {
      console.log("[telegram-subs] getUpdates timed out, will retry");
    } else {
      console.error(`[telegram-subs] poll error: ${message}`);
    }
  }
}

// =============================================================================
// Lifecycle — started from index.ts alongside the cycle timer
// =============================================================================

let pollTimer: NodeJS.Timeout | null = null;
let isPolling = false;
let consecutiveErrors = 0;

/**
 * Schedule the next poll. Long-polling + overlap guard means we won't start a
 * second getUpdates while one is already in flight (the 409 conflict the logs
 * were showing). After consecutive failures we back off up to MAX_BACKOFF_MS.
 */
function scheduleNextPoll(intervalMs: number): void {
  if (pollTimer) return;
  const backoff = Math.min(intervalMs * Math.max(1, consecutiveErrors), MAX_BACKOFF_MS);
  pollTimer = setTimeout(async () => {
    pollTimer = null;
    if (isPolling) {
      scheduleNextPoll(intervalMs);
      return;
    }
    isPolling = true;
    try {
      await pollTelegramUpdates();
      consecutiveErrors = 0;
    } catch {
      consecutiveErrors += 1;
    } finally {
      isPolling = false;
      scheduleNextPoll(intervalMs);
    }
  }, backoff);
  pollTimer.unref?.();
}

/**
 * Start the subscriber polling loop. No-ops when TELEGRAM_BOT_TOKEN is unset.
 * The timer is unref'd so it never holds the process open on its own — the
 * cycle timer owns the process lifetime.
 */
export function startSubscriberPolling(intervalMs: number = DEFAULT_POLL_INTERVAL_MS): void {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.log("[telegram-subs] TELEGRAM_BOT_TOKEN not set — subscriber polling disabled");
    return;
  }
  if (pollTimer) return;

  // Resolve the bot's @username once (surfaced on GET /status) and consume
  // any updates that queued up while the agent was down.
  fetchBotUsername().catch(() => {});
  pollTelegramUpdates().catch(() => {});

  scheduleNextPoll(intervalMs);

  console.log(`[telegram-subs] Long-polling for /start subscribers every ${Math.round(intervalMs / 1000)}s (${getSubscriberCount()} subscribed)`);
}

export function stopSubscriberPolling(): void {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}
