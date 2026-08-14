/**
 * Delphi Executor
 *
 * Wraps @gensyn-ai/gensyn-delphi-sdk (v2.1.0+) as a typed execution surface,
 * mirroring the TwakExecutor shape: lazy client construction, retry wrapper,
 * slippage guard, and a simulator mode that never touches the chain.
 *
 * Strategy context lives in docs/DELPHI_AGENT_ARENA.md. This module is the
 * execution plumbing only: it deliberately contains no probability-estimation
 * logic (that is `probability.ts` / the LLM jury's job) and no loop scheduling
 * (that is `runner.ts`).
 *
 * Two modes:
 *   - live:      real DelphiClient against DELPHI_NETWORK (competition-testnet
 *                during the Agent Arena, mainnet later)
 *   - simulator: dry-run that returns synthetic quotes/trades and tracks
 *                trades in memory, for tests and local development
 *
 * The Delphi SDK reads its own env (DELPHI_NETWORK, DELPHI_API_ACCESS_KEY,
 * WALLET_PRIVATE_KEY). We accept config overrides in the constructor so tests
 * never need to mutate process.env.
 */

// =============================================================================
// Types
// =============================================================================

/** Minimal market shape we care about for gating and accounting. */
export interface DelphiMarket {
  /** On-chain market proxy contract address. */
  id: string;
  /** Delphi app UUID (for building market URLs). */
  appMarketId?: string;
  question?: string;
  category?: string;
  status: "open" | "awaiting_settlement" | "settled" | "expired" | "failed" | string;
  /** Direct link on the Delphi app, if provided by the API. */
  marketUrl?: string;
}

export interface DelphiQuote {
  marketAddress: string;
  outcomeIdx: number;
  /** bigint as string — 18-decimal share units. */
  sharesOut: string;
  /** bigint as string — exact token cost from the ladder quoting call. */
  tokensIn: string;
  /** Effective price per share (tokensIn / sharesOut) as a 0-1 float. */
  pricePerShare: number;
  quotedAt: number;
}

export interface DelphiTradeResult {
  success: boolean;
  transactionHash?: string;
  marketAddress: string;
  outcomeIdx: number;
  sharesOut?: string;
  tokensIn?: string;
  /** 0-1 float; what we actually paid per share. */
  effectivePrice?: number;
  /** 0-1 float; the model probability estimate that justified the trade. */
  estimatedProbability?: number;
  error?: string;
  timestamp: number;
}

export interface DelphiHealth {
  available: boolean;
  network: string;
  mode: "live" | "simulator";
  /** Ordered diagnostic strings from healthCheck(). */
  diagnostics: string[];
  help?: string;
}

/** Minimal position shape as returned by the REST API. */
export interface DelphiPosition {
  marketProxy: string;
  outcomeIdx: string;
  shares: string;
  marketStatus: "open" | "awaiting_settlement" | "settled" | "expired" | "failed" | string;
  redeemedOrLiquidated: boolean;
}

