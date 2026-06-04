"use client";

import { useEffect, useState } from "react";
import type { CohortStats } from "@/lib/db/postgres";
import type { EthosTier } from "@/lib/ethos-gates";

interface CohortComparisonResult {
  cohort: CohortStats | null;
  percentile: number;
  tier: EthosTier;
  gate?: { score: number; tier: EthosTier };
}

interface UseCohortComparisonOptions {
  address: string | null;
  chain?: "solana" | "base";
  score: number;
  /** Skip fetch when false (e.g., while analysis is in progress) */
  enabled?: boolean;
}

interface CohortComparisonState extends CohortComparisonResult {
  isLoading: boolean;
  isGated: boolean;
  error: string | null;
}

const EMPTY: CohortComparisonState = {
  cohort: null,
  percentile: 50,
  tier: "visitor",
  isLoading: false,
  isGated: false,
  error: null,
};

export function useCohortComparison({
  address,
  chain,
  score,
  enabled = true,
}: UseCohortComparisonOptions): CohortComparisonState {
  const [state, setState] = useState<CohortComparisonState>(EMPTY);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    setState((s) => ({ ...s, isLoading: true, error: null }));

    const params = new URLSearchParams();
    if (address) params.set("address", address);
    if (chain) params.set("chain", chain);
    params.set("score", String(score));

    fetch(`/api/cohort/compare?${params.toString()}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => null);
          if (r.status === 403) {
            throw { status: 403, body };
          }
          throw { status: r.status, body };
        }
        return r.json();
      })
      .then((res: CohortComparisonResult) => {
        if (cancelled) return;
        setState({
          ...res,
          isLoading: false,
          isGated: false,
          error: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err?.status === 403) {
          setState({
            ...EMPTY,
            isGated: true,
            error:
              err.body?.error ??
              "Cohort Comparison requires Ethos ≥ 1400 (Whale)",
          });
        } else {
          setState({
            ...EMPTY,
            error: "Failed to load cohort comparison",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [address, chain, score, enabled]);

  return state;
}
