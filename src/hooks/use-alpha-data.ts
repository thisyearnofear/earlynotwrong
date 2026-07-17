"use client";

import { useEffect, useState } from "react";
import type { AlphaTrader, TokenHeatmapEntry } from "@/lib/db/postgres";
import type { EthosTier } from "@/lib/ethos-gates";

interface AlphaDataState {
  traders: AlphaTrader[];
  tokens: TokenHeatmapEntry[];
  isLoading: boolean;
  isGated: boolean;
  gate?: { score: number; tier: EthosTier };
  error: string | null;
}

interface UseAlphaDataOptions {
  address: string | null;
  chain?: "solana" | "base";
}

/**
 * Fetch alpha traders + token heatmap from the API.
 * If the caller's Ethos score is below the gate, the API returns 403 and we
 * surface `isGated: true` so the page can render the TierGate preview.
 */
export function useAlphaData({
  address,
  chain,
}: UseAlphaDataOptions): AlphaDataState {
  const [state, setState] = useState<AlphaDataState>({
    traders: [],
    tokens: [],
    isLoading: true,
    isGated: false,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, isLoading: true, error: null }));

    const params = new URLSearchParams();
    if (address) params.set("address", address);
    if (chain) params.set("chain", chain);

    Promise.all([
      fetch(`/api/alpha/traders?${params.toString()}`).then((r) =>
        r.ok ? r.json() : Promise.reject({ status: r.status, body: r.json() }),
      ),
      fetch(`/api/alpha/tokens?${params.toString()}`).then((r) =>
        r.ok ? r.json() : Promise.reject({ status: r.status, body: r.json() }),
      ),
    ])
      .then(([tradersRes, tokensRes]) => {
        if (cancelled) return;
        setState({
          traders: tradersRes.traders ?? [],
          tokens: tokensRes.tokens ?? [],
          isLoading: false,
          isGated: false,
          gate: tradersRes.gate,
          error: null,
        });
      })
      .catch(async (err) => {
        if (cancelled) return;
        const status = err?.status;
        if (status === 403) {
          const body = await err.body.catch(() => null);
          const score = typeof body?.currentScore === "number" ? body.currentScore : 0;
          setState({
            traders: [],
            tokens: [],
            isLoading: false,
            isGated: true,
            gate: body?.tier
              ? { score, tier: body.tier as EthosTier }
              : { score, tier: "visitor" },
            error: body?.error ?? "Conviction Discovery requires Ethos ≥ 1000",
          });
        } else {
          setState({
            traders: [],
            tokens: [],
            isLoading: false,
            isGated: false,
            error: "Failed to load conviction discovery data",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [address, chain]);

  return state;
}
