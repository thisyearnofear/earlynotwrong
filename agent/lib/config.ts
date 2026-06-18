/**
 * Agent Configuration
 * Ported from src/lib/config.ts — stripped of Next.js-specific env vars
 * and Aleo chain config. Single source of truth for agent-side constants.
 */

export const AGENT_CONFIG = {
  // Scoring Weights (0-100 total)
  weights: {
    winRate: 0.25,
    upsideCapture: 0.35,
    earlyExitMitigation: 0.25, // 100 - earlyExitRate
    holdingPeriod: 0.15,
  },

  // Reputation score thresholds (Ethos-derived)
  reputation: {
    scoreThresholds: {
      elite: 2000,
      alpha: 1700,
      whale: 1400,
      premium: 1000,
      member: 1,
      visitor: 0,
    },

    // Ethos tier → conviction score multipliers
    // Higher tiers get more weight when ranking wallets
    convictionMultipliers: {
      elite: 1.5,
      alpha: 1.3,
      whale: 1.15,
      premium: 1.05,
      member: 1.0,
      visitor: 1.0,
    } as Record<string, number>,

    // Minimum thresholds for data sources
    dataMinScore: {
      alphaDiscovery: 1000,
      cohortComparison: 1400,
    },
  },

  // Archetype Thresholds
  archetypes: {
    IRON_PILLAR: {
      minScore: 90,
      maxPatienceTax: 1000,
      label: "Iron Pillar",
    },
    PROFIT_PHANTOM: {
      minScore: 70,
      minPatienceTax: 5000,
      label: "Profit Phantom",
    },
    EXIT_VOYAGER: {
      maxScore: 40,
      label: "Exit Voyager",
    },
    DIAMOND_HAND: {
      label: "Diamond Hand", // Default fallback
    },
  },

  // Analysis Constants
  analysis: {
    defaultTimeHorizon: 180,
    minTradeValue: 100,
    patienceTaxWindowDays: 90,
  },

  // Agent Trading Parameters
  trading: {
    // Max positions to copy per cycle
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

    // Minimum conviction score to consider copying
    minConvictionScore: 60,
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

  // CMC AI Agent Hub
  cmc: {
    mcpEndpoint: "https://mcp.coinmarketcap.com/mcp",
    // x402: keyless, pay-per-request at $0.01/request on Base
    x402Endpoint: "https://api.coinmarketcap.com/data-api/v3",
    x402CostPerRequest: 0.01, // USD
    minRequestsPerCycle: 3,
    maxRequestsPerCycle: 10,
  },

  // Mantle ERC-8004 (existing ENW registry)
  mantle: {
    sepolia: {
      chainId: 5003,
      rpcUrl: "https://rpc.sepolia.mantle.xyz",
      explorerUrl: "https://explorer.sepolia.mantle.xyz",
      registryAddress: "0xBd93c9fd88d7D3D5a7b64b24C137f3666E287121",
    },
  },
} as const;

export type AgentConfig = typeof AGENT_CONFIG;
