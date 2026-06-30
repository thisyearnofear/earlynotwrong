/**
 * Solana pre-trade safety gate — vendored from solana-safe-trade-skill.
 *
 * Source of truth: https://github.com/thisyearnofear/solana-safe-trade-skill
 * (reference/check-token-safety.ts at HEAD)
 *
 * Vendored so the agent can run the four-gate safety check before any Solana
 * swap it considers. The BSC-side equivalent is the inline implementation in
 * twak-executor.ts (selectBestTokenMatch + DexScreener + TWAK quote check) —
 * this module is the same composition, ported to Solana primitives:
 *
 *   Gate 1: Jupiter Token Search v2 (isVerified)
 *   Gate 2: Pyth → Birdeye reference price sanity (deferred when no candidate
 *           price is supplied)
 *   Gate 3: DexScreener Solana pool depth + 24h volume
 *   Gate 4: Jupiter Lite /swap/v1/quote routability
 *
 * When updating: change the upstream skill first (the standalone repo is the
 * canonical source — external consumers read it), then re-vendor. Do not
 * diverge in-tree.
 */

// =============================================================================
// Public types
// =============================================================================

export type Gate = "allowlist" | "price-sanity" | "liquidity" | "quote";

export interface SafetyEvidence {
  jupiterTokenList?: {
    listed: boolean;
    verified?: boolean;
    tags?: string[];
    organicScoreLabel?: "high" | "medium" | "low";
    topHoldersPercentage?: number;
  };
  referencePrice?: {
    source: "pyth" | "birdeye";
    usd: number;
    ratioVsResolved?: number;
  };
  dexLiquidity?: {
    liquidityUsd: number;
    volume24hUsd: number;
    pairCount: number;
  };
  jupiterQuote?: {
    ok: boolean;
    outAmount?: string;
    routePlan?: number;
    error?: string;
  };
}

export interface SafetyResult {
  ok: boolean;
  mint: string;
  gateFailed: Gate | null;
  reason: string | null;
  evidence: SafetyEvidence;
}

/**
 * Gate 1 allowlist mode.
 *   - "jupiter-verified": mint must appear in Jupiter's v2 search AND have `isVerified === true`.
 *   - "jupiter-known": mint must appear in Jupiter's v2 search (any verification).
 *   - string[]: caller-supplied list of accepted mints.
 *   - "off": skip this gate.
 */
export type AllowlistMode = "jupiter-verified" | "jupiter-known" | "off" | string[];
export type ReferenceOracleMode = "pyth" | "birdeye" | "off";

export interface SafetyOptions {
  /** Gate 1: which allowlist to use, or `"off"` to skip. */
  allowlist?: AllowlistMode;
  /** Gate 2: which oracle for reference price, or `"off"` to skip. */
  referenceOracle?: ReferenceOracleMode;
  /**
   * Gate 2: candidate price (USD) for the mint, from the caller's pricing
   * source — typically Jupiter `/price` or a DEX aggregator. If undefined,
   * Gate 2 cannot run and is deferred (pass-by-default).
   */
  resolvedPriceUsd?: number;
  /** Gate 2: [low, high] multiplier band against the oracle. Default [0.5, 2.0]. */
  priceBand?: [number, number];
  /** Gate 3: minimum sum-of-pairs liquidity in USD. Default 5_000. */
  minLiquidityUsd?: number;
  /** Gate 3: minimum max-of-pairs 24h volume in USD. Default 100. */
  minVolume24hUsd?: number;
  /** Gate 3: DexScreener chainId filter. Default "solana". */
  dexScreenerChain?: string;
  /** Gate 4: Jupiter v6 input mint (defaults to wSOL). */
  inputMint?: string;
  /** Gate 4: amount in input-mint base units (lamports for SOL). Default 1 SOL. */
  quoteAmountLamports?: bigint;
  /** Gate 4: slippage tolerance for the test quote, basis points. Default 50. */
  slippageBps?: number;
  /** Inject fetchers for testing / custom transports. */
  fetchers?: Partial<Fetchers>;
}

/**
 * Single entry as returned by Jupiter's v2 token search.
 * https://lite-api.jup.ag/tokens/v2/search?query=<mint-or-symbol>
 * Response is rich (price, liquidity, holderCount, organicScore, …); we only
 * type the fields the gate uses.
 */
export interface JupiterTokenSearchEntry {
  id: string;
  symbol?: string;
  name?: string;
  isVerified?: boolean;
  tags?: string[];
  organicScoreLabel?: "high" | "medium" | "low";
  audit?: { topHoldersPercentage?: number };
}

export interface DexScreenerPair {
  chainId?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
}

