/**
 * Tests for agent/lib/errors.ts error hierarchy.
 */

import { describe, it, expect } from "vitest";
import {
  AgentError,
  ConfigError,
  ConnectionError,
  TradeError,
  GuardrailError,
  StateError,
  ContractError,
  isRecoverable,
  summarizeError,
} from "../lib/errors.js";

describe("AgentError base class", () => {
  it("creates an error with code and message", () => {
    const err = new AgentError("Something went wrong", { code: "TEST_ERROR" });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("TEST_ERROR");
    expect(err.message).toBe("Something went wrong");
    expect(err.recoverable).toBe(false);
  });

  it("sets recoverable flag", () => {
    const err = new AgentError("Retry please", {
      code: "RETRY",
      recoverable: true,
    });
    expect(err.recoverable).toBe(true);
  });

  it("includes context", () => {
    const err = new AgentError("Context test", {
      code: "WITH_CTX",
      context: { key: "value", num: 42 },
    });
    expect(err.context).toEqual({ key: "value", num: 42 });
  });

  it("toSummary() formats correctly", () => {
    const err = new AgentError("Test error", { code: "TEST" });
    expect(err.toSummary()).toBe("[TEST] Test error");
  });

  it("toSummary() includes context when present", () => {
    const err = new AgentError("Context error", {
      code: "CTX",
      context: { key: "val" },
    });
    expect(err.toSummary()).toContain("[CTX] Context error");
    expect(err.toSummary()).toContain("key");
  });
});

describe("ConfigError", () => {
  it("creates with CONFIG_ERROR code and not recoverable", () => {
    const err = new ConfigError("Missing env var", { key: "API_KEY" });
    expect(err.code).toBe("CONFIG_ERROR");
    expect(err.recoverable).toBe(false);
    expect(err.context?.key).toBe("API_KEY");
  });
});

describe("ConnectionError", () => {
  it("creates with CONNECTION_ERROR code and recoverable", () => {
    const err = new ConnectionError("Timeout after 10s", {
      endpoint: "api.example.com",
      timeoutMs: 10000,
    });
    expect(err.code).toBe("CONNECTION_ERROR");
    expect(err.recoverable).toBe(true);
    expect(err.context?.endpoint).toBe("api.example.com");
  });

  it("uses status code in the error code when provided", () => {
    const err = new ConnectionError("Rate limited", {
      statusCode: 429,
    });
    expect(err.code).toBe("CONNECTION_429");
  });
});

describe("TradeError", () => {
  it("stores swap parameters and defaults to recoverable", () => {
    const err = new TradeError("Insufficient liquidity", {
      tokenIn: "USDC",
      tokenOut: "ETH",
      amountIn: "500",
    });
    expect(err.tokenIn).toBe("USDC");
    expect(err.tokenOut).toBe("ETH");
    expect(err.amountIn).toBe("500");
    expect(err.recoverable).toBe(true);
  });
});

describe("GuardrailError", () => {
  it("creates with GUARDRAIL_ prefix and not recoverable", () => {
    const err = new GuardrailError("Drawdown exceeded", {
      guardrailCode: "DRAWDOWN_EXCEEDED",
      tokenSymbol: "ETH",
      amountUsd: 500,
    });
    expect(err.code).toBe("GUARDRAIL_DRAWDOWN_EXCEEDED");
    expect(err.recoverable).toBe(false);
  });
});

describe("StateError", () => {
  it("creates with STATE_ERROR and not recoverable", () => {
    const err = new StateError("State inconsistent", {
      field: "portfolio",
      expected: "non-null",
      actual: null,
    });
    expect(err.code).toBe("STATE_ERROR");
    expect(err.recoverable).toBe(false);
  });
});

describe("ContractError", () => {
  it("stores tx hash when available", () => {
    const err = new ContractError("Transaction reverted", {
      txHash: "0xabc123",
      revertReason: "insufficient balance",
    });
    expect(err.txHash).toBe("0xabc123");
    expect(err.code).toBe("CONTRACT_REVERT_insufficient balance");
  });
});

describe("isRecoverable", () => {
  it("returns true for ConnectionError", () => {
    expect(isRecoverable(new ConnectionError("timeout"))).toBe(true);
  });

  it("returns false for ConfigError", () => {
    expect(isRecoverable(new ConfigError("bad config"))).toBe(false);
  });

  it("returns false for GuardrailError", () => {
    expect(
      isRecoverable(
        new GuardrailError("blocked", { guardrailCode: "TEST" })
      )
    ).toBe(false);
  });

  it("returns true for TypeError related to fetch", () => {
    expect(isRecoverable(new TypeError("fetch failed"))).toBe(true);
  });

  it("returns false for random errors", () => {
    expect(isRecoverable(new Error("unknown"))).toBe(false);
  });
});

describe("summarizeError", () => {
  it("formats AgentError with toSummary", () => {
    const err = new AgentError("Test", { code: "TEST" });
    expect(summarizeError(err)).toBe("[TEST] Test");
  });

  it("formats regular Error with name and message", () => {
    const err = new Error("Something broke");
    expect(summarizeError(err)).toBe("[Error] Something broke");
  });

  it("formats string fallback", () => {
    expect(summarizeError("raw string")).toBe("raw string");
  });
});
