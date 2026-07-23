"use client";

import { ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import { guidanceActionClass } from "@/components/hire-signals-cta";
import type { BuyerRecommendedAction } from "@/lib/signals-teaser-types";
import { GUIDANCE_LABELS } from "@/lib/signals-teaser-types";

interface AgentHireSummaryProps {
  guidanceAction?: BuyerRecommendedAction;
  topCandidate?: string | null;
  className?: string;
}

/** One-line buyer guidance for the Hire tab in simple view. */
export function AgentHireSummary({
  guidanceAction,
  topCandidate,
  className,
}: AgentHireSummaryProps) {
  const action = guidanceAction ?? "wait";
  const label = GUIDANCE_LABELS[action];

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 p-3 rounded-xl",
        "border border-border/50 bg-surface/30 text-[11px] font-mono",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-foreground-muted">
        <ShoppingBag className="w-3.5 h-3.5 text-[#65b3ae] shrink-0" />
        <span>Buyer guidance</span>
      </div>
      <span className={cn("px-2 py-0.5 rounded-full border text-[10px]", guidanceActionClass(action))}>
        {label}
      </span>
      {topCandidate && (
        <span className="text-foreground-dim">
          top candidate <span className="text-signal">{topCandidate}</span>
        </span>
      )}
      <span className="text-foreground-dim ml-auto">MCP x402 · CROO $0.05</span>
    </div>
  );
}
