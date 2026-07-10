import { NextRequest, NextResponse } from "next/server";
import { marketService } from "@/lib/services/market-service";
import { APP_CONFIG } from "@/lib/config";
import { getCohortPercentile } from "@/lib/db/postgres";

interface Position {
  tokenAddress: string;
  tokenSymbol?: string;
  entries: Array<{
    hash: string;
    timestamp: number;
    amount: number;
    priceUsd: number;
    valueUsd: number;
  }>;
  exits: Array<{
    hash: string;
    timestamp: number;
    amount: number;
    priceUsd: number;
    valueUsd: number;
  }>;
  totalInvested: number;
  totalRealized: number;
  remainingBalance: number;
  isActive: boolean;
}

interface BatchRequest {
  positions: Position[];
  chain: "solana" | "base";
  ethosScore?: number | null;
}

interface PositionAnalysis {
  tokenAddress: string;
  tokenSymbol?: string;
  metadata: {
    name: string;
    symbol: string;
    logoUri?: string;
  } | null;
  currentPrice: number;
  priceChange24h: number;
  entryDetails: {
    avgPrice: number;
    totalAmount: number;
    totalValue: number;
    firstEntry: number;
  };
  exitDetails: {
    avgPrice: number;
    totalAmount: number;
    totalValue: number;
    lastExit: number;
  } | null;
  patienceTax: number;
  maxMissedGain: number;
  maxMissedGainDate: number;
  realizedPnL: number;
  realizedPnLPercent: number;
  unrealizedPnL: number | null;
  holdingPeriodDays: number;
  isEarlyExit: boolean;
  hasReEntry?: boolean;
  counterfactual: {
    wouldBeValue: number;
    missedGainDollars: number;
  } | null;
}

interface ScoreComponent {
  /** The measured input (a rate/percentage, 0–100 scale). */
  value: number;
  /** Points this component contributed to the score (negative = penalty). */
  points: number;
}

interface ScoreBreakdown {
  winRate: ScoreComponent;
  upsideCapture: ScoreComponent;
  earlyExitMitigation: ScoreComponent;
  holdingPeriod: ScoreComponent;
  diamondHands: ScoreComponent;
  consistency: ScoreComponent;
  panicSell: ScoreComponent;
}

interface ConvictionMetrics {
  score: number;
  /** Exact component contributions that produced `score`. */
  breakdown?: ScoreBreakdown;
  patienceTax: number;
  upsideCapture: number;
  earlyExits: number;
  convictionWins: number;
  /** Real cohort rank ("Top X%") — null when the cohort is unavailable/too small. */
  percentile: number | null;
  /** Number of analyzed wallets the percentile was computed against. */
  cohortSize?: number;
  archetype: "Iron Pillar" | "Profit Phantom" | "Exit Voyager" | "Diamond Hand";
  totalPositions: number;
  avgHoldingPeriod: number;
  winRate: number;
}

