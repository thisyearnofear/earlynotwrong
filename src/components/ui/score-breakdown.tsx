"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { ConvictionMetrics } from "@/lib/market";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

interface ScoreBreakdownDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metrics: ConvictionMetrics;
}

/**
 * Renders the server-computed score breakdown verbatim — the components shown
 * here are exactly the numbers that produced `metrics.score`, not a
 * client-side approximation. Older cached analyses (no breakdown attached)
 * get an honest "re-scan to see the breakdown" state instead of a recompute
 * that could contradict the headline score.
 */
export function ScoreBreakdownDialog({ open, onOpenChange, metrics }: ScoreBreakdownDialogProps) {
  const b = metrics.breakdown;

  const components = b
    ? [
        { label: "Win Rate", value: b.winRate.value, points: b.winRate.points, color: "bg-patience" },
        { label: "Upside Capture", value: b.upsideCapture.value, points: b.upsideCapture.points, color: "bg-signal" },
        { label: "Early Exit Mitigation", value: b.earlyExitMitigation.value, points: b.earlyExitMitigation.points, color: "bg-impatience" },
        { label: "Holding Period Factor", value: b.holdingPeriod.value, points: b.holdingPeriod.points, color: "bg-foreground" },
      ]
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-wider">Score Breakdown</DialogTitle>
        </DialogHeader>
        {!b ? (
          <div className="py-8 text-center space-y-2">
            <p className="text-sm text-foreground-muted">
              This analysis was cached before component breakdowns were stored.
            </p>
            <p className="text-xs font-mono text-foreground-dim uppercase tracking-wider">
              Run a fresh scan to see how the score was built.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <Card className="bg-surface/40 border-border/50">
              <CardContent className="pt-4 space-y-3">
                {components.map((c) => (
                  <div key={c.label} className="space-y-1">
                    <div className="flex justify-between text-xs font-mono text-foreground-muted">
                      <span>{c.label}</span>
                      <span className="text-foreground">{c.points.toFixed(1)} pts</span>
                    </div>
                    <div className="h-1 w-full bg-surface rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.max(0, Math.min(100, c.points)).toFixed(1)}%` }}
                        className={cn("h-full", c.color)}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="bg-surface/40 border-border/50">
              <CardContent className="pt-4 space-y-2">
                <div className="text-xs font-mono text-foreground-muted uppercase tracking-wider">Behavioral Adjustments</div>
                <div className="grid grid-cols-3 gap-3 text-[11px] font-mono">
                  <div className="p-2 rounded bg-patience/10 border border-patience/20">
                    <div className="text-foreground-muted">Diamond Hands</div>
                    <div className="text-foreground font-semibold">{b.diamondHands.value}%</div>
                    <div className="text-foreground-muted">+{b.diamondHands.points.toFixed(1)} pts</div>
                  </div>
                  <div className="p-2 rounded bg-signal/10 border border-signal/20">
                    <div className="text-foreground-muted">Consistency</div>
                    <div className="text-foreground font-semibold">{b.consistency.value}%</div>
                    <div className="text-foreground-muted">+{b.consistency.points.toFixed(1)} pts</div>
                  </div>
                  <div className="p-2 rounded bg-impatience/10 border border-impatience/20">
                    <div className="text-foreground-muted">Panic Sell</div>
                    <div className="text-foreground font-semibold">{b.panicSell.value}%</div>
                    <div className="text-foreground-muted">{b.panicSell.points.toFixed(1)} pts</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-surface/40 border-border/50">
              <CardContent className="pt-4 space-y-2 font-mono text-sm">
                <div className="flex justify-between text-lg font-bold">
                  <span>Conviction Score</span>
                  <span>{metrics.score.toFixed(1)}</span>
                </div>
                <p className="text-[11px] text-foreground-muted font-sans leading-relaxed">
                  Purely behavioral — how you trade, not who vouches for you.
                  Social credibility (Ethos) is shown separately and never
                  multiplies this score.
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
