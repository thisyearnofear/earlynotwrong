"use client";

import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { APP_CONFIG } from "@/lib/config";
import { ConvictionMetrics } from "@/lib/market";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

interface ScoreBreakdownDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metrics: ConvictionMetrics;
  positionCount: number;
  ethosScore?: number | null;
}

export function ScoreBreakdownDialog({ open, onOpenChange, metrics, positionCount, ethosScore }: ScoreBreakdownDialogProps) {
  const breakdown = useMemo(() => {
    const { weights, reputation } = APP_CONFIG;

    const winRatePoints = metrics.winRate * weights.winRate;
    const upsideCapturePoints = metrics.upsideCapture * weights.upsideCapture;
    const earlyExitRate = positionCount > 0 ? (metrics.earlyExits / positionCount) * 100 : 0;
    const earlyExitMitigationPoints = (100 - earlyExitRate) * weights.earlyExitMitigation;
    const holdingPeriodPoints = Math.min(metrics.avgHoldingPeriod / 30, 1) * (weights.holdingPeriod * 100);

    // Behavioral approximations (client-side mirror of server logic)
    const panicSellRate = earlyExitRate; // proxy
    const consistencyScore = Math.max(0, 100 - panicSellRate);
    // Infer diamond-hand-like behavior from existing metrics
    const diamondHandRate = Math.max(0, Math.min(100, Math.round((metrics.winRate * 0.3 + metrics.upsideCapture * 0.4 + (100 - panicSellRate) * 0.3))));

    const behaviorBonus = diamondHandRate * 0.05 + consistencyScore * 0.05;
    const behaviorPenalty = panicSellRate * 0.1;

    const baseScore = Math.max(0, Math.min(100,
      winRatePoints + upsideCapturePoints + earlyExitMitigationPoints + holdingPeriodPoints + behaviorBonus - behaviorPenalty
    ));

    let reputationMultiplier = 1.0;
    if (ethosScore && ethosScore > 0) {
      if (ethosScore >= reputation.ethosScoreThresholds.elite) reputationMultiplier = 1.5;
      else if (ethosScore >= reputation.ethosScoreThresholds.high) reputationMultiplier = 1.3;
      else if (ethosScore >= reputation.ethosScoreThresholds.medium) reputationMultiplier = 1.15;
      else if (ethosScore >= reputation.ethosScoreThresholds.low) reputationMultiplier = 1.05;
    }

    const finalScore = Math.min(100, baseScore * reputationMultiplier);

    return {
      components: [
        { label: "Win Rate", value: metrics.winRate, points: winRatePoints, color: "bg-patience" },
        { label: "Upside Capture", value: metrics.upsideCapture, points: upsideCapturePoints, color: "bg-signal" },
        { label: "Early Exit Mitigation", value: 100 - earlyExitRate, points: earlyExitMitigationPoints, color: "bg-amber-400" },
        { label: "Holding Period Factor", value: Math.min(metrics.avgHoldingPeriod / 30, 1) * 100, points: holdingPeriodPoints, color: "bg-foreground" },
      ],
      behavior: {
        diamondHandRate,
        panicSellRate,
        consistencyScore,
        bonus: behaviorBonus,
        penalty: behaviorPenalty,
      },
      baseScore,
      reputationMultiplier,
      finalScore,
    };
  }, [metrics, positionCount, ethosScore]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-wider">Score Breakdown</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Card className="bg-surface/40 border-border/50">
            <CardContent className="pt-4 space-y-3">
              {breakdown.components.map((c) => (
                <div key={c.label} className="space-y-1">
                  <div className="flex justify-between text-xs font-mono text-foreground-muted">
                    <span>{c.label}</span>
                    <span className="text-foreground">{c.points.toFixed(1)} pts</span>
                  </div>
                  <div className="h-1 w-full bg-surface rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, c.points).toFixed(1)}%` }}
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
                  <div className="text-foreground font-semibold">{breakdown.behavior.diamondHandRate}%</div>
                  <div className="text-foreground-muted">+{breakdown.behavior.bonus.toFixed(1)} pts</div>
                </div>
                <div className="p-2 rounded bg-amber-400/10 border border-amber-400/20">
                  <div className="text-foreground-muted">Consistency</div>
                  <div className="text-foreground font-semibold">{breakdown.behavior.consistencyScore}%</div>
                  <div className="text-foreground-muted">+{(breakdown.behavior.bonus/2).toFixed(1)} pts</div>
                </div>
                <div className="p-2 rounded bg-impatience/10 border border-impatience/20">
                  <div className="text-foreground-muted">Panic Sell</div>
                  <div className="text-foreground font-semibold">{breakdown.behavior.panicSellRate}%</div>
                  <div className="text-foreground-muted">-{breakdown.behavior.penalty.toFixed(1)} pts</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-surface/40 border-border/50">
            <CardContent className="pt-4 space-y-2 font-mono text-sm">
              <div className="flex justify-between"><span className="text-foreground-muted">Base Score</span><span className="text-foreground">{breakdown.baseScore.toFixed(1)}</span></div>
              <div className="flex justify-between"><span className="text-foreground-muted">Reputation Multiplier</span><span className="text-foreground">{breakdown.reputationMultiplier.toFixed(2)}x</span></div>
              <div className="flex justify-between text-lg font-bold"><span>Final Score</span><span>{breakdown.finalScore.toFixed(1)}</span></div>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
