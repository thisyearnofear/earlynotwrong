/**
 * Event Converters
 * Transform chain-specific data into canonical TradeEvent format
 */

import type { TradeEvent, Chain, TradeSide } from "./types";

/**
 * Helius Enhanced Transaction (from webhook)
 */
interface HeliusTransaction {
  signature: string;
  timestamp: number;
  type: string;
  feePayer: string;
  nativeTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
  }>;
  tokenTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    tokenAmount: number;
    mint: string;
  }>;
}

/**
 * Convert Helius webhook transaction to TradeEvent
 */
export function fromHeliusTransaction(
  tx: HeliusTransaction,
  matchedWallet: string,
  traderId?: string
): TradeEvent | null {
  // Must have token transfers to be relevant
  if (!tx.tokenTransfers?.length) {
    return null;
  }

  // Find the most significant token transfer for this wallet
  const relevantTransfer = tx.tokenTransfers.find(
    (t) =>
      t.fromUserAccount === matchedWallet || t.toUserAccount === matchedWallet
  );

  if (!relevantTransfer) {
    return null;
  }

  // Determine side: receiving tokens = buy, sending = sell
  const side: TradeSide =
    relevantTransfer.toUserAccount === matchedWallet ? "buy" : "sell";

  return {
    id: `helius:${tx.signature}:${relevantTransfer.mint}`,
    chain: "solana",
    walletAddress: matchedWallet,
    traderId,
    timestampMs: tx.timestamp * 1000,
    tokenAddress: relevantTransfer.mint,
    side,
    amount: relevantTransfer.tokenAmount,
    txHash: tx.signature,
  };
}

/**
 * Alchemy/Base token transfer
 */
interface AlchemyTransfer {
  hash: string;
  timestamp: number;
  tokenAddress: string;
  tokenSymbol: string;
  type: "buy" | "sell";
  amount: number;
  valueUsd: number;
  walletAddress: string;
}

/**
 * Convert Alchemy polling result to TradeEvent
 */
export function fromAlchemyTransfer(
  transfer: AlchemyTransfer,
  traderId?: string
): TradeEvent {
  return {
    id: `alchemy:${transfer.hash}:${transfer.tokenAddress}`,
    chain: "base",
    walletAddress: transfer.walletAddress,
    traderId,
    timestampMs: transfer.timestamp,
    tokenAddress: transfer.tokenAddress,
    tokenSymbol: transfer.tokenSymbol,
    side: transfer.type,
    amount: transfer.amount,
    valueUsd: transfer.valueUsd,
    txHash: transfer.hash,
  };
}
