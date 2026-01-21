import { NextRequest, NextResponse } from "next/server";

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

interface ConvictionMetrics {
  score: number;
  patienceTax: number;
  upsideCapture: number;
  earlyExits: number;
  convictionWins: number;
  percentile: number;
  archetype: "Iron Pillar" | "Profit Phantom" | "Exit Voyager" | "Diamond Hand";
  totalPositions: number;
  avgHoldingPeriod: number;
  winRate: number;
}

import { serverCache, CacheKeys, CacheTTL } from "@/lib/server-cache";

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;

const BIRDEYE_URL = "https://public-api.birdeye.so";
const DEXSCREENER_URL = "https://api.dexscreener.com/latest/dex";
const COINGECKO_URL = "https://api.coingecko.com/api/v3";
const COINGECKO_PRO_URL = "https://pro-api.coingecko.com/api/v3";

const getCoingeckoUrl = () => COINGECKO_API_KEY ? COINGECKO_PRO_URL : COINGECKO_URL;
const getCoingeckoHeaders = (): HeadersInit => COINGECKO_API_KEY ? { "x-cg-pro-api-key": COINGECKO_API_KEY } : {};


export async function POST(request: NextRequest) {
  try {
    const body: BatchRequest = await request.json();
    const { positions, chain, ethosScore } = body;

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

    // Batch fetch metadata and prices for all unique tokens
    const [metadataMap, priceMap] = await Promise.all([
      batchGetTokenMetadata(uniqueTokens, chain),
      batchGetPriceData(uniqueTokens, chain),
    ]);

    // Analyze positions with pre-fetched data
    const positionAnalyses = await Promise.all(
      positions.map((position) =>
        analyzePosition(position, chain, metadataMap, priceMap)
      )
    );

    const convictionMetrics = calculateConvictionMetrics(
      positions,
      positionAnalyses,
      ethosScore
    );

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

  // Only fetch patience tax (not batchable due to unique timestamps per position)
  const patienceTaxData = position.exits.length > 0
    ? await calculatePatienceTax(position, chain)
    : null;

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

/**
 * Batch fetch metadata for multiple tokens (with caching and deduplication)
 */
async function batchGetTokenMetadata(
  tokenAddresses: string[],
  chain: "solana" | "base"
): Promise<Map<string, { name: string; symbol: string; logoUri?: string } | null>> {
  const results = await Promise.all(
    tokenAddresses.map((address) => getTokenMetadata(address, chain))
  );

  const map = new Map<string, { name: string; symbol: string; logoUri?: string } | null>();
  tokenAddresses.forEach((address, index) => {
    map.set(address, results[index]);
  });

  return map;
}

/**
 * Batch fetch price data for multiple tokens (with caching and deduplication)
 */
async function batchGetPriceData(
  tokenAddresses: string[],
  chain: "solana" | "base"
): Promise<Map<string, { currentPrice: number; priceChange24h: number } | null>> {
  const results = await Promise.all(
    tokenAddresses.map((address) => getPriceData(address, chain))
  );

  const map = new Map<string, { currentPrice: number; priceChange24h: number } | null>();
  tokenAddresses.forEach((address, index) => {
    map.set(address, results[index]);
  });

  return map;
}

async function getTokenMetadata(
  tokenAddress: string,
  chain: "solana" | "base"
): Promise<{ name: string; symbol: string; logoUri?: string } | null> {
  const cacheKey = CacheKeys.tokenMetadata(tokenAddress, chain);

  return serverCache.get(
    cacheKey,
    async () => {
      try {
        if (chain === "solana" && BIRDEYE_API_KEY) {
          const response = await fetch(
            `${BIRDEYE_URL}/defi/token_overview?address=${tokenAddress}`,
            {
              headers: { "X-API-KEY": BIRDEYE_API_KEY },
            }
          );

          if (response.ok) {
            const data = await response.json();
            if (data.success && data.data) {
              return {
                name: data.data.name || "Unknown",
                symbol: data.data.symbol || "???",
                logoUri: data.data.logoURI,
              };
            }
          }
        }

        const response = await fetch(`${DEXSCREENER_URL}/tokens/${tokenAddress}`);

        if (response.ok) {
          const data = await response.json();
          const pair = data.pairs?.[0];
          if (pair) {
            return {
              name: pair.baseToken?.name || "Unknown",
              symbol: pair.baseToken?.symbol || "???",
              logoUri: pair.info?.imageUrl,
            };
          }
        }

        return null;
      } catch (error) {
        console.warn(`Metadata fetch failed for ${tokenAddress}:`, error);
        return null;
      }
    },
    CacheTTL.METADATA
  );
}

async function getPriceData(
  tokenAddress: string,
  chain: "solana" | "base"
): Promise<{ currentPrice: number; priceChange24h: number } | null> {
  const cacheKey = CacheKeys.tokenPrice(tokenAddress, chain);

  return serverCache.get(
    cacheKey,
    async () => {
      try {
        if (chain === "solana" && BIRDEYE_API_KEY) {
          const response = await fetch(
            `${BIRDEYE_URL}/defi/price?list_address=${tokenAddress}`,
            {
              headers: { "X-API-KEY": BIRDEYE_API_KEY },
            }
          );

          if (response.ok) {
            const data = await response.json();
            if (data.success && data.data) {
              return {
                currentPrice: data.data.value || 0,
                priceChange24h: data.data.priceChange24hPercent || 0,
              };
            }
          }
        }

        const response = await fetch(`${DEXSCREENER_URL}/tokens/${tokenAddress}`);

        if (response.ok) {
          const data = await response.json();
          const pair = data.pairs?.[0];
          if (pair) {
            return {
              currentPrice: parseFloat(pair.priceUsd || "0"),
              priceChange24h: parseFloat(pair.priceChange?.h24 || "0"),
            };
          }
        }

        return null;
      } catch (error) {
        console.warn(`Price fetch failed for ${tokenAddress}:`, error);
        return null;
      }
    },
    CacheTTL.PRICE_CURRENT
  );
}

async function calculatePatienceTax(
  position: Position,
  chain: "solana" | "base"
): Promise<{
  patienceTax: number;
  maxMissedGain: number;
  maxMissedGainDate: number;
  wouldBeValue: number;
} | null> {
  if (position.exits.length === 0) return null;

  const lastExit = position.exits[position.exits.length - 1];
  const exitPrice = lastExit.priceUsd;
  const exitTimestamp = lastExit.timestamp;

  try {
    const endTimestamp = Math.min(Date.now(), exitTimestamp + 90 * 24 * 60 * 60 * 1000);

    let priceHistory: Array<{ timestamp: number; price: number }> = [];

    const cacheKey = CacheKeys.priceHistory(
      position.tokenAddress,
      chain,
      exitTimestamp,
      endTimestamp
    );

    priceHistory = await serverCache.get(
      cacheKey,
      async () => {
        // 1. Try Birdeye (Solana only)
        if (chain === "solana" && BIRDEYE_API_KEY) {
          try {
            const response = await fetch(
              `${BIRDEYE_URL}/defi/history_price?address=${position.tokenAddress}&address_type=token&type=1H&time_from=${Math.floor(exitTimestamp / 1000)}&time_to=${Math.floor(endTimestamp / 1000)}`,
              {
                headers: { "X-API-KEY": BIRDEYE_API_KEY },
              }
            );

            if (response.ok) {
              const data = await response.json();
              if (data.success && data.data?.items) {
                return data.data.items.map((item: any) => ({
                  timestamp: item.unixTime * 1000,
                  price: item.value || 0,
                }));
              }
            }
          } catch (error) {
            console.warn(`Birdeye historical fetch failed for ${position.tokenAddress}:`, error);
          }
        }

        // 2. Try CoinGecko (Solana or Base)
        try {
          const platformId = chain === "solana" ? "solana" : "base";
          const response = await fetch(
            `${getCoingeckoUrl()}/coins/${platformId}/contract/${position.tokenAddress}/market_chart/range?vs_currency=usd&from=${Math.floor(
              exitTimestamp / 1000
            )}&to=${Math.floor(endTimestamp / 1000)}`,
            {
              headers: getCoingeckoHeaders(),
              next: { revalidate: 3600 }
            }
          );

          if (response.ok) {
            const data = await response.json();
            if (data.prices && Array.isArray(data.prices)) {
              return data.prices.map(([timestamp, price]: [number, number]) => ({
                timestamp,
                price,
              }));
            }
          }
        } catch (error) {
          console.warn(`CoinGecko historical fetch failed for ${position.tokenAddress}:`, error);
        }

        return [];
      },
      CacheTTL.PRICE_HISTORY
    );

    if (priceHistory.length === 0) {
      return {
        patienceTax: 0,
        maxMissedGain: 0,
        maxMissedGainDate: exitTimestamp,
        wouldBeValue: position.totalRealized,
      };
    }

    let maxPrice = exitPrice;
    let maxPriceDate = exitTimestamp;

    for (const point of priceHistory) {
      if (point.price > maxPrice) {
        maxPrice = point.price;
        maxPriceDate = point.timestamp;
      }
    }

    const maxMissedGainMultiplier = maxPrice / exitPrice;
    const maxMissedGain = (maxMissedGainMultiplier - 1) * 100;
    const patienceTax = position.totalRealized * (maxMissedGainMultiplier - 1);
    const wouldBeValue = position.totalRealized * maxMissedGainMultiplier;

    return {
      patienceTax: Math.max(0, patienceTax),
      maxMissedGain,
      maxMissedGainDate: maxPriceDate,
      wouldBeValue,
    };
  } catch (error) {
    console.warn("Patience tax calculation failed:", error);
    return null;
  }
}

import { APP_CONFIG } from "@/lib/config";

function calculateConvictionMetrics(
  positions: Position[],
  analyses: PositionAnalysis[],
  ethosScore?: number | null
): ConvictionMetrics {
  if (positions.length === 0) {
    return {
      score: 0,
      patienceTax: 0,
      upsideCapture: 0,
      earlyExits: 0,
      convictionWins: 0,
      percentile: 0,
      archetype: APP_CONFIG.archetypes.EXIT_VOYAGER.label as any,
      totalPositions: 0,
      avgHoldingPeriod: 0,
      winRate: 0,
    };
  }

  let totalPatienceTax = 0;
  let totalRealized = 0;
  let totalInvested = 0;
  let earlyExits = 0;
  let convictionWins = 0;
  let totalHoldingDays = 0;
  let winningPositions = 0;
  let positionSizes: number[] = [];
  let holdingPeriods: number[] = [];
  
  // Behavioral metrics for conviction analysis
  let reEntryCount = 0;  // Re-entering same token after exit
  let panicSells = 0;    // Sells within 7 days of entry
  let diamondHands = 0;  // Held through 50%+ drawdown

  for (let i = 0; i < positions.length; i++) {
    const position = positions[i];
    const analysis = analyses[i];

    totalInvested += position.totalInvested;
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
      const entryGaps = [];
      for (let j = 1; j < position.entries.length; j++) {
        const gap = (position.entries[j].timestamp - position.entries[j-1].timestamp) / (24 * 60 * 60 * 1000);
        if (gap > 1) { // More than 1 day gap
          entryGaps.push(gap);
        }
      }
      if (entryGaps.length > 0) {
        reEntryCount++;
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
  const reEntryRate = (reEntryCount / positions.length) * 100;
  const diamondHandRate = (diamondHands / positions.length) * 100;
  
  // Position sizing consistency (lower std dev = more consistent)
  const avgPositionSize = positionSizes.reduce((a, b) => a + b, 0) / positionSizes.length;
  const positionSizeVariance = positionSizes.reduce((sum, size) => {
    const diff = size - avgPositionSize;
    return sum + (diff * diff);
  }, 0) / positionSizes.length;
  const positionSizeStdDev = Math.sqrt(positionSizeVariance);
  const consistencyScore = avgPositionSize > 0 
    ? Math.max(0, 100 - (positionSizeStdDev / avgPositionSize) * 100) 
    : 50;

  const { weights, reputation } = APP_CONFIG;
  
  // Enhanced base score with behavioral components
  const baseScore = Math.max(
    0,
    Math.min(
      100,
      winRate * weights.winRate +
      upsideCapture * weights.upsideCapture +
      (100 - earlyExitRate) * weights.earlyExitMitigation +
      Math.min(avgHoldingPeriod / 30, 1) * (weights.holdingPeriod * 100) +
      // Behavioral bonuses/penalties
      (diamondHandRate * 0.05) - // Bonus for holding through drawdowns
      (panicSellRate * 0.1) + // Penalty for panic selling
      (consistencyScore * 0.05) // Bonus for position sizing discipline
    )
  );

  // Apply reputation weighting if Ethos score available
  let finalScore = baseScore;
  let reputationMultiplier = 1.0;

  if (ethosScore && ethosScore > 0) {
    if (ethosScore >= reputation.ethosScoreThresholds.elite) {
      reputationMultiplier = 1.5;
    } else if (ethosScore >= reputation.ethosScoreThresholds.high) {
      reputationMultiplier = 1.3;
    } else if (ethosScore >= reputation.ethosScoreThresholds.medium) {
      reputationMultiplier = 1.15;
    } else if (ethosScore >= reputation.ethosScoreThresholds.low) {
      reputationMultiplier = 1.05;
    }

    finalScore = Math.min(100, baseScore * reputationMultiplier);
  }

  const percentile = Math.max(1, Math.min(99, 100 - Math.floor(finalScore)));

  return {
    score: Math.round(finalScore * 10) / 10,
    patienceTax: Math.round(totalPatienceTax),
    upsideCapture: Math.round(upsideCapture),
    earlyExits,
    convictionWins,
    percentile,
    archetype: getArchetype(finalScore, totalPatienceTax) as any,
    totalPositions: positions.length,
    avgHoldingPeriod: Math.round(avgHoldingPeriod),
    winRate: Math.round(winRate),
  };
}

function getArchetype(
  score: number,
  patienceTax: number
): string {
  const { archetypes } = APP_CONFIG;

  if (score >= archetypes.IRON_PILLAR.minScore! && patienceTax <= archetypes.IRON_PILLAR.maxPatienceTax!) {
    return archetypes.IRON_PILLAR.label;
  }

  if (score >= archetypes.PROFIT_PHANTOM.minScore! && patienceTax >= archetypes.PROFIT_PHANTOM.minPatienceTax!) {
    return archetypes.PROFIT_PHANTOM.label;
  }

  if (score <= archetypes.EXIT_VOYAGER.maxScore!) {
    return archetypes.EXIT_VOYAGER.label;
  }

  return archetypes.DIAMOND_HAND.label;
}
