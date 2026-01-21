import { NextRequest, NextResponse } from "next/server";
import { serverCache, CacheKeys, CacheTTL } from "@/lib/server-cache";

interface PriceRequest {
  tokenAddress: string;
  chain: "solana" | "base";
  exitPrice?: number;
  exitTimestamp?: number;
  positionSize?: number;
}

interface PriceAnalysis {
  currentPrice: number;
  priceChange24h: number;
  priceChange7d: number;
  allTimeHigh: number;
  volume24h?: number;
  marketCap?: number;
  lastUpdated: number;
}

interface TokenMetadata {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUri?: string;
}

interface PatienceTaxResult {
  patienceTax: number;
  maxMissedGain: number;
  maxMissedGainDate: number;
  currentMissedGain: number;
  wouldBeValue: number;
}

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;

const BIRDEYE_URL = "https://public-api.birdeye.so";
const DEXSCREENER_URL = "https://api.dexscreener.com/latest/dex";

export async function POST(request: NextRequest) {
  try {
    const body: PriceRequest = await request.json();
    const { tokenAddress, chain, exitPrice, exitTimestamp, positionSize } =
      body;

    if (!tokenAddress || !chain) {
      return NextResponse.json(
        { error: "Missing required fields: tokenAddress, chain" },
        { status: 400 }
      );
    }

    const [metadata, priceAnalysis] = await Promise.all([
      getTokenMetadata(tokenAddress, chain),
      getPriceAnalysis(tokenAddress, chain),
    ]);

    let patienceTax: PatienceTaxResult | null = null;
    if (exitPrice && exitTimestamp && positionSize) {
      patienceTax = await calculatePatienceTax(
        tokenAddress,
        chain,
        exitPrice,
        exitTimestamp,
        positionSize
      );
    }

    return NextResponse.json({
      success: true,
      metadata,
      priceAnalysis,
      patienceTax,
    });
  } catch (error) {
    console.error("Price fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch price data", details: String(error) },
      { status: 500 }
    );
  }
}

async function getTokenMetadata(
  tokenAddress: string,
  chain: "solana" | "base"
): Promise<TokenMetadata | null> {
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

          if (!response.ok) throw new Error("Birdeye metadata fetch failed");

          const data = await response.json();
          if (!data.success || !data.data) return null;

          const token = data.data;
          return {
            address: tokenAddress,
            symbol: token.symbol || "UNKNOWN",
            name: token.name || "Unknown Token",
            decimals: token.decimals || 9,
            logoUri: token.logoURI,
          };
        } else {
          const response = await fetch(
            `${DEXSCREENER_URL}/tokens/${tokenAddress}`
          );

          if (!response.ok) throw new Error("DexScreener metadata fetch failed");

          const data = await response.json();
          const pair = data.pairs?.[0];

          if (!pair) return null;

          return {
            address: tokenAddress,
            symbol: pair.baseToken?.symbol || "UNKNOWN",
            name: pair.baseToken?.name || "Unknown Token",
            decimals: 18,
            logoUri: pair.info?.imageUrl,
          };
        }
      } catch (error) {
        console.warn(`Token metadata fetch failed for ${tokenAddress}:`, error);
        return null;
      }
    },
    CacheTTL.METADATA
  );
}

async function getPriceAnalysis(
  tokenAddress: string,
  chain: "solana" | "base"
): Promise<PriceAnalysis | null> {
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

          if (!response.ok) throw new Error("Birdeye price fetch failed");

          const data = await response.json();
          if (!data.success || !data.data) return null;

          const priceData = data.data;
          return {
            currentPrice: priceData.value || 0,
            priceChange24h: priceData.priceChange24hPercent || 0,
            priceChange7d: priceData.priceChange7dPercent || 0,
            allTimeHigh: priceData.ath || 0,
            volume24h: priceData.volume24h,
            lastUpdated: Date.now(),
          };
        } else {
          const response = await fetch(
            `${DEXSCREENER_URL}/tokens/${tokenAddress}`
          );

          if (!response.ok) throw new Error("DexScreener price fetch failed");

          const data = await response.json();
          const pair = data.pairs?.[0];

          if (!pair) return null;

          return {
            currentPrice: parseFloat(pair.priceUsd || "0"),
            priceChange24h: parseFloat(pair.priceChange?.h24 || "0"),
            priceChange7d: parseFloat(pair.priceChange?.h6 || "0") * 4,
            allTimeHigh: parseFloat(pair.priceUsd || "0"),
            volume24h: parseFloat(pair.volume?.h24 || "0"),
            marketCap: parseFloat(pair.marketCap || "0"),
            lastUpdated: Date.now(),
          };
        }
      } catch (error) {
        console.warn(`Price analysis failed for ${tokenAddress}:`, error);
        return null;
      }
    },
    CacheTTL.PRICE_CURRENT
  );
}

