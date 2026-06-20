/**
 * TWAK Executor
 *
 * Trust Wallet Agent Kit integration for the BNB Hack trading agent.
 * Wraps the `twak` CLI as a typed interface. Supports both live execution
 * and a simulator mode for testing without a live TWAK connection.
 *
 * Uses execAsync (child_process.execFile) instead of execSync to avoid
 * blocking the event loop during CLI operations.
 *
 * Auth: TWAK_ACCESS_ID + TWAK_HMAC_SECRET (env vars, configured via Pinata secrets)
 *
 * Two modes:
 *   - live:   spawns `twak` CLI commands via child_process
 *   - simulator: in-memory mock for testing the agent loop
 *
 * The agent uses Agent Wallet Mode (autonomous, pre-configured rules).
 * TWAK handles self-custody signing — the agent never touches the private key.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AGENT_CONFIG } from "./config.js";
import { isEligibleToken } from "./constants.js";

const execFileAsync = promisify(execFile);

// =============================================================================
// Types
// =============================================================================

export type { SwapRequest, SwapResult, BalanceEntry, TwakPortfolio, RegistrationResult, TwakHealth, TwakConfig };

// =============================================================================
// Retry Helper
// =============================================================================

/**
 * Retry an async function with exponential backoff.
 * Only retries on network-like errors (not business logic errors).
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    label: string;
    maxRetries?: number;
    baseDelayMs?: number;
    timeoutMs?: number;
  }
): Promise<T> {
  const maxRetries = options.maxRetries ?? 2;
  const baseDelay = options.baseDelayMs ?? 1000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt); // 1s, 2s, 4s...
        console.log(`  [${options.label}] Retry ${attempt + 1}/${maxRetries} in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}

// =============================================================================
// Retained Types (moved outside export for clarity)
// =============================================================================

interface TwakConfig {
  accessId?: string;
  hmacSecret?: string;
  /** Agent wallet address (set after registration or config) */
  agentAddress?: string;
  /** Simulation mode — no real execution */
  simulator?: boolean;
  /** BSC testnet or mainnet */
  testnet?: boolean;
  /** Slippage in basis points (default: 100 = 1%) */
  defaultSlippageBps?: number;
  /**
   * For testing: inject a custom execFile implementation.
   * Must follow Node.js callback pattern: (file, args, options, callback) => void.
   */
  execFileOverride?: (
    file: string,
    args: readonly string[],
    options: Record<string, unknown>,
    callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
  ) => void;
}

interface SwapRequest {
  tokenIn: string;
  tokenOut: string;
  amountIn: string; // string to handle decimal precision
  slippageBps?: number;
  chain?: string;
}

interface SwapResult {
  success: boolean;
  txHash?: string;
  explorerUrl?: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut?: string;
  feeUsd?: number;
  error?: string;
  timestamp: number;
}

interface BalanceEntry {
  token: string;
  symbol: string;
  balance: string;
  valueUsd: number;
  chain: string;
}

interface TwakPortfolio {
  totalValueUsd: number;
  positions: BalanceEntry[];
  chains: string[];
  lastUpdated: number;
}

interface RegistrationResult {
  success: boolean;
  agentAddress?: string;
  txHash?: string;
  explorerUrl?: string;
  error?: string;
}

interface TwakHealth {
  available: boolean;
  version?: string;
  agentAddress?: string;
  mode: "live" | "simulator";
  testnet: boolean;
}

// =============================================================================
// TWAK Executor
// =============================================================================

export class TwakExecutor {
  private config: Required<Omit<TwakConfig, "execFileOverride">>;
  private simulatorBalances: Map<string, BalanceEntry> = new Map();
  private simulatorPortfolio: TwakPortfolio = {
    totalValueUsd: 10000, // Starting simulated portfolio
    positions: [],
    chains: ["bsc"],
    lastUpdated: Date.now(),
  };
  private simulatorSwapHistory: SwapResult[] = [];
  private lastQuote: { tokenIn: string; tokenOut: string; amountIn: string; amountOut: string; price: number } | null = null;

