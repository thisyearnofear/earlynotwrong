/**
 * Agent Mantle Anchoring
 * Ported from src/lib/mantle.ts — now with viem for live contract calls.
 * Handles anchoring analysis hashes to the existing Mantle ERC-8004 registry.
 */

import { keccak_256 as _keccak256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { createWalletClient, createPublicClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AGENT_CONFIG } from "./config.js";

// =============================================================================
// Mantle Sepolia Chain Definition (for viem)
// =============================================================================

export const mantleSepoliaChain = defineChain({
  id: AGENT_CONFIG.mantle.sepolia.chainId,
  name: "Mantle Sepolia",
  network: "mantle-sepolia",
  nativeCurrency: { name: "Mantle", symbol: "MNT", decimals: 18 },
  rpcUrls: {
    default: { http: [AGENT_CONFIG.mantle.sepolia.rpcUrl] },
  },
});

export const mantleSepolia = AGENT_CONFIG.mantle.sepolia;

// =============================================================================
// Public Client (shared for reading / waiting for receipts)
// =============================================================================

const mantlePublicClient = createPublicClient({
  chain: mantleSepoliaChain,
  transport: http(),
});

// =============================================================================
// Registry ABI (minimal — only the functions the agent needs)
// =============================================================================

/**
 * Minimal ABI for the MantleConvictionRegistry.
 * The agent calls anchorConviction; reading happens via the explorer.
 */
export const MANTLE_REGISTRY_ABI = [
  {
    type: "function",
    name: "anchorConviction",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_subjectHash", type: "bytes32" },
      { name: "_thesisHash", type: "bytes32" },
      { name: "_convictionScore", type: "uint256" },
      { name: "_archetype", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getLatestConviction",
    stateMutability: "view",
    inputs: [{ name: "_subjectHash", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "subjectHash", type: "bytes32" },
          { name: "anchoredBy", type: "address" },
          { name: "thesisHash", type: "bytes32" },
          { name: "convictionScore", type: "uint256" },
          { name: "archetype", type: "string" },
          { name: "timestamp", type: "uint256" },
          { name: "verified", type: "bool" },
        ],
      },
    ],
  },
] as const;

// =============================================================================
// Wallet Client (for signing anchorConviction transactions)
// =============================================================================

/**
 * Create a viem wallet client from the MANTLE_OPERATOR_KEY env var.
 *
 * Returns null in simulator mode (no key set) — the agent loop treats
 * null as "skip contract call, log payload instead".
 *
 * The operator wallet must be authorized on the contract via
 * setOperatorAuthorization() by the contract owner before the
 * agent can anchor. See mantle/contracts/MantleConvictionRegistry.sol.
 */
export function createMantleWalletClient() {
  const pk = process.env.MANTLE_OPERATOR_KEY;
  if (!pk || pk.trim() === "") {
    return null;
  }

  const hexKey = pk.startsWith("0x") ? (pk as `0x${string}`) : (`0x${pk}` as const);

  try {
    const account = privateKeyToAccount(hexKey);
    const walletClient = createWalletClient({
      account,
      chain: mantleSepoliaChain,
      transport: http(),
    });
    return walletClient;
  } catch (err) {
    console.warn("  ⚠ Failed to create Mantle wallet client:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Submit an anchorConviction transaction to the Mantle ERC-8004 registry
 * and wait for it to be mined.
 *
 * @returns The tx hash, explorer URL, block number, and status ("success" | "reverted").
 */
export async function anchorToMantleContract(
  walletClient: NonNullable<ReturnType<typeof createMantleWalletClient>>,
  params: {
    subjectHash: `0x${string}`;
    thesisHash: `0x${string}`;
    convictionScore: number;
    archetype: string;
  }
): Promise<{
  txHash: `0x${string}`;
  explorerUrl: string;
  blockNumber: bigint;
  status: "success" | "reverted";
  gasUsed: bigint;
}> {
  const registryAddress = AGENT_CONFIG.mantle.sepolia.registryAddress as `0x${string}`;

  // The contract requires score 0–100 (see the `require` in anchorConviction)
  const clampedScore = BigInt(Math.min(100, Math.max(0, params.convictionScore)));

  console.log(`  Submitting anchorConviction...`);

  const hash = await walletClient.writeContract({
    address: registryAddress,
    abi: MANTLE_REGISTRY_ABI,
    functionName: "anchorConviction",
    args: [
      params.subjectHash,
      params.thesisHash,
      clampedScore,
      params.archetype,
    ],
  });

  console.log(`  Transaction broadcast. Waiting for confirmation...`);

  const receipt = await mantlePublicClient.waitForTransactionReceipt({
    hash,
    timeout: 60_000,      // 60s timeout
    pollingInterval: 2_000, // poll every 2s
  });

  const explorerUrl = getMantleExplorerTxUrl(hash);
  const status = receipt.status === "success" ? "success" : "reverted";

  return {
    txHash: hash,
    explorerUrl,
    blockNumber: receipt.blockNumber,
    status,
    gasUsed: receipt.gasUsed,
  };
}

// =============================================================================
// Hash Utilities
// =============================================================================

/**
 * Create a deterministic subject hash from a chain + address pair.
 * Uses keccak256 for a 32-byte cryptographic hash.
 *
 * Matches the same scheme used in the ENW web app (src/app/page.tsx):
 *   keccak256(toBytes(`${chain}:${address}`))
 */
export function computeSubjectHash(chain: string, address: string): `0x${string}` {
  const input = `${chain}:${address}`;
  return keccak256(input);
}

/**
 * Create a deterministic thesis hash from analysis results.
 * The shape of `metrics` is whatever the agent's conviction engine produces
 * for this cycle — the hash is just keccak256 of the canonical JSON.
 */
export function computeThesisHash(
  metrics: Record<string, string | number | boolean | null>
): `0x${string}` {
  const input = JSON.stringify(metrics);
  return keccak256(input);
}

/**
 * keccak256 hash of a UTF-8 string, returned as a 0x-prefixed hex string.
 */
function keccak256(input: string): `0x${string}` {
  const hash = _keccak256(new TextEncoder().encode(input));
  return `0x${bytesToHex(hash)}`;
}

// =============================================================================
// Explorer URL Helpers
// =============================================================================

export function getMantleExplorerTxUrl(txHash: string): string {
  return `${mantleSepolia.explorerUrl}/tx/${txHash}`;
}

export function getMantleExplorerAddressUrl(address: string): string {
  return `${mantleSepolia.explorerUrl}/address/${address}`;
}

// =============================================================================
// BSC Scan URL Helpers
// =============================================================================

export function getBscExplorerTxUrl(txHash: string, testnet: boolean = true): string {
  const baseUrl = testnet
    ? AGENT_CONFIG.chains.bsc.blockExplorerUrls.testnet
    : AGENT_CONFIG.chains.bsc.blockExplorerUrls.mainnet;
  return `${baseUrl}/tx/${txHash}`;
}

export function getBscExplorerAddressUrl(address: string, testnet: boolean = true): string {
  const baseUrl = testnet
    ? AGENT_CONFIG.chains.bsc.blockExplorerUrls.testnet
    : AGENT_CONFIG.chains.bsc.blockExplorerUrls.mainnet;
  return `${baseUrl}/address/${address}`;
}