export interface PythPrice {
  /** USD price. */
  price: number;
  /** UNIX seconds — caller may want to reject stale feeds. */
  publishTime?: number;
}

export interface BirdeyePrice {
  /** USD price. */
  value: number;
}

export interface JupiterQuoteResponse {
  outAmount?: string;
  routePlan?: unknown[];
  errorCode?: string;
  error?: string;
}

export interface Fetchers {
  jupiterTokenSearch: (mint: string) => Promise<JupiterTokenSearchEntry | null>;
  dexScreener: (mint: string) => Promise<DexScreenerPair[] | null>;
  pythPrice: (mint: string) => Promise<PythPrice | null>;
  birdeyePrice: (mint: string) => Promise<BirdeyePrice | null>;
  jupiterQuote: (params: {
    inputMint: string;
    outputMint: string;
    amount: string;
    slippageBps: number;
  }) => Promise<JupiterQuoteResponse | null>;
}

// =============================================================================
// Defaults
// =============================================================================

const WSOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_BASE_UNITS_FALLBACK = 1_000_000n; // 1 USDC (6 decimals)

const DEFAULTS = {
  allowlist: "jupiter-verified" as AllowlistMode,
  referenceOracle: "pyth" as ReferenceOracleMode,
  priceBand: [0.5, 2.0] as [number, number],
  minLiquidityUsd: 5_000,
  minVolume24hUsd: 100,
  dexScreenerChain: "solana",
  inputMint: WSOL_MINT,
  quoteAmountLamports: 1_000_000_000n,
  slippageBps: 50,
};

// =============================================================================
// Default fetchers (live network)
// =============================================================================

