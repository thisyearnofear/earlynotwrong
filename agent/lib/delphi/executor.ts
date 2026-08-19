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
  /** Outcome labels in market order (binary: ["Yes","No"]; bands can have 4+). */
  outcomes?: string[];
  category?: string;
  status: "open" | "awaiting_settlement" | "settled" | "expired" | "failed" | string;
  /** Direct link on the Delphi app, if provided by the API. */
  marketUrl?: string;
  /** Settlement/resolution time (ISO), if the market declares one. */
  resolvesAt?: string | null;
  /**
   * Winning outcome index once the market settles (REST API field, string
   * on the wire). Null/absent while unsettled — used by the lifecycle sweep
   * to close out losing redemptions without retrying them forever.
   */
  winningOutcomeIdx?: string | number | null;
}

/**
 * Raw market shape the Delphi SDK returns (subset we consume). The live API
 * nests `question`/`outcomes` under `metadata` — the flat top-level fields
 * only exist in test fakes — so `listOpenMarkets` maps through
 * `mapSdkMarket` to normalize both.
 */
interface SdkMarketLike extends DelphiMarket {
  metadata?: { question?: string; outcomes?: string[] } | null;
}

function mapSdkMarket(raw: SdkMarketLike): DelphiMarket {
  const meta = raw.metadata ?? undefined;
  const { metadata: _metadata, ...rest } = raw;
  return {
    ...rest,
    question: raw.question ?? meta?.question,
    outcomes: raw.outcomes ?? meta?.outcomes,
  };
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
  /**
   * Ensure the gateway is approved to spend TST for this market. The SDK's
   * buyShares does NOT call this itself — a fresh wallet has zero allowance
   * and the pre-send simulation reverts. Must be called before every buy.
   */
  ensureTokenApproval(params: {
    marketAddress: `0x${string}`;
    minimumAmount: bigint;
    approveAmount?: bigint;
  }): Promise<{ approvalNeeded: boolean; allowance: bigint; transactionHash?: string }>;
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
  /** Wall-clock timeout (ms) for every SDK call. Default: 60_000. The SDK
   *  has no timeout of its own; a hung RPC/subgraph request would otherwise
   *  freeze the runner's loop forever. */
  sdkTimeoutMs?: number;
  /** Injected client factory — tests use this to avoid network + key material. */
  clientFactory?: () => Promise<DelphiClientLike>;
}

// =============================================================================
// Retry + Timeout Helpers (same shape as twak-executor.withRetry)
// =============================================================================

/**
 * Race a promise against a hard wall-clock deadline.
 *
 * The Delphi SDK performs HTTP calls with NO timeout of its own (verified
 * against SDK v2.1.0 source). A hung request — the Alchemy testnet RPC and
 * the Goldsky subgraph both do this under load — blocks the runner's
 * single-threaded loop forever, silently freezing the competition agent
 * (observed in production 2026-08-15: a cycle hung ~13.5h until pm2
 * restart). Every SDK call in the executor is wrapped here so a hang
 * becomes a retryable/throwable error instead.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Hard wall-clock cap default for every SDK call. The SDK has no timeout of
 * its own; this bound turns a hung RPC/subgraph request into a retryable
 * error instead of an indefinite freeze. Trades and reads share it — the
 * retry policy is the differentiator, not the deadline. */
export const SDK_CALL_TIMEOUT_MS = 60_000;

/**
 * Unit conventions (verified live on competition-testnet 2026-08-15):
 *   - The $TST competition token has **6 decimals** — balances, quotes
 *     (tokensIn/tokensOut), budgets, and exposure are 6-dec raw bigints.
 *   - Outcome **shares have 18 decimals** — the LMSR gateway's
 *     quoteBuyExactOut / quoteSellExactIn take share amounts in 18-dec raw.
 *
 * Dividing one by the other without the 10^12 bridge skews prices by twelve
 * orders of magnitude. Production incident: pricePerShare came out ~3e-13
 * for a 0.31 market, every buy sized to 0 shares, and 25 funded cycles
 * traded nothing. These constants are the single source for that bridge —
 * shared with sizeSharesBudget in probability.ts.
 */
