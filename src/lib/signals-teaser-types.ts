/** Matches agent GET /signals/teaser — public web shape (not paid delivery). */

export type BuyerRecommendedAction = "skip_entries" | "evaluate" | "wait";

export interface SignalsLiveTeaser {
  schema: string;
  teaser: true;
  preview: true;
  freshness: {
    cycle: number;
    stale: boolean;
    staleReason: string | null;
  };
  guidance: {
    recommendedAction: BuyerRecommendedAction;
    reason: string;
    topCandidate: string | null;
    sizeMultiplier: number;
  };
  signalCount: number;
  topSignal: { symbol: string; score: number } | null;
  provenance: {
    behavioral: { score: number; archetype: string } | null;
    reputation: { totalAnchors: number; dualChain: boolean };
  };
  unlock: {
    message: string;
    crooStoreUrl: string;
    priceUsdc: string;
    dashboardUrl: string;
  };
  meta: { schemaUrl: string };
}

export const GUIDANCE_LABELS: Record<BuyerRecommendedAction, string> = {
  evaluate: "Evaluate",
  skip_entries: "Skip entries",
  wait: "Wait",
};
