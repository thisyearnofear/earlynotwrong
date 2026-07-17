"use client";

import Link from "next/link";
import { DOCS_MCP_INTEGRATION } from "@/lib/marketing-urls";
import { ExternalLink, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  crooStoreUrl,
  HIRE_AGENT_HREF,
  SIGNALS_LIVE_PRICE_USDC,
} from "@/lib/croo-store";
import {
  GUIDANCE_LABELS,
  type BuyerRecommendedAction,
  type SignalsLiveTeaser,
} from "@/lib/signals-teaser-types";

export function guidanceActionClass(action: BuyerRecommendedAction): string {
  if (action === "evaluate") {
    return "border-patience/40 bg-patience/10 text-patience";
  }
  if (action === "skip_entries") {
    return "border-impatience/40 bg-impatience/10 text-impatience";
  }
  return "border-border/50 bg-surface/40 text-foreground-muted";
}

interface HireSignalsCtaProps {
  teaser?: SignalsLiveTeaser | null;
  compact?: boolean;
  className?: string;
  /** Optional human context, e.g. wallet score comparison */
  headline?: string;
}

export function HireSignalsCta({
  teaser,
  compact = false,
  className,
  headline,
}: HireSignalsCtaProps) {
  const action = teaser?.guidance.recommendedAction;
  const storeUrl = teaser?.unlock.crooStoreUrl ?? crooStoreUrl("hire-cta");

  return (
    <div
      className={cn(
        "rounded-xl border border-signal/25 bg-signal/5 p-4 space-y-3",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <ShoppingBag className="w-4 h-4 text-signal shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs font-mono uppercase tracking-wider text-foreground-muted">
            Live agent this cycle
          </p>
          {headline ? (
            <p className="text-sm text-foreground leading-relaxed">{headline}</p>
          ) : teaser ? (
            <p className="text-sm text-foreground leading-relaxed">
              {teaser.guidance.reason}
            </p>
          ) : (
            <p className="text-sm text-foreground-muted">
              Hire <span className="font-mono text-foreground">signals-live</span> for
              ranked conviction + on-chain provenance + guidance.
            </p>
          )}
        </div>
      </div>

      {teaser && action && (
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider border",
              guidanceActionClass(action),
            )}
          >
            {GUIDANCE_LABELS[action]}
            {teaser.guidance.topCandidate && action === "evaluate" && (
              <span className="normal-case">· {teaser.guidance.topCandidate}</span>
            )}
          </span>
          <span className="text-[10px] font-mono text-foreground-dim">
            cycle {teaser.freshness.cycle}
            {teaser.freshness.stale ? " · stale" : ""}
            {teaser.signalCount > 1 && ` · +${teaser.signalCount - 1} more locked`}
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <a
          href={storeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "inline-flex items-center gap-1.5 font-mono text-[11px] px-3 py-2 rounded-lg",
            "bg-[#65b3ae]/15 border border-[#65b3ae]/40 text-[#65b3ae]",
            "hover:bg-[#65b3ae]/25 transition-colors",
          )}
        >
          Hire on CROO · ${teaser?.unlock.priceUsdc ?? SIGNALS_LIVE_PRICE_USDC}
          <ExternalLink className="w-3 h-3" />
        </a>
        {!compact && (
          <Link
            href={HIRE_AGENT_HREF}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] px-3 py-2 rounded-lg border border-border/50 text-foreground-muted hover:text-signal hover:border-signal/30 transition-colors"
          >
            MCP + integration docs
          </Link>
        )}
        {!compact && (
          <a
            href={DOCS_MCP_INTEGRATION}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 font-mono text-[11px] px-3 py-2 rounded-lg border border-border/50 text-foreground-muted hover:text-signal hover:border-signal/30 transition-colors"
          >
            Full guide (GitHub)
          </a>
        )}
      </div>

      {!compact && (
        <p className="text-[10px] font-mono text-foreground-dim leading-relaxed">
          {teaser?.unlock.message ??
            "Full ranked signals, breakdowns, and provenance links — not shown on the free dashboard."}
        </p>
      )}
    </div>
  );
}
