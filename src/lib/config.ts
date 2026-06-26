/**
 * Application Configuration
 * Single source of truth for all constants, scoring weights, and thresholds.
 */

export const APP_CONFIG = {
  // URLs
  baseUrl: process.env.NEXT_PUBLIC_APP_URL || "https://earlynotwrong.com",

  // Scoring Weights (0-100 total)
  weights: {
    winRate: 0.25,
    upsideCapture: 0.35,
    earlyExitMitigation: 0.25, // 100 - earlyExitRate
    holdingPeriod: 0.15,
  },

  // Reputation Thresholds
  reputation: {
    ethosScoreThresholds: {
      elite: 2000,    // Exemplary
      high: 1700,     // Reputable
      medium: 1400,   // Known
      low: 1000,      // Entry
      unknown: 0
    },
    featureGating: {
      premiumAccess: 1000,
      whaleAnalysis: 1400,
      alphaSignals: 1700,
      eliteInsights: 2000,
    },
    communityTiers: {
      viewer: 0,
      nominator: 1000,
      contributor: 1200,
      curator: 1400,
      moderator: 1700,
      admin: 2000,
    }
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
      label: "Diamond Hand", // Default
    },
  },

  // Analysis Constants
  analysis: {
    defaultTimeHorizon: 180,
    minTradeValue: 100,
    patienceTaxWindowDays: 90,
    solanaAvgBlockTime: 0.4,
    baseAvgBlockTime: 2.0,
  },

  // Fallbacks
  fallbacks: {
    solPrice: 180,
  },

  // Chain Configs
  chains: {
    base: {
      id: 8453,
      name: "Base",
      rpcUrl: `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
    },
    solana: {
      name: "Solana",
      rpcUrl: `https://api.mainnet-beta.solana.com`,
    },
    aleo: {
      // network: "testnet" — Aleo's current network identifier. The repo had
      // "testnet3" inherited from older SDK versions; the explorer API rejects
      // anything but "testnet" now (verified via curl).
      network: "testnet",
      apiUrl: "https://api.explorer.provable.com/v1",
      explorerUrl: "https://testnet.explorer.provable.com",
      // programId: v2 is what's actually live on Aleo Testnet right now. v3
      // (which adds claim_rebate + used_vouchers mapping) has never been
      // deployed. v2 exposes everything the proof flow needs — issue_conviction,
      // commit_thesis, verify_score_threshold, verify_archetype,
      // verify_efficient_trading. Deploy v3 later only if we want the rebate
      // feature back; the UI guards that path on `rebatesEnabled` below.
      programId: "early_not_wrong_v2.aleo",
      /** True only when programId is a v3+ deploy (has claim_rebate entry).
       *  Used by AleoConvictionCard to show/hide the rebate button. */
      rebatesEnabled: false,
      creditsProgramId: "credits.aleo",
      usdcProgramId: "usdcx_stablecoin.aleo",
      treasuryAddress: "aleo1lsjcz7402z2zxuzznltcx4r37ys39w0gktxr3rmtce2kqqdwr5xq020tl2",
    },
  }
};
