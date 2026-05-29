import type { Address } from "viem";

export const mantleSepolia = {
  id: 5003,
  name: "Mantle Sepolia",
  nativeCurrency: {
    decimals: 18,
    name: "Mantle",
    symbol: "MNT",
  },
  rpcUrls: {
    default: { http: ["https://rpc.sepolia.mantle.xyz"] },
  },
  blockExplorers: {
    default: {
      name: "Mantle Sepolia Explorer",
      url: "https://explorer.sepolia.mantle.xyz",
    },
  },
  testnet: true,
} as const;

export const MANTLE_CONVICTION_REGISTRY_ADDRESS = process.env
  .NEXT_PUBLIC_MANTLE_CONVICTION_REGISTRY as Address | undefined;

export const MANTLE_CONVICTION_REGISTRY_ABI = [
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

export function getMantleExplorerTxUrl(txHash: string) {
  return `${mantleSepolia.blockExplorers.default.url}/tx/${txHash}`;
}

export function getMantleExplorerAddressUrl(address: string) {
  return `${mantleSepolia.blockExplorers.default.url}/address/${address}`;
}
