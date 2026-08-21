/**
 * Agent Configuration
 * Ported from src/lib/config.ts — stripped of Next.js-specific env vars
 * and Aleo chain config. Single source of truth for agent-side constants.
 */

/**
 * Resolve the agent's operating mode from env or default.
 * Explicit mode via AGENT_MODE env var overrides implicit auto-detection.
 *
 * Values:
 *   "live"      — Full execution (requires TWAK_ACCESS_ID, CMC_API_KEY or x402, etc.)
 *   "simulator" — In-memory mocks, no real execution
 *   "auto"      — (default) Auto-detect: live if TWAK_ACCESS_ID is set, else simulator
 */
export function resolveAgentMode(): "live" | "simulator" {
  const explicit = process.env.AGENT_MODE?.toLowerCase().trim();
  if (explicit === "live") return "live";
  if (explicit === "simulator") return "simulator";
  // Auto-detect: if TWAK credentials are set, assume live
  return process.env.TWAK_ACCESS_ID ? "live" : "simulator";
}

/** The resolved operating mode at startup. */
export const AGENT_MODE = resolveAgentMode();

export const AGENT_CONFIG = {
  // Conviction signal weights (entry scoring, 0–100 total).
  // The thesis is "Early, Not Wrong": reward contrarian entries on quality
  // assets during fear — NOT momentum/chasing recent winners.
  signal: {
    // Reward weakness / being early (negative recent returns).
    contrarian: 30,
    // Reward oversold timing (synthesized RSI < 35 from 7d return).
    rsi: 10,
    // Reward liquidity & size (capped downside, room to run).
    quality: 20,
    // Reward entering when the market is fearful (low FGI, negative funding).
    regime: 20,
    // Reward on-chain accumulation (growing holder base over 7d).
    holders: 10,
    // Cap on the volatility-erraticism penalty (large |7d − 24h| divergence).
    volatilityPenaltyMax: 15,
    // Max absolute SoSoValue news-sentiment adjustment (signed, ±newsMax).
    // Net negative news on a token shaves conviction; net positive boosts it.
    newsMax: 10,
    // Floor for "early" — collapses worse than this are avoided, not bought.
    capitulationFloorPercent: -70,
  },

  // Agent Trading Parameters
  trading: {
    // Max new conviction entries to open per cycle.
    // Tight-bankroll endgame (live window, ~$9 BSC): one quality entry per
    // cycle conserves BNB so we always retain gas to exit/harvest.
    topK: 1,

    // Hard cap on total open positions in the ledger. With a ~$115 bankroll
    // 5-10 positions averaging $10-$20 each is the right size: meaningful
    // per-position stake, and exit gas (~$1.50/swap) stays under 10% of
    // value. Above this, new entries defer until harvesting frees a slot.
    maxOpenPositions: 8,

    // Cycle interval in minutes
    loopIntervalMinutes: 240,

    // Risk guardrails (hard limits)
    maxDrawdownPercent: 25, // Trip before the 30% disqualification line
    maxPerTradeUsd: 1000,
    maxDailyTrades: 6,
    maxPositionConcentrationPercent: 20,

    // Slippage
    defaultSlippageBps: 100, // 1%

    // Pre-entry execution probe: buy a small amount of the token and immediately
    // sell it back to verify the route is swappable in practice. This catches
    // honeypots, allowance/spender mismatches, and illiquid pairs that pass
    // quote-only checks. Probes are skipped when disabled or when liquidity is
    // comfortably above the threshold (see minLiquidityUsdForSkip).
    entryProbe: {
      enabled: true,
      amountUsd: 1.0,                // probe size
      maxAcceptableLossPercent: 15,  // reject if round-trip loses more than this
      slippageBps: 4900,             // 49% — use a very wide probe so execution, not slippage, is the gate
      minLiquidityUsdForSkip: 20_000, // skip probe when DexScreener liquidity >= this
    },

    // Minimum conviction score required to open a position.
    // At ~$1.50 gas/trade, only strong signals justify the cost.
    minConvictionScore: 58,

    // Holder-base gate: tokens need at least this many on-chain holders to be
    // considered for entry. Shy of this we treat the token as too thin/unproven.
    minHolderCount: 1_000,

    // Holder growth gate: require non-negative 7d holder growth (or no history
    // yet). Negative growth is a distribution/unwind signal.
    requireNonNegativeHolderGrowth: true,

    // ── Position management (the soul: cap losses, let winners run) ──
    // Hard stop — the thesis is invalidated. This is the only reason we exit
    // a losing position. We do NOT sell into ordinary drawdown.
    stopLossPercent: 35,
    // Tiered profit-taking: sell 33% at +50%, remainder trails at +100%.
    // This recycles capital from proven winners into new conviction entries.
    partialProfitGainPercent: 50,

    // We never exit into ordinary drawdown. A trailing stop only arms AFTER
    // a position has run far enough that locking in the asymmetry is no
    // longer "early".
    trailingActivationGainPercent: 100,
    trailingStopPercent: 30,

    // ── Bankroll management (the survival logic) ──
    // The hackathon scoring rules require a non-zero portfolio through the
    // trading window — a sub-$1 portfolio scores 0% for that hour. BNB is
    // also the gas + trade-value asset; once it runs out, the agent can
    // neither exit nor harvest. So bankroll sizing is conservative by design:
    // we cap trade size as a fraction of available BNB (not portfolio value),
    // and we keep a non-spendable gas reserve.
    bankroll: {
      // Never let BNB drop below this — strictly reserved for gas + emergency
      // exits. Trades are skipped when BNB < this + one trade cost.
      // Trading wallet only pays cheap BSC swap gas (Mantle anchoring uses a
      // separate operator wallet), so a $2.5 reserve still covers many exits.
      minBnbReserveUsd: 2.5,
      // When BNB is below this, slow down (double cycle interval) so we
      // burn less Mantle anchor gas per day. Set below our live balance so
      // cycles stay at the base 4h cadence through the trading window.
      targetBnbUsd: 4,
      // Cap on a single trade as a fraction of TRADEABLE BNB (BNB - reserve).
      // 0.5 means one trade can use at most half of what we can afford to spend.
      maxTradeFractionOfBnb: 0.5,
      // When BNB is below this, skip new entries entirely — focus cycles on
      // closing positions and harvesting back into BNB. Lowered for the
      // tight-bankroll live window so entries actually fire (~$8.66 BNB).
      entrySkipBelowBnbUsd: 4.5,
      // Trigger harvest ABOVE the entry-skip floor so harvest fires whenever
      // we can't safely enter. Otherwise BNB sits in the dead zone (above
      // harvest floor, below entry floor) and the agent does nothing.
      // Lowered so the agent recycles capital more aggressively from a small
      // BNB base without external top-ups.
      harvestMinBnbUsd: 4.5,
      // When BNB is low, double the loop interval to save gas on anchoring.
      adaptiveInterval: true,
    },
  },

  // BSC Chain Config (hackathon competition chain)
  chains: {
    bsc: {
      id: 56,
      testnetId: 97,
      name: "BNB Smart Chain",
      nativeCurrency: {
        decimals: 18,
        name: "BNB",
        symbol: "BNB",
      },
      rpcUrls: {
        mainnet: "https://bsc-dataseed.binance.org",
        testnet: "https://data-seed-prebsc-1-s1.binance.org:8545",
      },
      blockExplorerUrls: {
        mainnet: "https://bscscan.com",
        testnet: "https://testnet.bscscan.com",
      },
    },
  },

  // Competition contract (BSC Testnet)
  competition: {
    // BNB Hack competition registration
    identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    // Eligible token symbols from the hackathon rules
    eligibleTokens: [
      "ETH", "USDT", "USDC", "XRP", "TRX", "DOGE", "ZEC", "ADA", "LINK",
      "BCH", "DAI", "TON", "USD1", "USDe", "M", "LTC", "AVAX", "SHIB",
      "XAUt", "WLFI", "H", "DOT", "UNI", "ASTER", "DEXE", "USDD", "ETC",
      "AAVE", "ATOM", "U", "STABLE", "FIL", "INJ", "NIGHT", "FET", "TUSD",
      "BONK", "PENGU", "CAKE", "SIREN", "LUNC", "ZRO", "KITE", "FDUSD",
      "BEAT", "PIEVERSE", "BTT", "NFT", "EDGE", "FLOKI", "LDO", "B", "FF",
      "PENDLE", "NEX", "STG", "AXS", "TWT", "HOME", "RAY", "COMP", "GWEI",
      "XCN", "GENIUS", "XPL", "BAT", "SKYAI", "APE", "IP", "SFP", "TAG",
      "NXPC", "AB", "SAHARA", "1INCH", "CHEEMS", "BANANAS31", "RIVER",
      "MYX", "RAVE", "SNX", "FORM", "LAB", "HTX", "USDf", "CTM", "BDX",
      "SLX", "UB", "DUCKY", "FRAX", "BILL", "WFI", "KOGE", "ALE",
      "FRXUSD", "USDF", "GOMINING", "VCNT", "GUA", "DUSD", "SMILEK",
      "0G", "BEAM", "MY", "SOON", "REAL", "Q", "AIOZ", "ZIG", "YFI",
      "TAC", "lisUSD", "CYS", "ZAMA", "TRIA", "HUMA", "PLUME", "ZIL",
      "XPR", "ZETA", "BabyDoge", "NILA", "ROSE", "VELO", "UAI", "BRETT",
      "OPEN", "BSB", "TOSHI", "BAS", "ACH", "AXL", "LUR", "ELF", "KAVA",
      "APR", "IRYS", "EURI", "XUSD", "BARD", "DUSK", "SUSHI", "PEAQ",
      "COAI", "BDCA", "XAUM",
    ],
  },

  // Mantle ERC-8004 (existing ENW registry)
  mantle: {
    sepolia: {
      chainId: 5003,
      rpcUrl: "https://rpc.sepolia.mantle.xyz",
      explorerUrl: "https://explorer.sepolia.mantle.xyz",
      registryAddress: "0x81226e8894D334c790D9a972855592E6C4eeB15C",
    },
  },

  // Casper Network (Buildathon Qualification Round)
  casper: {
    testnet: {
      // RPC fallback chain — tried in order. The public Casper Association
      // node is primary (no auth, no quota, verified working); cspr.cloud is
      // fallback (needs CSPR_CLOUD_TOKEN, free-tier daily quota 1,200 reqs).
      // The agent's read path (balance checks, event reads) cycles through
      // these; tx submission uses the first reachable one.
      rpcUrls: [
        "https://node.testnet.casper.network/rpc",
        "https://node.testnet.cspr.cloud/rpc",
      ] as readonly string[],
      // Kept for backward compat with one-shot scripts (deploy, smoke, transfer)
      // that still use a single URL. Maps to the cspr.cloud endpoint so scripts
      // that need the auth token keep working unchanged.
      rpcUrl: "https://node.testnet.cspr.cloud/rpc",
      chainName: "casper-test",
      explorerUrl: "https://testnet.cspr.live",
      // Populated post-deploy by `casper/scripts/deploy.ts`. Until then, the
      // adapter reports `isAvailable() = false` and the orchestrator skips it.
      registryHash: "",
      // Payment cap for one anchor_conviction entry-point call, in motes
      // (1 CSPR = 1e9 motes). Unused gas is refunded; this is the maximum
      // the deploy is allowed to consume, not the actual cost. 50 CSPR is the
      // verified working amount — 5 CSPR was rejected as below the testnet
      // floor, and 50 CSPR landed with 13 effects + event emission.
      paymentMotes: "50000000000",
      // Minimum operator balance required before we attempt an anchor.
      // If balance is below this, the adapter skips to avoid guaranteed
      // "Invalid transaction" failures and wasted RPC calls. Set well above
      // the real per-anchor gas cost (a Casper contract call burns <1 CSPR of
      // the 50 CSPR payment cap; unused gas is refunded) so a failed/repriced
      // deploy can't drain the key, but low enough that the wallet rides down
      // to ~30 CSPR before skipping — buying more cycles per top-up. The
      // primary spend lever is anchor *frequency*, controlled by the
      // thesis-hash dedup + quantized jury digest, not this gate.
      minOperatorBalanceMotes: "30000000000",
    },
  },

  // SoDEX — on-chain orderbook on ValueChain (Buildathon integration bonus)
  // Integrated alongside TWAK: SoDEX testnet preferred for new entries,
  // TWAK fallback for tokens/pairs not on SoDEX or when SoDEX is unavailable.
  // Testnet requires no access form — works directly.
  sodex: {
    testnet: {
      baseUrl: "https://testnet-gw.sodex.dev/api/v1/spot",
      chainId: 138565,
    },
    // Default API key name used in X-API-Key header
    defaultApiKeyName: "enw-agent",
  },

  // SoSoValue API — on-chain financial data provider (Buildathon integration)
  // Fetches market snapshots, klines, SSI index data, news feeds, and macro
  // events. Used alongside CMC (composite: SoSoValue token prices preferred,
  // CMC fills regime data gaps).
  sosovalue: {
    baseUrl: "https://openapi.sosovalue.com/openapi/v1",
    // Toggle which modules are active
    modules: {
      marketData: true,    // Currency market snapshots (token pricing)
      indices: true,       // SSI index data (regime + quality signals)
      feeds: true,         // News feeds (AI market narrative, Phase 3)
      macro: true,         // Macroeconomic events (regime context, Phase 3)
    },
  },

  // CROO Agent Protocol — A2A commerce layer (additive to MCP + x402).
  // Private SDK key is read from CROO_SDK_KEY at runtime; these are public
  // defaults and chain metadata.
  cap: {
    apiUrl: process.env.CROO_API_URL ?? "https://api.croo.network",
    wsUrl: process.env.CROO_WS_URL ?? "wss://api.croo.network/ws",
    settlementChain: "base",
    usdcDecimals: 6,
  },

  // Delphi information markets (Gensyn Agent Arena + mainnet later).
  // Prediction-market execution surface: self-contained under agent/lib/delphi/.
  // The BSC pipeline does not import it; the runner is a separate pm2 process.
  // See docs/DELPHI_AGENT_ARENA.md for strategy and phased plan.
  delphi: {
    // Enable gate is runtime-checked per cycle (DELPHI_ENABLED) by the runner,
    // not read from this config object — module-scope env reads are frozen at
    // import time, which breaks test isolation and requires a rebuild for a
    // config flip. Keep gates as runtime functions on consumers instead.
    network: process.env.DELPHI_NETWORK ?? "competition-testnet",
    chainId: 685685,
    competitionGateway: "0x097599c9D966fF496284b892A8F13BF885b258ef",
    appUrl: "https://agent-competition.gensyn.ai",
    // Slippage tolerance applied top-of-book on LMSR quotes (3%).
    defaultSlippageBps: 300,
    // Decision gates for the probability-vs-price strategy. edge = |estimate − implied|;
    // we only trade when it clears threshold + fees + slippage.
    minEdgeToTrade: 0.08,
    // Category-aware edge gates. Crypto threshold markets have a computed
    // vol baseline anchor, so the standard gate applies; categories with no
    // quantitative anchor (politics, culture) demand more edge before we
    // trust an LLM-only estimate against the market.
    categoryEdgeGates: {
      crypto: 0.08,
      economics: 0.1,
      politics: 0.12,
      sports: 0.12,
      culture: 0.14,
      miscellaneous: 0.14,
    } as Record<string, number>,
    // Gate for categories not listed above (unknown/absent category).
    defaultCategoryGate: 0.12,
    // Ensemble forecasting: N independent LLM samples per market, combined by
    // per-outcome median. 1 disables ensembling. Free-tier latency is the
    // cost; median kills single-sample outlier overconfidence.
    ensembleSamples: 3,
    // Crypto vol baseline blend: when a threshold market has BOTH an LLM
    // estimate and a computed log-normal reference probability, the final
    // estimate is (1 − w)·LLM + w·quant. w=0 disables blending.
    volBaselineWeight: 0.35,
    // Sell-into-convergence exit policy (see probability.ts).
    // Take profit when the market price reaches within `tolerance` of our
    // entry estimate; cut the position when price moves `stopEdge` against us.
    // Endgame (2026-08-20): these defaults stay for tests + rollback; the
    // runner ignores them once `endgameHoldFromUtc` has passed.
    convergenceTolerance: 0.02,
    thesisStopEdge: 0.1,
    // Tournament endgame: hold tracked positions to settlement (P&L-only
    // scoring; selling the 1/0 payoff back into LMSR is how we sat 122nd).
    // Set undefined / a far-future date to restore convergence exits.
    endgameHoldFromUtc: "2026-08-20T00:00:00Z" as string | undefined,
    // Maximize P(3× the board), not E[log wealth]. One fat entry per cycle
    // into a +EV ticket whose 1/fill is ≥3 (fill ≤ 0.33). Ruin accepted.
    // Tournament mode does NOT require the Kelly 8–14¢ edge gate — that
    // gate starved the ranker on 2026-08-21 (empty candidate list).
    tournamentMode: true,
    maxNewEntriesPerCycle: 1,
    minPayoutMultiple: 3.0,
    maxFillPrice: 0.33,
    // Once cash is large enough for hop-2, relax so a ~0.58 fill can still
    // compound (1900 / 0.58 ≈ 3270).
    hop2BankrollTst: 1500,
    hop2MinPayoutMultiple: 1.6,
    hop2MaxFillPrice: 0.65,
    // Never enter a market that cannot settle AND redeem before close.
    entryResolveBufferHours: 6,
    // Keep cycling after the window so last-day winners get redeemed.
    postCloseGraceHours: 12,
    // Stop-out re-entry cooldown (hours): after a thesis stop on a market,
    // don't re-enter it for this long unless the new signal's edge beats the
    // stopped entry's edge. Serial re-entry into the same losing thesis is
    // how the Chess market got bought 4× in 4 days (net −89 TST, 2026-08):
    // each stop freed the exposure and the hourly cycle re-bought the same
    // "underpriced" outcome at nearly the same price. Derived from the
    // trade ledger (no extra state file), so it survives restarts.
    stopReentryCooldownHours: 12,
    // Exa web-search briefings per runner cycle (free-tier budget guard).
    webSearchMaxCallsPerCycle: 10,
    // Tier 3 — two-source corroboration: after the primary search rung
    // answers, query the next eligible rung for the same question and mark
    // the briefing corroborated on deterministic overlap (one extra network
    // call from the shared budget above; pure string arithmetic, no LLM).
    webCorroborationEnabled: true,
    // Tier 4 — pre-entry adversarial verification. Fires ONLY when a buy
    // signal has already cleared the edge gate (rare), so the cost is one
    // extra LLM call per candidate entry, never per market per cycle.
    verificationEnabled: true,
    // How much weight the verifier's probability gets when it disagrees
    // with the estimate (see verification.ts applyVerificationToProbability):
    // adjusted = (1−w)·estimate + w·verifier, then the edge gate re-runs.
    verificationWeight: 0.5,
    // Minimum disagreement (|est − verifier|) before the discount applies.
    // Below this the verifier merely confirms — no adjustment.
    verificationDisagreementThreshold: 0.15,
    // Forecast cache TTL: reuse an LLM ensemble estimate across hourly
    // cycles while the market's implied probability hasn't moved (keyed on
    // 2¢-bucketed prices — see forecastCacheKey in runner.ts). Unchanged
    // markets then cost zero inference; the TTL caps staleness.
    forecastCacheTtlMinutes: 360,
    // Tournament sizing: dump free cash into the one ticket. 0.95 not 1.0
    // so a quote/gas remainder stays for the redeem sweep. Ruin of a single
    // hop is accepted — 15% Kelly cannot 5× to top 5 from 600 TST.
    maxPositionFraction: 0.95,
    maxMarketFraction: 0.95,
    // Loop cadence for the standalone Delphi runner (minutes). 30 min so a
    // hop-1 redeem can recycle into hop-2 the same calendar day.
    loopIntervalMinutes: 30,
    // Competition trading window (UTC). Final leaderboard after settlement.
    tradingWindowOpens: "2026-08-10T00:00:00Z",
    tradingWindowCloses: "2026-08-24T00:00:00Z",
  },

  // Anchoring orchestration — which chains we publish conviction records to.
  // Add an entry here + an adapter under `lib/anchors/` to extend to a new chain.
  anchoring: {
    adapters: ["mantle", "casper"] as readonly string[],
  },
} as const;

