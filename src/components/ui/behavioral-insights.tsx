"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Target, TrendingUp, Zap, Award, Coins } from "lucide-react";
import { ConvictionMetrics } from "@/lib/market";
import { UnifiedTrustScore } from "@/lib/services/trust-resolver";

interface BehavioralInsightsProps {
  metrics: ConvictionMetrics;
  positionCount: number;
  trust?: UnifiedTrustScore | null;
  className?: string;
}

interface BehaviorMetric {
  label: string;
  value: number;
  maxValue: number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bgColor: string;
  description: string;
}

export function BehavioralInsights({
  metrics,
  positionCount,
  trust,
  className,
}: BehavioralInsightsProps) {
  // Calculate derived behavioral metrics from what we have
  const panicSellRate = positionCount > 0 
    ? Math.round((metrics.earlyExits / positionCount) * 100) 
    : 0;
  
  const convictionWinRate = positionCount > 0
    ? Math.round((metrics.convictionWins / positionCount) * 100)
    : 0;
  
  // Consistency score approximation (inverse of early exits)
  const consistencyScore = Math.max(0, 100 - panicSellRate);
  
  // Diamond hands is hard to calculate without per-position data
  // We can infer it from high win rate + high upside capture + low early exits
  const diamondHandsScore = Math.round(
    (metrics.winRate * 0.3 + metrics.upsideCapture * 0.4 + (100 - panicSellRate) * 0.3)
  );

  const behaviorMetrics: BehaviorMetric[] = [
    {
      label: "Panic Sell Risk",
      value: panicSellRate,
      maxValue: 100,
      icon: Zap,
      color: panicSellRate > 50 ? "text-impatience" : panicSellRate > 25 ? "text-amber-400" : "text-patience",
      bgColor: panicSellRate > 50 ? "bg-impatience/10" : panicSellRate > 25 ? "bg-amber-400/10" : "bg-patience/10",
      description: `${panicSellRate}% of positions exited within 7 days`,
    },
    {
      label: "Conviction Power",
      value: convictionWinRate,
      maxValue: 100,
      icon: Target,
      color: convictionWinRate > 30 ? "text-patience" : convictionWinRate > 15 ? "text-amber-400" : "text-impatience",
      bgColor: convictionWinRate > 30 ? "bg-patience/10" : convictionWinRate > 15 ? "bg-amber-400/10" : "bg-impatience/10",
      description: `${convictionWinRate}% of positions achieved 50%+ gains`,
    },
    {
      label: "Diamond Hands",
      value: diamondHandsScore,
      maxValue: 100,
      icon: Activity,
      color: diamondHandsScore > 70 ? "text-patience" : diamondHandsScore > 40 ? "text-amber-400" : "text-impatience",
      bgColor: diamondHandsScore > 70 ? "bg-patience/10" : diamondHandsScore > 40 ? "bg-amber-400/10" : "bg-impatience/10",
      description: "Ability to hold through volatility",
    },
    {
      label: "Position Discipline",
      value: consistencyScore,
      maxValue: 100,
      icon: TrendingUp,
      color: consistencyScore > 70 ? "text-patience" : consistencyScore > 40 ? "text-amber-400" : "text-impatience",
      bgColor: consistencyScore > 70 ? "bg-patience/10" : consistencyScore > 40 ? "bg-amber-400/10" : "bg-impatience/10",
      description: "Consistency in trade execution and exits",
    },
  ];

  return (
    <Card className={cn("glass-panel border-border/50 bg-surface/40", className)}>
      <CardHeader>
        <CardTitle className="text-sm font-mono text-foreground-muted tracking-wider uppercase flex items-center gap-2">
          <Activity className="w-4 h-4 text-signal" />
          Behavioral Profile
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {behaviorMetrics.map((metric, index) => {
            const Icon = metric.icon;
            return (
              <motion.div
                key={metric.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className={cn(
                  "p-4 rounded-lg border border-border/30 transition-all hover:border-border/60 group",
                  metric.bgColor
                )}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="text-xs font-mono text-foreground-muted uppercase tracking-wider mb-1">
                      {metric.label}
                    </div>
                    <div className={cn("text-2xl font-bold font-mono", metric.color)}>
                      {metric.value}
                      <span className="text-sm text-foreground-muted ml-0.5">
                        /{metric.maxValue}
                      </span>
                    </div>
                  </div>
                  <div
                    className={cn(
                      "p-2 rounded-lg bg-surface/50 border border-border/30 group-hover:scale-110 transition-transform",
                      metric.color
                    )}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="mb-2">
                  <div className="h-1.5 w-full bg-surface/80 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(metric.value / metric.maxValue) * 100}%` }}
                      transition={{ duration: 0.8, delay: index * 0.1 + 0.2 }}
                      className={cn("h-full rounded-full", metric.color.replace("text-", "bg-"))}
                    />
                  </div>
                </div>

                {/* Description */}
                <p className="text-[10px] font-mono text-foreground-muted leading-relaxed">
                  {metric.description}
                </p>
              </motion.div>
            );
          })}
        </div>

        {/* FairScale-specific insights if available */}
        {trust?.providers.fairscale && (
          <div className="mt-6 p-4 rounded-lg bg-signal/5 border border-signal/20">
            <div className="flex items-center gap-2 mb-3">
              <Coins className="w-4 h-4 text-signal" />
              <h3 className="text-sm font-mono text-foreground-muted tracking-wider uppercase">
                FairScale Insights
              </h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-surface/20 border border-border/30">
                <div className="text-xs font-mono text-foreground-muted uppercase tracking-wider mb-1">
                  FairScore
                </div>
                <div className="text-lg font-bold text-signal">
                  {trust.providers.fairscale.fairscore.toFixed(1)}/10
                </div>
              </div>
              <div className="p-3 rounded-lg bg-surface/20 border border-border/30">
                <div className="text-xs font-mono text-foreground-muted uppercase tracking-wider mb-1">
                  Tier
                </div>
                <div className="text-lg font-bold text-signal capitalize">
                  {trust.providers.fairscale.tier}
                </div>
              </div>
            </div>
            <div className="mt-3">
              <div className="text-xs font-mono text-foreground-muted uppercase tracking-wider mb-2">
                Achievements
              </div>
              <div className="flex flex-wrap gap-2">
                {trust.providers.fairscale.badges.slice(0, 3).map((badge, idx) => (
                  <div
                    key={idx}
                    className="px-2 py-1 rounded-md bg-signal/10 border border-signal/20 text-[10px] font-mono text-signal capitalize"
                  >
                    {badge.label}
                  </div>
                ))}
                {trust.providers.fairscale.badges.length > 3 && (
                  <div className="px-2 py-1 rounded-md bg-surface/20 border border-border/30 text-[10px] font-mono text-foreground-muted">
                    +{trust.providers.fairscale.badges.length - 3} more
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Summary Insight */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="mt-6 p-3 rounded-lg bg-surface/30 border border-border/30"
        >
          <p className="text-xs text-foreground-muted font-mono leading-relaxed">
            <span className="text-signal font-semibold">Behavioral Summary:</span>{" "}
            {panicSellRate > 30
              ? "High panic sell tendency detected. Consider extending holding periods to capture more upside."
              : convictionWinRate > 30
              ? "Strong conviction discipline. You're letting winners run and capturing outsized gains."
              : consistencyScore > 70
              ? "Consistent execution across positions. Maintain your disciplined approach."
              : "Balanced trading behavior. Focus on improving conviction in high-quality setups."}
          </p>
        </motion.div>
      </CardContent>
    </Card>
  );
}
