"use client";

import { cn } from "@/lib/utils";
import { RegimeBar, SignalFactorBreakdown, type ScoredSignal } from "./signal-factor-breakdown";

interface RegimeDetails {
  score: number;
  label: string;
  fearGreedIndex: number | null;
  fearLevel: string;
  ssiConfirmation: number | null;
}

interface SignalWeights {
  contrarian: number;
  rsi: number;
  quality: number;
  regime: number;
  holders: number;
  volatilityPenaltyMax: number;
  newsMax: number;
}

interface SignalScoringDetailsProps {
  regime: RegimeDetails | null;
  topSignal: ScoredSignal | null;
  weights?: SignalWeights;
}

/** Full regime context + 7-factor breakdown — for progressive disclosure. */
export function SignalScoringDetails({ regime, topSignal, weights }: SignalScoringDetailsProps) {
  if (!regime && !topSignal) {
    return (
      <p className="text-xs font-mono text-foreground-muted">No scoring data this cycle.</p>
    );
  }

  return (
    <div className="space-y-4">
      {regime && (
        <div className="space-y-2">
          <RegimeBar score={regime.score} label={regime.label} />
          <p className="text-[10px] font-mono text-foreground-dim leading-relaxed">
            Fear & Greed {regime.fearGreedIndex ?? "—"} · {regime.fearLevel}
            {regime.ssiConfirmation != null && (
              <>
                {" · "}
                <span
                  className={cn(
                    regime.ssiConfirmation > 0.2
                      ? "text-patience"
                      : regime.ssiConfirmation < -0.2
                        ? "text-impatience"
                        : "text-foreground-dim",
                  )}
                >
                  SSI{" "}
                  {regime.ssiConfirmation > 0
                    ? "confirms"
                    : regime.ssiConfirmation < 0
                      ? "contradicts"
                      : "neutral"}{" "}
                  ({regime.ssiConfirmation > 0 ? "+" : ""}
                  {regime.ssiConfirmation.toFixed(2)})
                </span>
              </>
            )}
          </p>
          {weights && (
            <p className="text-[10px] font-mono text-foreground-dim/80">
              Active weights{" "}
              <span className="text-signal">C{weights.contrarian}</span>
              {" · "}
              <span className="text-cyan-400">R{weights.rsi}</span>
              {" · "}
              <span className="text-patience">Q{weights.quality}</span>
              {" · "}
              <span className="text-cyan-400">M{weights.regime}</span>
              {" · "}
              <span className="text-amber-400">H{weights.holders}</span>
              {" · "}
              <span className="text-impatience">V{weights.volatilityPenaltyMax}</span>
              {" · "}
              <span className="text-emerald-400">N{weights.newsMax}</span>
            </p>
          )}
        </div>
      )}
      {topSignal && (
        <div className="p-3 rounded-lg bg-surface/50 border border-border/30">
          <SignalFactorBreakdown signal={topSignal} />
        </div>
      )}
    </div>
  );
}
