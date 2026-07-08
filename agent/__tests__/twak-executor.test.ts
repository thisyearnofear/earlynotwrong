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
import { TwakExecutor, selectBestTokenMatch, parseSwapFeeUsd } from "../lib/twak-executor.js";

describe("parseSwapFeeUsd — TWAK output gas extraction", () => {
  it("parses 'gas: $0.42'", () => {
    expect(parseSwapFeeUsd("Swap complete. gas: $0.42 paid")).toBe(0.42);
  });
  it("parses 'gas cost: $1.23'", () => {
    expect(parseSwapFeeUsd("tx confirmed\ngas cost: $1.23")).toBe(1.23);
  });
  it("parses 'fee: 0.55 USD'", () => {
    expect(parseSwapFeeUsd("fee: 0.55 USD")).toBe(0.55);
  });
  it("parses 'Network fee: $2.10'", () => {
    expect(parseSwapFeeUsd("Network fee: $2.10")).toBe(2.10);
  });
  it("returns null when no gas info present", () => {
    expect(parseSwapFeeUsd("Hash: 0xabc Amount out: 1.5")).toBeNull();
  });
  it("returns null for empty input", () => {
    expect(parseSwapFeeUsd("")).toBeNull();
  });
  it("rejects implausible values (>= $1000)", () => {
    expect(parseSwapFeeUsd("gas: $1500.00")).toBeNull();
  });
  it("accepts integer-only values", () => {
    expect(parseSwapFeeUsd("fee: $1")).toBe(1);
  });
});

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
    // The CMC-listed entry has a real market cap; scam lookalikes don't.
    // The resolver now uses marketCap as the tiebreaker (logoUrl is too easy
    // to spoof; KaiChain abused that to outrank the real Injective listing).
    priceUsd: 1.0, priceChange24h: 0,
    marketCapUsd: r.hasCmcLogo ? 1_000_000 : 0,
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

  it("allows BNB as tokenOut for selling positions (self-funding harvest)", async () => {
    const result = await executor.executeSwap({
      tokenIn: "USDC", tokenOut: "BNB", amountIn: "12",
    });
    expect(result.success).toBe(true);
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
    // Default: DexScreener gate is "passing" — these tests focus on the TWAK
    // quote leg. The DexScreener-gate behaviour gets its own describe block.
    TwakExecutor.setDexScreenerFetcher(async () => ({
      liquidityUsd: 100_000,
      volume24hUsd: 50_000,
      pairCount: 1,
    }));
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

// =============================================================================
// DexScreener liquidity gate — defence against scam/honeypot tokens
// =============================================================================

describe("TwakExecutor — DexScreener liquidity gate", () => {
  let mock: ReturnType<typeof createResponseQueue>;
  let executor: TwakExecutor;
  let dexCalls: string[];

  const stubDex = (result: { liquidityUsd: number; volume24hUsd: number; pairCount: number } | null) => {
    TwakExecutor.setDexScreenerFetcher(async (contract) => {
      dexCalls.push(contract);
      return result;
    });
  };

  beforeEach(() => {
    TwakExecutor.resetCaches();
    dexCalls = [];
    mock = createResponseQueue();
    executor = new TwakExecutor({
      simulator: false,
      testnet: true,
      execFileOverride: mock.execFileOverride,
    });
  });

  it("rejects tokens with no DEX pair (scam signal)", async () => {
    queueSearch(mock.queue, "SCAM", "0xDEADBEEF000000000000000000000000DEADBEEF");
    stubDex({ liquidityUsd: 0, volume24hUsd: 0, pairCount: 0 });

    expect(await executor.checkLiquidity("SCAM")).toBe(false);
    // TWAK quote should NOT be called — we short-circuited at the DexScreener gate.
    const quoteCalls = mock.calls.filter((c) => c.args.includes("--quote-only"));
    expect(quoteCalls).toHaveLength(0);
  });

  it("rejects shallow pools (the KAI honeypot pattern: $951 pool)", async () => {
    queueSearch(mock.queue, "KAI", "0x39Ae8EEFB05138f418Bb27659c21632Dc1DDAb10");
    stubDex({ liquidityUsd: 951, volume24hUsd: 0, pairCount: 1 });

    expect(await executor.checkLiquidity("KAI")).toBe(false);
    const quoteCalls = mock.calls.filter((c) => c.args.includes("--quote-only"));
    expect(quoteCalls).toHaveLength(0);
  });

  it("rejects tokens with $0 24h volume even if pool is deep (stale/abandoned)", async () => {
    queueSearch(mock.queue, "DEAD", "0x000000000000000000000000000000000DEAD000");
    stubDex({ liquidityUsd: 100_000, volume24hUsd: 0, pairCount: 1 });

    expect(await executor.checkLiquidity("DEAD")).toBe(false);
  });

  it("accepts tokens with deep pool and active volume (passes both gates)", async () => {
    queueSearch(mock.queue, "FET", "0x031b41e504677879370e9dbcf937283a8691fa7f");
    stubDex({ liquidityUsd: 155_000, volume24hUsd: 53_000, pairCount: 3 });
    queueQuote(mock.queue, "100.5");

    expect(await executor.checkLiquidity("FET")).toBe(true);
    expect(dexCalls).toHaveLength(1);
    expect(dexCalls[0]).toBe("0x031b41e504677879370e9dbcf937283a8691fa7f");
  });

  it("falls through to TWAK quote if DexScreener errors (transient outage)", async () => {
    queueSearch(mock.queue, "BSB", "0xa90bfBe73fDd56C9D0C25B40B0e29B05bA38EBbb");
    stubDex(null); // outage
    queueQuote(mock.queue, "100.5");

    expect(await executor.checkLiquidity("BSB")).toBe(true);
    const quoteCalls = mock.calls.filter((c) => c.args.includes("--quote-only"));
    expect(quoteCalls).toHaveLength(1);
  });

  it("requires BOTH gates: deep pool passes DexScreener but TWAK rejects", async () => {
    queueSearch(mock.queue, "REVERT", "0xa1B2c3D4e5F6789012345678901234567890ABcD");
    stubDex({ liquidityUsd: 100_000, volume24hUsd: 50_000, pairCount: 1 });
    queueEmptyQuote(mock.queue, "revert: insufficient output amount");

    expect(await executor.checkLiquidity("REVERT")).toBe(false);
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

describe("TwakExecutor — Sellability Check (honeypot gate)", () => {
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

  it("returns true when sell quote to BNB succeeds", async () => {
    queueSearch(mock.queue, "SLX", "0x8A063A9ff4dE28dcB87117cc759BE6cE70e09F81");
    queueQuote(mock.queue, "0.005");

    expect(await executor.checkSellability("SLX")).toBe(true);

    const sellQuoteCall = mock.calls.find((c) => c.args.includes("--quote-only") && c.args.includes("BNB"));
    expect(sellQuoteCall).toBeDefined();
    expect(sellQuoteCall!.args).toContain("0x8A063A9ff4dE28dcB87117cc759BE6cE70e09F81");
    expect(sellQuoteCall!.args).toContain("BNB");
  });

  it("returns false when sell quote reverts", async () => {
    queueSearch(mock.queue, "HONEY", "0xDEADBEEF000000000000000000000000DEADBEEF");
    queueEmptyQuote(mock.queue, "execution reverted: transfer amount exceeds balance");

    expect(await executor.checkSellability("HONEY")).toBe(false);
  });

  it("returns true in simulator mode without CLI calls", async () => {
    const simExecutor = new TwakExecutor({ simulator: true });
    expect(await simExecutor.checkSellability("ANY")).toBe(true);
    expect(mock.calls).toHaveLength(0);
  });

  it("caches sellability result for repeated checks", async () => {
    queueSearch(mock.queue, "SLX", "0x8A063A9ff4dE28dcB87117cc759BE6cE70e09F81");
    queueQuote(mock.queue, "0.005");
    await executor.checkSellability("SLX");
    expect(mock.calls).toHaveLength(2);

    mock.calls.length = 0;
    mock.queue.length = 0;

    expect(await executor.checkSellability("SLX")).toBe(true);
    expect(mock.calls).toHaveLength(0);
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

// =============================================================================
// Portfolio parser — regression test for the BNB-as-USD bug
//
// Bug: parser matched the first numeric token (the balance) as USD value,
// so 0.057 BNB was reported as $0.06 instead of $33. This caused the
// agent to skip all entries and double its loop interval — a phantom
// conservative mode triggered by misread BNB.
// =============================================================================

describe("TwakExecutor — Portfolio Parser", () => {
  it("parses BNB USD value from $ column, not from balance", async () => {
    // Sample TWAK `wallet portfolio` output. Note the long decimal balance
    // for BNB and the explicit $USD column at the end of each row.
    const twakPortfolioOutput = [
      "Chain        Type    Symbol            Balance               USD",
      "────────────────────────────────────────────────────────────────────────",
      "bsc          native  BNB               0.05717979978759799  $33.03",
      "bsc          token   USDC              0.648383822632066233 $0.65",
      "base         token   USDC              5                    $5.00",
      "Total USD: $38.68",
      "",
    ].join("\n");

    const queue = createResponseQueue();
    queue.queue.push((_err, result) => {
      result.stdout = twakPortfolioOutput;
      result.stderr = "";
    });

    const executor = new TwakExecutor({
      simulator: false,
      testnet: true,
      execFileOverride: queue.execFileOverride,
    });

    const portfolio = await executor.getPortfolio();

    // The critical assertion: BNB must be reported as ~$33, not $0.057.
    const bnb = portfolio.positions.find((p) => p.symbol === "BNB");
    expect(bnb).toBeDefined();
    expect(bnb!.valueUsd).toBeCloseTo(33.03, 1);

    // USDC total across BSC + Base = $5.65
    const usdcTotal = portfolio.positions
      .filter((p) => p.symbol === "USDC")
      .reduce((sum, p) => sum + p.valueUsd, 0);
    expect(usdcTotal).toBeCloseTo(5.65, 1);

    // Total should sum to $38.68
    expect(portfolio.totalValueUsd).toBeCloseTo(38.68, 1);
  });
});

// =============================================================================
// selectBestTokenMatch — scam-lookalike rejection
// =============================================================================

describe("selectBestTokenMatch", () => {
  it("rejects mismatched symbols (KaiChain when INJ was requested)", () => {
    const results = [
      { symbol: "KAI", name: "KaiChain", address: "0xKAI", priceUsd: 0.07, marketCapUsd: 5_000_000 },
      { symbol: "INJ", name: "Injective", address: "0xINJ", priceUsd: 4.15, marketCapUsd: 500_000_000 },
    ];
    const best = selectBestTokenMatch(results, "INJ");
    expect(best?.address).toBe("0xINJ");
  });

  it("returns null if no result has a matching symbol", () => {
    const results = [{ symbol: "KAI", address: "0xKAI", priceUsd: 0.07 }];
    expect(selectBestTokenMatch(results, "INJ")).toBeNull();
  });

  it("rejects scam lookalikes whose price is far off the reference (fake ETH)", () => {
    const results = [
      { symbol: "ETH", name: "Fake ETH", address: "0xFAKE", priceUsd: 0.00001, marketCapUsd: 1 },
    ];
    const best = selectBestTokenMatch(results, "ETH", 1500);
    expect(best).toBeNull();
  });

  it("accepts a result whose price is near the reference price", () => {
    const results = [
      { symbol: "ETH", name: "Ethereum", address: "0xETH", priceUsd: 1480, marketCapUsd: 200_000_000_000 },
    ];
    const best = selectBestTokenMatch(results, "ETH", 1500);
    expect(best?.address).toBe("0xETH");
  });

  it("prefers higher market cap among symbol-matching, priced candidates", () => {
    const results = [
      { symbol: "USDT", address: "0xFAKE_USDT", priceUsd: 1.0, marketCapUsd: 1 },
      { symbol: "USDT", address: "0xREAL_USDT", priceUsd: 1.0, marketCapUsd: 80_000_000_000 },
    ];
    const best = selectBestTokenMatch(results, "USDT");
    expect(best?.address).toBe("0xREAL_USDT");
  });

  it("rejects dead-price results (priceUsd ≤ 0)", () => {
    const results = [
      { symbol: "RAVE", address: "0xDEAD", priceUsd: 0 },
      { symbol: "RAVE", address: "0xLIVE", priceUsd: 0.012 },
    ];
    const best = selectBestTokenMatch(results, "RAVE");
    expect(best?.address).toBe("0xLIVE");
  });

  it("returns null for empty results", () => {
    expect(selectBestTokenMatch([], "ANY")).toBeNull();
  });

  it("when a reference is supplied but no result is within ±50%, returns null", () => {
    const results = [
      { symbol: "BTC", address: "0xBTC", priceUsd: 100, marketCapUsd: 1 },
    ];
    // Real BTC ~$60k; the candidate at $100 is way off → reject.
    expect(selectBestTokenMatch(results, "BTC", 60000)).toBeNull();
  });

  it("is case-insensitive for the requested symbol", () => {
    const results = [{ symbol: "inj", address: "0xINJ", priceUsd: 4.15, marketCapUsd: 500_000_000 }];
    expect(selectBestTokenMatch(results, "INJ")?.address).toBe("0xINJ");
  });
});