async function getHistoricalPrices(
  tokenAddress: string,
  chain: "solana" | "base",
  fromTimestamp: number,
  toTimestamp: number
): Promise<Array<{ timestamp: number; price: number }>> {
  try {
    if (chain === "solana" && BIRDEYE_API_KEY) {
      const response = await fetch(
        `${BIRDEYE_URL}/defi/history_price?address=${tokenAddress}&address_type=token&type=1H&time_from=${Math.floor(fromTimestamp / 1000)}&time_to=${Math.floor(toTimestamp / 1000)}`,
        {
          headers: { "X-API-KEY": BIRDEYE_API_KEY },
          next: { revalidate: 3600 },
        }
      );

      if (!response.ok) throw new Error("Birdeye historical data fetch failed");

      const data = await response.json();
      if (!data.success || !data.data?.items) return [];

      return data.data.items.map((item: any) => ({
        timestamp: item.unixTime * 1000,
        price: item.value || 0,
      }));
    } else {
      const response = await fetch(
        `${DEXSCREENER_URL}/tokens/${tokenAddress}`,
        { next: { revalidate: 300 } }
      );

      if (!response.ok) return [];

      const data = await response.json();
      const pair = data.pairs?.[0];

      if (!pair) return [];

      return [
        {
          timestamp: Date.now(),
          price: parseFloat(pair.priceUsd || "0"),
        },
      ];
    }
  } catch (error) {
    console.warn(`Historical price fetch failed for ${tokenAddress}:`, error);
    return [];
  }
}

async function calculatePatienceTax(
  tokenAddress: string,
  chain: "solana" | "base",
  exitPrice: number,
  exitTimestamp: number,
  positionSize: number,
  holdingPeriodDays: number = 90
): Promise<PatienceTaxResult> {
  try {
    const endTimestamp = Math.min(
      Date.now(),
      exitTimestamp + holdingPeriodDays * 24 * 60 * 60 * 1000
    );

    const priceHistory = await getHistoricalPrices(
      tokenAddress,
      chain,
      exitTimestamp,
      endTimestamp
    );

    if (priceHistory.length === 0) {
      return {
        patienceTax: 0,
        maxMissedGain: 0,
        maxMissedGainDate: exitTimestamp,
        currentMissedGain: 0,
        wouldBeValue: positionSize,
      };
    }

    let maxPrice = exitPrice;
    let maxPriceDate = exitTimestamp;
    let currentPrice = exitPrice;

    for (const point of priceHistory) {
      if (point.price > maxPrice) {
        maxPrice = point.price;
        maxPriceDate = point.timestamp;
      }
      currentPrice = point.price;
    }

    const maxMissedGainMultiplier = maxPrice / exitPrice;
    const currentMissedGainMultiplier = currentPrice / exitPrice;

    const maxMissedGain = (maxMissedGainMultiplier - 1) * 100;
    const currentMissedGain = (currentMissedGainMultiplier - 1) * 100;

    const patienceTax = positionSize * (maxMissedGainMultiplier - 1);
    const wouldBeValue = positionSize * currentMissedGainMultiplier;

    return {
      patienceTax: Math.max(0, patienceTax),
      maxMissedGain,
      maxMissedGainDate: maxPriceDate,
      currentMissedGain,
      wouldBeValue,
    };
  } catch (error) {
    console.error("Patience tax calculation failed:", error);
    return {
      patienceTax: 0,
      maxMissedGain: 0,
      maxMissedGainDate: exitTimestamp,
      currentMissedGain: 0,
      wouldBeValue: positionSize,
    };
  }
}
