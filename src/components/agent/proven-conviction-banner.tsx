"use client";

import { motion } from "framer-motion";
import type { EntrySignal, LedgerPosition, PositionVerdict } from "./position-row";

interface ProvenConvictionBannerProps {
  position: LedgerPosition;
  verdict: PositionVerdict;
  signal?: EntrySignal;
  compact?: boolean;
}

export function ProvenConvictionBanner({
  position: p,
  verdict,
  signal,
  compact = false,
}: ProvenConvictionBannerProps) {
  if (compact) {
    return (
      <div className="rounded-lg border border-patience/35 bg-patience/8 px-3 py-2.5 mb-1">
        <p className="text-[11px] font-mono leading-relaxed">
          <span className="text-patience font-bold uppercase tracking-wider">◆ Early, Not Wrong</span>
          {" — "}
          <span className="text-foreground font-semibold">{p.symbol}</span>
          {" held through "}
          <span className="text-impatience">−{Math.abs(p.maxUnderwaterPercent).toFixed(0)}%</span>
          {" → "}
          <span className="text-patience font-semibold">
            +{verdict.unrealizedPnLPercent.toFixed(1)}%
          </span>
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4 }}
      className="rounded-xl border-2 border-patience/40 bg-patience/8 p-3.5 space-y-2.5 shadow-[0_0_20px_-8px_var(--patience-dim)]"
    >
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-patience">
          ◆ Early, Not Wrong
        </span>
        <span className="text-[9px] font-mono text-foreground-dim">conviction proven</span>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap text-[11px] font-mono">
        <span className="text-foreground font-semibold">{p.symbol}</span>
        {signal && (
          <>
            <span className="text-foreground-dim">·</span>
            <span className="text-signal" title={signal.rationale}>
              scored {signal.score}
            </span>
          </>
        )}
        <span className="text-foreground-dim">→</span>
        <span className="text-foreground-muted">entered cycle {p.entryCycle}</span>
        <span className="text-foreground-dim">→</span>
        <span className="text-impatience">dipped −{p.maxUnderwaterPercent.toFixed(1)}%</span>
        <span className="text-foreground-dim">→</span>
        <span className="text-patience font-semibold">held {p.cyclesHeld} cycles</span>
        <span className="text-foreground-dim">→</span>
        <span className="text-patience font-bold text-sm">
          now +{verdict.unrealizedPnLPercent.toFixed(1)}%
        </span>
      </div>
      {verdict.reason && (
        <p className="text-[10px] font-mono text-foreground-muted leading-relaxed">
          {verdict.reason}
        </p>
      )}
    </motion.div>
  );
}