export const DELPHI_TOKEN_DECIMALS = 6;
export const SHARE_DECIMALS = 18;
/** 10^(SHARE_DECIMALS − DELPHI_TOKEN_DECIMALS): the shares↔tokens bridge. */
export const SHARE_TOKEN_DECIMAL_SCALE = 10n ** BigInt(SHARE_DECIMALS - DELPHI_TOKEN_DECIMALS);
/** Precision for bigint price ratios (price × 1e6, converted back to float). */
const PRICE_PRECISION = 1_000_000n;

/**
 * price = tokensRaw / sharesRaw, bridging the decimal gap via bigint
 * (tokens are 6-dec, shares 18-dec; Number division of the raw values is
 * off by 10^12 and overflows-safe-precision alike). Returns price × 1e6 as
 * bigint, callers divide by 1e6 for the float.
 */
function priceRatioScaled(tokensRaw: bigint, sharesRaw: bigint): bigint {
  if (sharesRaw <= 0n) return 0n;
  return (tokensRaw * SHARE_TOKEN_DECIMAL_SCALE * PRICE_PRECISION) / sharesRaw;
}

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
  /** Wall-clock deadline for every SDK call (the SDK has none of its own). */
  private readonly sdkTimeoutMs: number;
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
    this.sdkTimeoutMs = config.sdkTimeoutMs ?? SDK_CALL_TIMEOUT_MS;
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
      const { status } = await withTimeout(client.health(), this.sdkTimeoutMs, "delphi-health");
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
        const { markets } = await withTimeout(
          client.listMarkets({
            status: "open",
            category: params.category,
            limit: params.limit ?? 50,
          }),
          this.sdkTimeoutMs,
          "delphi-list-markets",
        );
        // The live SDK nests question/outcomes under `metadata`; normalize so
        // the rest of the pipeline can read flat fields regardless of source.
        return (markets as SdkMarketLike[]).map(mapSdkMarket);
      },
      { label: "delphi-list-markets", ...this.retryPolicy },
    );
  }

  /**
   * Fetch a single market's details (used for maturity checks on tracked
   * positions — if `resolvesAt` has passed, the market is settled and the
   * lifecycle sweep must redeem, not the convergence sell path). Returns
   * the market shape normalized by `mapSdkMarket`.
   */
  async getMarket(marketAddress: string): Promise<DelphiMarket> {
    if (this.simulator) {
      // Return a synthetic open market in simulator mode so callers can
      // parse resolvesAt without crashing. Tests set it explicitly.
      return {
        id: marketAddress,
        question: "(simulator market)",
        outcomes: ["Yes", "No"],
        status: "open",
        resolvesAt: null,
      };
    }
    const client = await this.getClient();
    return withRetry(
      async () =>
        withTimeout(
          (client.getMarket({ id: marketAddress }) as Promise<DelphiMarket>).then(mapSdkMarket),
          this.sdkTimeoutMs,
          "delphi-get-market-status",
        ),
      { label: "delphi-get-market-status", ...this.retryPolicy },
    );
  }

  /**
   * The winning outcome index of a settled market, or null when unknown
   * (not settled yet, REST index lag, or simulator mode).
   *
   * The lifecycle sweep uses this to break a stuck redeem loop: redeem()
   * reverts for losing shares, and retrying it every cycle burns a
   * transaction attempt forever. With the resolution known, a losing
   * position can be closed + scored without another redeem attempt
   * (production incident 2026-08-18: the Typhoon market resolved NO while
   * we held YES, and the sweep retried the doomed redeem 50 times over
   * ~36h, pinning 103 TST of exposure the whole while).
   */
  async getWinningOutcomeIdx(marketAddress: string): Promise<number | null> {
    if (this.simulator) return null;
    const client = await this.getClient();
    try {
      const market = await withRetry(
        async () =>
          withTimeout(
            client.getMarket({ id: marketAddress }) as Promise<DelphiMarket>,
            this.sdkTimeoutMs,
            "delphi-get-market",
          ),
        { label: "delphi-get-market", ...this.retryPolicy },
      );
      const idx = market.winningOutcomeIdx;
      if (idx === null || idx === undefined || idx === "") return null;
      const parsed = typeof idx === "number" ? idx : parseInt(idx, 10);
      return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
    } catch {
      // REST index unavailable — the sweep keeps retrying redeem as before.
      return null;
    }
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
      // 1 share pays 1 TST at settlement: tokensIn (6-dec) = shares (18-dec)
      // × price / 10^12.
      const tokensIn = (sharesOut * BigInt(Math.round(price * 1e6))) / (SHARE_TOKEN_DECIMAL_SCALE * 1_000_000n);
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
      async () => withTimeout(client.quoteBuy({ marketAddress, outcomeIdx, sharesOut }), this.sdkTimeoutMs, "delphi-quote-buy"),
      { label: "delphi-quote-buy", ...this.retryPolicy },
    );
    // tokensIn is 6-dec TST, sharesOut is 18-dec — bridge the gap or the
    // price is off by 10^12 (see SHARE_TOKEN_DECIMAL_SCALE).
    const pricePerShare = Number(priceRatioScaled(tokensIn, sharesOut)) / 1e6;
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
      const tokensOut = (sharesIn * BigInt(Math.round(price * 1e6))) / (SHARE_TOKEN_DECIMAL_SCALE * 1_000_000n);
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
      async () => withTimeout(client.quoteSell({ marketAddress, outcomeIdx, sharesIn }), this.sdkTimeoutMs, "delphi-quote-sell"),
      { label: "delphi-quote-sell", ...this.retryPolicy },
    );
    // Same 6-dec tokens / 18-dec shares bridge as quoteBuy.
    const pricePerShare = Number(priceRatioScaled(tokensOut, sharesIn)) / 1e6;
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
          withTimeout(
            client.sellShares({
              marketAddress: params.marketAddress,
              outcomeIdx: params.outcomeIdx,
              sharesIn: params.sharesIn,
              minTokensOut,
            }),
            this.sdkTimeoutMs,
            "delphi-sell-shares",
          ),
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

      // The SDK's buyShares does not call ensureTokenApproval; a fresh
      // wallet has zero allowance and the on-chain simulation reverts.
      // Approve the gateway for at least maxTokensIn before buying.
      await withRetry(
        async () =>
          withTimeout(
            client.ensureTokenApproval({
              marketAddress: params.marketAddress as `0x${string}`,
              minimumAmount: maxTokensIn,
            }),
            this.sdkTimeoutMs,
            "delphi-ensure-approval",
          ),
        { label: "delphi-ensure-approval", ...this.retryPolicy },
      );

      const { transactionHash } = await withRetry(
        async () =>
          withTimeout(
            client.buyShares({
              marketAddress: params.marketAddress,
              outcomeIdx: params.outcomeIdx,
              sharesOut: params.sharesOut,
              maxTokensIn,
            }),
            this.sdkTimeoutMs,
            "delphi-buy-shares",
          ),
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
      async () => withTimeout(client.redeemPositions({ marketAddresses }), this.sdkTimeoutMs, "delphi-redeem"),
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
    const { address } = await withTimeout(client.getSigner(), this.sdkTimeoutMs, "delphi-get-signer");
    return address;
  }

  /** Competition-token balance of the signer (18-dec bigint as string). */
  async getTokenBalance(): Promise<string> {
    if (this.simulator) return "0";
    const client = await this.getClient();
    const balance = await withTimeout(client.getErc20Balance(), this.sdkTimeoutMs, "delphi-get-balance");
    return balance.toString();
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
      async () =>
        withTimeout(
          client.listPositions({ wallet, redeemedOrLiquidated: false }),
          this.sdkTimeoutMs,
          "delphi-list-positions",
        ),
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
      async () => withTimeout(client.liquidate(params), this.sdkTimeoutMs, "delphi-liquidate"),
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
