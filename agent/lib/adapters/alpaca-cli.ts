/**
 * Alpaca CLI Wrapper
 *
 * Genuine use of Alpaca's CLI tool (alpacahq/cli) — the hackathon's "MCP or
 * CLI" requirement. The CLI is an alpha-preview agent-first tool: structured
 * JSON output, no interactive prompts, `--dry-run` preview, and idempotent
 * orders via `--client-order-id`. Per Alpaca's own comparison table it's
 * "best for scripts, cron, focused agent actions" — exactly our Node executor.
 *
 * Places orders through the CLI (JSON output) with a REST fallback in the
 * executor so Monday's live path can't break if the CLI is missing or errors.
 *
 * Auth: reads ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY and passes them to
 * the CLI as ALPACA_API_KEY / ALPACA_SECRET_KEY (env), which is the CLI's
 * documented CI/agent path (no interactive profile login).
 *
 * Mirrors the twak-executor.ts pattern: execFile (non-blocking), explicit
 * binary resolution (Node's PATH may not include ~/.local/bin), and an
 * injectable execFileOverride so tests can drive it without a real binary.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { withTimeout } from "../delphi/executor.js";

const execFileAsync = promisify(execFile);

/** Common install locations for the `alpaca` CLI binary. */
const ALPACA_CLI_CANDIDATE_PATHS = [
  "~/.local/bin/alpaca",
  "/usr/local/bin/alpaca",
];

/** Env vars the CLI needs (mapped from our paper keys). */
function cliEnv(): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    // The CLI reads ALPACA_API_KEY / ALPACA_SECRET_KEY. Map from our ids.
    ALPACA_API_KEY: process.env.ALPACA_API_KEY_ID ?? "",
    ALPACA_SECRET_KEY: process.env.ALPACA_API_SECRET_KEY ?? "",
    // Paper trading is the default; ensure we never accidentally hit live.
    ALPACA_LIVE_TRADE: process.env.ALPACA_LIVE_TRADE ?? "false",
  };
}

export interface AlpacaCliSubmitArgs {
  symbol: string;
  qty: string;
  side: "buy" | "sell";
  type: string;
  limitPrice?: string;
  clientOrderId?: string;
}

export interface AlpacaCliOrder {
  id: string;
  status: string;
  filled_avg_price: string | null;
  filled_qty: string | null;
  client_order_id: string | null;
  symbol: string;
  [key: string]: unknown;
}

export interface AlpacaCliHealth {
  healthy: boolean;
  version: string | null;
  details: Record<string, unknown>;
}

export interface AlpacaCliOptions {
  /** Exec to override (tests). Must follow Node callback pattern. */
  execFileOverride?: (
    file: string,
    args: readonly string[],
    options: Record<string, unknown>,
    callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
  ) => void;
}

export class AlpacaCli {
  private cliCmd: string;
  private execFileAsync: typeof execFileAsync;

  constructor(opts: AlpacaCliOptions = {}) {
    this.cliCmd = opts.execFileOverride ? "alpaca" : AlpacaCli.resolveBinarySync();
    this.execFileAsync = opts.execFileOverride
      ? (promisify(opts.execFileOverride) as unknown as typeof execFileAsync)
      : execFileAsync;
  }

  /** Resolve the `alpaca` binary to an absolute path, or "alpaca" if on PATH. */
  static resolveBinarySync(): string {
    for (const candidate of ALPACA_CLI_CANDIDATE_PATHS) {
      const expanded = candidate.replace("~", process.env.HOME ?? "/root");
      if (existsSync(expanded)) return expanded;
    }
    return "alpaca";
  }

  private async run(args: readonly string[], timeoutMs: number, label: string): Promise<string> {
    try {
      const { stdout } = await withTimeout(
        this.execFileAsync(this.cliCmd, args, { env: cliEnv(), timeout: timeoutMs }),
        timeoutMs,
        `alpaca-cli:${label}`,
      );
      return stdout;
    } catch (err) {
      // execFile wraps the CLI's stderr + exit code into the error.
      const msg = err instanceof Error ? err.message : String(err);
      const e = new Error(`Alpaca CLI ${label} failed: ${msg}`) as Error & { stderr?: string };
      // Extract stderr for logging when available.
      const anyErr = err as { stderr?: string };
      if (anyErr.stderr) e.stderr = anyErr.stderr.slice(0, 400);
      throw e;
    }
  }

  /**
   * Submit an order via the CLI, returning the parsed order.
   * Uses `--client-order-id` for idempotency so a retry of the same logical
   * order can't double-submit (the CLI/API rejects duplicate client IDs).
   */
  async submitOrder(args: AlpacaCliSubmitArgs): Promise<AlpacaCliOrder> {
    const cliArgs = [
      "order",
      "submit",
      "--symbol", args.symbol,
      "--qty", args.qty,
      "--side", args.side,
      "--type", args.type,
      "--time-in-force", "day",
    ];
    if (args.limitPrice) cliArgs.push("--limit-price", args.limitPrice);
    if (args.clientOrderId) cliArgs.push("--client-order-id", args.clientOrderId);
    const stdout = await this.run(cliArgs, 30000, "order submit");
    return JSON.parse(stdout) as AlpacaCliOrder;
  }

  /**
   * Liquidate an open position. The binary's flag is `--symbol-or-asset-id`
   * (not `--symbol`) — that's the path the VPS CLI actually documents.
   */
  async closePosition(symbol: string): Promise<AlpacaCliOrder> {
    const stdout = await this.run(
      ["position", "close", "--symbol-or-asset-id", symbol],
      30000,
      "position close",
    );
    return JSON.parse(stdout) as AlpacaCliOrder;
  }

  /** Health check: binary version + a read-only account call. */
  async healthCheck(): Promise<AlpacaCliHealth> {
    let version: string | null = null;
    try {
      const vOut = await this.run(["version"], 5000, "version");
      // The CLI prints the bare version ("0.0.14"); tolerate a JSON-encoded
      // string variant too.
      version = vOut.trim().replace(/^"+|"+$/g, "").split("\n")[0] ?? null;
    } catch {
      return { healthy: false, version: null, details: { error: "alpaca not found" } };
    }
    try {
      const accountOut = await this.run(["account", "get"], 15000, "account get");
      const account = JSON.parse(accountOut) as { status?: string; equity?: string; buying_power?: string };
      return {
        healthy: account.status === "ACTIVE",
        version,
        details: { status: account.status, equity: account.equity, buyingPower: account.buying_power },
      };
    } catch (err) {
      return {
        healthy: false,
        version,
        details: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  }
}

/** Module-level default (resolves the binary once). */
let _instance: AlpacaCli | null = null;
export function getAlpacaCli(): AlpacaCli {
  if (!_instance) _instance = new AlpacaCli();
  return _instance;
}
