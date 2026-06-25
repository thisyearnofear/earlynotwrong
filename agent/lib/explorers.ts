/**
 * Public block-explorer URL helpers.
 *
 * Per-chain, chain-agnostic API: given a tx hash (or address) and a chain id,
 * build the public explorer URL. Lives here (not in `anchors/` or
 * `twak-executor`) because explorer URLs are surfacing concerns — used by
 * Telegram, the HTTP server, and the loop log — not adapter internals.
 */

import { AGENT_CONFIG } from "./config.js";

// ── BSC ──

export function getBscExplorerTxUrl(txHash: string, testnet: boolean = false): string {
  const baseUrl = testnet
    ? AGENT_CONFIG.chains.bsc.blockExplorerUrls.testnet
    : AGENT_CONFIG.chains.bsc.blockExplorerUrls.mainnet;
  return `${baseUrl}/tx/${txHash}`;
}

export function getBscExplorerAddressUrl(address: string, testnet: boolean = false): string {
  const baseUrl = testnet
    ? AGENT_CONFIG.chains.bsc.blockExplorerUrls.testnet
    : AGENT_CONFIG.chains.bsc.blockExplorerUrls.mainnet;
  return `${baseUrl}/address/${address}`;
}

// ── Mantle ──

export function getMantleExplorerTxUrl(txHash: string): string {
  return `${AGENT_CONFIG.mantle.sepolia.explorerUrl}/tx/${txHash}`;
}

export function getMantleExplorerAddressUrl(address: string): string {
  return `${AGENT_CONFIG.mantle.sepolia.explorerUrl}/address/${address}`;
}

// ── Casper ──

export function getCasperExplorerTxUrl(deployHash: string): string {
  return `${AGENT_CONFIG.casper.testnet.explorerUrl}/deploy/${deployHash}`;
}

export function getCasperExplorerAccountUrl(publicKeyHex: string): string {
  return `${AGENT_CONFIG.casper.testnet.explorerUrl}/account/${publicKeyHex}`;
}
