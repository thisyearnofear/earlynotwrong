import { NextRequest, NextResponse } from "next/server";
import { getWatchlist, findTraderByWallet } from "@/lib/watchlist";
import { APP_CONFIG } from "@/lib/config";
import { ethosClient } from "@/lib/ethos";
import { getList, setCached, pushToList } from "@/lib/kv-cache";
import { fromAlchemyTransfer, processTradeEvent } from "@/lib/alerts";
import { trustResolver } from "@/lib/services/trust-resolver";
import { enqueueClusterNotifications } from "@/lib/notifications";
import type { ClusterSignal } from "@/lib/alerts/types";
import { sql } from "@vercel/postgres";

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
const SOLANA_ALERTS_KEY = "solana:realtime:alerts";
const BASE_ALERTS_CACHE_KEY = "base:polled:alerts";

interface TokenTransfer {
  hash: string;
  timestamp: number;
  tokenAddress: string;
  tokenSymbol: string;
  type: "buy" | "sell";
  amount: number;
  valueUsd: number;
  walletAddress: string;
}

interface ConvictionAlert {
  id: string;
  timestamp: number;
  type: "entry" | "exit" | "accumulation" | "distribution";
  severity: "low" | "medium" | "high" | "critical";
  trader: {
    id: string;
    name: string;
    walletAddress: string;
    ethosScore: number | null;
    chain: "solana" | "base";
    farcasterIdentity?: {
      username: string;
      displayName?: string;
    };
  };
  token: {
    symbol: string;
    address: string;
    chain: "solana" | "base";
  };
  action: {
    type: string;
    amount: number;
    valueUsd: number;
  };
  txHash: string;
}

async function getBaseTokenPrice(tokenAddress: string): Promise<number> {
  try {
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
      { next: { revalidate: 300 } }
    );
    const data = await response.json();
    const pair = data.pairs?.[0];
    return parseFloat(pair?.priceUsd || "0");
  } catch {
    return 0;
  }
}

async function fetchRecentTransfersForWallet(
  address: string,
  hoursBack: number = 24
): Promise<TokenTransfer[]> {
  if (!ALCHEMY_API_KEY) {
    console.warn("No Alchemy API key configured");
    return [];
  }

  const rpcUrl = APP_CONFIG.chains.base.rpcUrl;
  const cutoffTime = Date.now() - hoursBack * 60 * 60 * 1000;

  // Estimate block number (Base ~2s blocks)
  const blocksBack = Math.floor((hoursBack * 60 * 60) / 2);
  const latestBlockResponse = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "eth_blockNumber",
    }),
  });
  const latestBlockData = await latestBlockResponse.json();
  const latestBlock = parseInt(latestBlockData.result, 16);
  const fromBlock = Math.max(0, latestBlock - blocksBack);
  const fromBlockHex = `0x${fromBlock.toString(16)}`;

  const [outgoingResponse, incomingResponse] = await Promise.all([
    fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "alchemy_getAssetTransfers",
        params: [
          {
            fromBlock: fromBlockHex,
            toBlock: "latest",
            fromAddress: address,
            category: ["erc20"],
            withMetadata: true,
            excludeZeroValue: true,
            maxCount: "0x32", // 50
          },
        ],
      }),
    }),
    fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: 2,
        jsonrpc: "2.0",
        method: "alchemy_getAssetTransfers",
        params: [
          {
            fromBlock: fromBlockHex,
            toBlock: "latest",
            toAddress: address,
            category: ["erc20"],
            withMetadata: true,
            excludeZeroValue: true,
            maxCount: "0x32", // 50
          },
        ],
      }),
    }),
  ]);

  const transfers: TokenTransfer[] = [];
  const seenHashes = new Set<string>();

  const processTransfers = async (
    response: Response,
    isSell: boolean
  ): Promise<void> => {
    if (!response.ok) return;
    const data = await response.json();
    const items = data.result?.transfers || [];

    for (const transfer of items) {
      if (seenHashes.has(transfer.hash)) continue;
      seenHashes.add(transfer.hash);

      const timestamp = new Date(transfer.metadata?.blockTimestamp).getTime();
      if (timestamp < cutoffTime) continue;

      const tokenAddress = transfer.rawContract?.address;
      if (!tokenAddress) continue;

      // Skip stablecoins and WETH as primary tokens
      const skipTokens = [
        "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC
        "0x4200000000000000000000000000000000000006", // WETH
        "0x50c5725949a6f0c72e6c4a641f24049a917db0cb", // DAI
      ];
      if (skipTokens.includes(tokenAddress.toLowerCase())) continue;

      const amount = parseFloat(transfer.value || "0");
      let valueUsd = parseFloat(transfer.metadata?.value || "0");

      if (valueUsd === 0 && amount > 0) {
        const price = await getBaseTokenPrice(tokenAddress);
        valueUsd = price * amount;
      }

      // Only include significant trades
      if (valueUsd < 100) continue;

      transfers.push({
        hash: transfer.hash,
        timestamp,
        tokenAddress,
        tokenSymbol: transfer.asset || "UNKNOWN",
        type: isSell ? "sell" : "buy",
        amount,
        valueUsd,
        walletAddress: address,
      });
    }
  };

  await Promise.all([
    processTransfers(outgoingResponse, true),
    processTransfers(incomingResponse, false),
  ]);

  return transfers;
}

