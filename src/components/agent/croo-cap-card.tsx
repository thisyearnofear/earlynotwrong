"use client";

/**
 * CROO · CAP marketplace card — Store listing, USDC settlement stats, and
 * the requester-agent snippet for hiring signals-live on CROO.
 *
 * Extracted from src/app/agent/page.tsx.
 */

import { useEffect, useState } from "react";
import { DollarSign, ExternalLink, Copy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  type ReputationStats,
  type CapStatusResponse,
  type CapProviderStats,
  formatUsdc,
  CROO_STORE_URL,
  CROO_REQUESTER_REPO,
  CROO_CAP_REQUESTER_SNIPPET,
} from "@/components/agent/hire-card-shared";

export function CrooCapCard() {
  const [capStatus, setCapStatus] = useState<CapStatusResponse | null>(null);
  const [capStats, setCapStats] = useState<CapProviderStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let stale = false;
    async function load() {
      try {
        const [statusRes, statsRes] = await Promise.all([
          fetch("/api/agent/proxy?endpoint=cap/status"),
          fetch("/api/agent/proxy?endpoint=reputation/stats"),
        ]);
        if (!statusRes.ok) throw new Error(`cap/status returned ${statusRes.status}`);
        const statusData = (await statusRes.json()) as CapStatusResponse;
        if (!stale) setCapStatus(statusData);

        if (statsRes.ok) {
          const statsData = (await statsRes.json()) as ReputationStats;
          if (!stale) setCapStats(statsData.providers?.cap ?? null);
        }
      } catch (e) {
        if (!stale) setError(e instanceof Error ? e.message : "failed to load");
      }
    }
    load();
    const id = setInterval(load, 30_000);
    return () => {
      stale = true;
      clearInterval(id);
    };
  }, []);

  const signalsLive = capStats?.pricing["signals-live"];
  const signalsCalls = capStats?.byTool["signals-live"];

  return (
    <Card className="bg-surface/30 border-border/50 border-[#65b3ae]/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2 flex-wrap">
          <DollarSign className="w-3.5 h-3.5 text-[#65b3ae]" />
          CROO · CAP
          <span className="ml-auto text-[10px] text-foreground-dim">
            USDC on Base
          </span>
          {capStatus && (
            <span
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-mono uppercase tracking-wider border",
                capStatus.connected
                  ? "border-patience/30 bg-patience/10 text-patience"
                  : "border-impatience/30 bg-impatience/10 text-impatience",
              )}
            >
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  capStatus.connected ? "bg-patience" : "bg-impatience",
                )}
              />
              {capStatus.connected ? "Connected" : "Offline"}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="rounded-lg bg-surface/40 border border-border/40 p-3">
            <p className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider">Orders fulfilled</p>
            <p className="text-2xl font-semibold tabular-nums">
              {capStats?.queriesServed ?? "—"}
            </p>
          </div>
          <div className="rounded-lg bg-surface/40 border border-border/40 p-3">
            <p className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider">Paid</p>
            <p className="text-2xl font-semibold tabular-nums text-[#65b3ae]">
              {capStats?.paidQueries ?? "—"}
            </p>
          </div>
          <div className="rounded-lg bg-surface/40 border border-border/40 p-3">
            <p className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider">USDC earned</p>
            <p className="text-2xl font-semibold tabular-nums text-patience">
              {formatUsdc(capStats?.feesCollectedBaseUnits)}
            </p>
          </div>
        </div>

        <p className="text-[11px] text-foreground-muted mb-3 leading-relaxed">
          Hire this agent on the{" "}
          <a
            href={CROO_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[#65b3ae] hover:underline"
          >
            CROO Agent Store
          </a>
          . USDC on Base via CAP — identical{" "}
          <span className="font-mono text-foreground">signals-live/v1.2</span> JSON on every
          paid order.
        </p>

        {/* Store-listed premium SKU */}
        <div className="rounded-lg border border-[#65b3ae]/30 bg-[#65b3ae]/5 p-3 mb-4 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <p className="text-[11px] font-mono text-foreground font-semibold">
                signals-live
                <span className="ml-2 text-[#65b3ae]">$0.05 USDC</span>
                <span className="ml-2 text-[10px] text-foreground-dim">v1.2</span>
              </p>
              <p className="text-[10px] font-mono text-foreground-muted mt-0.5 leading-relaxed">
                Ranked signals + execution alignment + provenance — Requirements{" "}
                <code className="text-foreground">{`{}`}</code> only
              </p>
            </div>
            <a
              href={CROO_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border border-[#65b3ae]/40 text-[#65b3ae] hover:bg-[#65b3ae]/10 transition-colors"
            >
              Hire on CROO
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          {signalsLive && (
            <p className="text-[10px] font-mono text-foreground-dim">
              {signalsCalls?.calls ?? 0} fulfillment
              {(signalsCalls?.paidCalls ?? 0) > 0
                ? ` (${signalsCalls?.paidCalls} paid)`
                : ""}
              {" · "}
              maps to MCP <code className="text-foreground-muted">get_live_signals</code>
            </p>
          )}
        </div>

        {/* Requester snippet */}
        <div className="rounded-lg border border-border/40 bg-surface/30 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-mono text-foreground">
              <span className="text-[#65b3ae]">▸</span> Requester agent (CAP SDK)
            </p>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(CROO_CAP_REQUESTER_SNIPPET).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded bg-surface/60 border border-border/50 hover:border-[#65b3ae]/40 text-foreground-muted hover:text-[#65b3ae] transition-colors"
            >
              <Copy className="w-3 h-3" />
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <pre className="p-2 rounded bg-black/40 text-[9px] text-foreground-muted overflow-x-auto font-mono leading-relaxed max-h-48">
            {CROO_CAP_REQUESTER_SNIPPET}
          </pre>
          <p className="text-[10px] font-mono text-foreground-dim leading-relaxed">
            Use a <strong className="font-normal text-foreground">requester</strong> SDK key (not
            the provider key on this VPS). See{" "}
            <a href={CROO_REQUESTER_REPO} className="text-[#65b3ae] hover:underline" target="_blank" rel="noopener noreferrer">
              examples/croo-requester
            </a>
            {" "}for dry-run and live purchase.
          </p>
        </div>

        {error && (
          <p className="mt-3 text-[10px] text-impatience font-mono">cap: {error}</p>
        )}
      </CardContent>
    </Card>
  );
}