export type AgentConfig = typeof AGENT_CONFIG;

// =============================================================================
// Competition Constants
// =============================================================================

/**
 * Check if a token symbol is in the competition's eligible token list.
 */
export function isEligibleToken(symbol: string): boolean {
  return (AGENT_CONFIG.competition.eligibleTokens as readonly string[]).includes(symbol.toUpperCase());
}

/**
 * Minimum number of trades per day to qualify for competition ranking.
 */
export const MIN_TRADES_PER_DAY = 1;

/**
 * Minimum total trades for the full trading week.
 */
export const MIN_TRADES_TOTAL = 7;

/**
 * Portfolio threshold — sub-$1 is treated as no capital at work.
 */
export const PORTFOLIO_MINIMUM_USD = 1;

/**
 * HACKATHON: Registration deadline; trading window opens
 * June 22, 2026 00:00 UTC
 */
export const TRADING_WINDOW_OPENS = new Date("2026-06-22T00:00:00Z").getTime();

/**
 * HACKATHON: Trading window closes
 * June 28, 2026 23:59 UTC
 */
export const TRADING_WINDOW_CLOSES = new Date("2026-06-28T23:59:00Z").getTime();

/**
 * Drawdown disqualification threshold (per hackathon rules).
 * Our guardrail trips earlier at 25%.
 */
