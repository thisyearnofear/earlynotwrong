import { NextRequest, NextResponse } from "next/server";
import { WATCHLIST } from "@/lib/watchlist";
import { APP_CONFIG } from "@/lib/config";

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

interface TokenHolding {
  tokenAddress: string;
  symbol: string;
  name: string;
  chain: "solana" | "base";
  balance: number;
  valueUsd: number;
  holderId: string;
}

interface TokenConviction {
  tokenAddress: string;
  symbol: string;
  name: string;
  chain: "solana" | "base";
  credibleHolders: number;
  avgConvictionScore: number;
  totalValue: number;
  convictionIntensity: number;
}

const tokenCache = new Map<string, { data: TokenConviction[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getBaseTokenBalances(address: string): Promise<TokenHolding[]> {
  if (!ALCHEMY_API_KEY) return [];

  try {
    const response = await fetch(APP_CONFIG.chains.base.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "alchemy_getTokenBalances",
        params: [address],
      }),
    });

    if (!response.ok) return [];
    const data = await response.json();
    const balances = data.result?.tokenBalances || [];

    const holdings: TokenHolding[] = [];

    for (const balance of balances.slice(0, 10)) {
      if (balance.tokenBalance === "0x0") continue;

      const tokenAddress = balance.contractAddress;
      const rawBalance = parseInt(balance.tokenBalance, 16);
      if (rawBalance === 0) continue;

      // Get token metadata
      try {
        const metaResponse = await fetch(APP_CONFIG.chains.base.rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: 1,
            jsonrpc: "2.0",
            method: "alchemy_getTokenMetadata",
            params: [tokenAddress],
          }),
        });

        if (metaResponse.ok) {
          const metaData = await metaResponse.json();
          const meta = metaData.result;
          if (meta?.symbol) {
            const decimals = meta.decimals || 18;
            const balance = rawBalance / Math.pow(10, decimals);

            // Get price from DexScreener
            let valueUsd = 0;
            try {
              const priceRes = await fetch(
                `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`
              );
              const priceData = await priceRes.json();
              const price = parseFloat(priceData.pairs?.[0]?.priceUsd || "0");
              valueUsd = balance * price;
            } catch {
              // Skip price lookup failures
            }

            if (valueUsd >= 100) {
              holdings.push({
                tokenAddress,
                symbol: meta.symbol,
                name: meta.name || meta.symbol,
                chain: "base",
                balance,
                valueUsd,
                holderId: address,
              });
            }
          }
        }
      } catch {
        // Skip failed metadata lookups
      }
    }

    return holdings;
  } catch (error) {
    console.error("Error fetching Base balances:", error);
    return [];
  }
}

async function getSolanaTokenBalances(address: string): Promise<TokenHolding[]> {
  if (!HELIUS_API_KEY) return [];

  try {
    const response = await fetch(
      `https://api.helius.xyz/v0/addresses/${address}/balances?api-key=${HELIUS_API_KEY}`
    );

    if (!response.ok) return [];
    const data = await response.json();

    const holdings: TokenHolding[] = [];
    const tokens = data.tokens || [];

    for (const token of tokens.slice(0, 10)) {
      if (!token.mint || token.amount === 0) continue;

      const balance = token.amount / Math.pow(10, token.decimals || 9);

      // Get price from Jupiter
      let valueUsd = 0;
      try {
        const priceRes = await fetch(
          `https://api.jup.ag/price/v2?ids=${token.mint}`
        );
        const priceData = await priceRes.json();
        const price = parseFloat(priceData.data?.[token.mint]?.price || "0");
        valueUsd = balance * price;
      } catch {
        // Skip price lookup failures
      }

      if (valueUsd >= 100) {
        holdings.push({
          tokenAddress: token.mint,
          symbol: token.symbol || "UNKNOWN",
          name: token.name || token.symbol || "Unknown Token",
          chain: "solana",
          balance,
          valueUsd,
          holderId: address,
        });
      }
    }

    return holdings;
  } catch (error) {
    console.error("Error fetching Solana balances:", error);
    return [];
  }
}

function aggregateTokenConviction(
  holdings: TokenHolding[]
): TokenConviction[] {
  const tokenMap = new Map<
    string,
    {
      tokenAddress: string;
      symbol: string;
      name: string;
      chain: "solana" | "base";
      holders: Set<string>;
      totalValue: number;
    }
  >();

  for (const holding of holdings) {
    const key = `${holding.chain}:${holding.tokenAddress}`;
    const existing = tokenMap.get(key);

    if (existing) {
      existing.holders.add(holding.holderId);
      existing.totalValue += holding.valueUsd;
    } else {
      tokenMap.set(key, {
        tokenAddress: holding.tokenAddress,
        symbol: holding.symbol,
        name: holding.name,
        chain: holding.chain,
        holders: new Set([holding.holderId]),
        totalValue: holding.valueUsd,
      });
    }
  }

  const tokens: TokenConviction[] = [];

  for (const [, data] of tokenMap) {
    const credibleHolders = data.holders.size;
    // More holders from watchlist = higher conviction intensity
    const convictionIntensity = Math.min(
      99,
      50 + credibleHolders * 10 + Math.log10(data.totalValue + 1) * 5
    );
    const avgConvictionScore = Math.min(95, 70 + credibleHolders * 3);

    tokens.push({
      tokenAddress: data.tokenAddress,
      symbol: data.symbol,
      name: data.name,
      chain: data.chain,
      credibleHolders,
      avgConvictionScore: Math.round(avgConvictionScore * 10) / 10,
      totalValue: Math.round(data.totalValue),
      convictionIntensity: Math.round(convictionIntensity),
    });
  }

  return tokens.sort((a, b) => b.convictionIntensity - a.convictionIntensity);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const chain = searchParams.get("chain") as "solana" | "base" | null;
    const limit = parseInt(searchParams.get("limit") || "20");

    // Check cache
    const cacheKey = chain || "all";
    const cached = tokenCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json({
        success: true,
        tokens: cached.data.slice(0, limit),
        count: Math.min(cached.data.length, limit),
        cached: true,
      });
    }

    // Fetch holdings from watchlist wallets
    const allHoldings: TokenHolding[] = [];

    // Process by chain
    const baseTraders = WATCHLIST.filter((t) => t.chain === "base");
    const solanaTraders = WATCHLIST.filter((t) => t.chain === "solana");

    if (!chain || chain === "base") {
      for (const trader of baseTraders) {
        // Only check first 2 wallets per trader to avoid rate limits
        for (const wallet of trader.wallets.slice(0, 2)) {
          const holdings = await getBaseTokenBalances(wallet);
          allHoldings.push(...holdings);
        }
      }
    }

    if (!chain || chain === "solana") {
      for (const trader of solanaTraders) {
        for (const wallet of trader.wallets.slice(0, 2)) {
          const holdings = await getSolanaTokenBalances(wallet);
          allHoldings.push(...holdings);
        }
      }
    }

    // Aggregate and score
    const tokens = aggregateTokenConviction(allHoldings);

    // Cache results
    tokenCache.set(cacheKey, { data: tokens, timestamp: Date.now() });

    return NextResponse.json({
      success: true,
      tokens: tokens.slice(0, limit),
      count: Math.min(tokens.length, limit),
      meta: {
        tradersScanned: baseTraders.length + solanaTraders.length,
        totalHoldings: allHoldings.length,
      },
    });
  } catch (error) {
    console.error("Token heatmap error:", error);
    return NextResponse.json(
      { error: "Failed to fetch token data", details: String(error) },
      { status: 500 }
    );
  }
}
