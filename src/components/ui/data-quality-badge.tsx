"use client";

import { cn } from "@/lib/utils";

interface DataQualityBadgeProps {
  symbolRate: number;
  priceRate: number;
  avgTradeSize: number;
  className?: string;
}

function qualityColor(percent: number) {
  if (percent >= 90) return { dot: "bg-patience", text: "text-patience" };
  if (percent >= 70) return { dot: "bg-amber-400", text: "text-amber-400" };
  return { dot: "bg-impatience", text: "text-impatience" };
}

export function DataQualityBadge({ symbolRate, priceRate, avgTradeSize, className }: DataQualityBadgeProps) {
  const overall = Math.round(symbolRate * 0.4 + priceRate * 0.6);
  const color = qualityColor(overall);

  return (
    <div className={cn("inline-flex items-center gap-2 px-2 py-1 rounded-full border border-border/50 bg-surface/50", className)}>
      <span className={cn("w-2 h-2 rounded-full", color.dot)} />
      <span className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider">Data Quality</span>
      <span className={cn("text-[10px] font-mono", color.text)}>{overall}%</span>
    </div>
  );
}
