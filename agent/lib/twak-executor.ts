/**
 * TWAK Executor
 *
 * Trust Wallet Agent Kit integration for the BNB Hack trading agent.
 * Wraps the `twak` CLI as a typed interface. Supports both live execution
 * and a simulator mode for testing without a live TWAK connection.
 *
 * TWAK CLI: https://portal.trustwallet.com
 * Auth: TWAK_ACCESS_ID + TWAK_HMAC_SECRET (env vars, configured via Pinata secrets)
 *
 * Two modes:
 *   - live:   spawns `twak` CLI commands via child_process
 *   - simulator: in-memory mock for testing the agent loop
 *
 * The agent uses Agent Wallet Mode (autonomous, pre-configured rules).
 * TWAK handles self-custody signing — the agent never touches the private key.
 */

import { execSync } from "node:child_process";
import { AGENT_CONFIG } from "./config.js";
import type { TradeExecution, PortfolioState, PortfolioPosition } from "./types.js";
import { isEligibleToken } from "./constants.js";

// =============================================================================
// Types
// =============================================================================

export interface TwakConfig {
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
}

export interface SwapRequest {
  tokenIn: string;
  tokenOut: string;
  amountIn: string; // string to handle decimal precision
  slippageBps?: number;
  chain?: string;
}

export interface SwapResult {
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

export interface BalanceEntry {
  token: string;
  symbol: string;
  balance: string;
  valueUsd: number;
  chain: string;
}

export interface TwakPortfolio {
  totalValueUsd: number;
  positions: BalanceEntry[];
  chains: string[];
  lastUpdated: number;
}

export interface RegistrationResult {
  success: boolean;
  agentAddress?: string;
  txHash?: string;
  explorerUrl?: string;
  error?: string;
}

export interface TwakHealth {
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
  private config: Required<TwakConfig>;
  private simulatorBalances: Map<string, BalanceEntry> = new Map();
  private simulatorPortfolio: TwakPortfolio = {
    totalValueUsd: 10000, // Starting simulated portfolio
    positions: [],
    chains: ["bsc"],
    lastUpdated: Date.now(),
  };
  private simulatorSwapHistory: SwapResult[] = [];
  private lastQuote: { tokenIn: string; tokenOut: string; amountIn: string; amountOut: string; price: number } | null = null;

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
    // Validate token allowlist
    if (!isEligibleToken(request.tokenIn) || !isEligibleToken(request.tokenOut)) {
      return {
        success: false,
        tokenIn: request.tokenIn,
        tokenOut: request.tokenOut,
        amountIn: request.amountIn,
        error: `Token not in competition allowlist: ${!isEligibleToken(request.tokenIn) ? request.tokenIn : request.tokenOut}`,
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
   * Only available in live mode; simulator uses last simulated price.
   */
  async getQuote(request: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
  }): Promise<{ amountOut: string; price: number } | null> {
    if (this.config.simulator) {
      // Simulator: return stored last quote or a mock price
      if (this.lastQuote &&
          this.lastQuote.tokenIn === request.tokenIn &&
          this.lastQuote.tokenOut === request.tokenOut &&
          this.lastQuote.amountIn === request.amountIn) {
        return { amountOut: this.lastQuote.amountOut, price: this.lastQuote.price };
      }
      // Mock quote: 1% slippage on a $100 token
      const amount = parseFloat(request.amountIn);
      const mockPrice = 100; // Assume $100 per token
      const mockAmountOut = ((amount * mockPrice) * 0.99).toFixed(6);
      return { amountOut: mockAmountOut, price: mockPrice };
    }

    return this.liveQuote(request);
  }

  /**
   * Get portfolio state (all positions, total value, chain distribution).
   */
  async getPortfolio(): Promise<TwakPortfolio> {
    if (this.config.simulator) {
      return this.simulatorPortfolio;
    }
    return this.livePortfolio();
  }

  /**
   * Get balance for a specific token.
   */
  async getBalance(token: string): Promise<BalanceEntry | null> {
    if (this.config.simulator) {
      return this.simulatorBalances.get(token.toUpperCase()) ?? null;
    }
    return this.liveBalance(token);
  }

  /**
   * Get recent transaction history.
   */
  async getHistory(limit: number = 10): Promise<SwapResult[]> {
    if (this.config.simulator) {
      return this.simulatorSwapHistory.slice(0, limit);
    }
    return this.liveHistory(limit);
  }

  /**
   * Register the agent wallet for the hackathon competition.
   * Runs `twak compete register` to register on-chain.
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

    // Check if twak CLI is installed
    try {
      execSync("twak --version", { stdio: "pipe", timeout: 5000 });
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
  // Live Mode (CLI-backed)
  // ===========================================================================

  /**
   * Execute a swap via the `twak` CLI.
   * Command: twak swap <amount> <tokenIn> <tokenOut> --chain bsc
   */
  /** Shell-safe character whitelist for CLI parameters. */
  private static readonly SAFE_INPUT_RE = /^[a-zA-Z0-9._-]+$/;

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

  private async executeLiveSwap(request: SwapRequest): Promise<SwapResult> {
    const chain = request.chain || (this.config.testnet ? "bsc-testnet" : "bsc");
    const slippage = request.slippageBps ?? this.config.defaultSlippageBps;

    try {
      // Validate all user-provided inputs for shell safety
      TwakExecutor.validateSafeInput(request.amountIn, "amount");
      TwakExecutor.validateSafeInput(request.tokenIn, "tokenIn");
      TwakExecutor.validateSafeInput(request.tokenOut, "tokenOut");
      TwakExecutor.validateSafeInput(chain, "chain");

      const cmd = [
        "twak",
        "swap",
        request.amountIn,
        request.tokenIn,
        request.tokenOut,
        `--chain=${chain}`,
        `--slippage=${slippage}`,
        "--autonomous",
      ].join(" ");

      const output = execSync(cmd, {
        env: {
          ...process.env,
          TWAK_ACCESS_ID: this.config.accessId,
          TWAK_HMAC_SECRET: this.config.hmacSecret,
        },
        timeout: 30000,
        stdio: "pipe",
      });

      const result = output.toString();
      return this.parseSwapOutput(result, request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
   * Get a quote via TWAK CLI without executing.
   * Command: twak swap <amount> <tokenIn> <tokenOut> --chain bsc --quote-only
   */
  private async liveQuote(request: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
  }): Promise<{ amountOut: string; price: number } | null> {
    try {
      TwakExecutor.validateSafeInput(request.amountIn, "amount");
      TwakExecutor.validateSafeInput(request.tokenIn, "tokenIn");
      TwakExecutor.validateSafeInput(request.tokenOut, "tokenOut");

      const cmd = [
        "twak",
        "swap",
        request.amountIn,
        request.tokenIn,
        request.tokenOut,
        "--quote-only",
        `--chain=${this.config.testnet ? "bsc-testnet" : "bsc"}`,
      ].join(" ");

      const output = execSync(cmd, {
        env: {
          ...process.env,
          TWAK_ACCESS_ID: this.config.accessId,
          TWAK_HMAC_SECRET: this.config.hmacSecret,
        },
        timeout: 15000,
        stdio: "pipe",
      });

      // Parse output for price/amount
      const text = output.toString();
      const amountOutMatch = text.match(/(?:amountOut|expectedOutput)[:\s]+([\d.]+)/i);
      const priceMatch = text.match(/(?:price|rate)[:\s]+([\d.]+)/i);

      if (amountOutMatch) {
        const amountOut = amountOutMatch[1];
        const price = priceMatch ? parseFloat(priceMatch[1]) : 0;
        this.lastQuote = { ...request, amountOut, price };
        return { amountOut, price };
      }

      return null;
    } catch {
      return null;
    }
  }

  private async liveBalance(token: string): Promise<BalanceEntry | null> {
    try {
      TwakExecutor.validateSafeInput(token, "token");
      const output = execSync(`twak balance ${token} --chain=${this.config.testnet ? "bsc-testnet" : "bsc"}`, {
        env: {
          ...process.env,
          TWAK_ACCESS_ID: this.config.accessId,
          TWAK_HMAC_SECRET: this.config.hmacSecret,
        },
        timeout: 10000,
        stdio: "pipe",
      });

      const text = output.toString();
      return this.parseBalanceOutput(text, token);
    } catch {
      return null;
    }
  }

  private async livePortfolio(): Promise<TwakPortfolio> {
    try {
      const output = execSync("twak wallet portfolio", {
        env: {
          ...process.env,
          TWAK_ACCESS_ID: this.config.accessId,
          TWAK_HMAC_SECRET: this.config.hmacSecret,
        },
        timeout: 15000,
        stdio: "pipe",
      });

      return this.parsePortfolioOutput(output.toString());
    } catch {
      return {
        totalValueUsd: 0,
        positions: [],
        chains: [],
        lastUpdated: Date.now(),
      };
    }
  }

  private async liveHistory(limit: number): Promise<SwapResult[]> {
    try {
      const output = execSync(`twak history --limit=${limit}`, {
        env: {
          ...process.env,
          TWAK_ACCESS_ID: this.config.accessId,
          TWAK_HMAC_SECRET: this.config.hmacSecret,
        },
        timeout: 10000,
        stdio: "pipe",
      });

      return this.parseHistoryOutput(output.toString());
    } catch {
      return [];
    }
  }

  private async liveRegister(): Promise<RegistrationResult> {
    try {
      const output = execSync("twak compete register", {
        env: {
          ...process.env,
          TWAK_ACCESS_ID: this.config.accessId,
          TWAK_HMAC_SECRET: this.config.hmacSecret,
        },
        timeout: 60000,
        stdio: "pipe",
      });

      const text = output.toString();
      const addressMatch = text.match(/(?:address|agent|wallet)[:\s]+(0x[a-fA-F0-9]{40})/i);
      const txHashMatch = text.match(/(?:tx|transaction|hash)[:\s]+(0x[a-fA-F0-9]{64})/i);

      return {
        success: true,
        agentAddress: addressMatch?.[1],
        txHash: txHashMatch?.[1],
        explorerUrl: txHashMatch?.[1]
          ? `https://${this.config.testnet ? "testnet." : ""}bscscan.com/tx/${txHashMatch[1]}`
          : undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Registration failed: ${message}`,
      };
    }
  }

  // ===========================================================================
  // Simulator Mode (in-memory mock for testing)
  // ===========================================================================

  private initSimulator(): void {
    // Start with a demo portfolio on BSC
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

    // Simulate swap with price discovery
    // In a real scenario, TWAK would find the best route
    const mockPriceIn = this.getMockPrice(request.tokenIn);
    const mockPriceOut = this.getMockPrice(request.tokenOut);
    const slippageMultiplier = 1 - ((request.slippageBps ?? this.config.defaultSlippageBps) / 10000);
    const amountOut = ((amount * mockPriceIn) / mockPriceOut) * slippageMultiplier;

    // Update balances
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

    // Update portfolio
    const allPositions = Array.from(this.simulatorBalances.values());
    this.simulatorPortfolio = {
      totalValueUsd: allPositions.reduce((sum, p) => sum + p.valueUsd, 0),
      positions: allPositions,
      chains: ["bsc"],
      lastUpdated: Date.now(),
    };

    // Store quote
    this.lastQuote = {
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: request.amountIn,
      amountOut: amountOut.toFixed(6),
      price: mockPriceOut / mockPriceIn,
    };

    // Create result
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
      feeUsd: 0.01, // Simulated fee
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

  private parseSwapOutput(
    output: string,
    request: SwapRequest
  ): SwapResult {
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
    // Basic parsing — extract lines with balance: value patterns
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