  /** Promisified execFile for async CLI calls (supports DI for testing). */
  private execFileAsync: typeof execFileAsync;

  constructor(config: TwakConfig = {}) {
    this.config = {
      accessId: config.accessId || process.env.TWAK_ACCESS_ID || "",
      hmacSecret: config.hmacSecret || process.env.TWAK_HMAC_SECRET || "",
      // AGENT_WALLET_KEY matches the secret declared in manifest.json
      agentAddress: config.agentAddress || process.env.AGENT_WALLET_KEY || "",
      simulator: config.simulator ?? !process.env.TWAK_ACCESS_ID,
      testnet: config.testnet ?? true,
      defaultSlippageBps: config.defaultSlippageBps ?? AGENT_CONFIG.trading.defaultSlippageBps,
    };

    // Dependency injection: use custom execFile override for testing, or real one
    this.execFileAsync = config.execFileOverride
      ? (promisify(config.execFileOverride) as unknown as typeof execFileAsync)
      : execFileAsync;

    // Initialize simulator with demo portfolio
    if (this.config.simulator) {
      this.initSimulator();
    }
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Execute a token swap via TWAK.
   * Uses Agent Wallet Mode (autonomous) — no per-transaction approval needed.
   *
   * @returns SwapResult with tx hash or error
   */
  async executeSwap(request: SwapRequest): Promise<SwapResult> {
    // Validate token allowlist — only tokenOut (the target) must be an eligible hackathon token
    // tokenIn can be BNB (native gas token) or any stablecoin the wallet holds
    if (!isEligibleToken(request.tokenOut)) {
      return {
        success: false,
        tokenIn: request.tokenIn,
        tokenOut: request.tokenOut,
        amountIn: request.amountIn,
        error: `Token not in competition allowlist: ${request.tokenOut}`,
        timestamp: Date.now(),
      };
    }

    if (this.config.simulator) {
      return this.simulateSwap(request);
    }

    return this.executeLiveSwap(request);
  }

  /**
   * Get a quote without executing (price discovery).
   */
  async getQuote(request: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
  }): Promise<{ amountOut: string; price: number } | null> {
    if (this.config.simulator) {
      if (this.lastQuote &&
          this.lastQuote.tokenIn === request.tokenIn &&
          this.lastQuote.tokenOut === request.tokenOut &&
          this.lastQuote.amountIn === request.amountIn) {
        return { amountOut: this.lastQuote.amountOut, price: this.lastQuote.price };
      }
      const amount = parseFloat(request.amountIn);
      const mockPrice = 100;
      const mockAmountOut = ((amount * mockPrice) * 0.99).toFixed(6);
      return { amountOut: mockAmountOut, price: mockPrice };
    }

    return withRetry(() => this.liveQuote(request), {
      label: "quote",
      maxRetries: 2,
      baseDelayMs: 1000,
      timeoutMs: 15000,
    });
  }

  /**
   * Get portfolio state (all positions, total value, chain distribution).
   */
  async getPortfolio(): Promise<TwakPortfolio> {
    if (this.config.simulator) {
      return this.simulatorPortfolio;
    }

    return withRetry(() => this.livePortfolio(), {
      label: "portfolio",
      maxRetries: 2,
      baseDelayMs: 1000,
      timeoutMs: 15000,
    });
  }

  /**
   * Get balance for a specific token.
   */
  async getBalance(token: string): Promise<BalanceEntry | null> {
    if (this.config.simulator) {
      return this.simulatorBalances.get(token.toUpperCase()) ?? null;
    }

    return withRetry(() => this.liveBalance(token), {
      label: "balance",
      maxRetries: 2,
      baseDelayMs: 1000,
      timeoutMs: 10000,
    });
  }

  /**
   * Get recent transaction history.
   */
  async getHistory(limit: number = 10): Promise<SwapResult[]> {
    if (this.config.simulator) {
      return this.simulatorSwapHistory.slice(0, limit);
    }

    return withRetry(() => this.liveHistory(limit), {
      label: "history",
      maxRetries: 2,
      baseDelayMs: 1000,
      timeoutMs: 10000,
    });
  }