export const DRAWDOWN_DISQUALIFICATION = 30;

// =============================================================================
// Block-Explorer URL Builders
// =============================================================================

/** Build a BSC transaction explorer URL. */
export function getBscExplorerTxUrl(txHash: string, testnet: boolean = false): string {
  const baseUrl = testnet
    ? AGENT_CONFIG.chains.bsc.blockExplorerUrls.testnet
    : AGENT_CONFIG.chains.bsc.blockExplorerUrls.mainnet;
  return `${baseUrl}/tx/${txHash}`;
}

/** Build a BSC address explorer URL. */
export function getBscExplorerAddressUrl(address: string, testnet: boolean = false): string {
  const baseUrl = testnet
    ? AGENT_CONFIG.chains.bsc.blockExplorerUrls.testnet
    : AGENT_CONFIG.chains.bsc.blockExplorerUrls.mainnet;
  return `${baseUrl}/address/${address}`;
}

/** Build a Mantle transaction explorer URL. */
export function getMantleExplorerTxUrl(txHash: string): string {
  return `${AGENT_CONFIG.mantle.sepolia.explorerUrl}/tx/${txHash}`;
}

/** Build a Mantle address explorer URL. */
export function getMantleExplorerAddressUrl(address: string): string {
  return `${AGENT_CONFIG.mantle.sepolia.explorerUrl}/address/${address}`;
}

/** Build a Casper deploy explorer URL. */
export function getCasperExplorerTxUrl(deployHash: string): string {
  return `${AGENT_CONFIG.casper.testnet.explorerUrl}/deploy/${deployHash}`;
}

/** Build a Casper account explorer URL. */
export function getCasperExplorerAccountUrl(publicKeyHex: string): string {
  return `${AGENT_CONFIG.casper.testnet.explorerUrl}/account/${publicKeyHex}`;
}
