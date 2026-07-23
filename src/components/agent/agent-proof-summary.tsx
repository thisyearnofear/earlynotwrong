"use client";

import { Anchor, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface AnchorResult {
  adapter: string;
  status: "success" | "skipped" | "failed";
  explorerUrl?: string;
  error?: string;
}

interface AgentProofSummaryProps {
  anchorResults?: AnchorResult[];
  cycle: number;
  className?: string;
}

function chainLabel(adapter: string, status: AnchorResult["status"]): string {
  const name = adapter.charAt(0).toUpperCase() + adapter.slice(1);
  if (status === "success") return `${name} ✓`;
  if (status === "skipped") return `${name} skipped`;
  return `${name} failed`;
}

/** One-line proof status for the Proof tab header in simple view. */
export function AgentProofSummary({ anchorResults, cycle, className }: AgentProofSummaryProps) {
  const results = anchorResults ?? [];
  const successCount = results.filter((r) => r.status === "success").length;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 p-3 rounded-xl",
        "border border-border/50 bg-surface/30 text-[11px] font-mono",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-foreground-muted">
        <Anchor className="w-3.5 h-3.5 text-signal shrink-0" />
        <span>
          Cycle <span className="text-foreground font-semibold">#{cycle}</span>
          {" · "}
          {successCount > 0
            ? `${successCount} chain${successCount === 1 ? "" : "s"} anchored`
            : "Awaiting anchor this cycle"}
        </span>
      </div>
      {results.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {results.map((r) => (
            <span
              key={r.adapter}
              className={cn(
                r.status === "success"
                  ? "text-signal"
                  : r.status === "skipped"
                    ? "text-foreground-dim"
                    : "text-impatience",
              )}
            >
              {chainLabel(r.adapter, r.status)}
              {r.status === "success" && r.explorerUrl && (
                <a
                  href={r.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-1 inline-flex align-middle text-signal hover:underline"
                  aria-label={`View ${r.adapter} anchor`}
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
