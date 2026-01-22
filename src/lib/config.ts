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

  // Reputation Weighting
  reputation: {
    ethosScoreThresholds: {
      elite: 2000,    // Exemplary (1.5x)
      high: 1700,     // Reputable (1.35x)
      medium: 1400,   // Known (1.15x)
      low: 1000,      // Entry (1.05x)
      unknown: 0
    },
    featureGating: {
      premiumAccess: 1000,     // Entry: Basic analytics
      whaleAnalysis: 1400,     // Known: Alpha discovery + heatmap
      alphaSignals: 1700,      // Reputable: Real-time alerts
      eliteInsights: 2000,     // Exemplary: Advanced audit
    },
    // Community watchlist contribution tiers
    communityTiers: {
      viewer: 0,
      nominator: 1000,    // Entry level nomination
      contributor: 1200,  // Neutral
      curator: 1400,      // Known
      moderator: 1700,    // Reputable
      admin: 2000,        // Exemplary
    },
    perks: {
      // Ethos 100+: Premium Access
      premium: {
        refreshRate: 300000,     // 5 min refresh
        historyDepth: 90,        // 90 days
        exportData: false,
        prioritySupport: false,
      },
      // Ethos 500+: Whale Analysis  
      whale: {
        refreshRate: 180000,     // 3 min refresh
        historyDepth: 180,       // 180 days
        exportData: true,
        prioritySupport: false,
        cohortComparison: true,
        advancedFilters: true,
      },
      // Ethos 1000+: Alpha Signals
      alpha: {
        refreshRate: 60000,      // 1 min refresh
        historyDepth: 365,       // 1 year
        exportData: true,
        prioritySupport: true,
        cohortComparison: true,
        advancedFilters: true,
        realTimeAlerts: true,
        whaleTracking: true,
      },
      // Ethos 2000+: Elite Insights
      elite: {
        refreshRate: 30000,      // 30 sec refresh
        historyDepth: 730,       // 2 years
        exportData: true,
        prioritySupport: true,
        cohortComparison: true,
        advancedFilters: true,
        realTimeAlerts: true,
        whaleTracking: true,
        earlyAccess: true,
        customDashboard: true,
        apiAccess: true,
      }
    }
  },

  // Alpha Discovery
  alphaDiscovery: {
    highConvictionThreshold: 80,
    ironPillarThreshold: 90,
    minPositionsForRanking: 3,
    leaderboardSize: 50,
    alertCooldownHours: 24,
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
