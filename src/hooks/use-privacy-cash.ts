"use client";

import { useEffect, useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  fetchPrivateBalance,
  type PrivacyBalance,
} from "@/lib/privacy-cash";

interface UsePrivacyCashReturn {
  balance: PrivacyBalance;
  isLoading: boolean;
  isConnected: boolean;
  publicKey: string | null;
  refresh: () => Promise<void>;
}

const EMPTY_BALANCE: PrivacyBalance = {
  solLamports: 0,
  solFormatted: "0.0000",
  ok: false,
  error: "Not connected",
};

/**
 * React hook exposing the connected Solana wallet's Privacy Cash balance.
 * Calls the server-side /api/privacy/balance route, which runs the
 * Privacy Cash SDK on the server (no Node-only deps leak into the bundle).
 */
export function usePrivacyCash(): UsePrivacyCashReturn {
  const { publicKey, connected } = useWallet();
  const [balance, setBalance] = useState<PrivacyBalance>(EMPTY_BALANCE);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!publicKey) {
      setBalance({ ...EMPTY_BALANCE, error: "Not connected" });
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetchPrivateBalance(publicKey.toBase58());
      setBalance(res);
    } finally {
      setIsLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    if (!connected || !publicKey) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh, connected, publicKey]);

  return {
    balance,
    isLoading,
    isConnected: !!connected && !!publicKey,
    publicKey: publicKey?.toBase58() ?? null,
    refresh,
  };
}
