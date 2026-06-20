/**
 * Tests for RiskGuardrails
 *
 * Covers: drawdown limits, trade sizing, daily limits, token allowlist,
 * conviction threshold, trading window, and cumulative state reset.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { RiskGuardrails } from "../lib/risk-guardrails.js";
import { AGENT_CONFIG } from "../lib/config.js";

describe("RiskGuardrails", () => {
  let guardrails: RiskGuardrails;

  beforeEach(() => {
    // Freeze time to the middle of the trading window (June 24, 2026)
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date("2026-06-24T12:00:00Z"));
    guardrails = new RiskGuardrails(10000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =========================================================================
  // Flow: Happy Path
  // =========================================================================

  it("allows a valid trade within all limits", () => {
    const result = guardrails.checkTrade({
      tokenIn: "USDC",
      tokenOut: "ETH",
      amountInUsd: 500,
      expectedAmountOut: 0,
      convictionScore: 80,
      portfolioValue: 10000,
    });

    expect(result.allowed).toBe(true);
    expect(result.code).toBe("OK");
  });

  // =========================================================================
  // Flow: Drawdown Limits
  // =========================================================================

  it("rejects a trade when drawdown exceeds 25%", () => {
    // Set peak value via updatePeakValue
    guardrails.updatePeakValue(10000);

    // Current portfolio value is 7000 → 30% drawdown
    const result = guardrails.checkTrade({
      tokenIn: "USDC",
      tokenOut: "ETH",
      amountInUsd: 500,
      expectedAmountOut: 0,
      convictionScore: 80,
      portfolioValue: 7000,
    });

    expect(result.allowed).toBe(false);
    expect(result.code).toBe("DRAWDOWN_EXCEEDED");
  });

  it("allows a trade when drawdown is under 25%", () => {
    guardrails.updatePeakValue(10000);

    const result = guardrails.checkTrade({
      tokenIn: "USDC",
      tokenOut: "ETH",
      amountInUsd: 500,
      expectedAmountOut: 0,
      convictionScore: 80,
      portfolioValue: 8500, // 15% drawdown
    });

    expect(result.allowed).toBe(true);
  });

  it("rejects a trade when drawdown hits competition disqual limit (30%)", () => {
    guardrails.updatePeakValue(10000);

    const result = guardrails.checkTrade({
      tokenIn: "USDC",
      tokenOut: "ETH",
      amountInUsd: 500,
      expectedAmountOut: 0,
      convictionScore: 80,
      portfolioValue: 6900, // 31% drawdown
    });

    expect(result.allowed).toBe(false);
    expect(result.code).toBe("DRAWDOWN_EXCEEDED");
  });

  // =========================================================================
  // Flow: Trade Size Limits
  // =========================================================================

  it("rejects a trade exceeding max per-trade limit", () => {
    const result = guardrails.checkTrade({
      tokenIn: "USDC",
      tokenOut: "ETH",
      amountInUsd: 1500, // max is 1000
      expectedAmountOut: 0,
      convictionScore: 80,
      portfolioValue: 10000,
    });

    expect(result.allowed).toBe(false);
    expect(result.code).toBe("PER_TRADE_LIMIT");
  });

  // =========================================================================
  // Flow: Daily Trade Limits
  // =========================================================================

  it("rejects a trade when daily limit is exceeded", () => {
    // Record 10 trades (daily max)
    for (let i = 0; i < 10; i++) {
      guardrails.recordTrade(100, true);
    }

    const result = guardrails.checkTrade({
      tokenIn: "USDC",
      tokenOut: "ETH",
      amountInUsd: 500,
      expectedAmountOut: 0,
      convictionScore: 80,
      portfolioValue: 10000,
    });

    expect(result.allowed).toBe(false);
    expect(result.code).toBe("DAILY_TRADE_LIMIT");
  });

  it("resets daily counter when date changes", () => {
    // Record trades on June 24
    for (let i = 0; i < 10; i++) {
      guardrails.recordTrade(100, true);
    }

    // Advance to June 25
    vi.setSystemTime(new Date("2026-06-25T12:00:00Z"));

    // Should be allowed since the day has changed
    const result = guardrails.checkTrade({
      tokenIn: "USDC",
      tokenOut: "ETH",
      amountInUsd: 500,
      expectedAmountOut: 0,
      convictionScore: 80,
      portfolioValue: 10000,
    });

    expect(result.allowed).toBe(true);
  });

  // =========================================================================
  // Flow: Token Allowlist
  // =========================================================================

  it("rejects a trade with a non-eligible tokenOut", () => {
    const result = guardrails.checkTrade({
      tokenIn: "BNB",    // BNB is native gas token, not in eligible list — should be allowed
      tokenOut: "SHIBADOGEMOON", // not in allowlist
      amountInUsd: 500,
      expectedAmountOut: 0,
      convictionScore: 80,
      portfolioValue: 10000,
    });

    expect(result.allowed).toBe(false);
    expect(result.code).toBe("TOKEN_NOT_ALLOWED");
  });

  it("allows BNB as tokenIn (native gas token, not in eligible list)", () => {
    const result = guardrails.checkTrade({
      tokenIn: "BNB",
      tokenOut: "ETH",  // ETH is in the eligible tokens list
      amountInUsd: 500,
      expectedAmountOut: 0,
      convictionScore: 80,
      portfolioValue: 10000,
    });

    expect(result.allowed).toBe(true);
  });

  // =========================================================================
  // Flow: Position Concentration
  // =========================================================================

  it("rejects a trade exceeding position concentration limit", () => {
    // Small portfolio: 20% of 2000 = 400 max concentration.
    // Trade of 500 exceeds concentration but is under per-trade limit (1000).
    const smallGuardrails = new RiskGuardrails(2000);
    smallGuardrails.updatePeakValue(2000);

    const result = smallGuardrails.checkTrade({
      tokenIn: "USDC",
      tokenOut: "ETH",
      amountInUsd: 500,
      expectedAmountOut: 0,
      convictionScore: 80,
      portfolioValue: 2000,
    });

    expect(result.allowed).toBe(false);
    expect(result.code).toBe("CONCENTRATION_LIMIT");
  });

  // =========================================================================
  // Flow: Conviction Threshold
  // =========================================================================

  it("rejects a trade with conviction score below minimum", () => {
    const result = guardrails.checkTrade({
      tokenIn: "USDC",
      tokenOut: "ETH",
      amountInUsd: 500,
      expectedAmountOut: 0,
      convictionScore: 30, // min is 60
      portfolioValue: 10000,
    });

    expect(result.allowed).toBe(false);
    expect(result.code).toBe("CONVICTION_TOO_LOW");
  });

  // =========================================================================
  // Flow: Portfolio Minimum
  // =========================================================================

  it("rejects a trade when portfolio is nearly empty", () => {
    const result = guardrails.checkTrade({
      tokenIn: "USDC",
      tokenOut: "ETH",
      amountInUsd: 500,
      expectedAmountOut: 0,
      convictionScore: 80,
      portfolioValue: 0.5, // below $1 minimum
    });

    expect(result.allowed).toBe(false);
    expect(result.code).toBe("PORTFOLIO_TOO_LOW");
  });

  // =========================================================================
  // Flow: Trading Window
  // =========================================================================

  it("rejects trades before the trading window opens", () => {
    vi.setSystemTime(new Date("2025-06-01T12:00:00Z"));
    const earlyGuardrails = new RiskGuardrails(10000);

    const result = earlyGuardrails.checkTrade({
      tokenIn: "USDC",
      tokenOut: "ETH",
      amountInUsd: 500,
      expectedAmountOut: 0,
      convictionScore: 80,
      portfolioValue: 10000,
    });

    expect(result.allowed).toBe(false);
    expect(result.code).toBe("TRADING_WINDOW_CLOSED");
  });

  it("rejects trades after the trading window closes", () => {
    vi.setSystemTime(new Date("2028-01-01T12:00:00Z"));
    const lateGuardrails = new RiskGuardrails(10000);

    const result = lateGuardrails.checkTrade({
      tokenIn: "USDC",
      tokenOut: "ETH",
      amountInUsd: 500,
      expectedAmountOut: 0,
      convictionScore: 80,
      portfolioValue: 10000,
    });

    expect(result.allowed).toBe(false);
    expect(result.code).toBe("TRADING_WINDOW_CLOSED");
  });

  // =========================================================================
  // Flow: getStatus
  // =========================================================================

  it("getStatus returns accurate drawdown and trade counts", () => {
    guardrails.updatePeakValue(10000);
    guardrails.recordTrade(500, true);
    guardrails.recordTrade(300, true);

    const status = guardrails.getStatus(9000);

    expect(status.drawdownPercent).toBeCloseTo(10);
    expect(status.tradesToday).toBe(2);
    expect(status.drawdownExceeded).toBe(false);
    expect(status.allOk).toBe(true);
  });

  // =========================================================================
  // Flow: Cumulative State
  // =========================================================================

  it("records total trade counts and volume across sessions", () => {
    guardrails.recordTrade(500, true);
    guardrails.recordTrade(300, false); // failed trade
    guardrails.recordTrade(200, true);

    const totals = guardrails.getTotals();
    expect(totals.totalTrades).toBe(2); // only successful trades counted
    expect(totals.totalVolumeUsd).toBe(700);
  });

  it("updatePeakValue tracks the maximum", () => {
    guardrails.updatePeakValue(10000);
    guardrails.updatePeakValue(8000);
    guardrails.updatePeakValue(12000);
    guardrails.updatePeakValue(9000);

    expect(guardrails.getPeakValue()).toBe(12000);
  });

  // =========================================================================
  // Edge: All checks fail simultaneously
  // =========================================================================

  it("fails fast on the first failing check (trading window first)", () => {
    vi.setSystemTime(new Date("2025-06-01T12:00:00Z"));
    const earlyGuardrails = new RiskGuardrails(10000);

    const result = earlyGuardrails.checkTrade({
      tokenIn: "INVALID",
      tokenOut: "ALSO_INVALID",
      amountInUsd: 99999,
      expectedAmountOut: 0,
      convictionScore: 0,
      portfolioValue: 0,
    });

    // Trading window check is first — returns closed before portfolio check
    expect(result.code).toBe("TRADING_WINDOW_CLOSED");
  });
});
