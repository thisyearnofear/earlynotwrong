import { NextRequest, NextResponse } from "next/server";
import { pushToList, getList } from "@/lib/kv-cache";
import { findTraderByWallet } from "@/lib/watchlist";
import { fromHeliusTransaction, processTradeEvent } from "@/lib/alerts";
import { trustResolver } from "@/lib/services/trust-resolver";
import { enqueueClusterNotifications } from "@/lib/notifications";

const WEBHOOK_AUTH_HEADER = process.env.HELIUS_WEBHOOK_AUTH;
const ALERTS_KEY = "solana:realtime:alerts";

interface HeliusEnhancedTransaction {
  signature: string;
  timestamp: number;
  type: string;
  source: string;
  fee: number;
  feePayer: string;
  nativeTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
  }>;
  tokenTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    fromTokenAccount: string;
    toTokenAccount: string;
    tokenAmount: number;
    mint: string;
    tokenStandard: string;
  }>;
  accountData?: Array<{
    account: string;
    nativeBalanceChange: number;
    tokenBalanceChanges: Array<{
      userAccount: string;
      tokenAccount: string;
      mint: string;
      rawTokenAmount: {
        tokenAmount: string;
        decimals: number;
      };
    }>;
  }>;
  description?: string;
}

interface StoredAlert {
  id: string;
visibleUnixtime: number;
  traderId: string;
  traderName: string;
  walletAddress: string;
  chain: "solana";
  type: string;
  signature: string;
  description: string;
  timestamp: number;
  tokenTransfers: Array<{
    mint: string;
    amount: number;
    direction: "in" | "out";
  }>;
  nativeTransfer?: {
    amount: number;
    direction: "in" | "out";
  };
}

function parseHeliusTransaction(
  tx: HeliusEnhancedTransaction,
  watchedAddresses: string[]
): StoredAlert | null {
  const matchedAddress = watchedAddresses.find(
    (addr) =>
      tx.feePayer === addr ||
      tx.nativeTransfers?.some(
        (t) => t.fromUserAccount === addr || t.toUserAccount === addr
      ) ||
      tx.tokenTransfers?.some(
        (t) => t.fromUserAccount === addr || t.toUserAccount === addr
      )
  );

  if (!matchedAddress) return null;

  const trader = findTraderByWallet(matchedAddress);
  if (!trader) return null;

  // Parse token transfers
  const tokenTransfers =
    tx.tokenTransfers?.map((t) => ({
      mint: t.mint,
      amount: t.tokenAmount,
      direction:
        t.toUserAccount === matchedAddress ? ("in" as const) : ("out" as const),
    })) || [];

  // Parse native SOL transfers
  const nativeIn = tx.nativeTransfers?.find(
    (t) => t.toUserAccount === matchedAddress
  );
  const nativeOut = tx.nativeTransfers?.find(
    (t) => t.fromUserAccount === matchedAddress
  );
  const nativeTransfer = nativeIn
    ? { amount: nativeIn.amount / 1e9, direction: "in" as const }
    : nativeOut
      ? { amount: nativeOut.amount / 1e9, direction: "out" as const }
      : undefined;

  return {
    id: `helius:${tx.signature}`,
    visibleUnixtime: Date.now(),
    traderId: trader.id,
    traderName: trader.name,
    walletAddress: matchedAddress,
    chain: "solana",
    type: tx.type,
    signature: tx.signature,
    description: tx.description || tx.type,
    timestamp: tx.timestamp * 1000,
    tokenTransfers,
    nativeTransfer,
  };
}

export async function POST(request: NextRequest) {
  try {
    // Verify auth header if configured
    if (WEBHOOK_AUTH_HEADER) {
      const authHeader = request.headers.get("authorization");
      if (authHeader !== WEBHOOK_AUTH_HEADER) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const transactions: HeliusEnhancedTransaction[] = await request.json();

    if (!Array.isArray(transactions)) {
      return NextResponse.json(
        { error: "Expected array of transactions" },
        { status: 400 }
      );
    }

    // Import watchlist addresses
    const { getWatchlistAddresses } = await import("@/lib/watchlist");
    const solanaAddresses = getWatchlistAddresses("solana");

    let processed = 0;
    let clustersDetected = 0;

    for (const tx of transactions) {
      const alert = parseHeliusTransaction(tx, solanaAddresses);
      if (alert) {
        await pushToList(ALERTS_KEY, alert, 100);
        processed++;

        // Convert to TradeEvent and check for cluster formation
        const tradeEvent = fromHeliusTransaction(
          tx as HeliusEnhancedTransaction,
          alert.walletAddress,
          alert.traderId
        );

        if (tradeEvent) {
          // Resolve trust score for cluster eligibility
          const trust = await trustResolver.resolve(
            tradeEvent.walletAddress,
            findTraderByWallet(tradeEvent.walletAddress)?.socials?.twitter
          );
          tradeEvent.unifiedTrustScore = trust.score;
          tradeEvent.unifiedTrustTier = trust.tier;

          // Check for cluster signal
          const clusterSignal = await processTradeEvent(tradeEvent);
          if (clusterSignal) {
            // Store cluster signal and queue notifications
            await pushToList("cluster:signals", clusterSignal, 100);
            const queued = await enqueueClusterNotifications(clusterSignal);
            clustersDetected++;
            console.log(
              `🔔 Cluster detected: ${clusterSignal.tokenSymbol || clusterSignal.tokenAddress} ` +
              `(${clusterSignal.clusterSize} traders, ${queued} notifications queued)`
            );
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      processed,
      clustersDetected,
      total: transactions.length,
    });
  } catch (error) {
    console.error("Helius webhook error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed", details: String(error) },
      { status: 500 }
    );
  }
}

// GET endpoint to retrieve stored alerts
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "20");

    const alerts = await getList<StoredAlert>(ALERTS_KEY, 0, limit - 1);

    return NextResponse.json({
      success: true,
      alerts,
      count: alerts.length,
      source: "helius-realtime",
    });
  } catch (error) {
    console.error("Error fetching alerts:", error);
    return NextResponse.json(
      { error: "Failed to fetch alerts", details: String(error) },
      { status: 500 }
    );
  }
}