/** Abstraction over the real DelphiClient so tests can inject fakes. */
export interface DelphiClientLike {
  health(): Promise<{ status: string }>;
  listMarkets(params?: Record<string, unknown>): Promise<{ markets: DelphiMarket[] }>;
  getMarket(params: { id: string }): Promise<DelphiMarket>;
  quoteBuy(params: {
    marketAddress: string;
    outcomeIdx: number;
    sharesOut: bigint;
  }): Promise<{ tokensIn: bigint }>;
  buyShares(params: {
    marketAddress: string;
    outcomeIdx: number;
    sharesOut: bigint;
    maxTokensIn: bigint;
  }): Promise<{ transactionHash: string }>;
  redeemPositions(params: { marketAddresses: string[] }): Promise<{
    results: Array<{ marketAddress: string; success: boolean; tokensOut?: bigint; error?: string }>;
    totalTokensOut: bigint;
  }>;
  /** Wallet address of the signer (for listPositions + balance checks). */
  getSigner(): Promise<{ address: string }>;
  /** ERC-20 token balance of the signer (competition token on Delphi). */
  getErc20Balance(): Promise<bigint>;
  /** Positions for the signer wallet (open + settled + liquidatable). */
  listPositions(params: {
    wallet: string;
    redeemedOrLiquidated?: boolean;
  }): Promise<{ positions: DelphiPosition[] | null }>;
  /** Liquidate an expired/failed market (burns shares, returns collateral). */
  liquidate(params: {
    marketAddress: string;
    outcomeIndices: number[];
  }): Promise<{ transactionHash: string }>;
  /** Quote selling `sharesIn` shares of an outcome (no gas). */
  quoteSell(params: {
    marketAddress: string;
    outcomeIdx: number;
    sharesIn: bigint;
  }): Promise<{ tokensOut: bigint }>;
  /** Sell an exact number of outcome shares back into the LMSR pool. */
  sellShares(params: {
    marketAddress: string;
    outcomeIdx: number;
    sharesIn: bigint;
    minTokensOut: bigint;
  }): Promise<{ transactionHash: string }>;
}

export interface DelphiExecutorConfig {
  /** Override DELPHI_NETWORK. Defaults to competition-testnet. */
  network?: string;
  /** Override DELPHI_API_ACCESS_KEY. */
  apiKey?: string;
  /** Force simulator regardless of env. Defaults to true when no API key. */
  simulator?: boolean;
  /** Slippage tolerance in basis points applied to quotes (default 300 = 3%). */
  slippageBps?: number;
  /**
   * Competition wallet private key. Defaults to DELPHI_WALLET_PRIVATE_KEY
   * (NOT the SDK's WALLET_PRIVATE_KEY — we namespace so a process hosting
   * both the BSC pipeline and the Delphi runner can't cross-wire signers).
   * Passed to the SDK as `privateKey`, which takes precedence over its env.
   */
  privateKey?: string;
  /** Retry policy; tests should set maxRetries: 0 to keep them fast. */
  retry?: { maxRetries?: number; baseDelayMs?: number };
  /** Injected client factory — tests use this to avoid network + key material. */
  clientFactory?: () => Promise<DelphiClientLike>;
}

// =============================================================================
// Retry Helper (same shape as twak-executor.withRetry)
// =============================================================================