const liveFetchers: Fetchers = {
  jupiterTokenSearch: async (mint) => {
    const res = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`);
    if (!res.ok) return null;
    const arr = (await res.json()) as JupiterTokenSearchEntry[];
    // The search endpoint accepts symbols or mints; filter to the exact mint
    // so a symbol collision can't match.
    return arr.find((e) => e.id === mint) ?? null;
  },

  dexScreener: async (mint) => {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    if (!res.ok) return null;
    const j = (await res.json()) as { pairs?: DexScreenerPair[] };
    return j.pairs ?? [];
  },

  pythPrice: async (mint) => {
    // Pyth's Hermes API uses price-feed IDs, not mint addresses, which means
    // a real implementation needs a mint→feedId map. The kit's sendai/pyth
    // skill ships one. For the reference implementation we treat unmapped
    // mints as "no price" (gate defers).
    const feedId = PYTH_MINT_TO_FEED[mint];
    if (!feedId) return null;
    const res = await fetch(`https://hermes.pyth.network/api/latest_price_feeds?ids[]=${feedId}`);
    if (!res.ok) return null;
    const arr = (await res.json()) as Array<{ price?: { price?: string; expo?: number; publish_time?: number } }>;
    const p = arr[0]?.price;
    if (!p?.price || typeof p.expo !== "number") return null;
    const price = Number(p.price) * Math.pow(10, p.expo);
    if (!Number.isFinite(price) || price <= 0) return null;
    return { price, publishTime: p.publish_time };
  },

  birdeyePrice: async (mint) => {
    const apiKey = process.env.BIRDEYE_API_KEY;
    if (!apiKey) return null;
    const res = await fetch(`https://public-api.birdeye.so/defi/price?address=${mint}`, {
      headers: { "X-API-KEY": apiKey, "x-chain": "solana" },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { data?: { value?: number } };
    const v = j.data?.value;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
    return { value: v };
  },

  jupiterQuote: async ({ inputMint, outputMint, amount, slippageBps }) => {
    // Current Jupiter swap quote endpoint (v6 retired alongside quote-api.jup.ag).
    const url = new URL("https://lite-api.jup.ag/swap/v1/quote");
    url.searchParams.set("inputMint", inputMint);
    url.searchParams.set("outputMint", outputMint);
    url.searchParams.set("amount", amount);
    url.searchParams.set("slippageBps", String(slippageBps));
    const res = await fetch(url);
    if (res.status >= 500) {
      // Surface 5xx as null so the gate can mark this as a hard fail (Jupiter
      // is load-bearing; if it's down, the agent can't trade anyway).
      return null;
    }
    if (!res.ok) {
      return { errorCode: `http_${res.status}` };
    }
    return (await res.json()) as JupiterQuoteResponse;
  },
};

/**
 * Minimal seed mint→Pyth feed map. Production agents should use a complete map
 * (sendai/pyth skill ships one). This subset is enough to make the reference
 * implementation useful out of the box for the canonical mints.
 */
const PYTH_MINT_TO_FEED: Record<string, string> = {
  // SOL
  [WSOL_MINT]: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  // USDC
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  // USDT
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b",
};

// =============================================================================
// Gate implementations
// =============================================================================

interface GateContext {
  mint: string;
  opts: Required<Omit<SafetyOptions, "fetchers" | "resolvedPriceUsd">> & {
    resolvedPriceUsd?: number;
  };
  fetchers: Fetchers;
  evidence: SafetyEvidence;
}

async function gateAllowlist(ctx: GateContext): Promise<{ ok: boolean; reason?: string }> {
  const mode = ctx.opts.allowlist;
  if (mode === "off") return { ok: true };

  if (Array.isArray(mode)) {
    const listed = mode.includes(ctx.mint);
    ctx.evidence.jupiterTokenList = { listed, verified: listed };
    return listed ? { ok: true } : { ok: false, reason: "mint not in custom allowlist" };
  }

  const entry = await ctx.fetchers.jupiterTokenSearch(ctx.mint);
  if (!entry) {
    ctx.evidence.jupiterTokenList = { listed: false };
    return { ok: false, reason: "mint not found in Jupiter token search" };
  }

  const isVerified = entry.isVerified === true;
  ctx.evidence.jupiterTokenList = {
    listed: true,
    verified: isVerified,
    tags: entry.tags,
    organicScoreLabel: entry.organicScoreLabel,
    topHoldersPercentage: entry.audit?.topHoldersPercentage,
  };

  if (mode === "jupiter-verified" && !isVerified) {
    return { ok: false, reason: "mint not Jupiter-verified (isVerified=false)" };
  }
  return { ok: true };
}

async function gatePriceSanity(ctx: GateContext): Promise<{ ok: boolean; reason?: string }> {
  if (ctx.opts.referenceOracle === "off") return { ok: true };
  if (typeof ctx.opts.resolvedPriceUsd !== "number" || ctx.opts.resolvedPriceUsd <= 0) {
    // No candidate price to compare against — cannot run this gate. Defer.
    return { ok: true };
  }

  let oracle: PythPrice | BirdeyePrice | null = null;
  let source: "pyth" | "birdeye" | null = null;

  if (ctx.opts.referenceOracle === "pyth") {
    oracle = await ctx.fetchers.pythPrice(ctx.mint);
    if (oracle) source = "pyth";
    // Fall back to Birdeye if Pyth has no feed for this mint.
    if (!oracle) {
      oracle = await ctx.fetchers.birdeyePrice(ctx.mint);
      if (oracle) source = "birdeye";
    }
  } else if (ctx.opts.referenceOracle === "birdeye") {
    oracle = await ctx.fetchers.birdeyePrice(ctx.mint);
    if (oracle) source = "birdeye";
  }

  if (!oracle || !source) {
    // No oracle data available — defer (pass-by-default).
    return { ok: true };
  }

  const oraclePrice = "price" in oracle ? oracle.price : oracle.value;
  const ratio = ctx.opts.resolvedPriceUsd / oraclePrice;
  ctx.evidence.referencePrice = { source, usd: oraclePrice, ratioVsResolved: ratio };

  const [low, high] = ctx.opts.priceBand;
  if (ratio < low || ratio > high) {
    return {
      ok: false,
      reason: `resolved price $${ctx.opts.resolvedPriceUsd.toFixed(6)} is ${ratio.toFixed(2)}× ${source} ($${oraclePrice.toFixed(6)}); band [${low}, ${high}]`,
    };
  }
  return { ok: true };
}

async function gateLiquidity(ctx: GateContext): Promise<{ ok: boolean; reason?: string }> {
  const pairs = await ctx.fetchers.dexScreener(ctx.mint);
  // Fetcher failure / 5xx: defer (pass-by-default). The downstream quote gate
  // is the load-bearing "router can route it" signal.
  if (pairs === null) return { ok: true };

  const onChain = pairs.filter((p) => p.chainId === ctx.opts.dexScreenerChain);
  if (onChain.length === 0) {
    ctx.evidence.dexLiquidity = { liquidityUsd: 0, volume24hUsd: 0, pairCount: 0 };
    return { ok: false, reason: `no DEX pair on ${ctx.opts.dexScreenerChain}` };
  }

  const liquidityUsd = onChain.reduce((s, p) => s + (Number(p.liquidity?.usd) || 0), 0);
  const volume24hUsd = Math.max(...onChain.map((p) => Number(p.volume?.h24) || 0));
  ctx.evidence.dexLiquidity = { liquidityUsd, volume24hUsd, pairCount: onChain.length };

  if (liquidityUsd < ctx.opts.minLiquidityUsd) {
    return {
      ok: false,
      reason: `pool $${liquidityUsd.toFixed(0)} < $${ctx.opts.minLiquidityUsd}`,
    };
  }
  if (volume24hUsd < ctx.opts.minVolume24hUsd) {
    return {
      ok: false,
      reason: `24h volume $${volume24hUsd.toFixed(0)} < $${ctx.opts.minVolume24hUsd}`,
    };
  }
  return { ok: true };
}

async function gateQuote(ctx: GateContext): Promise<{ ok: boolean; reason?: string }> {
  // Guard against the no-op case: if the candidate IS the configured input
  // mint, swap to USDC as the test input so Jupiter doesn't 400 on a
  // self-trade. The point of this gate is "can the router route INTO this
  // mint?" — that question only makes sense with a different input.
  let inputMint = ctx.opts.inputMint;
  let amount = ctx.opts.quoteAmountLamports.toString();
  if (inputMint === ctx.mint) {
    inputMint = ctx.mint === USDC_MINT ? WSOL_MINT : USDC_MINT;
    if (inputMint === USDC_MINT) amount = USDC_BASE_UNITS_FALLBACK.toString();
  }

  const resp = await ctx.fetchers.jupiterQuote({
    inputMint,
    outputMint: ctx.mint,
    amount,
    slippageBps: ctx.opts.slippageBps,
  });

  if (resp === null) {
    ctx.evidence.jupiterQuote = { ok: false, error: "jupiter unreachable" };
    return { ok: false, reason: "jupiter v6 unreachable (5xx)" };
  }
  if (resp.errorCode || resp.error) {
    ctx.evidence.jupiterQuote = { ok: false, error: resp.errorCode ?? resp.error };
    return { ok: false, reason: `jupiter: ${resp.errorCode ?? resp.error}` };
  }
  const outAmount = resp.outAmount;
  const routePlan = Array.isArray(resp.routePlan) ? resp.routePlan : [];
  if (!outAmount || Number(outAmount) <= 0) {
    ctx.evidence.jupiterQuote = { ok: false, error: "no outAmount" };
    return { ok: false, reason: "jupiter returned no outAmount" };
  }
  if (routePlan.length === 0) {
    ctx.evidence.jupiterQuote = { ok: false, error: "empty routePlan", outAmount };
    return { ok: false, reason: "jupiter returned empty routePlan" };
  }
  ctx.evidence.jupiterQuote = { ok: true, outAmount, routePlan: routePlan.length };
  return { ok: true };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Run the four-gate pre-trade safety check on a Solana mint.
 *
 * Gates run in order (cheapest first); the first failure short-circuits.
 * If every gate passes, the result is `{ ok: true, gateFailed: null }` and
 * the caller may proceed with a real swap.
 */
export async function checkTokenSafety(
  mint: string,
  opts: SafetyOptions = {},
): Promise<SafetyResult> {
  const merged: GateContext["opts"] = {
    allowlist: opts.allowlist ?? DEFAULTS.allowlist,
    referenceOracle: opts.referenceOracle ?? DEFAULTS.referenceOracle,
    priceBand: opts.priceBand ?? DEFAULTS.priceBand,
    minLiquidityUsd: opts.minLiquidityUsd ?? DEFAULTS.minLiquidityUsd,
    minVolume24hUsd: opts.minVolume24hUsd ?? DEFAULTS.minVolume24hUsd,
    dexScreenerChain: opts.dexScreenerChain ?? DEFAULTS.dexScreenerChain,
    inputMint: opts.inputMint ?? DEFAULTS.inputMint,
    quoteAmountLamports: opts.quoteAmountLamports ?? DEFAULTS.quoteAmountLamports,
    slippageBps: opts.slippageBps ?? DEFAULTS.slippageBps,
    resolvedPriceUsd: opts.resolvedPriceUsd,
  };

  const fetchers: Fetchers = { ...liveFetchers, ...opts.fetchers };
  const evidence: SafetyEvidence = {};
  const ctx: GateContext = { mint, opts: merged, fetchers, evidence };

  const order: Array<{ name: Gate; run: typeof gateAllowlist }> = [
    { name: "allowlist", run: gateAllowlist },
    { name: "price-sanity", run: gatePriceSanity },
    { name: "liquidity", run: gateLiquidity },
    { name: "quote", run: gateQuote },
  ];

  for (const gate of order) {
    const verdict = await gate.run(ctx);
    if (!verdict.ok) {
      return {
        ok: false,
        mint,
        gateFailed: gate.name,
        reason: verdict.reason ?? "unknown",
        evidence,
      };
    }
  }
  return { ok: true, mint, gateFailed: null, reason: null, evidence };
}
