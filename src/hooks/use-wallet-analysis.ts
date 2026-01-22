/**
 * Wallet Analysis Hook
 *
 * Provides easy interface for analyzing any wallet from components.
 * Handles identity resolution, Ethos data fetching, and caching.
 */

import { useState, useEffect, useCallback } from "react";
import type { ResolvedIdentity } from "@/lib/services/identity-resolver";
import type { EthosProfile } from "@/lib/ethos";

interface WalletAnalysisState {
  identity: ResolvedIdentity | null;
  loading: boolean;
  error: string | null;
}

interface WalletData {
  address: string;
  identity: ResolvedIdentity;
  ethos: {
    score: number | null;
    tier: string;
    profile: EthosProfile | null;
    attestationCount: number;
  };
  socialProof: {
    hasEthosProfile: boolean;
    hasFarcaster: boolean;
    hasENS: boolean;
    attestations: number;
  };
}

/**
 * Hook for resolving wallet identity
 *
 * @param input - Address, ENS, Farcaster handle, etc.
 * @param autoResolve - Automatically resolve on mount/input change
 */
export function useWalletIdentity(input: string | null, autoResolve = true) {
  const [state, setState] = useState<WalletAnalysisState>({
    identity: null,
    loading: false,
    error: null,
  });

  const resolve = useCallback(async (inputValue: string) => {
    if (!inputValue?.trim()) {
      setState({ identity: null, loading: false, error: "Invalid input" });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const response = await fetch("/api/identity/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: inputValue }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to resolve identity");
      }

      const data = await response.json();
      setState({
        identity: data.identity,
        loading: false,
        error: null,
      });
    } catch (error) {
      setState({
        identity: null,
        loading: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }, []);

  const reset = useCallback(() => {
    setState({ identity: null, loading: false, error: null });
  }, []);

  useEffect(() => {
    if (autoResolve && input) {
      resolve(input);
    }
  }, [input, autoResolve, resolve]);

  return {
    ...state,
    resolve,
    reset,
  };
}

/**
 * Hook for complete wallet analysis
 *
 * @param address - Wallet address (must be resolved first)
 */
export function useWalletData(address: string | null) {
  const [data, setData] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async (addr: string) => {
    if (!addr) {
      setError("No address provided");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await globalThis.fetch(`/api/wallet/${addr}`);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to fetch wallet data");
      }

      const result = await response.json();
      setData(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (address) {
      fetch(address);
    }
  }, [address, fetch]);

  return {
    data,
    loading,
    error,
    refetch: () => address && fetch(address),
  };
}

/**
 * Combined hook for identity resolution + wallet data
 * Most convenient for components that need everything
 */
export function useWalletAnalysis(input: string | null) {
  const identity = useWalletIdentity(input);
  const walletData = useWalletData(identity.identity?.address || null);

  return {
    // Identity resolution
    identity: identity.identity,
    identityLoading: identity.loading,
    identityError: identity.error,
    resolve: identity.resolve,

    // Wallet data
    walletData: walletData.data,
    walletLoading: walletData.loading,
    walletError: walletData.error,

    // Combined state
    loading: identity.loading || walletData.loading,
    error: identity.error || walletData.error,

    // Actions
    reset: identity.reset,
    refetch: walletData.refetch,
  };
}