  /**
   * Register the agent wallet for the hackathon competition.
   */
  async registerForCompetition(): Promise<RegistrationResult> {
    if (this.config.simulator) {
      return {
        success: true,
        agentAddress: this.config.agentAddress || "0xSIMULATED_ADDRESS_FOR_TESTING",
        txHash: "0xSIMULATED_TX_HASH",
        explorerUrl: "https://testnet.bscscan.com/tx/0xSIMULATED",
      };
    }
    return this.liveRegister();
  }

  /**
   * Check if TWAK is available and configured.
   */
  async healthCheck(): Promise<TwakHealth> {
    const mode = this.config.simulator ? "simulator" : "live";

    if (this.config.simulator) {
      return {
        available: true,
        agentAddress: this.config.agentAddress || "0xSIMULATED",
        mode,
        testnet: this.config.testnet,
      };
    }

    // Check if twak CLI is installed using execFile (non-blocking)
    try {
      await this.execFileAsync("twak", ["--version"], {
        env: this.getEnv(),
        timeout: 5000,
      });
      return {
        available: true,
        mode,
        testnet: this.config.testnet,
        agentAddress: this.config.agentAddress,
      };
    } catch {
      return {
        available: false,
        mode,
        testnet: this.config.testnet,
      };
    }
  }

  // ===========================================================================
  // Live Mode (CLI-backed via execFile for non-blocking I/O)
  // ===========================================================================

  /** Shell-safe character whitelist for CLI parameters. */
  private static readonly SAFE_INPUT_RE = /^[a-zA-Z0-9._-]+$/;

  /** In-memory cache: symbol -> BEP-20 contract address (resolved via twak search). */
  private static tokenAddressCache = new Map<string, string>();

  /** Clear all caches (for testing). */
  static resetCaches(): void {
    TwakExecutor.tokenAddressCache.clear();
    TwakExecutor.liquidityCache.clear();
  }

  /** Clear only the liquidity cache (for testing address cache isolation). */
  static resetLiquidityCache(): void {
    TwakExecutor.liquidityCache.clear();
  }

