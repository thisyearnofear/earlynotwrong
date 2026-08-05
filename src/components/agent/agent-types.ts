/**
 * Shared agent dashboard types.
 *
 * Extracted from src/app/agent/page.tsx so card components can be split into
 * their own files without importing the god component. Keep this file free
 * of runtime code — types only.
 */

/** LLM conviction jury deliberation (the 7th scoring factor). */
export interface LlmDeliberation {
  deliberatedAt: string;
  provider: string;
  model: string;
  tokensEvaluated: number;
  marketAssessment: string;
  verdicts: Array<{
    symbol: string;
    adjustment: number;
    adjustedScore: number;
    reasoning: string;
    agreement: string;
    keyRisk: string;
  }>;
}

/** Casper ecosystem context fetched via MCP (CSPR.trade + blockchain MCP). */
export interface CasperEcosystemContext {
  dexMcpReachable: boolean;
  chainMcpReachable: boolean;
  csprPriceUsd: number | null;
  csprUsdcLiquidityUsd: number | null;
  topDexTokens: Array<{
    symbol: string;
    address: string;
    decimals: number;
    priceUsd?: number;
  }>;
  networkStatus: {
    eraId: number;
    activeValidators: number;
    totalStakeCspr: number;
    circulatingSupplyCspr: number;
    blockHeight: number;
  } | null;
  fetchedAt: string;
}

/** Macro event pause from SoSoValue calendar — drives entry sizing this cycle. */
export interface MacroPause {
  clear: boolean;
  skipEntries: boolean;
  sizeMultiplier: number;
  hoursUntilNext: number | null;
  reason: string;
  triggeringEvent: {
    name: string;
    date: string;
    impact: "high" | "medium" | "low";
  } | null;
}

/** Per-adapter anchor results — one entry per chain (Mantle, Casper). */
export interface AnchorResult {
  adapter: string;
  status: "success" | "skipped" | "failed";
  txHash?: string;
  blockNumber?: number;
  explorerUrl?: string;
  error?: string;
}

/**
 * The conviction payload the dashboard renders. Mirrors the agent's
 * /conviction response shape.
 */
export interface ConvictionData {
  regime: {
    score: number;
    label: string;
    fearGreedIndex: number | null;
    fearLevel: string;
    /** SoSoValue SSI index confirmation in [−1, +1], or null when offline. */
    ssiConfirmation: number | null;
  } | null;
  marketData: {
    fearGreedIndex: number;
    fearGreedLabel: string;
    totalMarketCapUsd: number;
    btcFundingRate: number;
    ethFundingRate: number;
    tokensTracked: number;
  } | null;
  signals: Array<{
    symbol: string;
    score: number;
    breakdown: {
      contrarian: number;
      rsi: number;
      quality: number;
      regime: number;
      holders: number;
      volatilityPenalty: number;
      /** SoSoValue news sentiment adjustment (signed, ±10pp). */
      news: number;
      /** LLM conviction jury adjustment (signed, ±15pp). */
      llmJury?: number;
    };
    /** Active signal weights for this regime. */
    weights: {
      contrarian: number;
      rsi: number;
      quality: number;
      regime: number;
      holders: number;
      volatilityPenaltyMax: number;
      newsMax: number;
    };
    holderCount: number | null;
    holderGrowthPercent: number | null;
    /** Net news sentiment in [−1, +1], or null if no related news in this cycle. */
    newsSentiment: number | null;
    rationale: string;
    /** LLM jury reasoning trace. */
    juryReasoning?: string;
    /** LLM jury agreement level. */
    juryAgreement?: string;
    /** LLM jury identified key risk. */
    juryKeyRisk?: string;
  }>;
  heldPositions: Array<{
    symbol: string;
    entryPriceUsd: number;
    amountUsd: number;
    entryCycle: number;
    cyclesHeld: number;
    peakPriceUsd: number;
    maxUnderwaterPercent: number;
    stuck?: boolean;
    failedExitAttempts?: number;
  }>;
  positionVerdicts: Array<{
    symbol: string;
    action: "HOLD" | "EXIT_STOP" | "EXIT_TRAIL";
    unrealizedPnLPercent: number;
    drawdownFromPeakPercent: number;
    heldThroughDrawdown: boolean;
    reason: string;
  }>;
  portfolio: {
    totalValueUsd: number;
    drawdownPercent: number;
    positions: Array<{ symbol: string; valueUsd: number }>;
  };
  narrative: {
    summary: string;
    headline: string | null;
    newsCount: number;
    macroEventCount: number;
    generatedAt: string;
  } | null;
  /** LLM conviction jury deliberation (7th factor). */
  llmDeliberation: LlmDeliberation | null;
  /** Casper ecosystem context fetched via MCP (CSPR.trade + blockchain MCP). */
  casperEcosystemContext: CasperEcosystemContext | null;
  /** Macro event pause from SoSoValue calendar — drives entry sizing this cycle. */
  macroPause: MacroPause | null;
  anchoredHash: string;
  anchoredUrl: string;
  anchoring: { hash: string; mode: string } | null;
  /** Per-adapter anchor results — one entry per chain (Mantle, Casper). */
  anchorResults?: AnchorResult[];
}
