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
 * Wallet password: TWAK_WALLET_PASSWORD (or OS keychain via `twak wallet keychain save`)
 *
 * Two modes:
 *   - live:   spawns `twak` CLI commands via child_process
 *   - simulator: in-memory mock for testing the agent loop
 *
 * The agent uses Agent Wallet Mode (autonomous, pre-configured rules).
 * TWAK handles self-custody signing — the agent never touches the private key.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { AGENT_CONFIG } from "./config.js";
import { isEligibleToken } from "./config.js";

const execFileAsync = promisify(execFile);

// Common install locations for the Trust Wallet Agent Kit CLI. The installer
// may place `twak` in ~/.local/bin on Linux or /usr/local/bin on macOS. Node's
// PATH does not always include the user's shell profile paths, so we resolve
// explicitly as a fallback.
const TWAK_CANDIDATE_PATHS = [
  `${process.env.HOME}/.local/bin/twak`,
  `${process.env.HOME}/.twak/bin/twak`,
  "/usr/local/bin/twak",
  "/opt/twak/bin/twak",
  "twak",
];

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
  /** Ordered diagnostic checks performed during healthCheck(). */
  diagnostics?: string[];
  /** Actionable remediation hint when available=false. */
  help?: string;
}

export interface DexLiquidity {
  liquidityUsd: number;
  volume24hUsd: number;
  pairCount: number;
  /** Estimated buy tax from DexScreener, if reported (0-1). */
  buyTax?: number;
  /** Estimated sell tax from DexScreener, if reported (0-1). */
  sellTax?: number;
}

// =============================================================================
// Token resolution — scam-lookalike defence
// =============================================================================

interface TwakSearchResult {
  symbol?: string;
  name?: string;
  address?: string;
  priceUsd?: number;
  logo?: string | null;
  marketCapUsd?: number;
}

/**
 * Pick the legit token from `twak search` results.
 *
 * `twak search` returns CMC-listed contracts plus a long tail of scam
 * lookalikes (fake INJ, fake ETH at contract 0x000008D2…). The old code took
 * the first result with a logo — which on INJ picked KaiChain because the real
 * Injective listing had no logo. This picker is stricter:
 *
 * 1. Exact symbol match (case-insensitive) is required. A search for "INJ"
 *    must return a token whose ticker is "INJ", not "KAI".
 * 2. If a reference price (from CMC market data) is supplied, the result's
 *    priceUsd must be within ~50% of it. Fake "ETH" at $0.00001 vs real
 *    $1500 fails this hard.
 * 3. Dead-price results (priceUsd ≤ 0) are rejected.
 * 4. Among survivors, prefer the highest market cap; tie-break by highest
 *    price — that's the canonical CMC-listed contract.
 *
 * Exported for unit testing. Pure: no I/O, no caches.
 */
export function selectBestTokenMatch(
  results: TwakSearchResult[],
  requestedSymbol: string,
  referencePrice?: number,
): TwakSearchResult | null {
  const target = requestedSymbol.toUpperCase().trim();
  if (!Array.isArray(results) || results.length === 0) return null;

  const symbolMatches = results.filter(
    (r) => typeof r.symbol === "string" && r.symbol.toUpperCase().trim() === target,
  );
  if (symbolMatches.length === 0) return null;

  const priced = symbolMatches.filter(
    (r) => typeof r.priceUsd === "number" && Number.isFinite(r.priceUsd) && (r.priceUsd as number) > 0,
  );
  if (priced.length === 0) return null;

  const refOk = (r: TwakSearchResult): boolean => {
    if (typeof referencePrice !== "number" || !Number.isFinite(referencePrice) || referencePrice <= 0) {
      return true;
    }
    const p = r.priceUsd as number;
    const ratio = p / referencePrice;
    return ratio >= 0.5 && ratio <= 2.0;
  };

  const onReference = priced.filter(refOk);
  const pool = onReference.length > 0 ? onReference : (typeof referencePrice === "number" ? [] : priced);
  if (pool.length === 0) return null;

  pool.sort((a, b) => {
    const mcA = typeof a.marketCapUsd === "number" ? a.marketCapUsd : 0;
    const mcB = typeof b.marketCapUsd === "number" ? b.marketCapUsd : 0;
    if (mcA !== mcB) return mcB - mcA;
    return (b.priceUsd ?? 0) - (a.priceUsd ?? 0);
  });

  return pool[0] ?? null;
}