  /**
   * In-memory cache: symbol -> { hasLiquidity, checkedAt }
   * Prevents re-checking the same token every cycle.
   * Cache TTL: 1 hour (liquidity doesn't change that fast).
   */
  private static liquidityCache = new Map<string, { hasLiquidity: boolean; checkedAt: number }>();
  private static readonly LIQUIDITY_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  /** Build the augmented env for CLI subprocess calls. */
  private getEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      TWAK_ACCESS_ID: this.config.accessId,
      TWAK_HMAC_SECRET: this.config.hmacSecret,
    };
  }

  /**
   * Validate that a CLI parameter contains only safe characters.
   * Prevents shell injection via crafted token symbols or amounts.
   */
  private static validateSafeInput(value: string, label: string): void {
    if (!TwakExecutor.SAFE_INPUT_RE.test(value)) {
      throw new Error(
        `Invalid ${label}: "${value}" contains unsafe characters. ` +
        `Only alphanumeric, dots, hyphens, and underscores allowed.`
      );
    }
  }

  /**
   * Execute a live swap via the TWAK CLI.
   * Tries symbol-based swap first (fast path for well-known tokens).
   * If TWAK doesn't recognize a symbol, resolves the contract address
   * via `twak search` and retries with the address.
   */
  private async executeLiveSwap(request: SwapRequest): Promise<SwapResult> {
    const chain = request.chain || "bsc";
    const slippage = request.slippageBps ?? this.config.defaultSlippageBps;

    // Check cache for resolved addresses; fall back to original symbol
    const tokenIn = this.resolveCachedToken(request.tokenIn);
    const tokenOut = this.resolveCachedToken(request.tokenOut);

    try {
      TwakExecutor.validateSafeInput(request.amountIn, "amount");
      TwakExecutor.validateSafeInput(tokenIn, "tokenIn");
      TwakExecutor.validateSafeInput(tokenOut, "tokenOut");
      TwakExecutor.validateSafeInput(chain, "chain");

      const slippagePercent = Math.max(0.1, Math.min(50, slippage / 100));
      const { stdout } = await this.execFileAsync("twak", [
        "swap",
        "--usd",
        request.amountIn,
        tokenIn,
        tokenOut,
        `--chain=${chain}`,
        `--slippage=${slippagePercent}`,
      ], {
        env: this.getEnv(),
        timeout: 30000,
      });

      return this.parseSwapOutput(stdout, request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Auto-resolve: if TWAK doesn't recognize a token, look up the address
      if (message.includes("Unknown token")) {
        console.log(`  [TWAK] Token not recognized, resolving addresses...`);
        const resolvedIn = await this.resolveTokenAddress(request.tokenIn);
        const resolvedOut = await this.resolveTokenAddress(request.tokenOut);

        if (resolvedIn || resolvedOut) {
          // Cache resolved addresses and retry the swap
          if (resolvedIn) TwakExecutor.tokenAddressCache.set(request.tokenIn.toUpperCase(), resolvedIn);
          if (resolvedOut) TwakExecutor.tokenAddressCache.set(request.tokenOut.toUpperCase(), resolvedOut);
          return this.executeLiveSwap({
            ...request,
            tokenIn: resolvedIn ?? tokenIn,
            tokenOut: resolvedOut ?? tokenOut,
          });
        }
      }

      return {
        success: false,
        tokenIn: request.tokenIn,
        tokenOut: request.tokenOut,
        amountIn: request.amountIn,
        error: `TWAK swap failed: ${message}`,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Resolve a token symbol to its BEP-20 contract address using `twak search`.
   * Caches the result so subsequent swaps don't need to search again.
   *
   * Skips if already cached or if the input is already a 0x contract address.
   */
  private async resolveTokenAddress(symbol: string): Promise<string | null> {
    const upper = symbol.toUpperCase();

    // Check cache first
    const cached = TwakExecutor.tokenAddressCache.get(upper);
    if (cached) return cached;

    // Skip symbols that look like contract addresses already
    if (symbol.startsWith("0x") && symbol.length === 42) return null;

    try {
      const { stdout } = await this.execFileAsync("twak", [
        "search",
        symbol,
        "--networks=bsc",
        "--limit=10",
        "--json",
      ], {
        env: this.getEnv(),
        timeout: 10000,
      });

      const results = JSON.parse(stdout);
      if (!Array.isArray(results) || results.length === 0) {
        console.log(`  [TWAK] No search results for ${symbol}`);
        return null;
      }

      // BSC-only results, preferring CMC-listed tokens (legitimate projects)
      const bscResults = results.filter((r: any) => r.chain === "bsc");
      if (bscResults.length === 0) return null;

      // Prefer CMC-listed tokens (have coinmarketcap logo URLs)
      const cmcToken = bscResults.find((r: any) =>
        r.logoUrl?.includes("coinmarketcap.com")
      );
      const bestMatch = cmcToken ?? bscResults[0];

      if (!bestMatch.address) return null;

      TwakExecutor.tokenAddressCache.set(upper, bestMatch.address);
      console.log(`  [TWAK] Resolved ${symbol} → ${bestMatch.address} (${bestMatch.name})`);
      return bestMatch.address;
    } catch (error) {
      console.warn(`  [TWAK] Failed to resolve token ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Check whether a token has sufficient DEX liquidity via TWAK.
   * Runs `twak swap --usd 1 BNB <token> --quote-only` and checks for a valid quote.
   * Results are cached for 1 hour to avoid redundant API calls.
   *
   * In simulator mode, always returns true (no real TWAK to check).
   */
  async checkLiquidity(symbol: string): Promise<boolean> {
    const upper = symbol.toUpperCase();

    // Simulator mode: skip real check
    if (this.config.simulator) return true;

    // Check cache first
    const cached = TwakExecutor.liquidityCache.get(upper);
    if (cached && Date.now() - cached.checkedAt < TwakExecutor.LIQUIDITY_CACHE_TTL_MS) {
      return cached.hasLiquidity;
    }

    // Resolve the token address (uses cache or twak search)
    let tokenParam = this.resolveCachedToken(upper);
    if (tokenParam === upper) {
      const resolved = await this.resolveTokenAddress(symbol);
      if (resolved) tokenParam = resolved;
    }

    try {
      TwakExecutor.validateSafeInput("1", "amount");
      TwakExecutor.validateSafeInput(tokenParam, "tokenOut");

      const { stdout, stderr } = await this.execFileAsync("twak", [
        "swap",
        "--usd",
        "1",
        "BNB",
        tokenParam,
        "--quote-only",
        "--chain=bsc",
      ], {
        env: this.getEnv(),
        timeout: 15000,
      });

      // Check for valid quote output — TWAK returns JSON with 'output:' key
      // Wrapped in quotes: output: '854.599... SLX'
      const hasQuote = /(?:amountOut|expectedOutput|received|output)[:\s]+'?[\d.]+/i.test(stdout);
      const hasRevert = /revert|insufficient|liquidity|insufficient_output/i.test(stderr + stdout);
      const result = hasQuote && !hasRevert;

      TwakExecutor.liquidityCache.set(upper, { hasLiquidity: result, checkedAt: Date.now() });
      console.log(`  [TWAK] Liquidity check: ${symbol} → ${result ? "✓" : "✗"}`);
      return result;
    } catch (error) {
      console.log(`  [TWAK] Liquidity check failed for ${symbol}:`, error instanceof Error ? error.message : String(error));
      TwakExecutor.liquidityCache.set(upper, { hasLiquidity: false, checkedAt: Date.now() });
      return false;
    }
  }

  /**
   * Check the token address cache for a resolved address.
   * Returns the cached address if found, or the original symbol if not.
   */
  private resolveCachedToken(symbol: string): string {
    return TwakExecutor.tokenAddressCache.get(symbol.toUpperCase()) ?? symbol;
  }

  private async liveQuote(request: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
  }): Promise<{ amountOut: string; price: number } | null> {
    TwakExecutor.validateSafeInput(request.amountIn, "amount");
    TwakExecutor.validateSafeInput(request.tokenIn, "tokenIn");
    TwakExecutor.validateSafeInput(request.tokenOut, "tokenOut");

    const { stdout } = await this.execFileAsync("twak", [
      "swap",
      "--usd",
      request.amountIn,
      request.tokenIn,
      request.tokenOut,
      "--quote-only",
      "--chain=bsc",
    ], {
      env: this.getEnv(),
      timeout: 15000,
    });

    const amountOutMatch = stdout.match(/(?:amountOut|expectedOutput)[:\s]+([\d.]+)/i);
    const priceMatch = stdout.match(/(?:price|rate)[:\s]+([\d.]+)/i);

    if (amountOutMatch) {
      const amountOut = amountOutMatch[1];
      const price = priceMatch ? parseFloat(priceMatch[1]) : 0;
      this.lastQuote = { ...request, amountOut, price };
      return { amountOut, price };
    }

    return null;
  }

  private async liveBalance(token: string): Promise<BalanceEntry | null> {
    TwakExecutor.validateSafeInput(token, "token");

    const { stdout } = await this.execFileAsync("twak", [
      "balance",
      token,
      "--chain=bsc",
    ], {
      env: this.getEnv(),
      timeout: 10000,
    });

    return this.parseBalanceOutput(stdout, token);
  }

  private async livePortfolio(): Promise<TwakPortfolio> {
    const { stdout } = await this.execFileAsync("twak", [
      "wallet",
      "portfolio",
    ], {
      env: this.getEnv(),
      timeout: 15000,
    });

    return this.parsePortfolioOutput(stdout);
  }

  private async liveHistory(limit: number): Promise<SwapResult[]> {
    const { stdout } = await this.execFileAsync("twak", [
      "history",
      `--limit=${limit}`,
    ], {
      env: this.getEnv(),
      timeout: 10000,
    });

    return this.parseHistoryOutput(stdout);
  }

  private async liveRegister(): Promise<RegistrationResult> {
    const { stdout } = await this.execFileAsync("twak", [
      "compete",
      "register",
    ], {
      env: this.getEnv(),
      timeout: 60000,
    });

    const addressMatch = stdout.match(/(?:address|agent|wallet)[:\s]+(0x[a-fA-F0-9]{40})/i);
    const txHashMatch = stdout.match(/(?:tx|transaction|hash)[:\s]+(0x[a-fA-F0-9]{64})/i);

    return {
      success: true,
      agentAddress: addressMatch?.[1],
      txHash: txHashMatch?.[1],
      explorerUrl: txHashMatch?.[1]
        ? `https://${this.config.testnet ? "testnet." : ""}bscscan.com/tx/${txHashMatch[1]}`
        : undefined,
    };
  }

  // ===========================================================================
  // Simulator Mode (in-memory mock for testing)
  // ===========================================================================

  private initSimulator(): void {
    const startingBalance: BalanceEntry[] = [
      { token: "BNB", symbol: "BNB", balance: "10.0", valueUsd: 6000, chain: "bsc" },
      { token: "USDC", symbol: "USDC", balance: "3000.0", valueUsd: 3000, chain: "bsc" },
      { token: "ETH", symbol: "ETH", balance: "0.5", valueUsd: 1000, chain: "bsc" },
    ];

    for (const entry of startingBalance) {
      this.simulatorBalances.set(entry.token.toUpperCase(), entry);
    }

    this.simulatorPortfolio = {
      totalValueUsd: startingBalance.reduce((sum, e) => sum + e.valueUsd, 0),
      positions: startingBalance,
      chains: ["bsc"],
      lastUpdated: Date.now(),
    };
  }

  private async simulateSwap(request: SwapRequest): Promise<SwapResult> {
    const amount = parseFloat(request.amountIn);
    if (amount <= 0) {
      return {
        success: false,
        tokenIn: request.tokenIn,
        tokenOut: request.tokenOut,
        amountIn: request.amountIn,
        error: "Invalid amount",
        timestamp: Date.now(),
      };
    }

    const inBalance = this.simulatorBalances.get(request.tokenIn.toUpperCase());
    if (!inBalance || parseFloat(inBalance.balance) < amount) {
      return {
        success: false,
        tokenIn: request.tokenIn,
        tokenOut: request.tokenOut,
        amountIn: request.amountIn,
        error: `Insufficient ${request.tokenIn} balance (have ${inBalance?.balance ?? 0})`,
        timestamp: Date.now(),
      };
    }

    const mockPriceIn = this.getMockPrice(request.tokenIn);
    const mockPriceOut = this.getMockPrice(request.tokenOut);
    const slippageMultiplier = 1 - ((request.slippageBps ?? this.config.defaultSlippageBps) / 10000);
    const amountOut = ((amount * mockPriceIn) / mockPriceOut) * slippageMultiplier;

    const inNewBalance = (parseFloat(inBalance.balance) - amount).toFixed(6);
    this.simulatorBalances.set(request.tokenIn.toUpperCase(), {
      ...inBalance,
      balance: inNewBalance,
      valueUsd: parseFloat(inNewBalance) * mockPriceIn,
    });

    const outSymbol = request.tokenOut.toUpperCase();
    const outBalance = this.simulatorBalances.get(outSymbol);
    if (outBalance) {
      const outNewBalance = (parseFloat(outBalance.balance) + amountOut).toFixed(6);
      this.simulatorBalances.set(outSymbol, {
        ...outBalance,
        balance: outNewBalance,
        valueUsd: parseFloat(outNewBalance) * mockPriceOut,
      });
    } else {
      this.simulatorBalances.set(outSymbol, {
        token: request.tokenOut,
        symbol: request.tokenOut,
        balance: amountOut.toFixed(6),
        valueUsd: amountOut * mockPriceOut,
        chain: "bsc",
      });
    }

    const allPositions = Array.from(this.simulatorBalances.values());
    this.simulatorPortfolio = {
      totalValueUsd: allPositions.reduce((sum, p) => sum + p.valueUsd, 0),
      positions: allPositions,
      chains: ["bsc"],
      lastUpdated: Date.now(),
    };

    this.lastQuote = {
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: request.amountIn,
      amountOut: amountOut.toFixed(6),
      price: mockPriceOut / mockPriceIn,
    };

    const txHash = `0xSIMULATED_${Date.now().toString(16)}`;
    const result: SwapResult = {
      success: true,
      txHash,
      explorerUrl: this.config.testnet
        ? `https://testnet.bscscan.com/tx/${txHash}`
        : `https://bscscan.com/tx/${txHash}`,
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: request.amountIn,
      amountOut: amountOut.toFixed(6),
      feeUsd: 0.01,
      timestamp: Date.now(),
    };

    this.simulatorSwapHistory.push(result);
    return result;
  }

  private getMockPrice(symbol: string): number {
    const prices: Record<string, number> = {
      BNB: 600,
      USDC: 1,
      USDT: 1,
      ETH: 2000,
      BTC: 67000,
      SOL: 140,
      DOGE: 0.12,
      XRP: 0.5,
      CAKE: 2.5,
      TWT: 1.2,
    };
    return prices[symbol.toUpperCase()] ?? 10;
  }

  // ===========================================================================
  // Output Parsing (live mode CLI output → typed data)
  // ===========================================================================

  private parseSwapOutput(output: string, request: SwapRequest): SwapResult {
    const txHashMatch = output.match(/(?:tx|transaction|hash)[:\s]+(0x[a-fA-F0-9]{64})/i);
    const amountOutMatch = output.match(/(?:amountOut|received|output)[:\s]+([\d.]+)/i);

    return {
      success: true,
      txHash: txHashMatch?.[1],
      explorerUrl: txHashMatch?.[1]
        ? `https://${this.config.testnet ? "testnet." : ""}bscscan.com/tx/${txHashMatch[1]}`
        : undefined,
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: request.amountIn,
      amountOut: amountOutMatch?.[1],
      timestamp: Date.now(),
    };
  }

  private parseBalanceOutput(output: string, token: string): BalanceEntry | null {
    const balanceMatch = output.match(/(?:balance|amount)[:\s]+([\d.]+)/i);
    const valueMatch = output.match(/(?:value|usd)[:\s]*\$?([\d.]+)/i);

    if (!balanceMatch) return null;

    return {
      token,
      symbol: token.toUpperCase(),
      balance: balanceMatch[1],
      valueUsd: valueMatch ? parseFloat(valueMatch[1]) : 0,
      chain: this.config.testnet ? "bsc-testnet" : "bsc",
    };
  }

  private parsePortfolioOutput(output: string): TwakPortfolio {
    const lines = output.split("\n");
    const positions: BalanceEntry[] = [];
    let totalUsd = 0;

    for (const line of lines) {
      const match = line.match(/(\w+)[:\s]+\$?([\d.]+)/);
      if (match) {
        const symbol = match[1].toUpperCase();
        const value = parseFloat(match[2]);
        if (value > 0) {
          totalUsd += value;
          positions.push({
            token: symbol,
            symbol,
            balance: "0",
            valueUsd: value,
            chain: "bsc",
          });
        }
      }
    }

    return {
      totalValueUsd: totalUsd,
      positions,
      chains: ["bsc"],
      lastUpdated: Date.now(),
    };
  }

  private parseHistoryOutput(output: string): SwapResult[] {
    const results: SwapResult[] = [];
    const lines = output.split("\n");

    for (const line of lines) {
      const txMatch = line.match(/(0x[a-fA-F0-9]{64})/);
      if (txMatch) {
        results.push({
          success: true,
          txHash: txMatch[1],
          explorerUrl: `https://${this.config.testnet ? "testnet." : ""}bscscan.com/tx/${txMatch[1]}`,
          tokenIn: "",
          tokenOut: "",
          amountIn: "",
          timestamp: Date.now(),
        });
      }
    }

    return results;
  }
}

// =============================================================================
// Singleton
// =============================================================================

/**
 * Default TWAK executor instance.
 * Auto-detects simulator mode based on whether TWAK_ACCESS_ID is set.
 */
export const twakExecutor = new TwakExecutor();
