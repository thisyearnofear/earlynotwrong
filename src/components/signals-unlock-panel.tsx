"use client";

import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { HireSignalsCta } from "@/components/hire-signals-cta";
import type { SignalsLiveTeaser } from "@/lib/signals-teaser-types";

interface SignalsUnlockPanelProps {
  hiddenCount: number;
  teaser?: SignalsLiveTeaser | null;
  className?: string;
}

/** Overlay for ranked signals beyond the public teaser (top-1). */
export function SignalsUnlockPanel({
  hiddenCount,
  teaser,
  className,
}: SignalsUnlockPanelProps) {
  if (hiddenCount <= 0) return null;

  return (
    <div
      className={cn(
        "relative rounded-lg border border-border/40 overflow-hidden",
        className,
      )}
    >
      <div
        className="absolute inset-0 z-10 backdrop-blur-md bg-background/60 flex flex-col items-center justify-center p-4 text-center gap-2"
        aria-hidden
      >
        <Lock className="w-5 h-5 text-signal/80" />
        <p className="text-xs font-mono text-foreground-muted max-w-xs">
          {hiddenCount} more ranked signal{hiddenCount === 1 ? "" : "s"} + full
          breakdowns in paid{" "}
          <span className="text-foreground">signals-live/v1.1</span>
        </p>
      </div>
      <div className="p-6 opacity-30 pointer-events-none select-none">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-12 mb-2 rounded bg-surface/50 border border-border/30"
          />
        ))}
      </div>
      <div className="relative z-20 p-3 border-t border-border/30 bg-surface/30">
        <HireSignalsCta teaser={teaser} compact />
      </div>
    </div>
  );
}