/**
 * Extract a USD-denominated swap fee/gas cost from TWAK CLI output.
 *
 * TWAK prints fee info in several formats over time — we accept any of:
 *   "gas: $0.42"
 *   "gas cost: $0.42"
 *   "fee: 0.42 USD"
 *   "Network fee: $0.42"
 *   "total fee: $0.42"
 *
 * Returns null when nothing matches (caller falls back to GAS_BUFFER_USD).
 * Exported for unit testing.
 */
export function parseSwapFeeUsd(output: string): number | null {
  if (!output) return null;
  const patterns = [
    /(?:gas(?:\s*cost)?|network\s*fee|total\s*fee|fee)\s*[:\-]?\s*\$\s*([\d.]+)/i,
    /(?:gas(?:\s*cost)?|network\s*fee|total\s*fee|fee)\s*[:\-]?\s*([\d.]+)\s*(?:USD|usd)/i,
  ];
  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match && match[1]) {
      const parsed = parseFloat(match[1]);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed < 1000) {
        return parsed;
      }
    }
  }
  return null;
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
      // Default to mainnet. `twak` swaps with --chain=bsc and `twak compete`
      // both target BSC mainnet for the BNB Hack live PnL window. The old
      // `?? true` default leaked the wrong network label into the Telegram
      // startup banner ("BSC Testnet 🧪") even though every swap was mainnet.
      // Override with TWAK_TESTNET=1 for explicit testnet runs.
      testnet: config.testnet ?? process.env.TWAK_TESTNET === "1",
      defaultSlippageBps: config.defaultSlippageBps ?? AGENT_CONFIG.trading.defaultSlippageBps,
    };

    // Resolve the twak binary to an absolute path when possible. The installer
    // commonly places it in ~/.local/bin, which may not be in Node's PATH.
    this.twakCmd = config.execFileOverride
      ? "twak" // overridden below
      : TwakExecutor.resolveBinarySync();

    // Dependency injection: use custom execFile override for testing, or real one
    this.execFileAsync = config.execFileOverride
      ? (promisify(config.execFileOverride) as unknown as typeof execFileAsync)
      : execFileAsync;

    // Initialize simulator with demo portfolio
    if (this.config.simulator) {
      this.initSimulator();
    }
  }

  private static resolveBinarySync(): string {
    for (const candidate of TWAK_CANDIDATE_PATHS) {
      if (candidate === "twak") continue;
      if (existsSync(candidate)) return candidate;
    }
    return "twak";
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
    if (request.tokenOut.toUpperCase() !== "BNB" && !isEligibleToken(request.tokenOut)) {
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
   *
   * If the live TWAK CLI fails, we return an empty portfolio so the cycle can
   * continue with the on-chain fallback in `augmentPortfolioOnchain`. TWAK's
   * native+USDC-only view is not the source of truth for the agent's BEP-20
   * positions anyway.
   */
  async getPortfolio(): Promise<TwakPortfolio> {
    if (this.config.simulator) {
      return this.simulatorPortfolio;
    }

    try {
      return await withRetry(() => this.livePortfolio(), {
        label: "portfolio",
        maxRetries: 2,
        baseDelayMs: 1000,
        timeoutMs: 15000,
      });
    } catch (err) {
      console.warn(
        `  [twak] wallet portfolio failed, falling back to on-chain reader:`,
        err instanceof Error ? err.message : String(err),
      );
      return {
        totalValueUsd: 0,
        positions: [],
        chains: ["bsc"],
        lastUpdated: Date.now(),
      };
    }
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
   * Check if TWAK is available and configured. Returns detailed diagnostics
   * so startup logs explain exactly what is missing (binary, credentials,
   * wallet password, or network).
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

    const diagnostics: string[] = [];

    // 1. Binary present?
    let version = "";
    try {
      const { stdout } = await this.execFileAsync(this.twakCmd, ["--version"], {
        env: this.getEnv(),
        timeout: 5000,
      });
      version = stdout.trim().split("\n")[0]?.trim() ?? "";
      diagnostics.push(`binary=${this.twakCmd} version=${version}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      diagnostics.push(`binary=missing (${message})`);
      return {
        available: false,
        mode,
        testnet: this.config.testnet,
        diagnostics,
        help: "Install TWAK: curl -fsSL https://agent-kit.trustwallet.com/install.sh | bash",
      };
    }

    // 2. Credentials configured?
    if (!this.config.accessId || !this.config.hmacSecret) {
      diagnostics.push("credentials=missing TWAK_ACCESS_ID / TWAK_HMAC_SECRET");
      return {
        available: false,
        mode,
        testnet: this.config.testnet,
        version,
        diagnostics,
        help: "Set TWAK_ACCESS_ID and TWAK_HMAC_SECRET from portal.trustwallet.com",
      };
    }
    diagnostics.push("credentials=ok");

    // 3. Wallet address readable (read-only, no password needed for address)?
    try {
      const { stdout } = await this.execFileAsync(this.twakCmd, ["wallet", "address", "--chain=bsc", "--json"], {
        env: this.getEnv(),
        timeout: 10000,
      });
      const parsed = JSON.parse(stdout);
      const address = typeof parsed === "string" ? parsed : parsed?.address;
      if (address) {
        diagnostics.push(`wallet_address=${address}`);
        if (!this.config.agentAddress || this.config.agentAddress.toLowerCase() === address.toLowerCase()) {
          return {
            available: true,
            mode,
            testnet: this.config.testnet,
            agentAddress: address,
            version,
            diagnostics,
          };
        }
        diagnostics.push(`config_mismatch: AGENT_WALLET_KEY=${this.config.agentAddress} vs twak_address=${address}`);
        return {
          available: true,
          mode,
          testnet: this.config.testnet,
          agentAddress: address,
          version,
          diagnostics,
          help: `AGENT_WALLET_KEY differs from TWAK wallet. Consider unsetting AGENT_WALLET_KEY so the agent uses TWAK's derived address.`,
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      diagnostics.push(`wallet_address=unavailable (${message})`);
      return {
        available: false,
        mode,
        testnet: this.config.testnet,
        version,
        diagnostics,
        help: "Create a TWAK wallet and set TWAK_WALLET_PASSWORD (or use OS keychain). See https://developer.trustwallet.com/developer/agent-sdk/key-management",
      };
    }

    return {
      available: false,
      mode,
      testnet: this.config.testnet,
      version,
      diagnostics,
    };
  }

  // ===========================================================================
  // Live Mode (CLI-backed via execFile for non-blocking I/O)
  // ===========================================================================

  /** Shell-safe character whitelist for CLI parameters. */
  private static readonly SAFE_INPUT_RE = /^[a-zA-Z0-9._-]+$/;

  /** Resolved path to the `twak` binary, or "twak" if not found in known locations. */
  private twakCmd: string;

  /** In-memory cache: symbol -> BEP-20 contract address (resolved via twak search). */
  private static tokenAddressCache = new Map<string, string>();

  /**
   * Reference prices (USD) for sanity-checking search results: SYMBOL -> price.
   * Populated each cycle from CMC market data. Used by selectBestTokenMatch to
   * reject scam lookalikes whose CMC-listed price diverges sharply from the
   * legit token's market price (e.g. fake "ETH" at $0.00001 vs real $1500).
   */
  private static referencePrices = new Map<string, number>();

  /** Seed reference prices from the market data fetched at cycle start. */
  static setReferencePrices(prices: Iterable<[string, number]>): void {
    TwakExecutor.referencePrices.clear();
    for (const [symbol, price] of prices) {
      if (typeof price === "number" && Number.isFinite(price) && price > 0) {
        TwakExecutor.referencePrices.set(symbol.toUpperCase(), price);
      }
    }
  }

  /** Clear all caches (for testing). */
  static resetCaches(): void {
    TwakExecutor.tokenAddressCache.clear();
    TwakExecutor.liquidityCache.clear();
    TwakExecutor.sellabilityCache.clear();
    TwakExecutor.referencePrices.clear();
  }

  /** Clear only the liquidity + sellability caches (for testing). */
  static resetLiquidityCache(): void {
    TwakExecutor.liquidityCache.clear();
    TwakExecutor.sellabilityCache.clear();
  }

  /**
   * In-memory cache: symbol -> { hasLiquidity, checkedAt }
   * Prevents re-checking the same token every cycle.
   * Cache TTL: 1 hour (liquidity doesn't change that fast).
   */
  private static liquidityCache = new Map<string, { hasLiquidity: boolean; checkedAt: number }>();
  private static readonly LIQUIDITY_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  /**
   * In-memory cache: symbol -> { sellable, checkedAt }
   * Prevents re-checking the same token every cycle.
   * Cache TTL: 1 hour.
   */
  private static sellabilityCache = new Map<string, { sellable: boolean; checkedAt: number }>();

  /** Build the augmented env for CLI subprocess calls. */
  private getEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      TWAK_ACCESS_ID: this.config.accessId,
      TWAK_HMAC_SECRET: this.config.hmacSecret,
      TWAK_WALLET_PASSWORD: process.env.TWAK_WALLET_PASSWORD,
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
      const { stdout } = await this.execFileAsync(this.twakCmd, [
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
      const { stdout } = await this.execFileAsync(this.twakCmd, [
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

      const reference = TwakExecutor.referencePrices.get(upper);
      const best = selectBestTokenMatch(results, symbol, reference);

      if (!best?.address) {
        console.log(`  [TWAK] No legitimate match for ${symbol} (rejected ${results.length} result(s) — symbol mismatch / dead price / off reference)`);
        return null;
      }

      TwakExecutor.tokenAddressCache.set(upper, best.address);
      console.log(`  [TWAK] Resolved ${symbol} → ${best.address} (${best.name}, $${(best.priceUsd ?? 0).toPrecision(4)})`);
      return best.address;
    } catch (error) {
      console.warn(`  [TWAK] Failed to resolve token ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Minimum DEX pool depth (USD) required to consider a token tradeable.
   * Tokens with shallow pools cause SafeMath/slippage reverts on swap; honeypot
   * scams typically have tiny pools that look priceable on CMC but unswappable.
   * KAI sat at $951 pool with $0 24h volume — exactly the pattern we now reject.
   */
  private static readonly MIN_DEX_LIQUIDITY_USD = 5_000;
  private static readonly MIN_DEX_24H_VOLUME_USD = 100;
  /** Reject tokens whose reported sell tax exceeds this threshold (0.10 = 10%). */
  private static readonly MAX_DEX_SELL_TAX = 0.10;

  /** Override the DexScreener fetcher (for tests). */
  private static dexScreenerFetcher: ((contract: string) => Promise<DexLiquidity | null>) | null = null;

  static setDexScreenerFetcher(fetcher: ((contract: string) => Promise<DexLiquidity | null>) | null): void {
    TwakExecutor.dexScreenerFetcher = fetcher;
  }

  /**
   * Fetch real DEX pool depth + 24h volume for a BSC contract. This is the
   * dependable "is this actually tradeable?" check — CMC can list prices for
   * tokens whose only on-chain pool is $50, but DexScreener reflects what
   * routers will actually see.
   */
  private static async fetchDexLiquidity(contract: string): Promise<DexLiquidity | null> {
    if (TwakExecutor.dexScreenerFetcher) {
      return TwakExecutor.dexScreenerFetcher(contract);
    }
    try {
      const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${contract}`);
      if (!r.ok) return null;
      const j = await r.json() as { pairs?: Array<{ chainId?: string; liquidity?: { usd?: number }; volume?: { h24?: number }; buyTax?: number; sellTax?: number; tax?: number }> };
      const pairs = (j.pairs ?? []).filter((p) => p.chainId === "bsc");
      if (pairs.length === 0) return { liquidityUsd: 0, volume24hUsd: 0, pairCount: 0 };
      const liquidityUsd = pairs.reduce((s, p) => s + (Number(p.liquidity?.usd) || 0), 0);
      const volume24hUsd = Math.max(...pairs.map((p) => Number(p.volume?.h24) || 0));
      // Some DexScreener pairs report estimated buy/sell tax. Use the worst
      // (highest) sell tax across BSC pairs as a defensive signal.
      const sellTax = Math.max(...pairs.map((p) => Number(p.sellTax ?? p.tax ?? 0) || 0));
      const buyTax = Math.max(...pairs.map((p) => Number(p.buyTax ?? 0) || 0));
      return { liquidityUsd, volume24hUsd, pairCount: pairs.length, buyTax, sellTax };
    } catch {
      return null;
    }
  }

  /**
   * Check whether a token is tradeable via two independent signals:
   *   1. DexScreener pool depth + 24h volume on BSC (the on-chain truth)
   *   2. TWAK `swap --quote-only` returns a route (the router can quote it)
   *
   * Both must pass. DexScreener is the primary defence — KAI passed TWAK's
   * quote check (a router will quote anything) but had a $951 pool with $0
   * volume, and the actual swap reverted. The DexScreener gate catches that
   * before we spend BNB on it.
   *
   * Results are cached for 1 hour. In simulator mode, always returns true.
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

    // ── Gate 1: DexScreener pool depth ──
    // Only runs if we have a contract address (not a bare symbol).
    if (tokenParam.startsWith("0x") && tokenParam.length === 42) {
      const dex = await TwakExecutor.fetchDexLiquidity(tokenParam);
      // If the fetcher errored (null), we don't reject — let TWAK be the sole
      // judge so a transient DexScreener outage doesn't freeze trading.
      if (dex) {
        if (dex.pairCount === 0) {
          console.log(`  [TWAK] Liquidity check: ${symbol} → ✗ (no DEX pair on BSC)`);
          TwakExecutor.liquidityCache.set(upper, { hasLiquidity: false, checkedAt: Date.now() });
          return false;
        }
        if (dex.liquidityUsd < TwakExecutor.MIN_DEX_LIQUIDITY_USD) {
          console.log(`  [TWAK] Liquidity check: ${symbol} → ✗ (pool $${dex.liquidityUsd.toFixed(0)} < $${TwakExecutor.MIN_DEX_LIQUIDITY_USD})`);
          TwakExecutor.liquidityCache.set(upper, { hasLiquidity: false, checkedAt: Date.now() });
          return false;
        }
        if (dex.volume24hUsd < TwakExecutor.MIN_DEX_24H_VOLUME_USD) {
          console.log(`  [TWAK] Liquidity check: ${symbol} → ✗ (24h volume $${dex.volume24hUsd.toFixed(0)} < $${TwakExecutor.MIN_DEX_24H_VOLUME_USD})`);
          TwakExecutor.liquidityCache.set(upper, { hasLiquidity: false, checkedAt: Date.now() });
          return false;
        }
        if ((dex.sellTax ?? 0) > TwakExecutor.MAX_DEX_SELL_TAX) {
          console.log(`  [TWAK] Liquidity check: ${symbol} → ✗ (sell tax ${((dex.sellTax ?? 0) * 100).toFixed(0)}% > ${(TwakExecutor.MAX_DEX_SELL_TAX * 100).toFixed(0)}%)`);
          TwakExecutor.liquidityCache.set(upper, { hasLiquidity: false, checkedAt: Date.now() });
          return false;
        }
      }
    }

    // ── Gate 2: TWAK quote-only (router can actually route it) ──
    try {
      TwakExecutor.validateSafeInput("1", "amount");
      TwakExecutor.validateSafeInput(tokenParam, "tokenOut");

      const { stdout, stderr } = await this.execFileAsync(this.twakCmd, [
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
   * Check whether a token can actually be sold back to BNB on-chain.
   * This is the honeypot defence: a token may have buy liquidity but no
   * sell route (or a route that reverts). We quote a tiny sell amount
   * before committing capital.
   *
   * Returns true only if the router returns a valid sell quote with no
   * revert/insufficient-liquidity message. Caches the result for 1 hour.
   */
  async checkSellability(symbol: string): Promise<boolean> {
    const upper = symbol.toUpperCase();

    // Simulator mode: skip real check
    if (this.config.simulator) return true;

    // Check cache first
    const cached = TwakExecutor.sellabilityCache.get(upper);
    if (cached && Date.now() - cached.checkedAt < TwakExecutor.LIQUIDITY_CACHE_TTL_MS) {
      return cached.sellable;
    }

    // Resolve the token address (uses cache or twak search)
    let tokenParam = this.resolveCachedToken(upper);
    if (tokenParam === upper) {
      const resolved = await this.resolveTokenAddress(symbol);
      if (resolved) tokenParam = resolved;
    }

    // ── Gate: TWAK sell quote (token → BNB) ──
    try {
      TwakExecutor.validateSafeInput("1", "amount");
      TwakExecutor.validateSafeInput(tokenParam, "tokenIn");

      const { stdout, stderr } = await this.execFileAsync(this.twakCmd, [
        "swap",
        "--usd",
        "1",
        tokenParam,
        "BNB",
        "--quote-only",
        "--chain=bsc",
      ], {
        env: this.getEnv(),
        timeout: 15000,
      });

      const hasQuote = /(?:amountOut|expectedOutput|received|output)[:\s]+'?[\d.]+/i.test(stdout);
      const hasRevert = /revert|insufficient|liquidity|insufficient_output|cannot estimate/i.test(stderr + stdout);
      const result = hasQuote && !hasRevert;

      TwakExecutor.sellabilityCache.set(upper, { sellable: result, checkedAt: Date.now() });
      console.log(`  [TWAK] Sellability check: ${symbol} → ${result ? "✓" : "✗"}`);
      return result;
    } catch (error) {
      console.log(`  [TWAK] Sellability check failed for ${symbol}:`, error instanceof Error ? error.message : String(error));
      TwakExecutor.sellabilityCache.set(upper, { sellable: false, checkedAt: Date.now() });
      return false;
    }
  }

  /**
   * Resolve a token symbol to its BEP-20 contract address via `twak search`.
   * Public wrapper around the private resolver — used by the holder-growth
   * module to look up BscScan contract addresses.
   */
  async resolveAddress(symbol: string): Promise<string | null> {
    return this.resolveTokenAddress(symbol);
  }

  /** All symbol → address mappings resolved so far this session. */
  static getResolvedAddresses(): Map<string, string> {
    return new Map(TwakExecutor.tokenAddressCache);
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

    const { stdout } = await this.execFileAsync(this.twakCmd, [
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

    // TWAK CLI changed: `balance` now takes named flags
    //   --address <wallet> --chain <chain> {--coin <slip44> | --token <contract>}
    // (was: positional `balance <symbol> --chain=bsc`)
    const wallet = this.config.agentAddress;
    if (!wallet) return null;
    TwakExecutor.validateSafeInput(wallet, "wallet");

    const upper = token.toUpperCase();
    const args = ["balance", "--address", wallet, "--chain", "bsc"];

    if (upper === "BNB") {
      // Native BNB: omit --coin and --token; `twak balance` returns the chain's
      // native asset. The previous SLIP44 id 714 is rejected by newer TWAK.
      // (no extra args needed)
    } else {
      // Need a contract address for ERC-20 reads. Use the cached resolution if
      // available, otherwise resolve on-the-fly.
      let contract = this.resolveCachedToken(upper);
      if (contract === upper) {
        const resolved = await this.resolveTokenAddress(token);
        if (!resolved) return null;
        contract = resolved;
      }
      TwakExecutor.validateSafeInput(contract, "token-contract");
      args.push("--token", contract);
    }

    const { stdout } = await this.execFileAsync(this.twakCmd, args, {
      env: this.getEnv(),
      timeout: 10000,
    });

    return this.parseBalanceOutput(stdout, token);
  }

  private async livePortfolio(): Promise<TwakPortfolio> {
    const { stdout } = await this.execFileAsync(this.twakCmd, [
      "wallet",
      "portfolio",
      "--chains=bsc",
    ], {
      env: this.getEnv(),
      timeout: 15000,
    });

    return this.parsePortfolioOutput(stdout);
  }

  private async liveHistory(limit: number): Promise<SwapResult[]> {
    const { stdout } = await this.execFileAsync(this.twakCmd, [
      "history",
      `--limit=${limit}`,
    ], {
      env: this.getEnv(),
      timeout: 10000,
    });

    return this.parseHistoryOutput(stdout);
  }

  private async liveRegister(): Promise<RegistrationResult> {
    const { stdout } = await this.execFileAsync(this.twakCmd, [
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
    const feeUsd = parseSwapFeeUsd(output);

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
      feeUsd: feeUsd ?? undefined,
      timestamp: Date.now(),
    };
  }

  private parseBalanceOutput(output: string, token: string): BalanceEntry | null {
    // TWAK balance returns JSON when stdout is valid JSON. Otherwise fall back
    // to the legacy text regex for compatibility with older CLI versions.
    try {
      const parsed = JSON.parse(output);
      if (parsed && typeof parsed === "object" && !parsed.error && parsed.errorCode === undefined) {
        const rawBalance = parsed.available ?? parsed.total ?? parsed.balance ?? parsed.amount;
        const rawValue = parsed.totalUsd ?? parsed.valueUsd ?? parsed.value;
        const balance = typeof rawBalance === "string" ? rawBalance : typeof rawBalance === "number" ? String(rawBalance) : undefined;
        const valueUsd = typeof rawValue === "number" ? rawValue : typeof rawValue === "string" ? parseFloat(rawValue) : 0;
        if (balance) {
          return {
            token,
            symbol: (parsed.symbol ?? token).toUpperCase(),
            balance,
            valueUsd,
            chain: this.config.testnet ? "bsc-testnet" : "bsc",
          };
        }
      }
    } catch {
      // not JSON, continue with text regex
    }

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

    // TWAK portfolio CLI format:
    //   Chain        Type    Symbol            Balance               USD
    //   ────────────────────────────────────────────────────────────────
    //   bsc          native  BNB               0.05717979978759799  $33.03
    //   bsc          token   USDC              0.648383822632066233 $0.65
    //   ...
    //   Total USD: $9.81
    //
    // We parse by column position: chain (1), type (2), symbol (3),
    // balance (4, numeric), $USD (5). The earlier regex `(\w+)[:\s]+\$?([\d.]+)`
    // was matching "BNB  0.057..." and treating the balance as USD — which
    // made the agent think BNB was worth $0.06 instead of $33. Critical bug.
    const rowPattern = /^\s*(\S+)\s+(\S+)\s+(\S+)\s+[\d.eE+-]+\s+\$([\d.]+)/;

    for (const line of lines) {
      // Skip header, separator, and total lines
      if (
        line.includes("Chain") ||
        line.includes("───") ||
        line.toLowerCase().includes("total") ||
        line.trim() === ""
      ) {
        continue;
      }

      const m = line.match(rowPattern);
      if (!m) continue;

      const symbol = m[3].toUpperCase();
      const valueUsd = parseFloat(m[4]);

      if (valueUsd > 0 && symbol !== "TOTAL") {
        totalUsd += valueUsd;
        positions.push({
          token: symbol,
          symbol,
          balance: "0",
          valueUsd,
          chain: "bsc",
        });
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