export async function POST(request: NextRequest) {
  try {
    const body: BatchRequest = await request.json();
    const { positions, chain } = body;

    if (!positions || !chain) {
      return NextResponse.json(
        { error: "Missing required fields: positions, chain" },
        { status: 400 }
      );
    }

    // Extract unique token addresses for batch fetching
    const uniqueTokens = Array.from(
      new Set(positions.map((p) => p.tokenAddress))
    );

    // Batch fetch metadata and prices for all unique tokens using MarketService
    const [metadataResults, priceResults] = await Promise.all([
      Promise.all(uniqueTokens.map((address) => marketService.getTokenMetadata(address, chain))),
      Promise.all(uniqueTokens.map((address) => marketService.getPriceData(address, chain))),
    ]);

    // Create lookup maps
    const metadataMap = new Map<string, { name: string; symbol: string; logoUri?: string } | null>();
    const priceMap = new Map<string, { currentPrice: number; priceChange24h: number } | null>();

    uniqueTokens.forEach((address, index) => {
      const metadata = metadataResults[index];
      metadataMap.set(address, metadata ? { name: metadata.name, symbol: metadata.symbol, logoUri: metadata.logoUri } : null);

      const priceData = priceResults[index];
      priceMap.set(address, priceData ? { currentPrice: priceData.currentPrice, priceChange24h: priceData.priceChange24h } : null);
    });

    // Analyze positions with pre-fetched data
    const positionAnalyses = await Promise.all(
      positions.map((position) =>
        analyzePosition(position, chain, metadataMap, priceMap)
      )
    );

    const convictionMetrics = calculateConvictionMetrics(
      positions,
      positionAnalyses
    );

    // Rank against the real cohort of analyzed wallets. When the DB is
    // unreachable or the cohort is too small, percentile stays null and the
    // UI omits the stat — we never show a fabricated rank.
    const cohort = await getCohortPercentile(convictionMetrics.score, chain);
    if (cohort) {
      convictionMetrics.percentile = cohort.topPercent;
      convictionMetrics.cohortSize = cohort.cohortSize;
    }

    return NextResponse.json({
      success: true,
      positions: positionAnalyses,
      metrics: convictionMetrics,
    });
  } catch (error) {
    console.error("Batch analysis error:", error);
    return NextResponse.json(
      { error: "Failed to analyze positions", details: String(error) },
      { status: 500 }
    );
  }
}

async function analyzePosition(
  position: Position,
  chain: "solana" | "base",
  metadataMap: Map<string, { name: string; symbol: string; logoUri?: string } | null>,
  priceMap: Map<string, { currentPrice: number; priceChange24h: number } | null>
): Promise<PositionAnalysis> {
  // Use pre-fetched data from maps
  const metadata = metadataMap.get(position.tokenAddress) ?? null;
  const priceData = priceMap.get(position.tokenAddress) ?? null;

  // Calculate patience tax using MarketService if there are exits
  let patienceTaxData = null;
  if (position.exits.length > 0) {
    const lastExit = position.exits[position.exits.length - 1];
    patienceTaxData = await marketService.calculatePatienceTax(
      position.tokenAddress,
      chain,
      lastExit.priceUsd,
      lastExit.timestamp,
      position.totalRealized,
      APP_CONFIG.analysis.patienceTaxWindowDays
    );
  }

  const entryDetails = {
    avgPrice:
      position.entries.reduce((sum, e) => sum + e.priceUsd * e.amount, 0) /
      position.entries.reduce((sum, e) => sum + e.amount, 0),
    totalAmount: position.entries.reduce((sum, e) => sum + e.amount, 0),
    totalValue: position.totalInvested,
    firstEntry: position.entries[0]?.timestamp || 0,
  };

  const exitDetails =
    position.exits.length > 0
      ? {
        avgPrice:
          position.exits.reduce((sum, e) => sum + e.priceUsd * e.amount, 0) /
          position.exits.reduce((sum, e) => sum + e.amount, 0),
        totalAmount: position.exits.reduce((sum, e) => sum + e.amount, 0),
        totalValue: position.totalRealized,
        lastExit: position.exits[position.exits.length - 1]?.timestamp || 0,
      }
      : null;

  const realizedPnL = position.totalRealized - position.totalInvested;
  const realizedPnLPercent =
    position.totalInvested > 0
      ? (realizedPnL / position.totalInvested) * 100
      : 0;

  let unrealizedPnL: number | null = null;
  if (position.isActive && priceData && position.remainingBalance > 0) {
    const currentValue = position.remainingBalance * priceData.currentPrice;
    const costBasis = position.remainingBalance * entryDetails.avgPrice;
    unrealizedPnL = currentValue - costBasis;
  }

  const holdingPeriodDays = exitDetails
    ? (exitDetails.lastExit - entryDetails.firstEntry) / (24 * 60 * 60 * 1000)
    : (Date.now() - entryDetails.firstEntry) / (24 * 60 * 60 * 1000);

  // Re-entry detection for this position (gap > 1 day between entries)
  let hasReEntry = false;
  if (position.entries && position.entries.length > 1) {
    for (let j = 1; j < position.entries.length; j++) {
      const gapDays = (position.entries[j].timestamp - position.entries[j - 1].timestamp) / (24 * 60 * 60 * 1000);
      if (gapDays > 1) {
        hasReEntry = true;
        break;
      }
    }
  }

  const isEarlyExit =
    patienceTaxData !== null && patienceTaxData.maxMissedGain > 50;

  const counterfactual = patienceTaxData
    ? {
      wouldBeValue: patienceTaxData.wouldBeValue,
      missedGainDollars: patienceTaxData.patienceTax,
    }
    : null;

  return {
    tokenAddress: position.tokenAddress,
    tokenSymbol: position.tokenSymbol || metadata?.symbol,
    metadata: metadata
      ? {
        name: metadata.name,
        symbol: metadata.symbol,
        logoUri: metadata.logoUri,
      }
      : null,
    currentPrice: priceData?.currentPrice || 0,
    priceChange24h: priceData?.priceChange24h || 0,
    entryDetails,
    exitDetails,
    patienceTax: patienceTaxData?.patienceTax || 0,
    maxMissedGain: patienceTaxData?.maxMissedGain || 0,
    maxMissedGainDate: patienceTaxData?.maxMissedGainDate || 0,
    realizedPnL,
    realizedPnLPercent,
    unrealizedPnL,
    holdingPeriodDays: Math.round(holdingPeriodDays),
    isEarlyExit,
    hasReEntry,
    counterfactual,
  };
}

