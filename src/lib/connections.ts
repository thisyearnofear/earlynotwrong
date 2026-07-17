/** Shared types and helpers for the multi-chain Connections panel. */

export type ConnectionChain = "evm" | "solana" | "aleo" | "casper";

const CONNECT_ALIASES: Record<string, ConnectionChain> = {
  evm: "evm",
  base: "evm",
  ethereum: "evm",
  solana: "solana",
  sol: "solana",
  aleo: "aleo",
  casper: "casper",
  cspr: "casper",
};

export function parseConnectionChain(
  value: string | null | undefined,
): ConnectionChain | null {
  if (!value) return null;
  return CONNECT_ALIASES[value.toLowerCase()] ?? null;
}

export function connectionSectionId(chain: ConnectionChain): string {
  return `connections-${chain}`;
}

export const CONNECTION_CHAIN_LABELS: Record<ConnectionChain, string> = {
  evm: "Base (EVM)",
  solana: "Solana",
  aleo: "Aleo",
  casper: "Casper",
};
