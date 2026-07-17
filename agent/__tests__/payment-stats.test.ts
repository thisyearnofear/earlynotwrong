/**
 * Payment stats persistence — survives pm2 restarts via payment-stats.json.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  paymentStats,
  recordCall,
  loadPaymentStats,
  persistPaymentStatsSync,
  getPaymentStatsPath,
  createEmptyStats,
} from "../src/payment-stats.js";

const TEST_DIR = join(process.cwd(), "data", "__payment-stats-test__");

describe("payment stats persistence", () => {
  function resetMemoryStats(): void {
    const empty = createEmptyStats();
    paymentStats.queriesServed = empty.queriesServed;
    paymentStats.paidQueries = empty.paidQueries;
    paymentStats.feesCollectedBaseUnits = { ...empty.feesCollectedBaseUnits };
    paymentStats.byTool = new Map();
    paymentStats.byProvider.x402 = {
      queriesServed: 0,
      paidQueries: 0,
      feesCollectedBaseUnits: 0n,
      byTool: new Map(),
    };
    paymentStats.byProvider.cap = {
      queriesServed: 0,
      paidQueries: 0,
      feesCollectedBaseUnits: 0n,
      byTool: new Map(),
    };
  }

  beforeEach(() => {
    process.env.AGENT_DATA_DIR = TEST_DIR;
    mkdirSync(TEST_DIR, { recursive: true });
    resetMemoryStats();
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.AGENT_DATA_DIR;
  });

  it("persists and restores CAP paid orders", () => {
    recordCall("get_live_signals", "cap", true, 50_000n);
    persistPaymentStatsSync();

    expect(existsSync(getPaymentStatsPath())).toBe(true);

    // Simulate restart — wipe memory, reload
    paymentStats.byProvider.cap.paidQueries = 0;
    paymentStats.byProvider.cap.queriesServed = 0;
    paymentStats.feesCollectedBaseUnits.cap = 0n;

    loadPaymentStats();

    expect(paymentStats.byProvider.cap.paidQueries).toBe(1);
    expect(paymentStats.byProvider.cap.feesCollectedBaseUnits).toBe(50_000n);
    expect(paymentStats.byProvider.cap.byTool.get("get_live_signals")?.paidCalls).toBe(1);
  });

  it("accumulates across save/load cycles", () => {
    recordCall("get_live_signals", "cap", true, 50_000n);
    persistPaymentStatsSync();

    loadPaymentStats();
    recordCall("get_live_signals", "cap", true, 50_000n);
    persistPaymentStatsSync();

    loadPaymentStats();
    expect(paymentStats.byProvider.cap.paidQueries).toBe(2);
    expect(paymentStats.byProvider.cap.feesCollectedBaseUnits).toBe(100_000n);

    const raw = JSON.parse(readFileSync(getPaymentStatsPath(), "utf-8"));
    expect(raw.byProvider.cap.paidQueries).toBe(2);
  });
});
