/**
 * Tests for the Alpaca CLI wrapper (alpaca-cli.ts).
 *
 * Uses dependency injection via execFileOverride (constructor option) instead
 * of vi.mock — avoids Node.js built-in module mocking issues, mirroring the
 * twak-executor.test.ts approach.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { AlpacaCli, type AlpacaCliOptions } from "../lib/adapters/alpaca-cli.js";

type ExecFileCallback = (
  error: Error | null,
  result: { stdout: string; stderr: string },
) => void;

type ExecFileOverride = NonNullable<AlpacaCliOptions["execFileOverride"]>;

/** Create a FIFO queue of execFile responses for testing. */
function createResponseQueue(): {
  execFileOverride: ExecFileOverride;
  queue: Array<ExecFileCallback | Error>;
  calls: Array<{ file: string; args: readonly string[] }>;
} {
  const queue: Array<ExecFileCallback | Error> = [];
  const calls: Array<{ file: string; args: readonly string[] }> = [];
  const execFileOverride: ExecFileOverride = (
    file: string,
    args: readonly string[],
    _options: Record<string, unknown>,
    callback: ExecFileCallback,
  ) => {
    calls.push({ file, args });
    const next = queue.shift();
    if (!next) {
      callback(new Error("queue empty"), { stdout: "", stderr: "" });
      return;
    }
    if (next instanceof Error) {
      callback(next, { stdout: "", stderr: "" });
      return;
    }
    // The queued item is a function that MUTATES a fresh result object; then
    // we pass that result to the real callback (promisified execFile).
    const result = { stdout: "", stderr: "" };
    next(null, result);
    callback(null, result);
  };
  return { execFileOverride, queue, calls };
}

/** Push a JSON stdout response onto the queue. */
function queueJson(queue: Array<ExecFileCallback | Error>, data: unknown): void {
  queue.push((_err, result) => {
    result.stdout = JSON.stringify(data);
    result.stderr = "";
  });
}

function queueError(queue: Array<ExecFileCallback | Error>, msg: string): void {
  queue.push(new Error(msg));
}

describe("AlpacaCli — submitOrder", () => {
  let mock: ReturnType<typeof createResponseQueue>;

  beforeEach(() => {
    mock = createResponseQueue();
  });

  it("resolves the binary from the candidate path", () => {
    // ~/.local/bin/alpaca exists on the test host? Just assert the resolver
    // returns a non-empty string deterministically.
    expect(AlpacaCli.resolveBinarySync().length).toBeGreaterThan(0);
  });

  it("sends the right CLI args and parses the JSON order", async () => {
    queueJson(mock.queue, {
      id: "cli-order-1",
      status: "accepted",
      symbol: "AAPL260909C00230000",
      filled_avg_price: null,
      filled_qty: null,
      client_order_id: "enw-AAPL260909C00230000-123",
    });
    const cli = new AlpacaCli({ execFileOverride: mock.execFileOverride });
    const order = await cli.submitOrder({
      symbol: "AAPL260909C00230000",
      qty: "1",
      side: "buy",
      type: "market",
      clientOrderId: "enw-AAPL260909C00230000-123",
    });
    expect(order.id).toBe("cli-order-1");
    expect(order.status).toBe("accepted");
    // The args must include the actual CLI command shape.
    const args = mock.calls[0].args;
    expect(args.slice(0, 2)).toEqual(["order", "submit"]);
    expect(args).toContain("--client-order-id");
  });

  it("throws when the CLI errors (non-zero exit / missing binary)", async () => {
    queueError(mock.queue, "spawn alpaca ENOENT");
    const cli = new AlpacaCli({ execFileOverride: mock.execFileOverride });
    await expect(cli.submitOrder({ symbol: "AAPL", qty: "1", side: "buy", type: "market" }) as Promise<unknown>).rejects.toThrow(/Alpaca CLI/);
  });

  it("includes a limit price when provided", async () => {
    queueJson(mock.queue, { id: "o-2", status: "new", symbol: "X", filled_avg_price: null, filled_qty: null, client_order_id: "c-2" });
    const cli = new AlpacaCli({ execFileOverride: mock.execFileOverride });
    await cli.submitOrder({ symbol: "X", qty: "1", side: "buy", type: "limit", limitPrice: "1.25", clientOrderId: "c-2" });
    const args = mock.calls[0].args;
    expect(args).toContain("--type");
    expect(args[args.indexOf("--type") + 1]).toBe("limit");
    expect(args).toContain("--limit-price");
    expect(args[args.indexOf("--limit-price") + 1]).toBe("1.25");
  });
});

describe("AlpacaCli — healthCheck", () => {
  let mock: ReturnType<typeof createResponseQueue>;

  beforeEach(() => {
    mock = createResponseQueue();
  });

  it("reports healthy with version + ACTIVE account", async () => {
    queueJson(mock.queue, "0.0.14");
    queueJson(mock.queue, { status: "ACTIVE", equity: "100000", buying_power: "400000" });
    const cli = new AlpacaCli({ execFileOverride: mock.execFileOverride });
    const health = await cli.healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.version).toBe("0.0.14");
    expect(health.details.status).toBe("ACTIVE");
  });

  it("reports unhealthy when the binary is missing", async () => {
    queueError(mock.queue, "spawn alpaca ENOENT");
    const cli = new AlpacaCli({ execFileOverride: mock.execFileOverride });
    const health = await cli.healthCheck();
    expect(health.healthy).toBe(false);
    expect(health.version).toBeNull();
  });

  it("reports unhealthy when the account call fails", async () => {
    queueJson(mock.queue, "0.0.14");
    queueError(mock.queue, "alpaca account get failed");
    const cli = new AlpacaCli({ execFileOverride: mock.execFileOverride });
    const health = await cli.healthCheck();
    expect(health.healthy).toBe(false);
    expect(health.version).toBe("0.0.14");
    expect(health.details.error).toContain("failed");
  });
});
