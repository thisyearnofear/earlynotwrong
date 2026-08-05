"use client";

/**
 * MCP · x402 reputation API card — query stats, per-tool pricing, and
 * copy-paste curls for judges and integrators.
 *
 * Extracted from src/app/agent/page.tsx.
 */

import { useEffect, useState } from "react";
import { Network, Copy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DOCS_MCP_INTEGRATION } from "@/lib/marketing-urls";
import {
  type ReputationStats,
  formatCspr,
  MCP_CONFIG_SNIPPET,
  MCP_CURL_FREE,
  MCP_CURL_PAID,
} from "@/components/agent/hire-card-shared";

export function ReputationApiCard() {
  const [stats, setStats] = useState<ReputationStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"config" | "free" | "paid" | null>(null);

  const x402 = stats?.providers?.x402 ?? (stats ? {
    queriesServed: stats.queriesServed,
    paidQueries: stats.paidQueries,
    feesCollectedBaseUnits: stats.feesCollectedBaseUnits,
    pricing: stats.pricing,
    byTool: stats.byTool,
  } : null);

  const copySnippet = (key: "config" | "free" | "paid", text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  useEffect(() => {
    let stale = false;
    async function load() {
      try {
        const res = await fetch("/api/agent/proxy?endpoint=reputation/stats");
        if (!res.ok) throw new Error(`stats returned ${res.status}`);
        const data = (await res.json()) as ReputationStats;
        if (!stale) setStats(data);
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

  return (
    <Card className="bg-surface/30 border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
          <Network className="w-3.5 h-3.5 text-signal" />
          MCP · x402
          <span className="ml-auto text-[10px] text-foreground-dim">
            Casper settlement
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="rounded-lg bg-surface/40 border border-border/40 p-3">
            <p className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider">Queries served</p>
            <p className="text-2xl font-semibold tabular-nums">
              {x402?.queriesServed ?? "—"}
            </p>
          </div>
          <div className="rounded-lg bg-surface/40 border border-border/40 p-3">
            <p className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider">Paid</p>
            <p className="text-2xl font-semibold tabular-nums text-signal">
              {x402?.paidQueries ?? "—"}
            </p>
          </div>
          <div className="rounded-lg bg-surface/40 border border-border/40 p-3">
            <p className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider">
              Fees collected{" "}
              <span className="text-foreground-dim normal-case">(testnet)</span>
            </p>
            <p className="text-2xl font-semibold tabular-nums text-patience">
              {formatCspr(x402?.feesCollectedBaseUnits)}
            </p>
          </div>
        </div>

        <p className="text-[11px] text-foreground-muted mb-3 leading-relaxed">
          Query over{" "}
          <span className="font-mono text-foreground">Model Context Protocol</span>{" "}
          with per-call <span className="font-mono text-foreground">x402</span>{" "}
          micropayments on Casper — same{" "}
          <span className="font-mono text-foreground">signals-live/v1.2</span> payload as CROO.{" "}
          <a
            href={DOCS_MCP_INTEGRATION}
            target="_blank"
            rel="noopener noreferrer"
            className="text-signal hover:underline"
          >
            Integration guide
          </a>
        </p>

        <div className="rounded-lg border border-signal/30 bg-signal/5 p-3 mb-4">
          <p className="text-[11px] font-mono text-foreground font-semibold">
            get_live_signals
            <span className="ml-2 text-signal">0.5 CSPR</span>
          </p>
          <p className="text-[10px] font-mono text-foreground-muted mt-0.5 leading-relaxed">
            signals-live/v1.2 — ranked candidates, macro gate, execution alignment,
            provenance bundle, and buyer <code className="text-foreground">guidance</code>{" "}
            action contract
          </p>
        </div>

        {/* Tools table */}
        <div className="rounded-lg border border-border/40 overflow-hidden">
          <table className="w-full text-[11px] font-mono">
            <thead className="bg-surface/40 text-foreground-muted text-[10px] uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Tool</th>
                <th className="text-left px-3 py-2 font-medium">Pricing</th>
                <th className="text-right px-3 py-2 font-medium">Calls</th>
              </tr>
            </thead>
            <tbody>
              {x402 &&
                Object.entries(x402.pricing).map(([tool, p]) => {
                  const called = x402.byTool[tool];
                  return (
                    <tr key={tool} className="border-t border-border/30">
                      <td className="px-3 py-2 text-foreground">{tool}</td>
                      <td className="px-3 py-2 text-foreground-muted">
                        {p.paid ? (
                          <span className="text-signal">{p.description}</span>
                        ) : (
                          <span>{p.description}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-foreground-muted tabular-nums">
                        {called?.calls ?? 0}
                        {called?.paidCalls ? (
                          <span className="text-signal"> ({called.paidCalls} paid)</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {/* Try it — copy-paste curls for judges and integrators */}
        <div className="mt-4 space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-wider text-foreground-dim">
            Try it now
          </p>

          <div className="rounded-lg border border-border/40 bg-surface/30 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-mono text-foreground">
                <span className="text-patience">Free</span> ·{" "}
                <code className="text-foreground-muted">get_agent_reputation</code>
              </p>
              <button
                type="button"
                onClick={() => copySnippet("free", MCP_CURL_FREE)}
                className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded bg-surface/60 border border-border/50 hover:border-signal/40 text-foreground-muted hover:text-signal transition-colors"
              >
                <Copy className="w-3 h-3" />
                {copied === "free" ? "Copied!" : "Copy curl"}
              </button>
            </div>
            <pre className="p-2 rounded bg-black/40 text-[9px] text-foreground-muted overflow-x-auto font-mono leading-relaxed">
              {MCP_CURL_FREE}
            </pre>
          </div>

          <div className="rounded-lg border border-signal/30 bg-signal/5 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-mono text-foreground">
                <span className="text-signal">Paid · 402</span> ·{" "}
                <code className="text-foreground-muted">get_live_signals</code>
              </p>
              <button
                type="button"
                onClick={() => copySnippet("paid", MCP_CURL_PAID)}
                className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded bg-surface/60 border border-border/50 hover:border-signal/40 text-foreground-muted hover:text-signal transition-colors"
              >
                <Copy className="w-3 h-3" />
                {copied === "paid" ? "Copied!" : "Copy curl"}
              </button>
            </div>
            <pre className="p-2 rounded bg-black/40 text-[9px] text-foreground-muted overflow-x-auto font-mono leading-relaxed">
              {MCP_CURL_PAID}
            </pre>
            <p className="text-[10px] font-mono text-foreground-dim leading-relaxed">
              Returns HTTP 402 + Casper x402 PaymentRequirements (0.5 CSPR). Response is{" "}
              <span className="font-mono text-foreground">signals-live/v1.2</span> — see the
              preview card above. Re-POST with a signed{" "}
              <code className="text-foreground-muted">X-PAYMENT</code> header to settle.
            </p>
          </div>
        </div>

        {/* Claude Desktop integration — promoted inline (was a collapsed
            <details>) since this is the single highest-conversion element
            on the page: a passing developer can grab this and try it. */}
        <div className="mt-4 rounded-lg border border-signal/30 bg-signal/5 p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-[11px] font-mono text-foreground">
              <span className="text-signal">▸</span> Add this MCP server to your AI agent
            </p>
            <button
              type="button"
              onClick={() => copySnippet("config", MCP_CONFIG_SNIPPET)}
              className="text-[10px] font-mono px-2 py-1 rounded bg-surface/60 border border-border/50 hover:border-signal/40 text-foreground-muted hover:text-signal transition-colors"
            >
              {copied === "config" ? "Copied!" : "Copy"}
            </button>
          </div>
          <pre className="p-3 rounded bg-black/50 text-foreground-muted text-[10px] overflow-x-auto font-mono leading-relaxed">{MCP_CONFIG_SNIPPET}</pre>
          <p className="text-[10px] text-foreground-muted mt-2 font-mono leading-relaxed">
            Works with Claude Desktop, Cursor, Continue.dev — or any MCP-compatible client.
          </p>
        </div>

        {error && (
          <p className="mt-3 text-[10px] text-impatience font-mono">stats: {error}</p>
        )}
      </CardContent>
    </Card>
  );
}
