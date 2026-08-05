/**
 * Tests for the SoSoValue rate-limit fix.
 *
 * Root cause of the recurring HTTP 429 storms: the old token bucket (capacity
 * 20, refill 1/3s) allowed a ~40-request first minute (20 instant-burst + 20
 * paced refill) against SoSoValue's 20 req/min key limit. Everything past 20
 * got 429'd, and 3 consecutive failures tripped the 15-min circuit breaker.
 *
 * The rolling-window limiter hard-caps 20 requests in any trailing 60s — the
 * same metric the server enforces. Also tested: jittered per-token snapshot
 * TTL so 147 expiries don't land in the same minute.
 */

import { describe, it, expect } from "vitest";
import {
  computeSsvThrottleWaitMs,
  snapshotTtlMs,
  SSV_SNAPSHOT_TTL_MS,
  SSV_SNAPSHOT_TTL_JITTER_MS_MAX,
} from "../lib/data-providers.js";

const LIMIT = 20;
const WINDOW = 60_000;

describe("computeSsvThrottleWaitMs — rolling-window hard cap", () => {
  it("returns 0 when the window is empty", () => {
    expect(computeSsvThrottleWaitMs([], 100_000, WINDOW, LIMIT)).toBe(0);
  });

  it("returns 0 when fewer than 20 requests are in the trailing window", () => {
    const now = 100_000;
    const ts = Array.from({ length: 19 }, (_, i) => now - i * 100);
    expect(computeSsvThrottleWaitMs(ts, now, WINDOW, LIMIT)).toBe(0);
  });

  it("ignores timestamps older than the 60s window", () => {
    const now = 61_000;
    // 20 timestamps but ALL older than 60s → window is free.
    const ts = Array.from({ length: 20 }, (_, i) => i * 500);
    expect(computeSsvThrottleWaitMs(ts, now, WINDOW, LIMIT)).toBe(0);
  });

  it("blocks the 21st request within a minute — the production 429 scenario", () => {
    const now = 10_000;
    // 20 requests burst at t=0 … 1900ms (the old bucket's "fire instantly").
    const ts = Array.from({ length: 20 }, (_, i) => i * 100);
    const wait = computeSsvThrottleWaitMs(ts, now, WINDOW, LIMIT);
    expect(wait).toBeGreaterThan(0);
    // Must wait until the oldest (t=0) ages out of the 60s window, +5ms buffer.
    expect(wait).toBe(60_000 - now + 5);
  });

  it("window slides forward as time passes (old requests keep aging out)", () => {
    const now = 40_000;
    const ts = Array.from({ length: 20 }, (_, i) => i * 500); // t=0…9500
    const wait = computeSsvThrottleWaitMs(ts, now, WINDOW, LIMIT);
    // Oldest at t=0 ages out at t=60,000 → wait 20s + 5ms buffer.
    expect(wait).toBe(20_005);
  });

  it("simulated 147-token burst under the rolling limiter: ≤20 requests in ANY 60s window", () => {
    // Simulate a full batchFetchQuotes cold fill with the limiter's pacing:
    // each request waits computeSsvThrottleWaitMs before firing.
    const fired: number[] = [];
    let now = 0;
    let ts: number[] = [];
    for (let i = 0; i < 147; i++) {
      const wait = computeSsvThrottleWaitMs(ts, now, WINDOW, LIMIT);
      now += wait;
      // consume slot
      ts.push(now);
      ts = ts.filter((t) => t > now - WINDOW);
      fired.push(now);
    }
    // Invariant: for every request, at most 20 requests in its trailing 60s.
    for (const t of fired) {
      const inWindow = fired.filter((u) => u > t - WINDOW && u <= t);
      expect(inWindow.length).toBeLessThanOrEqual(LIMIT);
    }
    // Total wall-clock ≥ 147/20 * 60s ≈ 7.3 min (the honest cost of a compliant cold fill).
    expect(fired[fired.length - 1] - fired[0]).toBeGreaterThanOrEqual(7 * 60_000 - 5);
  });
});

describe("snapshotTtlMs — jittered TTL defeats synchronized expiry", () => {
  it("stays within [10h, 12h]", () => {
    for (const id of ["1673723677362320330", "1962347183957491713", "a", "zzz", "0"]) {
      const ttl = snapshotTtlMs(id);
      expect(ttl).toBeGreaterThanOrEqual(SSV_SNAPSHOT_TTL_MS - SSV_SNAPSHOT_TTL_JITTER_MS_MAX);
      expect(ttl).toBeLessThanOrEqual(SSV_SNAPSHOT_TTL_MS);
    }
  });

  it("is deterministic (stable across restarts — hash-based, not Math.random)", () => {
    expect(snapshotTtlMs("1673723677362320330")).toBe(snapshotTtlMs("1673723677362320330"));
  });

  it("spreads distinct currencies over distinct TTLs (expiry de-synchronization)", () => {
    const ttls = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t"].map(snapshotTtlMs),
    );
    expect(ttls.size).toBeGreaterThan(3); // with 2h of jitter resolution, 20 ids must not collapse to one value
  });
});