function classifyAlert(
  transfer: TokenTransfer
): Pick<ConvictionAlert, "type" | "severity"> {
  const { type, valueUsd } = transfer;

  let alertType: ConvictionAlert["type"];
  let severity: ConvictionAlert["severity"];

  if (type === "buy") {
    alertType = valueUsd > 10000 ? "accumulation" : "entry";
  } else {
    alertType = valueUsd > 10000 ? "distribution" : "exit";
  }

  if (valueUsd >= 50000) {
    severity = "critical";
  } else if (valueUsd >= 10000) {
    severity = "high";
  } else if (valueUsd >= 1000) {
    severity = "medium";
  } else {
    severity = "low";
  }

  return { type: alertType, severity };
}

function getActionLabel(
  type: "buy" | "sell",
  valueUsd: number
): string {
  if (type === "buy") {
    if (valueUsd >= 50000) return "Whale Accumulation";
    if (valueUsd >= 10000) return "Large Buy";
    return "Buy";
  } else {
    if (valueUsd >= 50000) return "Major Exit";
    if (valueUsd >= 10000) return "Large Sell";
    return "Sell";
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const hoursBack = parseInt(searchParams.get("hours") || "24");
    const minValue = parseInt(searchParams.get("minValue") || "100");
    const limit = parseInt(searchParams.get("limit") || "20");
    const chain = searchParams.get("chain") as "solana" | "base" | null;
    const kind = searchParams.get("kind") as "trade" | "cluster" | "all" | null;

    // Fetch cluster signals from KV
    let clusterSignals: ClusterSignal[] = [];
    if (kind !== "trade") {
      try {
        clusterSignals = await getList<ClusterSignal>("cluster:signals", 0, limit - 1);
      } catch {
        // KV not available
      }
    }

    // Try to get real-time Solana alerts from KV (populated by Helius webhooks)
    let solanaAlerts: ConvictionAlert[] = [];
    if (!chain || chain === "solana") {
      try {
        const storedAlerts = await getList<any>(SOLANA_ALERTS_KEY, 0, limit - 1);
        solanaAlerts = storedAlerts.map((alert) => ({
          id: alert.id,
          timestamp: alert.timestamp,
          type: alert.type?.includes("SWAP") ? "entry" : "exit",
          severity: "high" as const,
          trader: {
            id: alert.traderId,
            name: alert.traderName,
            walletAddress: alert.walletAddress,
            ethosScore: null,
            chain: "solana" as const,
          },
          token: {
            symbol: alert.tokenTransfers?.[0]?.mint?.slice(0, 6) || "SOL",
            address: alert.tokenTransfers?.[0]?.mint || "",
            chain: "solana" as const,
          },
          action: {
            type: alert.type || "Transaction",
            amount: alert.nativeTransfer?.amount || 0,
            valueUsd: 0,
          },
          txHash: alert.signature,
        }));
      } catch (err) {
        console.warn("KV not available, skipping Solana real-time alerts:", err);
      }
    }

    // If only requesting Solana, return early
    if (chain === "solana") {
      return NextResponse.json({
        success: true,
        alerts: solanaAlerts.slice(0, limit),
        count: solanaAlerts.length,
        source: "helius-realtime",
      });
    }

    // Fetch Base transactions (with caching)
    const watchlist = await getWatchlist();
    
    // ENHANCEMENT: Also include top traders from the leaderboard for broader monitoring
    let topTraders: any[] = [];
    try {
      const topTradersResult = await sql`
        SELECT address, chain, farcaster as farcaster_username, ens as ens_name, ethos_score
        FROM alpha_leaderboard
        WHERE conviction_score >= 90
        ORDER BY conviction_score DESC
        LIMIT 20
      `;
      topTraders = topTradersResult.rows.map(r => ({
        id: `leaderboard-${r.address}`,
        name: r.ens_name || r.farcaster_username || r.address.slice(0, 8),
        wallets: [r.address],
        chain: r.chain,
        socials: {
          farcaster: r.farcaster_username,
          ens: r.ens_name
        }
      }));
    } catch (err) {
      console.warn("Failed to fetch top traders for alerts:", err);
    }

    // Combine curated watchlist with top leaderboard traders
    const monitoringPool = [...watchlist];
    // Add unique top traders from leaderboard
    topTraders.forEach(tt => {
      if (!monitoringPool.some(t => t.wallets.some(w => w.toLowerCase() === tt.wallets[0].toLowerCase()))) {
        monitoringPool.push(tt);
      }
    });

    const baseTraders = monitoringPool.filter((t) => t.chain === "base");

    // Fetch in parallel but with some rate limiting
    const allTransfers: TokenTransfer[] = [];
    const ethosScoreCache = new Map<string, number | null>();

    // Process traders in batches of 3 to improve performance while respecting rate limits
    for (let i = 0; i < baseTraders.length; i += 3) {
      const batch = baseTraders.slice(i, i + 3);
      const batchPromises = batch.flatMap((trader) =>
        trader.wallets.slice(0, 2).map((wallet) =>
          fetchRecentTransfersForWallet(wallet, hoursBack)
        )
      );

      const batchResults = await Promise.all(batchPromises);
      allTransfers.push(...batchResults.flat());
    }

    // Filter by minimum value
    const significantTransfers = allTransfers.filter(
      (t) => t.valueUsd >= minValue
    );

    // Convert to alerts
    const alertsRaw = await Promise.all(
      significantTransfers.map(async (transfer) => {
        // Find trader in our monitoring pool
        const trader = monitoringPool.find(t => 
          t.wallets.some(w => w.toLowerCase() === transfer.walletAddress.toLowerCase())
        );
        
        if (!trader) return null;

        // Get Ethos score (cached)
        let ethosScore = ethosScoreCache.get(trader.id);
        if (ethosScore === undefined) {
          try {
            const result = await ethosClient.getScoreByAddress(
              transfer.walletAddress
            );
            ethosScore = result?.score ?? null;
          } catch {
            ethosScore = null;
          }
          ethosScoreCache.set(trader.id, ethosScore);
        }

        const { type, severity } = classifyAlert(transfer);

        // Process for cluster detection (same as Helius webhook)
        const tradeEvent = fromAlchemyTransfer(transfer, trader.id);
        if (tradeEvent) {
          const trust = await trustResolver.resolve(
            transfer.walletAddress,
            trader.socials?.twitter
          );
          tradeEvent.unifiedTrustScore = trust.score;
          tradeEvent.unifiedTrustTier = trust.tier;

          const clusterSignal = await processTradeEvent(tradeEvent);
          if (clusterSignal) {
            await pushToList("cluster:signals", clusterSignal, 100);
            await enqueueClusterNotifications(clusterSignal);
          }
        }

        return {
          id: `${transfer.hash}-${transfer.tokenAddress}`,
          timestamp: transfer.timestamp,
          type,
          severity,
          trader: {
            id: trader.id,
            name: trader.name,
            walletAddress: transfer.walletAddress,
            ethosScore,
            chain: trader.chain,
            farcasterIdentity: trader.socials?.farcaster
              ? {
                  username: trader.socials.farcaster,
                  displayName: trader.name,
                }
              : undefined,
          },
          token: {
            symbol: transfer.tokenSymbol,
            address: transfer.tokenAddress,
            chain: trader.chain,
          },
          action: {
            type: getActionLabel(transfer.type, transfer.valueUsd),
            amount: transfer.amount,
            valueUsd: transfer.valueUsd,
          },
          txHash: transfer.hash,
        } as ConvictionAlert;
      })
    );

    // Filter nulls from Base alerts
    const baseAlerts = alertsRaw.filter(
      (a): a is ConvictionAlert => a !== null
    );

    // Combine Solana (real-time) + Base (polled) alerts
    const allAlerts = [...solanaAlerts, ...baseAlerts]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);

    // Cache Base alerts in KV for faster subsequent requests
    if (baseAlerts.length > 0) {
      try {
        await setCached(BASE_ALERTS_CACHE_KEY, baseAlerts, { ttl: 300 });
      } catch {
        // KV not available, continue without caching
      }
    }

    // Filter based on kind param
    let responseAlerts = allAlerts;
    let responseClusters = clusterSignals;

    if (kind === "trade") {
      responseClusters = [];
    } else if (kind === "cluster") {
      responseAlerts = [];
    }

    return NextResponse.json({
      success: true,
      alerts: responseAlerts,
      clusters: responseClusters,
      count: responseAlerts.length + responseClusters.length,
      meta: {
        hoursBack,
        minValue,
        kind: kind || "all",
        tradersMonitored: baseTraders.length + watchlist.filter((t) => t.chain === "solana").length,
        walletsScanned: watchlist.reduce((sum, t) => sum + t.wallets.length, 0),
        sources: {
          solanaRealtime: solanaAlerts.length,
          basePolled: baseAlerts.length,
          clusters: responseClusters.length,
        },
      },
    });
  } catch (error) {
    console.error("Alerts fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch alerts", details: String(error) },
      { status: 500 }
    );
  }
}
