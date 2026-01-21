"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  HistoricalAnalysis,
  getConvictionHistory,
  getScoreChange,
  getScoreEvolution,
} from "@/lib/history";
import { TrendingUp, TrendingDown, Minus, Clock, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScoreEvolutionChart } from "@/components/ui/score-evolution-chart";

interface HistoryPanelProps {
  currentAddress?: string;
  className?: string;
}

export function HistoryPanel({ currentAddress, className }: HistoryPanelProps) {
  const [history, setHistory] = useState<HistoricalAnalysis[]>([]);
  const [scoreChange, setScoreChange] = useState<ReturnType<
    typeof getScoreChange
  > | null>(null);

  useEffect(() => {
    setHistory(getConvictionHistory());
    if (currentAddress) {
      setScoreChange(getScoreChange(currentAddress));
    }
  }, [currentAddress]);

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  const getTrendIcon = (trend: "up" | "down" | "stable" | null) => {
    switch (trend) {
      case "up":
        return <TrendingUp className="w-4 h-4 text-patience" />;
      case "down":
        return <TrendingDown className="w-4 h-4 text-impatience" />;
      case "stable":
        return <Minus className="w-4 h-4 text-foreground-muted" />;
      default:
        return null;
    }
  };

  if (history.length === 0) {
    return null;
  }

  const recentHistory = history.slice(0, 5);

  const hasEvolution = currentAddress && getScoreEvolution(currentAddress).length >= 2;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Score Evolution Chart */}
      {currentAddress && hasEvolution && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-lg bg-surface/50 border border-border"
        >
          <div className="mb-3">
            <h4 className="text-xs font-mono text-foreground-muted uppercase tracking-wider mb-1">
              Score Evolution
            </h4>
          </div>
          <ScoreEvolutionChart address={currentAddress} />
        </motion.div>
      )}

      {/* Score Trend (if viewing same address) */}
      {scoreChange && scoreChange.previous !== null && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-lg bg-surface/50 border border-border"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {getTrendIcon(scoreChange.trend)}
              <span className="text-sm text-foreground-muted">
                Score Trend
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-foreground-muted">
                {scoreChange.previous.toFixed(1)}
              </span>
              <span className="text-foreground-dim">→</span>
              <span
                className={cn(
                  "text-sm font-semibold",
                  scoreChange.trend === "up"
                    ? "text-patience"
                    : scoreChange.trend === "down"
                      ? "text-impatience"
                      : "text-foreground"
                )}
              >
                {scoreChange.current.toFixed(1)}
              </span>
              {scoreChange.change !== null && (
                <span
                  className={cn(
                    "text-xs font-mono",
                    scoreChange.change > 0
                      ? "text-patience"
                      : scoreChange.change < 0
                        ? "text-impatience"
                        : "text-foreground-muted"
                  )}
                >
                  ({scoreChange.change > 0 ? "+" : ""}
                  {scoreChange.change.toFixed(1)})
                </span>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* Recent Analyses */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-mono text-foreground-muted uppercase tracking-wider">
            Recent Analyses
          </h3>
          <Clock className="w-3 h-3 text-foreground-dim" />
        </div>

        <div className="space-y-1">
          {recentHistory.map((analysis) => (
            <div
              key={analysis.id}
              className={cn(
                "flex items-center justify-between p-3 rounded-lg border transition-colors",
                analysis.address === currentAddress
                  ? "bg-signal/10 border-signal/30"
                  : "bg-surface/30 border-border hover:bg-surface/50"
              )}
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold",
                    analysis.metrics.score >= 70
                      ? "bg-patience/20 text-patience"
                      : analysis.metrics.score >= 40
                        ? "bg-signal/20 text-signal"
                        : "bg-impatience/20 text-impatience"
                  )}
                >
                  {Math.round(analysis.metrics.score)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono text-foreground">
                      {analysis.addressShort}
                    </span>
                    {analysis.isShowcase && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-signal/10 text-signal font-mono">
                        DEMO
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-foreground-muted">
                    <span>{analysis.chain.toUpperCase()}</span>
                    <span>•</span>
                    <span>{analysis.metrics.archetype}</span>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-foreground-muted">
                  {formatDate(analysis.timestamp)}
                </div>
                <div className="text-xs text-foreground-dim font-mono">
                  {analysis.timeHorizon}d horizon
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
