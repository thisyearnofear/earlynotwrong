/**
 * Agent Error Hierarchy
 *
 * Standardized error types for the trading agent. Every module throws
 * or returns typed errors so the main loop can handle them predictably.
 *
 * Error categories:
 *   AgentError           — Base class (all agent errors extend this)
 *   │
 *   ├─ ConfigError       — Missing/invalid env vars or configuration
 *   ├─ ConnectionError   — Network/timeout failures (CMC, Mantle RPC)
 *   ├─ TradeError        — Trade execution failures (TWAK, slippage)
 *   ├─ GuardrailError    — Trade rejected by risk limits (not a bug)
 *   ├─ StateError        — Inconsistent state / data corruption
 *   └─ ContractError     — On-chain revert / gas failure
 */

// =============================================================================
// Base Error
// =============================================================================

/**
 * Base class for all agent errors. Includes a `code` for machine-readable
 * handling and a `recoverable` flag for the main loop's retry logic.
 */
export class AgentError extends Error {
  /** Machine-readable error code (e.g., "CONNECTION_TIMEOUT") */
  readonly code: string;
  /** Whether the main loop can retry this error */
  readonly recoverable: boolean;
  /** Optional context (e.g., failing module, request ID) */
  readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    options: {
      code: string;
      recoverable?: boolean;
      context?: Record<string, unknown>;
      cause?: unknown;
    }
  ) {
    super(message, { cause: options.cause });
    this.name = "AgentError";
    this.code = options.code;
    this.recoverable = options.recoverable ?? false;
    this.context = options.context;
  }

  /** Human-readable summary for logs and Telegram messages. */
  toSummary(): string {
    const parts = [`[${this.code}] ${this.message}`];
    if (this.context && Object.keys(this.context).length > 0) {
      parts.push(`context=${JSON.stringify(this.context)}`);
    }
    return parts.join(" ");
  }
}

// =============================================================================
// Typed Errors
// =============================================================================

/**
 * Configuration or environment variable error.
 * Not recoverable — the agent cannot run without fixing the config.
 */
export class ConfigError extends AgentError {
  constructor(
    message: string,
    options: { key?: string; cause?: unknown } = {}
  ) {
    super(message, {
      code: "CONFIG_ERROR",
      recoverable: false,
      context: options.key ? { key: options.key } : undefined,
      cause: options.cause,
    });
    this.name = "ConfigError";
  }
}

/**
 * Network or connection error (timeout, DNS, HTTP 5xx).
 * Recoverable — the main loop can retry.
 */
export class ConnectionError extends AgentError {
  constructor(
    message: string,
    options: {
      endpoint?: string;
      timeoutMs?: number;
      statusCode?: number;
      cause?: unknown;
    } = {}
  ) {
    super(message, {
      code: options.statusCode
        ? `CONNECTION_${options.statusCode}`
        : "CONNECTION_ERROR",
      recoverable: true,
      context: {
        endpoint: options.endpoint,
        timeoutMs: options.timeoutMs,
        statusCode: options.statusCode,
      },
      cause: options.cause,
    });
    this.name = "ConnectionError";
  }
}

/**
 * Trade execution error (TWAK CLI failure, insufficient balance,
 * excessive slippage, rejected by dex).
 * Partially recoverable — retry may succeed with different params.
 */
export class TradeError extends AgentError {
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly amountIn: string;

  constructor(
    message: string,
    options: {
      tokenIn: string;
      tokenOut: string;
      amountIn: string;
      code?: string;
      recoverable?: boolean;
      cause?: unknown;
    }
  ) {
    super(message, {
      code: options.code ?? "TRADE_FAILED",
      recoverable: options.recoverable ?? true,
      context: {
        tokenIn: options.tokenIn,
        tokenOut: options.tokenOut,
        amountIn: options.amountIn,
      },
      cause: options.cause,
    });
    this.name = "TradeError";
    this.tokenIn = options.tokenIn;
    this.tokenOut = options.tokenOut;
    this.amountIn = options.amountIn;
  }
}

/**
 * Trade rejected by risk guardrails.
 * NOT an error in the traditional sense — this is expected behavior
 * when limits are hit. Not recoverable (the trade is intentionally blocked).
 */
export class GuardrailError extends AgentError {
  readonly guardrailCode: string;

  constructor(
    message: string,
    options: {
      guardrailCode: string;
      tokenSymbol?: string;
      amountUsd?: number;
    }
  ) {
    super(message, {
      code: `GUARDRAIL_${options.guardrailCode}`,
      recoverable: false, // Cannot retry — must wait for limit reset
      context: {
        guardrailCode: options.guardrailCode,
        tokenSymbol: options.tokenSymbol,
        amountUsd: options.amountUsd,
      },
    });
    this.name = "GuardrailError";
    this.guardrailCode = options.guardrailCode;
  }
}

/**
 * Inconsistent or corrupted state.
 * Not recoverable — the agent should halt and alert.
 */
export class StateError extends AgentError {
  constructor(
    message: string,
    options: { field?: string; expected?: unknown; actual?: unknown; cause?: unknown } = {}
  ) {
    super(message, {
      code: "STATE_ERROR",
      recoverable: false,
      context: {
        field: options.field,
        expected: options.expected,
        actual: options.actual,
      },
      cause: options.cause,
    });
    this.name = "StateError";
  }
}

/**
 * Contract interaction error (revert, out of gas, unauthorized).
 * Not recoverable on the same params — may succeed with different params.
 */
export class ContractError extends AgentError {
  readonly txHash?: string;

  constructor(
    message: string,
    options: {
      txHash?: string;
      contractAddress?: string;
      revertReason?: string;
      cause?: unknown;
    } = {}
  ) {
    super(message, {
      code: options.revertReason
        ? `CONTRACT_REVERT_${options.revertReason}`
        : "CONTRACT_ERROR",
      recoverable: false, // Contract errors typically need human intervention
      context: {
        txHash: options.txHash,
        contractAddress: options.contractAddress,
        revertReason: options.revertReason,
      },
      cause: options.cause,
    });
    this.name = "ContractError";
    this.txHash = options.txHash;
  }
}

// =============================================================================
// Error Classification Helpers
// =============================================================================

/**
 * Determine if an error is recoverable (safe to retry).
 * Used by the main loop's retry/backoff logic.
 */
export function isRecoverable(error: unknown): boolean {
  if (error instanceof AgentError) return error.recoverable;
  // Network-like native errors are generally recoverable
  if (error instanceof TypeError && error.message.includes("fetch")) return true;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return false;
}

/**
 * Get a human-readable error summary for logs and Telegram.
 * Falls back to `String(error)` for non-AgentErrors.
 */
export function summarizeError(error: unknown): string {
  if (error instanceof AgentError) return error.toSummary();
  if (error instanceof Error) return `[${error.name}] ${error.message}`;
  return String(error);
}
