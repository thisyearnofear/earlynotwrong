"use client";

import { AgentProofSummary } from "@/components/agent/agent-proof-summary";
import { RecentAnchors } from "@/components/recent-anchors";
import { cn } from "@/lib/utils";

interface AnchorResult {
  adapter: string;
  status: "success" | "skipped" | "failed";
  explorerUrl?: string;
  error?: string;
}

interface AgentProofPanelProps {
  anchorResults?: AnchorResult[];
  cycle: number;
  className?: string;
}

/** Merged proof ledger — summary strip + anchor history in one surface. */
export function AgentProofPanel({ anchorResults, cycle, className }: AgentProofPanelProps) {
  return (
    <div
      id="proof"
      className={cn(
        "rounded-xl border border-border/50 bg-surface/30 overflow-hidden",
        className,
      )}
    >
      <AgentProofSummary
        anchorResults={anchorResults}
        cycle={cycle}
        className="rounded-none border-0 border-b border-border/35 bg-transparent"
      />
      <RecentAnchors embedded />
    </div>
  );
}
