/**
 * Tests for TwakExecutor
 *
 * Covers: token address resolution, liquidity check, allowlist validation,
 * cache behavior, and simulator mode.
 *
 * Uses dependency injection via execFileOverride (constructor option)
 * instead of vi.mock — avoids Node.js built-in module mocking issues.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TwakExecutor } from "../lib/twak-executor.js";

// =============================================================================
// Helper: mock callback-style execFile builder
// =============================================================================

type ExecFileCallback = (
  error: Error | null,
  result: { stdout: string; stderr: string }
) => void;

type ExecFileOverride = (
  file: string,
  args: readonly string[],
  options: Record<string, unknown>,
  callback: ExecFileCallback
) => void;

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
    callback: ExecFileCallback
  ) => {
    calls.push({ file, args });
    const next = queue.shift();
    if (next instanceof Error) {
      callback(next, { stdout: "", stderr: "" });
    } else {
      // Create a result object, let the queue entry mutate it, then pass it
      // to the original callback so promisify resolves with the modified result.
      const result = { stdout: "", stderr: "" };
      if (next) {
        next(null, result);
      }
      callback(null, result);
    }
  };

  return { execFileOverride, queue, calls };
}

// =============================================================================
// Mock output generators
// =============================================================================

function searchResult(symbol: string, address: string, chain = "bsc", hasCmcLogo = true) {
  return JSON.stringify([{
    name: symbol === "SLX" ? "SLIMEX" : `${symbol} Token`,
    symbol, address, chain, decimals: 18,
    logoUrl: hasCmcLogo ? "https://s2.coinmarketcap.com/static/img/coins/200x200/12345.png" : undefined,
    priceUsd: 1.0, priceChange24h: 0,
  }]);
}

function searchResults(results: { symbol: string; address: string; chain: string; hasCmcLogo: boolean }[]) {
  return JSON.stringify(results.map(r => ({
    name: r.symbol === "SLX" ? "SLIMEX" : `${r.symbol} Token`,
    symbol: r.symbol, address: r.address, chain: r.chain, decimals: 18,
    logoUrl: r.hasCmcLogo ? "https://s2.coinmarketcap.com/static/img/coins/200x200/12345.png" : undefined,
    priceUsd: 1.0, priceChange24h: 0,
  })));
}

function quoteOutput(amountOut: string) {
  return `$1 USD ≈ 1.000270138585481527 USDC (@ $0.9997299343696658)\n{\n  input: '1.000270138585481527 USDC',\n  output: '${amountOut} TOKEN',\n  minReceived: '${(+amountOut * 0.99).toFixed(6)} TOKEN',\n  provider: 'LiquidMesh',\n  priceImpact: '0'\n}`;
}

// =============================================================================
// Helpers: set up mock response sequences
// =============================================================================

function queueSearch(
  queue: Array<ExecFileCallback | Error>,
  symbol: string,
  address: string,
  chain = "bsc"
): void {
  queue.push((_err, result) => {
    result.stdout = searchResult(symbol, address, chain);
    result.stderr = "";
  });
}

function queueSearchResults(
  queue: Array<ExecFileCallback | Error>,
  results: { symbol: string; address: string; chain: string; hasCmcLogo: boolean }[]
): void {
  queue.push((_err, result) => {
    result.stdout = searchResults(results);
    result.stderr = "";
  });
}

function queueEmptySearch(queue: Array<ExecFileCallback | Error>): void {
  queue.push((_err, result) => {
    result.stdout = JSON.stringify([]);
    result.stderr = "";
  });
}

function queueQuote(queue: Array<ExecFileCallback | Error>, amountOut: string): void {
  queue.push((_err, result) => {
    result.stdout = quoteOutput(amountOut);
    result.stderr = "";
  });
}

function queueEmptyQuote(queue: Array<ExecFileCallback | Error>, stdout: string): void {
  queue.push((_err, result) => {
    result.stdout = stdout;
    result.stderr = "";
  });
}

function queueError(queue: Array<ExecFileCallback | Error>, message: string): void {
  queue.push(new Error(message));
}

function queueMalformedJson(queue: Array<ExecFileCallback | Error>): void {
  queue.push((_err, result) => {
    result.stdout = "not valid json";
    result.stderr = "";
  });
}

// =============================================================================
// Tests
// =============================================================================

describe("TwakExecutor — Simulator Mode", () => {
  let executor: TwakExecutor;

  beforeEach(() => {
    executor = new TwakExecutor({ simulator: true });
  });

  it("checkLiquidity returns true in simulator mode", async () => {
    expect(await executor.checkLiquidity("SLX")).toBe(true);
  });

  it("executeSwap simulates successfully with BNB", async () => {
    const result = await executor.executeSwap({
      tokenIn: "BNB", tokenOut: "SLX", amountIn: "1",
    });
    expect(result.success).toBe(true);
    expect(result.txHash).toContain("0xSIMULATED");
  });

  it("executeSwap rejects non-eligible tokenOut", async () => {
    const result = await executor.executeSwap({
      tokenIn: "BNB", tokenOut: "INVALIDCOIN", amountIn: "12",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Token not in competition allowlist");
  });
});

describe("TwakExecutor — Allowlist Validation", () => {
  let executor: TwakExecutor;

  beforeEach(() => {
    executor = new TwakExecutor({ simulator: true });
  });

  it("allows BNB as tokenIn (native gas token not in eligible list)", async () => {
    const result = await executor.executeSwap({
      tokenIn: "BNB", tokenOut: "SLX", amountIn: "1",
    });
    expect(result.success).toBe(true);
  });

  it("allows USDC as tokenIn (stablecoin in allowlist)", async () => {
    const result = await executor.executeSwap({
      tokenIn: "USDC", tokenOut: "SLX", amountIn: "1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-eligible tokenOut (BNB is not in eligible tokens)", async () => {
    const result = await executor.executeSwap({
      tokenIn: "USDC", tokenOut: "BNB", amountIn: "12",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Token not in competition allowlist");
  });

  it("rejects completely unknown tokenOut", async () => {
    const result = await executor.executeSwap({
      tokenIn: "BNB", tokenOut: "TOTALLY_FAKE", amountIn: "12",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Token not in competition allowlist");
  });
});

describe("TwakExecutor — Token Address Resolution", () => {
  let mock: ReturnType<typeof createResponseQueue>;
  let executor: TwakExecutor;

  beforeEach(() => {
    TwakExecutor.resetCaches();
    mock = createResponseQueue();
    executor = new TwakExecutor({
      simulator: false,
      testnet: true,
      execFileOverride: mock.execFileOverride,
    });
  });

  it("resolves address and verifies liquidity", async () => {
    queueSearch(mock.queue, "SLX", "0x8A063A9ff4dE28dcB87117cc759BE6cE70e09F81");
    queueQuote(mock.queue, "854.599978068370381711");

    expect(await executor.checkLiquidity("SLX")).toBe(true);
    expect(mock.calls).toHaveLength(2);

    const searchCall = mock.calls[0];
    expect(searchCall.file).toBe("twak");
    expect(searchCall.args).toContain("search");

    const quoteCall = mock.calls[1];
    expect(quoteCall.args).toContain("swap");
    expect(quoteCall.args).toContain("--quote-only");
  });

  it("prefers CMC-listed tokens over meme tokens", async () => {
    queueSearchResults(mock.queue, [
      { symbol: "SLX", address: "0xFAKE", chain: "bsc", hasCmcLogo: false },
      { symbol: "SLX", address: "0x8A063A9ff4dE28dcB87117cc759BE6cE70e09F81", chain: "bsc", hasCmcLogo: true },
    ]);
    queueQuote(mock.queue, "854.5");

    expect(await executor.checkLiquidity("SLX")).toBe(true);

    // The CMC-listed address should be used for the quote
    const quoteArgs = mock.calls[1].args;
    expect(quoteArgs.join(" ")).toContain("0x8A063A9ff4dE28dcB87117cc759BE6cE70e09F81");
  });

  it("returns false for tokens not found on BSC", async () => {
    queueEmptySearch(mock.queue);

    expect(await executor.checkLiquidity("UNKNOWN_TOKEN")).toBe(false);
  });

  it("caches resolved addresses for subsequent calls", async () => {
    // First call: search + quote
    queueSearch(mock.queue, "SLX", "0x8A063A9ff4dE28dcB87117cc759BE6cE70e09F81");
    queueQuote(mock.queue, "854.6");
    await executor.checkLiquidity("SLX");
    expect(mock.calls).toHaveLength(2);

    // Clear liquidity cache but KEEP address cache (so quote re-runs with cached address)
    TwakExecutor.resetLiquidityCache();
    mock.calls.length = 0;
    mock.queue.length = 0;
    queueQuote(mock.queue, "854.6");

    expect(await executor.checkLiquidity("SLX")).toBe(true);
    expect(mock.calls).toHaveLength(1); // only quote (address cached, no search)
    expect(mock.calls[0].args).toContain("swap");
  });

  it("handles search CLI failure gracefully", async () => {
    queueError(mock.queue, "CLI not found");

    expect(await executor.checkLiquidity("SLX")).toBe(false);
  });
});

describe("TwakExecutor — Liquidity Check", () => {
  let mock: ReturnType<typeof createResponseQueue>;
  let executor: TwakExecutor;

  beforeEach(() => {
    TwakExecutor.resetCaches();
    mock = createResponseQueue();
    executor = new TwakExecutor({
      simulator: false,
      testnet: true,
      execFileOverride: mock.execFileOverride,
    });
  });

  it("returns true for a valid quote", async () => {
    queueSearch(mock.queue, "AXS", "0x715D400F88C167884bbCc41C5FeA407ed4D2f8A0");
    queueQuote(mock.queue, "10.5");

    expect(await executor.checkLiquidity("AXS")).toBe(true);
    expect(mock.calls).toHaveLength(2);
  });

  it("returns false when quote has no output value", async () => {
    queueSearch(mock.queue, "SLX", "0x8A063A9ff4dE28dcB87117cc759BE6cE70e09F81");
    queueEmptyQuote(mock.queue, "No route found");

    expect(await executor.checkLiquidity("SLX")).toBe(false);
  });

  it("returns false when quote CLI throws", async () => {
    queueSearch(mock.queue, "SLX", "0x8A063A9ff4dE28dcB87117cc759BE6cE70e09F81");
    queueError(mock.queue, "execution reverted: insufficient liquidity");

    expect(await executor.checkLiquidity("SLX")).toBe(false);
  });

  it("uses cached liquidity result for repeated checks", async () => {
    // First check: search + quote
    queueSearch(mock.queue, "BSB", "0x595dEaad1eB5476Ff1E649fDb7EFC36F1E4679cc");
    queueQuote(mock.queue, "3.2");
    await executor.checkLiquidity("BSB");
    expect(mock.calls).toHaveLength(2);

    // Second check uses liquidity cache
    mock.calls.length = 0;
    mock.queue.length = 0;

    expect(await executor.checkLiquidity("BSB")).toBe(true);
    expect(mock.calls).toHaveLength(0); // no CLI calls
  });

  it("passes correct flags to quote command", async () => {
    queueSearch(mock.queue, "SLX", "0x8A063A9ff4dE28dcB87117cc759BE6cE70e09F81");
    queueQuote(mock.queue, "854.6");

    await executor.checkLiquidity("SLX");

    const quoteArgs = mock.calls[1].args;
    expect(quoteArgs).toContain("--usd");
    expect(quoteArgs).toContain("1");
    expect(quoteArgs).toContain("--quote-only");
    expect(quoteArgs).toContain("--chain=bsc");
  });
});

describe("TwakExecutor — Edge Cases", () => {
  let mock: ReturnType<typeof createResponseQueue>;
  let executor: TwakExecutor;

  beforeEach(() => {
    TwakExecutor.resetCaches();
    mock = createResponseQueue();
    executor = new TwakExecutor({
      simulator: false,
      testnet: true,
      execFileOverride: mock.execFileOverride,
    });
  });

  it("handles empty search results", async () => {
    queueEmptySearch(mock.queue);
    expect(await executor.checkLiquidity("RANDOM")).toBe(false);
  });

  it("handles non-BSC search results", async () => {
    queueSearchResults(mock.queue, [
      { symbol: "TEST", address: "0x1234", chain: "ethereum", hasCmcLogo: true },
    ]);
    expect(await executor.checkLiquidity("TEST")).toBe(false);
  });

  it("handles malformed JSON from search", async () => {
    queueMalformedJson(mock.queue);
    expect(await executor.checkLiquidity("SLX")).toBe(false);
  });
});
