"use client";

import { Anchor, ShoppingBag, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ElectricBorder } from "@/components/ui/electric-border";
import { guidanceActionClass } from "@/components/hire-signals-cta";
import type { BuyerRecommendedAction } from "@/lib/signals-teaser-types";
import { GUIDANCE_LABELS } from "@/lib/signals-teaser-types";
import type { AgentView } from "@/components/agent/agent-section-nav";

interface AnchorResult {
  adapter: string;
  status: "success" | "skipped" | "failed";
}

interface AgentLiveHooksProps {
  onNavigate: (view: AgentView) => void;
  anchorResults?: AnchorResult[];
  guidanceAction?: BuyerRecommendedAction;
  topCandidate?: string | null;
  className?: string;
}

/** Compact proof + hire hooks at the bottom of Live — fills the bento grid. */
export function AgentLiveHooks({
  onNavigate,
  anchorResults,
  guidanceAction,
  topCandidate,
  className,
}: AgentLiveHooksProps) {
  const results = anchorResults ?? [];
  const anchored = results.filter((r) => r.status === "success").length;
  const action = guidanceAction ?? "wait";

  return (
    <div className={cn("grid grid-cols-1 sm:grid-cols-2 gap-2", className)}>
      <ElectricBorder
        as="button"
        type="button"
        hint
        borderRadius={12}
        onClick={() => onNavigate("proof")}
        className="group w-full text-left rounded-xl active:scale-[0.995] transition-transform"
      >
        <div className="flex items-center gap-3 p-3 bg-surface/25 group-hover:bg-surface/40">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg border border-border/40 bg-surface/30 shrink-0">
          <Anchor className="w-3.5 h-3.5 text-signal" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-mono uppercase tracking-wider text-foreground-dim">
            On-chain proof
          </p>
          <p className="text-xs font-mono text-foreground-muted truncate mt-0.5">
            {anchored > 0
              ? `${anchored} chain${anchored === 1 ? "" : "s"} this cycle`
              : results.length > 0
                ? results.map((r) => `${r.adapter} ${r.status}`).join(" · ")
                : "Mantle + Casper anchors"}
          </p>
        </div>
        <ChevronRight className="w-4 h-4 text-foreground-dim group-hover:text-signal shrink-0" />
        </div>
      </ElectricBorder>

      <ElectricBorder
        as="button"
        type="button"
        hint
        borderRadius={12}
        color="var(--patience)"
        onClick={() => onNavigate("hire")}
        className="group w-full text-left rounded-xl active:scale-[0.995] transition-transform"
      >
        <div className="flex items-center gap-3 p-3 bg-surface/25 group-hover:bg-surface/40">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg border border-border/40 bg-surface/30 shrink-0">
          <ShoppingBag className="w-3.5 h-3.5 text-[#65b3ae]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-mono uppercase tracking-wider text-foreground-dim">
            Hire / query
          </p>
          <p className="text-xs font-mono mt-0.5 flex items-center gap-2 flex-wrap">
            <span className={cn("px-1.5 py-0.5 rounded-full border text-[10px]", guidanceActionClass(action))}>
              {GUIDANCE_LABELS[action]}
            </span>
            {topCandidate && (
              <span className="text-foreground-dim truncate">{topCandidate}</span>
            )}
          </p>
        </div>
        <ChevronRight className="w-4 h-4 text-foreground-dim group-hover:text-[#65b3ae] shrink-0" />
        </div>
      </ElectricBorder>
    </div>
  );
}
