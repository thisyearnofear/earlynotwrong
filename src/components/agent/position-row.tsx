"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export interface LedgerPosition {
  symbol: string;
  amountUsd: number;
  entryCycle: number;
  cyclesHeld: number;
  maxUnderwaterPercent: number;
  stuck?: boolean;
  failedExitAttempts?: number;
}

export interface PositionVerdict {
  action: "HOLD" | "EXIT_STOP" | "EXIT_TRAIL";
  unrealizedPnLPercent: number;
  heldThroughDrawdown: boolean;
  reason: string;
}

export interface EntrySignal {
  symbol: string;
  score: number;
  rationale: string;
}

interface PositionRowProps {
  position: LedgerPosition;
  verdict?: PositionVerdict;
  entrySignal?: EntrySignal;
  /** Simple view: tap to expand thesis + metrics. Demo: always expanded. */
  expandable?: boolean;
  defaultExpanded?: boolean;
}

export function PositionRow({
  position: p,
  verdict,
  entrySignal,
  expandable = false,
  defaultExpanded = false,
}: PositionRowProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const currentPnl = verdict?.unrealizedPnLPercent ?? 0;
  const showDetails = !expandable || expanded;

  const actionLabel =
    verdict?.action === "HOLD"
      ? "Holding"
      : verdict?.action === "EXIT_TRAIL"
        ? "Trailing"
        : verdict?.action === "EXIT_STOP"
          ? "Stopped"
          : null;

  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">{p.symbol}</span>
            {actionLabel && verdict && (
              <span
                className={cn(
                  "text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full border",
                  verdict.action === "HOLD"
                    ? "border-patience/30 bg-patience/10 text-patience"
                    : verdict.action === "EXIT_TRAIL"
                      ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-400"
                      : "border-impatience/30 bg-impatience/10 text-impatience",
                )}
              >
                {actionLabel}
              </span>
            )}
            {verdict?.heldThroughDrawdown && (
              <span className="text-[10px] font-mono text-signal">◆ early, not wrong</span>
            )}
            {p.stuck && (
              <span
                className="text-[10px] font-mono px-1.5 py-0.5 rounded-full border border-impatience/30 bg-impatience/10 text-impatience"
                title={`Unexitable — ${p.failedExitAttempts ?? 0} failed exit attempts`}
              >
                STUCK
              </span>
            )}
          </div>
          <p className="text-[10px] font-mono text-foreground-muted mt-1">
            ${p.amountUsd.toFixed(0)} · {p.cyclesHeld} cycle{p.cyclesHeld === 1 ? "" : "s"}
            {!expandable && (
              <>
                {" · "}
                <span className="text-foreground-dim">
                  −{p.maxUnderwaterPercent.toFixed(1)}% worst dip
                </span>
                {entrySignal && (
                  <>
                    {" · "}
                    <span className="text-signal" title={entrySignal.rationale}>
                      scored {entrySignal.score}
                    </span>
                  </>
                )}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={cn(
              "text-sm font-bold tabular-nums",
              currentPnl >= 0 ? "text-patience" : "text-impatience",
            )}
          >
            {currentPnl >= 0 ? "+" : ""}
            {currentPnl.toFixed(1)}%
          </span>
          {expandable && (
            <ChevronDown
              className={cn(
                "w-4 h-4 text-foreground-dim transition-transform duration-200",
                expanded && "rotate-180",
              )}
              style={{ transitionTimingFunction: "var(--ease-out)" }}
            />
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {showDetails && (verdict?.reason || expandable) && (
          <motion.div
            key="details"
            initial={expandable ? { opacity: 0, y: -4 } : false}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
          >
            <div className={cn("space-y-2", expandable ? "pt-2.5 mt-2.5 border-t border-border/30" : "mt-1.5")}>
              {expandable && (
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] font-mono">
                  <div>
                    <span className="text-foreground-dim">Entry cycle</span>
                    <p className="text-foreground">#{p.entryCycle}</p>
                  </div>
                  <div>
                    <span className="text-foreground-dim">Worst dip</span>
                    <p className="text-impatience">−{p.maxUnderwaterPercent.toFixed(1)}%</p>
                  </div>
                  {entrySignal && (
                    <>
                      <div>
                        <span className="text-foreground-dim">Entry score</span>
                        <p className="text-signal">{entrySignal.score}</p>
                      </div>
                      <div className="col-span-2">
                        <span className="text-foreground-dim">Rationale</span>
                        <p className="text-foreground-muted leading-relaxed">{entrySignal.rationale}</p>
                      </div>
                    </>
                  )}
                </div>
              )}
              {verdict?.reason && (
                <p className="text-[10px] font-mono text-foreground-dim leading-relaxed">
                  {verdict.reason}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  if (expandable) {
    return (
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={cn(
          "w-full text-left p-2.5 rounded-lg bg-surface/40 border border-border/40",
          "hover:border-patience/20 transition-colors duration-200",
          "active:scale-[0.995] motion-reduce:active:scale-100",
          expanded && "border-patience/25 bg-surface/50",
        )}
      >
        {inner}
      </button>
    );
  }

  return (
    <div className="p-2.5 rounded-lg bg-surface/40 border border-border/40 hover:border-patience/20 transition-colors">
      {inner}
    </div>
  );
}
