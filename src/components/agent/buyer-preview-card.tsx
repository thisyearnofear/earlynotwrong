"use client";

/**
 * Buyer Preview card — shows the public signals-live teaser (guidance + top
 * symbol only) so a visitor can see what buyers get before paying.
 *
 * Extracted from src/app/agent/page.tsx.
 */

import { useEffect, useState } from "react";
import { Sparkles, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { guidanceActionClass } from "@/components/hire-signals-cta";
import { SIGNALS_SCHEMA_URL, SIGNALS_EXAMPLE_URL } from "@/lib/marketing-urls";
import {
  type SignalsLivePreview,
  GUIDANCE_LABELS_LOCAL,
  CROO_STORE_URL,
} from "@/components/agent/hire-card-shared";

export function BuyerPreviewCard() {
  const [preview, setPreview] = useState<SignalsLivePreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    async function load() {
      try {
        const res = await fetch("/api/agent/proxy?endpoint=signals/teaser");
        if (!res.ok) throw new Error(`signals/teaser returned ${res.status}`);
        const data = (await res.json()) as SignalsLivePreview;
        if (!stale) setPreview(data);
      } catch (e) {
        if (!stale) setError(e instanceof Error ? e.message : "failed to load");
      }
    }
    load();
    const id = setInterval(load, 60_000);
    return () => {
      stale = true;
      clearInterval(id);
    };
  }, []);

  const action = preview?.guidance.recommendedAction;
  const actionClass = action ? guidanceActionClass(action) : "";

  return (
    <Card className="bg-surface/30 border-border/50 border-signal/25">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2 flex-wrap">
          <Sparkles className="w-3.5 h-3.5 text-signal" />
          What buyers get
          <span className="ml-auto text-[10px] font-mono text-foreground-dim normal-case">
            signals-live/v1.2 · same on MCP + CROO
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-foreground-muted leading-relaxed">
          Public teaser — guidance + top symbol only. Paid{" "}
          <span className="font-mono text-foreground">signals-live/v1.2</span> adds full
          rankings, factor breakdowns, execution ledger (entries / skips / alignment), and
          on-chain provenance with explicit behavioral status.
        </p>

        {preview ? (
          <div className="rounded-lg border border-signal/30 bg-signal/5 p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {action && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider border",
                    actionClass,
                  )}
                >
                  {GUIDANCE_LABELS_LOCAL[action]}
                  {preview.guidance.topCandidate && action === "evaluate" && (
                    <span className="normal-case">· {preview.guidance.topCandidate}</span>
                  )}
                </span>
              )}
              <span className="text-[10px] font-mono text-foreground-dim">
                cycle {preview.freshness.cycle}
                {preview.freshness.stale ? " · stale" : " · fresh"}
              </span>
              {preview.provenance.reputation.dualChain && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-signal/30 text-signal">
                  dual-chain
                </span>
              )}
            </div>

            <p className="text-[11px] font-mono text-foreground leading-relaxed">
              {preview.guidance.reason}
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-mono">
              <div className="rounded bg-black/30 px-2 py-1.5">
                <p className="text-foreground-dim uppercase tracking-wider">Ranked</p>
                <p className="text-foreground tabular-nums">{preview.signalCount}</p>
              </div>
              <div className="rounded bg-black/30 px-2 py-1.5">
                <p className="text-foreground-dim uppercase tracking-wider">Behavior</p>
                <p className="text-foreground tabular-nums">
                  {preview.provenance.behavioral?.score ?? "—"}
                </p>
              </div>
              <div className="rounded bg-black/30 px-2 py-1.5">
                <p className="text-foreground-dim uppercase tracking-wider">Anchors</p>
                <p className="text-foreground tabular-nums">
                  {preview.provenance.reputation.totalAnchors}
                </p>
              </div>
              <div className="rounded bg-black/30 px-2 py-1.5">
                <p className="text-foreground-dim uppercase tracking-wider">Size ×</p>
                <p className="text-foreground tabular-nums">
                  {preview.guidance.sizeMultiplier}
                </p>
              </div>
            </div>
          </div>
        ) : error ? (
          <p className="text-[10px] text-impatience font-mono">preview: {error}</p>
        ) : (
          <Skeleton className="h-24 w-full rounded-lg" />
        )}

        <div className="flex flex-wrap gap-2">
          <a
            href={preview?.meta.schemaUrl ?? SIGNALS_SCHEMA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border border-border/50 hover:border-signal/40 text-foreground-muted hover:text-signal transition-colors"
          >
            JSON Schema
            <ExternalLink className="w-3 h-3" />
          </a>
          <a
            href={SIGNALS_EXAMPLE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border border-border/50 hover:border-signal/40 text-foreground-muted hover:text-signal transition-colors"
          >
            Example response
            <ExternalLink className="w-3 h-3" />
          </a>
          <a
            href={preview?.unlock.crooStoreUrl ?? CROO_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border border-[#65b3ae]/40 hover:bg-[#65b3ae]/10 text-[#65b3ae] transition-colors"
          >
            Hire on CROO · ${preview?.unlock.priceUsdc ?? "0.05"}
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        <p className="text-[10px] font-mono text-foreground-dim leading-relaxed">
          {preview?.unlock.message}
        </p>
      </CardContent>
    </Card>
  );
}
