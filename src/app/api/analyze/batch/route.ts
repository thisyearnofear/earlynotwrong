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

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
const BIRDEYE_URL = "https://public-api.birdeye.so";
const DEXSCREENER_URL = "https://api.dexscreener.com/latest/dex";

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

    const positionAnalyses = await Promise.all(
      positions.map((position) => analyzePosition(position, chain))
    );

    const convictionMetrics = calculateConvictionMetrics(
      positions,
      positionAnalyses
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
  chain: "solana" | "base"
): Promise<PositionAnalysis> {
  const [metadata, priceData, patienceTaxData] = await Promise.all([
    getTokenMetadata(position.tokenAddress, chain),
    getPriceData(position.tokenAddress, chain),
    position.exits.length > 0
      ? calculatePatienceTax(position, chain)
      : Promise.resolve(null),
  ]);

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
    counterfactual,
  };
}

async function getTokenMetadata(
  tokenAddress: string,
  chain: "solana" | "base"
): Promise<{ name: string; symbol: string; logoUri?: string } | null> {
  try {
    if (chain === "solana" && BIRDEYE_API_KEY) {
      const response = await fetch(
        `${BIRDEYE_URL}/defi/token_overview?address=${tokenAddress}`,
        {
          headers: { "X-API-KEY": BIRDEYE_API_KEY },
          next: { revalidate: 3600 },
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

    const response = await fetch(`${DEXSCREENER_URL}/tokens/${tokenAddress}`, {
      next: { revalidate: 3600 },
    });

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
}

async function getPriceData(
  tokenAddress: string,
  chain: "solana" | "base"
): Promise<{ currentPrice: number; priceChange24h: number } | null> {
  try {
    if (chain === "solana" && BIRDEYE_API_KEY) {
      const response = await fetch(
        `${BIRDEYE_URL}/defi/price?list_address=${tokenAddress}`,
        {
          headers: { "X-API-KEY": BIRDEYE_API_KEY },
          next: { revalidate: 300 },
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

    const response = await fetch(`${DEXSCREENER_URL}/tokens/${tokenAddress}`, {
      next: { revalidate: 300 },
    });

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

    if (chain === "solana" && BIRDEYE_API_KEY) {
      const response = await fetch(
        `${BIRDEYE_URL}/defi/history_price?address=${position.tokenAddress}&address_type=token&type=1H&time_from=${Math.floor(exitTimestamp / 1000)}&time_to=${Math.floor(endTimestamp / 1000)}`,
        {
          headers: { "X-API-KEY": BIRDEYE_API_KEY },
          next: { revalidate: 3600 },
        }
      );

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data?.items) {
          priceHistory = data.data.items.map((item: any) => ({
            timestamp: item.unixTime * 1000,
            price: item.value || 0,
          }));
        }
      }
    }

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
      percentile: 0,
      archetype: "Exit Voyager",
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

  for (let i = 0; i < positions.length; i++) {
    const position = positions[i];
    const analysis = analyses[i];

    totalInvested += position.totalInvested;
    totalRealized += position.totalRealized;
    totalPatienceTax += analysis.patienceTax;
    totalHoldingDays += analysis.holdingPeriodDays;

    if (analysis.realizedPnL > 0) {
      winningPositions++;
    }

    if (analysis.realizedPnL > position.totalInvested * 0.5) {
      convictionWins++;
    }

    if (analysis.isEarlyExit) {
      earlyExits++;
    }
  }

  const avgHoldingPeriod = totalHoldingDays / positions.length;
  const winRate = (winningPositions / positions.length) * 100;

  const totalPotentialValue = totalRealized + totalPatienceTax;
  const upsideCapture =
    totalPotentialValue > 0 ? (totalRealized / totalPotentialValue) * 100 : 0;

  const earlyExitRate = (earlyExits / positions.length) * 100;

  const score = Math.max(
    0,
    Math.min(
      100,
      winRate * 0.25 +
        upsideCapture * 0.35 +
        (100 - earlyExitRate) * 0.25 +
        Math.min(avgHoldingPeriod / 30, 1) * 15
    )
  );

  const percentile = Math.max(1, Math.min(99, 100 - Math.floor(score)));

  return {
    score: Math.round(score * 10) / 10,
    patienceTax: Math.round(totalPatienceTax),
    upsideCapture: Math.round(upsideCapture),
    earlyExits,
    convictionWins,
    percentile,
    archetype: getArchetype(score, totalPatienceTax),
    totalPositions: positions.length,
    avgHoldingPeriod: Math.round(avgHoldingPeriod),
    winRate: Math.round(winRate),
  };
}

function getArchetype(
  score: number,
  patienceTax: number
): "Iron Pillar" | "Profit Phantom" | "Exit Voyager" | "Diamond Hand" {
  if (score > 90 && patienceTax < 1000) return "Iron Pillar";
  if (score > 70 && patienceTax > 5000) return "Profit Phantom";
  if (score < 40) return "Exit Voyager";
  return "Diamond Hand";
}
