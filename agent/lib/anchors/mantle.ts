/**
 * Mantle anchor adapter.
 *
 * Wraps the existing MantleConvictionRegistry on Mantle Sepolia. The chain
 * config (RPC, registry address, explorer URL) lives in `AGENT_CONFIG.mantle`
 * and is unchanged from the pre-adapter setup — this file is a pure
 * refactor of `agent/lib/mantle.ts` into the AnchorAdapter shape.
 *
 * Operator key: `MANTLE_OPERATOR_KEY` env var. Without it `isAvailable()`
 * returns false and the orchestrator skips this adapter.
 */

import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AGENT_CONFIG } from "../config.js";
import type { AnchorAdapter, AnchorResult, ConvictionRecord } from "./types.js";

// ── Chain + ABI ──

const mantleSepoliaChain = defineChain({
  id: AGENT_CONFIG.mantle.sepolia.chainId,
  name: "Mantle Sepolia",
  network: "mantle-sepolia",
  nativeCurrency: { name: "Mantle", symbol: "MNT", decimals: 18 },
  rpcUrls: { default: { http: [AGENT_CONFIG.mantle.sepolia.rpcUrl] } },
});

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

const publicClient = createPublicClient({
  chain: mantleSepoliaChain,
  transport: http(),
});

function getMantleExplorerTxUrl(txHash: string): string {
  return `${AGENT_CONFIG.mantle.sepolia.explorerUrl}/tx/${txHash}`;
}

// ── Adapter ──

export class MantleAnchorAdapter implements AnchorAdapter {
  readonly name = "mantle";

  isAvailable(): boolean {
    const pk = process.env.MANTLE_OPERATOR_KEY;
    return typeof pk === "string" && pk.trim().length > 0;
  }

  async anchor(record: ConvictionRecord): Promise<AnchorResult> {
    const pk = process.env.MANTLE_OPERATOR_KEY;
    if (!pk || pk.trim() === "") {
      return { adapter: this.name, status: "skipped", error: "MANTLE_OPERATOR_KEY not set" };
    }

    const hexKey = pk.startsWith("0x") ? (pk as `0x${string}`) : (`0x${pk}` as const);
    let account;
    try {
      account = privateKeyToAccount(hexKey);
    } catch (err) {
      return {
        adapter: this.name,
        status: "failed",
        error: `Invalid operator key: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const walletClient = createWalletClient({
      account,
      chain: mantleSepoliaChain,
      transport: http(),
    });

    const registryAddress = AGENT_CONFIG.mantle.sepolia.registryAddress as `0x${string}`;
    const clampedScore = BigInt(Math.min(100, Math.max(0, record.convictionScore)));

    try {
      const hash = await walletClient.writeContract({
        address: registryAddress,
        abi: MANTLE_REGISTRY_ABI,
        functionName: "anchorConviction",
        args: [record.subjectHash, record.thesisHash, clampedScore, record.archetype],
      });

      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        timeout: 60_000,
        pollingInterval: 2_000,
      });

      return {
        adapter: this.name,
        status: receipt.status === "success" ? "success" : "failed",
        txHash: hash,
        blockNumber: Number(receipt.blockNumber),
        gasUsed: receipt.gasUsed.toString(),
        explorerUrl: getMantleExplorerTxUrl(hash),
        error: receipt.status === "success" ? undefined : "reverted",
      };
    } catch (err) {
      return {
        adapter: this.name,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