async function withRetry<T>(
  fn: () => Promise<T>,
  options: { label: string; maxRetries?: number; baseDelayMs?: number },
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
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`  [${options.label}] Retry ${attempt + 1}/${maxRetries} in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

// =============================================================================
// DelphiExecutor
// =============================================================================

export class DelphiExecutor {
  private readonly network: string;
  private readonly apiKey: string;
  private readonly privateKey?: string;
  private readonly simulator: boolean;
  private readonly slippageBps: number;
  private readonly retryPolicy: { maxRetries: number; baseDelayMs: number };
  private readonly clientFactoryOverride?: () => Promise<DelphiClientLike>;
  private client: DelphiClientLike | null = null;
  private readonly tradeLog: DelphiTradeResult[] = [];

  constructor(config: DelphiExecutorConfig = {}) {
    this.network = config.network ?? process.env.DELPHI_NETWORK ?? "competition-testnet";
    this.apiKey = config.apiKey ?? process.env.DELPHI_API_ACCESS_KEY ?? "";
    this.privateKey = config.privateKey ?? process.env.DELPHI_WALLET_PRIVATE_KEY ?? undefined;
    this.simulator = config.simulator ?? !this.apiKey;
    this.slippageBps = config.slippageBps ?? 300;
    this.retryPolicy = { maxRetries: config.retry?.maxRetries ?? 2, baseDelayMs: config.retry?.baseDelayMs ?? 1000 };
    this.clientFactoryOverride = config.clientFactory;
  }

  // ---------------------------------------------------------------------------
  // Client construction
  // ---------------------------------------------------------------------------

  /**
   * Lazily build the Delphi client. The SDK import is dynamic so unit tests
   * (and any environment without the network deps) can load this module
   * without @gensyn-ai/gensyn-delphi-sdk being initialized.
   */
  async getClient(): Promise<DelphiClientLike> {
    if (this.client) return this.client;
    if (this.clientFactoryOverride) {
      this.client = await this.clientFactoryOverride();
      return this.client;
    }
    if (this.simulator) {
      throw new Error("DelphiExecutor: no live client in simulator mode");
    }
    const mod = await import("@gensyn-ai/gensyn-delphi-sdk");
    const { DelphiClient } = mod as unknown as {
      DelphiClient: new (config: Record<string, unknown>) => DelphiClientLike;
    };
    this.client = new DelphiClient({
      network: this.network,
      signerType: "private_key",
      apiKey: this.apiKey,
      ...(this.privateKey ? { privateKey: this.privateKey } : {}),
    });
    return this.client;
  }

  // ---------------------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------------------

  async healthCheck(): Promise<DelphiHealth> {
    const diagnostics: string[] = [];
    if (this.simulator) {
      diagnostics.push("mode=simulator (no DELPHI_API_ACCESS_KEY set)");
      return {
        available: false,
        network: this.network,
        mode: "simulator",
        diagnostics,
        help: "Set DELPHI_API_ACCESS_KEY (https://delphi-api-access.gensyn.ai/) and WALLET_PRIVATE_KEY for the registered competition wallet to enable live mode.",
      };
    }
    try {
      const client = await this.getClient();
      const { status } = await client.health();
      diagnostics.push(`health=${status}`);
      return { available: status === "ok", network: this.network, mode: "live", diagnostics };
    } catch (err) {
      diagnostics.push(`health=error: ${err instanceof Error ? err.message : String(err)}`);
      return {
        available: false,
        network: this.network,
        mode: "live",
        diagnostics,
        help: "Delphi health check failed. Verify DELPHI_API_ACCESS_KEY, WALLET_PRIVATE_KEY, and Gensyn Testnet gas.",
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Market discovery
  // ---------------------------------------------------------------------------

  /** List open competition markets. Returns [] in simulator mode. */
  async listOpenMarkets(params: { limit?: number; category?: string } = {}): Promise<DelphiMarket[]> {
    if (this.simulator) return [];
    const client = await this.getClient();
    return withRetry(
      async () => {
        const { markets } = await client.listMarkets({
          status: "open",
          category: params.category,
          limit: params.limit ?? 50,
        });
        return markets;
      },
      { label: "delphi-list-markets", ...this.retryPolicy },
    );
  }

  // ---------------------------------------------------------------------------
  // Quoting
  // ---------------------------------------------------------------------------

  /**
   * Quote buying `sharesOut` shares of an outcome. In live mode this is a
   * real on-chain discussion call (no gas); in simulator mode the quote is
   * synthesized at `syntheticPrice`.
   */
  async quoteBuy(
    marketAddress: string,
    outcomeIdx: number,
    sharesOut: bigint,
    syntheticPrice?: number,
  ): Promise<DelphiQuote> {
    if (this.simulator) {
      const price = syntheticPrice ?? 0.5;
      // 1 share pays 1 token at settlement, so 18-dec shares × 0-1 price = 18-dec tokens.
      const tokensIn = (sharesOut * BigInt(Math.round(price * 1e6))) / 1_000_000n;
      return {
        marketAddress,
        outcomeIdx,
        sharesOut: sharesOut.toString(),
        tokensIn: tokensIn.toString(),
        pricePerShare: price,
        quotedAt: Date.now(),
      };
    }
    const client = await this.getClient();
    const { tokensIn } = await withRetry(
      async () => client.quoteBuy({ marketAddress, outcomeIdx, sharesOut }),
      { label: "delphi-quote-buy", ...this.retryPolicy },
    );
    const pricePerShare = sharesOut > 0n ? Number(tokensIn) / Number(sharesOut) : 0;
    return {
      marketAddress,
      outcomeIdx,
      sharesOut: sharesOut.toString(),
      tokensIn: tokensIn.toString(),
      pricePerShare,
      quotedAt: Date.now(),
    };
  }

  /**
   * Quote selling `sharesIn` shares of an outcome. In simulator mode the
   * quote is synthesized at `syntheticPrice` (same convention as quoteBuy).
   * Returns tokensOut as an 18-dec string plus the effective sell price.
   */
  async quoteSell(
    marketAddress: string,
    outcomeIdx: number,
    sharesIn: bigint,
    syntheticPrice?: number,
  ): Promise<DelphiQuote> {
    if (this.simulator) {
      const price = syntheticPrice ?? 0.5;
      const tokensOut = (sharesIn * BigInt(Math.round(price * 1e6))) / 1_000_000n;
      return {
        marketAddress,
        outcomeIdx,
        sharesOut: sharesIn.toString(),
        tokensIn: tokensOut.toString(), // reuse tokensIn field as "tokens received" for sells
        pricePerShare: price,
        quotedAt: Date.now(),
      };
    }
    const client = await this.getClient();
    const { tokensOut } = await withRetry(
      async () => client.quoteSell({ marketAddress, outcomeIdx, sharesIn }),
      { label: "delphi-quote-sell", ...this.retryPolicy },
    );
    const pricePerShare = sharesIn > 0n ? Number(tokensOut) / Number(sharesIn) : 0;
    return {
      marketAddress,
      outcomeIdx,
      sharesOut: sharesIn.toString(),
      tokensIn: tokensOut.toString(),
      pricePerShare,
      quotedAt: Date.now(),
    };
  }

  // ---------------------------------------------------------------------------
  // Trading
  // ---------------------------------------------------------------------------

  /**
   * Sell shares of an outcome back into the LMSR pool (sell-into-convergence
   * exit). Applies the slippage guard as a floor: receive at least
   * quote × (1 − slippageBps). In simulator mode, records the trade in
   * memory and returns success without touching the chain.
   */
  async sellShares(params: {
    marketAddress: string;
    outcomeIdx: number;
    sharesIn: bigint;
    estimatedProbability?: number;
    syntheticPrice?: number;
  }): Promise<DelphiTradeResult> {
    const timestamp = Date.now();
    try {
      const quote = await this.quoteSell(
        params.marketAddress,
        params.outcomeIdx,
        params.sharesIn,
        params.syntheticPrice,
      );

      if (this.simulator) {
        const result: DelphiTradeResult = {
          success: true,
          marketAddress: params.marketAddress,
          outcomeIdx: params.outcomeIdx,
          sharesOut: quote.sharesOut,
          tokensIn: quote.tokensIn, // tokens received on a sell
          effectivePrice: quote.pricePerShare,
          estimatedProbability: params.estimatedProbability,
          timestamp,
        };
        this.tradeLog.push(result);
        return result;
      }

      const tokensOutBig = BigInt(quote.tokensIn);
      const minTokensOut = (tokensOutBig * BigInt(10_000 - this.slippageBps)) / 10_000n;

      const client = await this.getClient();
      const { transactionHash } = await withRetry(
        async () =>
          client.sellShares({
            marketAddress: params.marketAddress,
            outcomeIdx: params.outcomeIdx,
            sharesIn: params.sharesIn,
            minTokensOut,
          }),
        { label: "delphi-sell-shares", ...this.retryPolicy },
      );

      const result: DelphiTradeResult = {
        success: true,
        transactionHash,
        marketAddress: params.marketAddress,
        outcomeIdx: params.outcomeIdx,
        sharesOut: quote.sharesOut,
        tokensIn: quote.tokensIn,
        effectivePrice: quote.pricePerShare,
        estimatedProbability: params.estimatedProbability,
        timestamp,
      };
      this.tradeLog.push(result);
      return result;
    } catch (err) {
      const result: DelphiTradeResult = {
        success: false,
        marketAddress: params.marketAddress,
        outcomeIdx: params.outcomeIdx,
        error: err instanceof Error ? err.message : String(err),
        timestamp,
      };
      this.tradeLog.push(result);
      return result;
    }
  }

  /**
   * Buy shares of an outcome. Applies the configured slippage guard to the
   * live quote before sending. In simulator mode, records the trade in memory
   * and returns success without touching the chain.
   *
   * `estimatedProbability` is recorded for post-hoc calibration/Brier scoring
   * (see docs/DELPHI_AGENT_ARENA.md). Callers should pass the model estimate
   * that justified the entry.
   */
  async buyShares(params: {
    marketAddress: string;
    outcomeIdx: number;
    sharesOut: bigint;
    estimatedProbability?: number;
    syntheticPrice?: number;
  }): Promise<DelphiTradeResult> {
    const timestamp = Date.now();
    try {
      const quote = await this.quoteBuy(
        params.marketAddress,
        params.outcomeIdx,
        params.sharesOut,
        params.syntheticPrice,
      );

      if (this.simulator) {
        const result: DelphiTradeResult = {
          success: true,
          marketAddress: params.marketAddress,
          outcomeIdx: params.outcomeIdx,
          sharesOut: quote.sharesOut,
          tokensIn: quote.tokensIn,
          effectivePrice: quote.pricePerShare,
          estimatedProbability: params.estimatedProbability,
          timestamp,
        };
        this.tradeLog.push(result);
        return result;
      }

      // Slippage guard: pay at most quote * (1 + slippageBps).
      const tokensInBig = BigInt(quote.tokensIn);
      const maxTokensIn = (tokensInBig * BigInt(10_000 + this.slippageBps)) / 10_000n;

      const client = await this.getClient();
      const { transactionHash } = await withRetry(
        async () =>
          client.buyShares({
            marketAddress: params.marketAddress,
            outcomeIdx: params.outcomeIdx,
            sharesOut: params.sharesOut,
            maxTokensIn,
          }),
        { label: "delphi-buy-shares", ...this.retryPolicy },
      );

      const result: DelphiTradeResult = {
        success: true,
        transactionHash,
        marketAddress: params.marketAddress,
        outcomeIdx: params.outcomeIdx,
        sharesOut: quote.sharesOut,
        tokensIn: quote.tokensIn,
        effectivePrice: quote.pricePerShare,
        estimatedProbability: params.estimatedProbability,
        timestamp,
      };
      this.tradeLog.push(result);
      return result;
    } catch (err) {
      const result: DelphiTradeResult = {
        success: false,
        marketAddress: params.marketAddress,
        outcomeIdx: params.outcomeIdx,
        error: err instanceof Error ? err.message : String(err),
        timestamp,
      };
      this.tradeLog.push(result);
      return result;
    }
  }

  /**
   * Redeem settled positions across the given markets. Returns the subset of
   * markets that redeemed successfully — per-market failures are captured by
   * the SDK rather than aborting the batch.
   *
   * Callers upstream should filter markets by status first (`settled` →
   * redeem, `expired`/`failed` → liquidate is out of scope for this scaffold).
   */
  async redeemPositions(marketAddresses: string[]): Promise<{
    redeemed: Array<{ marketAddress: string; tokensOut: string }>;
    failed: Array<{ marketAddress: string; error: string }>;
  }> {
    if (this.simulator || marketAddresses.length === 0) {
      return { redeemed: [], failed: [] };
    }
    const client = await this.getClient();
    const { results } = await withRetry(
      async () => client.redeemPositions({ marketAddresses }),
      { label: "delphi-redeem", ...this.retryPolicy },
    );
    const redeemed: Array<{ marketAddress: string; tokensOut: string }> = [];
    const failed: Array<{ marketAddress: string; error: string }> = [];
    for (const r of results) {
      if (r.success) {
        redeemed.push({ marketAddress: r.marketAddress, tokensOut: (r.tokensOut ?? 0n).toString() });
      } else {
        failed.push({ marketAddress: r.marketAddress, error: r.error ?? "unknown" });
      }
    }
    return { redeemed, failed };
  }

  // ---------------------------------------------------------------------------
  // Position lifecycle (Phase 4)
  // ---------------------------------------------------------------------------

  /** Signer wallet address. Throws in simulator mode. */
  async getWalletAddress(): Promise<string> {
    const client = await this.getClient();
    const { address } = await client.getSigner();
    return address;
  }

  /** Competition-token balance of the signer (18-dec bigint as string). */
  async getTokenBalance(): Promise<string> {
    if (this.simulator) return "0";
    const client = await this.getClient();
    return (await client.getErc20Balance()).toString();
  }

  /**
   * All open (unredeemed/unliquidated) positions for the signer wallet,
   * split by lifecycle so the runner can route settled → redeem and
   * expired/failed → liquidate.
   */
  async getOpenPositions(): Promise<{
    open: DelphiPosition[];
    settled: DelphiPosition[];
    liquidatable: DelphiPosition[];
  }> {
    if (this.simulator) return { open: [], settled: [], liquidatable: [] };
    const client = await this.getClient();
    const wallet = await this.getWalletAddress();
    const { positions } = await withRetry(
      async () => client.listPositions({ wallet, redeemedOrLiquidated: false }),
      { label: "delphi-list-positions", ...this.retryPolicy },
    );
    const list = positions ?? [];
    const settled: DelphiPosition[] = [];
    const liquidatable: DelphiPosition[] = [];
    const open: DelphiPosition[] = [];
    for (const p of list) {
      if (p.marketStatus === "settled") settled.push(p);
      else if (p.marketStatus === "expired" || p.marketStatus === "failed") liquidatable.push(p);
      else open.push(p);
    }
    return { open, settled, liquidatable };
  }

  /**
   * Liquidate an expired/failed market for the given outcome indices —
   * the exit path for markets with no winning outcome. Returns shares in
   * and collateral out.
   */
  async liquidate(params: {
    marketAddress: string;
    outcomeIndices: number[];
  }): Promise<{ transactionHash: string }> {
    if (this.simulator) {
      return { transactionHash: "0xsim" };
    }
    const client = await this.getClient();
    return withRetry(
      async () => client.liquidate(params),
      { label: "delphi-liquidate", ...this.retryPolicy },
    );
  }

  /**
   * Implied probabilities for a market's outcomes via on-chain spot prices.
   * Uses a 1-share quote per outcome as the price oracle (works in both
   * simulator and live mode). Returns null when the market isn't quotable.
   */
  async getImpliedProbabilities(marketAddress: string, outcomeCount: number): Promise<number[] | null> {
    const out: number[] = [];
    for (let i = 0; i < outcomeCount; i++) {
      try {
        const q = await this.quoteBuy(marketAddress, i, 10n ** 18n);
        out.push(q.pricePerShare);
      } catch {
        return null;
      }
    }
    if (out.some((p) => p <= 0 || p >= 1)) return null;
    return out;
  }

  // ---------------------------------------------------------------------------
  // Introspection
  // ---------------------------------------------------------------------------

  /** In-memory trade log (this process only). Persistence lands in runner.ts. */
  getTradeLog(): readonly DelphiTradeResult[] {
    return this.tradeLog;
  }

  get isSimulator(): boolean {
    return this.simulator;
  }

  get networkName(): string {
    return this.network;
  }
}
