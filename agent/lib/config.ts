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
    // Floor for "early" — collapses worse than this are avoided, not bought.
    capitulationFloorPercent: -70,
  },

  // Agent Trading Parameters
  trading: {
    // Max new conviction entries to open per cycle
    topK: 3,

    // Cycle interval in minutes
    loopIntervalMinutes: 240,

    // Risk guardrails (hard limits)
    maxDrawdownPercent: 25, // Trip before the 30% disqualification line
    maxPerTradeUsd: 1000,
    maxDailyTrades: 10,
    maxPositionConcentrationPercent: 20,

    // Slippage
    defaultSlippageBps: 100, // 1%

    // Minimum conviction score required to open a position
    minConvictionScore: 55,

    // ── Position management (the soul: cap losses, let winners run) ──
    // Hard stop — the thesis is invalidated. This is the only reason we exit
    // a losing position. We do NOT sell into ordinary drawdown.
    stopLossPercent: 35,
    // We never take profit early. A trailing stop only arms AFTER a position
    // has run far enough that locking in the asymmetry is no longer "early".
    trailingActivationGainPercent: 100,
    trailingStopPercent: 30,
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
} as const;

export type AgentConfig = typeof AGENT_CONFIG;
