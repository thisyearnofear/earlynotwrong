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
      elite: 2000,    // 1.5x multiplier
      high: 1000,     // 1.3x multiplier  
      medium: 500,    // 1.15x multiplier
      low: 100,       // 1.05x multiplier
      unknown: 0      // 1.0x multiplier
    },
    featureGating: {
      premiumAccess: 100,      // Basic analytics
      whaleAnalysis: 500,      // Alpha discovery + token heatmap
      alphaSignals: 1000,      // Real-time alerts + cohort analysis
      eliteInsights: 2000,     // Advanced analytics + early access
    },
    // Community watchlist contribution tiers
    communityTiers: {
      viewer: 0,          // Can view community watchlist
      nominator: 1000,    // Can nominate wallets (requires 2 endorsements)
      contributor: 1200,  // Can add wallets (requires 1 endorsement)
      curator: 1400,      // Can add wallets directly + vote on nominations
      moderator: 1600,    // Can remove wallets + curate
      admin: 2000,        // Full control + featured picks
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
