"use client";

import { useAccount } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWallet as useAleoWallet } from "@provablehq/aleo-wallet-adaptor-react";
import { useCasperWallet } from "@/components/casper-wallet-provider";
import { useAppStore } from "@/lib/store";
import type { ConnectionChain } from "@/lib/connections";

/**
 * Canonical read of per-chain connection state + helpers to open the panel.
 * Use `primaryForGates` for Ethos-gated features (Discovery, API auth).
 */
export function useConnections() {
  const { address: evmAddress, isConnected: isEvmConnected } = useAccount();
  const { publicKey, connected: isSolanaConnected } = useWallet();
  const {
    address: aleoAddress,
    connected: isAleoConnected,
  } = useAleoWallet();
  const casper = useCasperWallet();
  const casperPublicKey =
    casper?.status?.kind === "connected" ? casper.status.publicKey : null;
  const isCasperConnected = casper?.status?.kind === "connected";

  const openConnections = useAppStore((s) => s.openConnections);

  const solanaAddress = publicKey?.toBase58() ?? null;

  return {
    evm: {
      address: evmAddress ?? null,
      isConnected: isEvmConnected,
    },
    solana: {
      address: solanaAddress,
      isConnected: isSolanaConnected,
    },
    aleo: {
      address: aleoAddress ?? null,
      isConnected: isAleoConnected,
    },
    casper: {
      publicKey: casperPublicKey,
      isConnected: isCasperConnected,
      status: casper?.status?.kind ?? "loading",
    },
    /** EVM address used for Ethos gates and Discovery API auth. */
    primaryForGates: isEvmConnected ? (evmAddress ?? null) : null,
    hasAnyConnection:
      isEvmConnected ||
      isSolanaConnected ||
      isAleoConnected ||
      isCasperConnected,
    openConnections: (focus?: ConnectionChain) => openConnections(focus),
  };
}