function calculateConvictionMetrics(
  positions: Position[],
  analyses: PositionAnalysis[]
): ConvictionMetrics {
  if (positions.length === 0) {
    return {
      score: 0,
      patienceTax: 0,
      upsideCapture: 0,
      earlyExits: 0,
      convictionWins: 0,
      percentile: null,
      archetype: APP_CONFIG.archetypes.EXIT_VOYAGER.label as ConvictionMetrics["archetype"],
      totalPositions: 0,
      avgHoldingPeriod: 0,
      winRate: 0,
    };
  }

  let totalPatienceTax = 0;
  let totalRealized = 0;
  let earlyExits = 0;
  let convictionWins = 0;
  let totalHoldingDays = 0;
  let winningPositions = 0;
  const positionSizes: number[] = [];
  const holdingPeriods: number[] = [];

  // Behavioral metrics for conviction analysis
  let panicSells = 0;
  let diamondHands = 0;

  for (let i = 0; i < positions.length; i++) {
    const position = positions[i];
    const analysis = analyses[i];

    totalRealized += position.totalRealized;
    totalPatienceTax += analysis.patienceTax;
    totalHoldingDays += analysis.holdingPeriodDays;

    positionSizes.push(position.totalInvested);
    holdingPeriods.push(analysis.holdingPeriodDays);

    if (analysis.realizedPnL > 0) {
      winningPositions++;
    }

    // Conviction win: 50%+ gain on position
    if (analysis.realizedPnL > position.totalInvested * 0.5) {
      convictionWins++;
    }

    if (analysis.isEarlyExit) {
      earlyExits++;
    }

    // Panic sell: exited within 7 days
    if (analysis.holdingPeriodDays < 7 && position.exits.length > 0) {
      panicSells++;
    }

    // Diamond hands: held position despite high patience tax
    if (analysis.maxMissedGain > 100 && analysis.holdingPeriodDays > 30) {
      diamondHands++;
    }

    // Re-entry detection: multiple entry transactions with gap
    if (position.entries.length > 1) {
      for (let j = 1; j < position.entries.length; j++) {
        const gap = (position.entries[j].timestamp - position.entries[j - 1].timestamp) / (24 * 60 * 60 * 1000);
        if (gap > 1) {
          break;
        }
      }
    }
  }

  const avgHoldingPeriod = totalHoldingDays / positions.length;
  const winRate = (winningPositions / positions.length) * 100;

  const totalPotentialValue = totalRealized + totalPatienceTax;
  const upsideCapture =
    totalPotentialValue > 0 ? (totalRealized / totalPotentialValue) * 100 : 0;

  const earlyExitRate = (earlyExits / positions.length) * 100;

  // Behavioral adjustments for conviction scoring
  const panicSellRate = (panicSells / positions.length) * 100;
  const diamondHandRate = (diamondHands / positions.length) * 100;

  // Position sizing consistency
  const avgPositionSize = positionSizes.reduce((a, b) => a + b, 0) / positionSizes.length;
  const positionSizeVariance = positionSizes.reduce((sum, size) => {
    const diff = size - avgPositionSize;
    return sum + (diff * diff);
  }, 0) / positionSizes.length;
  const positionSizeStdDev = Math.sqrt(positionSizeVariance);
  const consistencyScore = avgPositionSize > 0
    ? Math.max(0, 100 - (positionSizeStdDev / avgPositionSize) * 100)
    : 50;

  const { weights } = APP_CONFIG;

  // Score components. Each entry is (input value, points contributed) so the
  // breakdown shown in the UI is exactly what produced the score — no
  // client-side re-derivation.
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const holdingPeriodFactor = Math.min(avgHoldingPeriod / 30, 1) * 100;
  const breakdown: ScoreBreakdown = {
    winRate: { value: round1(winRate), points: round1(winRate * weights.winRate) },
    upsideCapture: { value: round1(upsideCapture), points: round1(upsideCapture * weights.upsideCapture) },
    earlyExitMitigation: { value: round1(100 - earlyExitRate), points: round1((100 - earlyExitRate) * weights.earlyExitMitigation) },
    holdingPeriod: { value: round1(holdingPeriodFactor), points: round1(holdingPeriodFactor * weights.holdingPeriod) },
    diamondHands: { value: round1(diamondHandRate), points: round1(diamondHandRate * 0.05) },
    consistency: { value: round1(consistencyScore), points: round1(consistencyScore * 0.05) },
    panicSell: { value: round1(panicSellRate), points: round1(-(panicSellRate * 0.1)) },
  };

  // The conviction score is purely behavioral (SOUL.md: "Conviction ≠
  // Performance", no social signals). Ethos credibility is surfaced
  // separately in the UI and used only as a distinct rank on /alpha —
  // it never multiplies this score.
  const finalScore = Math.max(
    0,
    Math.min(
      100,
      winRate * weights.winRate +
      upsideCapture * weights.upsideCapture +
      (100 - earlyExitRate) * weights.earlyExitMitigation +
      Math.min(avgHoldingPeriod / 30, 1) * (weights.holdingPeriod * 100) +
      (diamondHandRate * 0.05) -
      (panicSellRate * 0.1) +
      (consistencyScore * 0.05)
    )
  );

  return {
    score: Math.round(finalScore * 10) / 10,
    breakdown,
    patienceTax: Math.round(totalPatienceTax),
    upsideCapture: Math.round(upsideCapture),
    earlyExits,
    convictionWins,
    // Filled in by the route from the real cohort; never derived from the score.
    percentile: null,
    archetype: getArchetype(finalScore, totalPatienceTax) as ConvictionMetrics["archetype"],
    totalPositions: positions.length,
    avgHoldingPeriod: Math.round(avgHoldingPeriod),
    winRate: Math.round(winRate),
  };
}

function getArchetype(
  score: number,
  patienceTax: number
): ConvictionMetrics["archetype"] {
  const { archetypes } = APP_CONFIG;

  if (score >= archetypes.IRON_PILLAR.minScore! && patienceTax <= archetypes.IRON_PILLAR.maxPatienceTax!) {
    return archetypes.IRON_PILLAR.label as ConvictionMetrics["archetype"];
  }

  if (score >= archetypes.PROFIT_PHANTOM.minScore! && patienceTax >= archetypes.PROFIT_PHANTOM.minPatienceTax!) {
    return archetypes.PROFIT_PHANTOM.label as ConvictionMetrics["archetype"];
  }

  if (score <= archetypes.EXIT_VOYAGER.maxScore!) {
    return archetypes.EXIT_VOYAGER.label as ConvictionMetrics["archetype"];
  }

  return archetypes.DIAMOND_HAND.label as ConvictionMetrics["archetype"];
}