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
    }
  }
};
