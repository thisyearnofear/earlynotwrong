"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface ScoredSignal {
  symbol: string;
  score: number;
  breakdown: {
    contrarian: number;
    rsi: number;
    quality: number;
    regime: number;
    holders: number;
    volatilityPenalty: number;
    news: number;
    llmJury?: number;
  };
}

interface SignalFactorBreakdownProps {
  signal: ScoredSignal;
  className?: string;
}

/** Stacked 7-factor composition bar for a scored token. */
export function SignalFactorBreakdown({ signal, className }: SignalFactorBreakdownProps) {
  const factors = [
    { label: "Contrarian", value: signal.breakdown.contrarian, color: "bg-signal", text: "text-signal" },
    { label: "RSI", value: signal.breakdown.rsi, color: "bg-cyan-400", text: "text-cyan-400" },
    { label: "Quality", value: signal.breakdown.quality, color: "bg-patience", text: "text-patience" },
    { label: "Regime", value: signal.breakdown.regime, color: "bg-blue-400", text: "text-blue-400" },
    { label: "Holders", value: signal.breakdown.holders, color: "bg-amber-400", text: "text-amber-400" },
    ...(signal.breakdown.volatilityPenalty > 0
      ? [{ label: "Vol penalty", value: -signal.breakdown.volatilityPenalty, color: "bg-impatience", text: "text-impatience" }]
      : []),
    ...(signal.breakdown.news !== 0
      ? [{
          label: "News",
          value: signal.breakdown.news,
          color: signal.breakdown.news > 0 ? "bg-emerald-400" : "bg-impatience",
          text: signal.breakdown.news > 0 ? "text-emerald-400" : "text-impatience",
        }]
      : []),
    ...(signal.breakdown.llmJury != null && signal.breakdown.llmJury !== 0
      ? [{
          label: "AI Jury",
          value: signal.breakdown.llmJury,
          color: signal.breakdown.llmJury > 0 ? "bg-purple-400" : "bg-rose-400",
          text: signal.breakdown.llmJury > 0 ? "text-purple-400" : "text-rose-400",
        }]
      : []),
  ];
  const maxAbs = Math.max(...factors.map((f) => Math.abs(f.value)), 30);

  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-foreground-dim">
          {signal.symbol} · 7-factor composition
        </span>
        <span className="text-sm font-bold tabular-nums text-signal ml-auto">{signal.score}</span>
      </div>
      <div className="flex h-3 rounded-full overflow-hidden bg-surface/60 gap-px">
        {factors.map((f, i) => (
          <div
            key={i}
            className={f.color}
            style={{ width: `${(Math.abs(f.value) / maxAbs) * 100}%` }}
            title={`${f.label}: ${f.value > 0 ? "+" : ""}${f.value}`}
          />
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap mt-2 text-[9px] font-mono">
        {factors.map((f, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${f.color}`} />
            <span className="text-foreground-dim">{f.label}</span>
            <span className={f.text}>
              {f.value > 0 ? "+" : ""}
              {f.value}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

interface RegimeBarProps {
  score: number;
  label: string;
  compact?: boolean;
}

export function RegimeBar({ score, label, compact }: RegimeBarProps) {
  return (
    <div className="p-3 rounded-lg bg-surface/40 border border-border/40">
      <div className="flex items-center justify-between gap-2">
        <p className={cn(
          "font-mono uppercase tracking-wider text-foreground-muted",
          compact ? "text-[10px]" : "text-xs",
        )}>
          {label}
        </p>
        <span className={cn(
          "font-bold tabular-nums text-signal",
          compact ? "text-xl" : "text-3xl",
        )}>
          {score}
        </span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-surface/60 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
          className={cn(
            "h-full rounded-full",
            score >= 60 ? "bg-patience" : score <= 30 ? "bg-impatience" : "bg-amber-400",
          )}
        />
      </div>
    </div>
  );
}
