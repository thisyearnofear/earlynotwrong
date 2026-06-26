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
import { getMantleExplorerTxUrl } from "../explorers.js";
import type { AnchorAdapter, AnchorResult, AnchoredRecord, Bytes32Hex, ConvictionRecord } from "./types.js";

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
  // Auto-generated getter for the `mapping(bytes32 => ConvictionRecord) public convictionByThesis`
  {
    type: "function",
    name: "convictionByThesis",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [
      { name: "subjectHash", type: "bytes32" },
      { name: "anchoredBy", type: "address" },
      { name: "thesisHash", type: "bytes32" },
      { name: "convictionScore", type: "uint256" },
      { name: "archetype", type: "string" },
      { name: "timestamp", type: "uint256" },
      { name: "verified", type: "bool" },
    ],
  },
  {
    type: "event",
    name: "ConvictionAnchored",
    anonymous: false,
    inputs: [
      { name: "subjectHash", type: "bytes32", indexed: true },
      { name: "anchoredBy", type: "address", indexed: true },
      { name: "thesisHash", type: "bytes32", indexed: true },
      { name: "convictionScore", type: "uint256", indexed: false },
      { name: "archetype", type: "string", indexed: false },
    ],
  },
] as const;

const publicClient = createPublicClient({
  chain: mantleSepoliaChain,
  transport: http(),
});

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

  // ─── Read methods ─────────────────────────────────────────────────────────
  //
  // Mantle reads are free (view functions + event logs) — no operator key
  // required. We expose them on the same adapter the agent uses to anchor
  // so the MCP server has one stable surface for both writes and reads.

  async getLatestConviction(subjectHash: Bytes32Hex): Promise<AnchoredRecord | null> {
    const registry = AGENT_CONFIG.mantle.sepolia.registryAddress as `0x${string}`;
    try {
      const r = await publicClient.readContract({
        address: registry,
        abi: MANTLE_REGISTRY_ABI,
        functionName: "getLatestConviction",
        args: [subjectHash],
      });
      return tupleToRecord(r as MantleConvictionTuple);
    } catch {
      // The contract reverts when no record exists; treat that as "none".
      return null;
    }
  }

  async getByThesis(thesisHash: Bytes32Hex): Promise<AnchoredRecord | null> {
    const registry = AGENT_CONFIG.mantle.sepolia.registryAddress as `0x${string}`;
    try {
      const r = await publicClient.readContract({
        address: registry,
        abi: MANTLE_REGISTRY_ABI,
        functionName: "convictionByThesis",
        args: [thesisHash],
      });
      // The auto-generated getter returns a flat tuple, not a struct.
      const tuple = r as readonly [
        `0x${string}`, `0x${string}`, `0x${string}`, bigint, string, bigint, boolean,
      ];
      if (tuple[5] === 0n) return null; // unset entry: timestamp == 0
      return tupleToRecord({
        subjectHash: tuple[0],
        anchoredBy: tuple[1],
        thesisHash: tuple[2],
        convictionScore: tuple[3],
        archetype: tuple[4],
        timestamp: tuple[5],
        verified: tuple[6],
      });
    } catch {
      return null;
    }
  }

  async getSubjectHistory(subjectHash: Bytes32Hex): Promise<AnchoredRecord[]> {
    const registry = AGENT_CONFIG.mantle.sepolia.registryAddress as `0x${string}`;
    try {
      // Walk the ConvictionAnchored event log. Topic 1 = subjectHash (indexed).
      const logs = await publicClient.getLogs({
        address: registry,
        event: MANTLE_REGISTRY_ABI.find(
          (e): e is typeof MANTLE_REGISTRY_ABI[number] & { type: "event" } =>
            e.type === "event" && e.name === "ConvictionAnchored",
        )!,
        args: { subjectHash },
        fromBlock: "earliest",
      });
      return logs.map((l) => ({
        adapter: this.name,
        subjectHash: l.args.subjectHash!,
        thesisHash: l.args.thesisHash!,
        convictionScore: Number(l.args.convictionScore ?? 0n),
        archetype: l.args.archetype ?? "",
        timestamp: 0, // not on the event; derive from block if needed
        anchoredBy: l.args.anchoredBy ?? "",
        txHash: l.transactionHash,
        explorerUrl: l.transactionHash ? getMantleExplorerTxUrl(l.transactionHash) : undefined,
      }));
    } catch {
      return [];
    }
  }
}

// ── Shared tuple → record conversion ──

interface MantleConvictionTuple {
  subjectHash: `0x${string}`;
  anchoredBy: `0x${string}`;
  thesisHash: `0x${string}`;
  convictionScore: bigint;
  archetype: string;
  timestamp: bigint;
  verified: boolean;
}

function tupleToRecord(t: MantleConvictionTuple): AnchoredRecord {
  return {
    adapter: "mantle",
    subjectHash: t.subjectHash,
    thesisHash: t.thesisHash,
    convictionScore: Number(t.convictionScore),
    archetype: t.archetype,
    timestamp: Number(t.timestamp),
    anchoredBy: t.anchoredBy,
  };
}
