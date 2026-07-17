"use client";

/**
 * Proof ladder — conviction → on-chain proof → hire/query.
 * Outcome-oriented strip replacing chain-logo tourism.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Activity,
  Anchor,
  ShoppingBag,
  Network,
  CheckCircle2,
  MinusCircle,
  XCircle,
  ArrowRight,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CROO_STORE_LISTING_URL, crooStoreUrl } from "@/lib/croo-store";

export { CROO_STORE_LISTING_URL };

interface AnchorResult {
  adapter: string;
  status: "success" | "skipped" | "failed";
  explorerUrl?: string;
  error?: string;
}

interface ProofData {
  status: string;
  cycle: number;
  lastRunAt: number | null;
  portfolioValueUsd?: number;
  anchorResults?: AnchorResult[];
  capConnected: boolean;
  capPaidOrders: number;
  capOrdersServed: number;
  mcpQueriesServed: number;
  guidanceAction?: string;
  guidanceTop?: string;
}

function shortenSkipReason(error?: string): string | null {
  if (!error) return null;
  if (/balance too low/i.test(error)) return "Operator CSPR low — fund testnet faucet";
  if (/identical to the last/i.test(error)) return "Thesis unchanged — skipped duplicate";
  return error.length > 72 ? `${error.slice(0, 69)}…` : error;
}

function anchorStepSummary(results?: AnchorResult[]): { label: string; tone: "ok" | "warn" | "dim" } {
  const mantle = results?.find((r) => r.adapter === "mantle");
  const casper = results?.find((r) => r.adapter === "casper");

  if (mantle?.status === "success") {
    if (casper?.status === "success") return { label: "Mantle + Casper this cycle", tone: "ok" };
    if (casper?.status === "skipped") {
      const why = shortenSkipReason(casper.error);
      return { label: why ? `Mantle ✓ · Casper skipped (${why})` : "Mantle ✓ · Casper skipped", tone: "warn" };
    }
    if (casper?.status === "failed") return { label: "Mantle ✓ · Casper failed", tone: "warn" };
    return { label: "Mantle anchored this cycle", tone: "ok" };
  }

  if (casper?.status === "success") return { label: "Casper anchored this cycle", tone: "ok" };
  if (results?.some((r) => r.status === "failed")) return { label: "Anchor failed this cycle", tone: "warn" };
  return { label: "Awaiting next cycle anchor", tone: "dim" };
}

const STEPS = [
  { id: "live", icon: Activity, label: "Live on BSC" },
  { id: "proof", icon: Anchor, label: "Proof on-chain" },
  { id: "hire", icon: ShoppingBag, label: "Hire on CROO" },
  { id: "query", icon: Network, label: "Query via MCP" },
] as const;

export function ProofLadder({
  variant = "compact",
  className,
}: {
  variant?: "compact" | "full";
  className?: string;
}) {
  const [data, setData] = useState<ProofData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [statusRes, convRes, capRes, statsRes, previewRes] = await Promise.all([
          fetch("/api/agent/proxy?endpoint=status"),
          fetch("/api/agent/proxy?endpoint=conviction"),
          fetch("/api/agent/proxy?endpoint=cap/status"),
          fetch("/api/agent/proxy?endpoint=reputation/stats"),
          fetch("/api/agent/proxy?endpoint=signals/teaser"),
        ]);

        const status = statusRes.ok ? await statusRes.json() : null;
        const conviction = convRes.ok ? await convRes.json() : null;
        const cap = capRes.ok ? await capRes.json() : null;
        const stats = statsRes.ok ? await statsRes.json() : null;
        const preview = previewRes.ok ? await previewRes.json() : null;

        if (cancelled) return;

        setData({
          status: status?.status ?? "unknown",
          cycle: status?.cycle ?? 0,
          lastRunAt: status?.lastRunAt ?? null,
          portfolioValueUsd: status?.portfolio?.totalValueUsd,
          anchorResults: conviction?.anchorResults,
          capConnected: cap?.connected === true,
          capPaidOrders: stats?.providers?.cap?.paidQueries ?? 0,
          capOrdersServed: stats?.providers?.cap?.queriesServed ?? 0,
          mcpQueriesServed: stats?.providers?.x402?.queriesServed ?? stats?.queriesServed ?? 0,
          guidanceAction: preview?.guidance?.recommendedAction,
          guidanceTop: preview?.guidance?.topCandidate,
        });
      } catch {
        /* best-effort */
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const proof = anchorStepSummary(data?.anchorResults);
  const isLive = data?.status === "running" || data?.status === "idle";

  function stepDetail(id: (typeof STEPS)[number]["id"]): string {
    if (loading || !data) return "…";
    switch (id) {
      case "live":
        return data.cycle
          ? `Cycle #${data.cycle}${data.portfolioValueUsd != null ? ` · $${data.portfolioValueUsd.toFixed(0)} portfolio` : ""}`
          : "Connecting…";
      case "proof":
        return proof.label;
      case "hire":
        if (!data.capConnected) return "CAP offline on VPS";
        if (data.capPaidOrders > 0) {
          return `Store live · ${data.capPaidOrders} paid order${data.capPaidOrders === 1 ? "" : "s"}`;
        }
        return "Store live · $0.05 signals-live";
      case "query":
        return data.mcpQueriesServed > 0
          ? `${data.mcpQueriesServed} MCP queries served`
          : "x402 paywall ready · Casper settlement";
      default:
        return "";
    }
  }

  function stepTone(id: (typeof STEPS)[number]["id"]): "ok" | "warn" | "dim" {
    if (loading || !data) return "dim";
    switch (id) {
      case "live":
        return isLive ? "ok" : "dim";
      case "proof":
        return proof.tone;
      case "hire":
        if (!data.capConnected) return "warn";
        return data.capPaidOrders > 0 ? "ok" : "ok";
      case "query":
        return "ok";
      default:
        return "dim";
    }
  }

  const toneClass = {
    ok: "border-patience/30 bg-patience/5 text-patience",
    warn: "border-amber-500/30 bg-amber-500/5 text-amber-400",
    dim: "border-border/40 bg-surface/30 text-foreground-muted",
  };

  const iconForTone = (tone: "ok" | "warn" | "dim") => {
    if (tone === "ok") return CheckCircle2;
    if (tone === "warn") return MinusCircle;
    return XCircle;
  };

  if (variant === "compact") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn("space-y-2", className)}
      >
        <div className="flex flex-wrap items-center justify-center gap-2 text-[10px] font-mono">
          {STEPS.map((step, i) => {
            const tone = stepTone(step.id);
            const StatusIcon = iconForTone(tone);
            const href =
              step.id === "hire"
                ? crooStoreUrl("proof-ladder")
                : step.id === "proof"
                  ? "/agent#proof"
                  : step.id === "query"
                    ? "/agent#hire"
                    : "/agent";
            const external = step.id === "hire";

            const inner = (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors",
                  toneClass[tone],
                  !external && "hover:border-signal/40",
                )}
              >
                <step.icon className="w-3 h-3 shrink-0" />
                <span className="uppercase tracking-wider font-semibold">{step.label}</span>
                <StatusIcon className="w-3 h-3 opacity-80" />
              </span>
            );

            return (
              <span key={step.id} className="inline-flex items-center gap-2">
                {i > 0 && <ArrowRight className="w-3 h-3 text-foreground-dim" />}
                {external ? (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {inner}
                  </a>
                ) : (
                  <Link href={href}>{inner}</Link>
                )}
              </span>
            );
          })}
        </div>
        <p className="text-center text-[10px] font-mono text-foreground-dim max-w-lg mx-auto leading-relaxed">
          {loading ? "Loading proof ladder…" : stepDetail("proof")}
          {data?.guidanceAction && data.guidanceAction !== "wait" && (
            <>
              {" · "}
              <span className="text-foreground-muted">
                Latest hire payload: {data.guidanceAction}
                {data.guidanceTop ? ` · ${data.guidanceTop}` : ""}
              </span>
            </>
          )}
        </p>
      </motion.div>
    );
  }

  // full variant — #hire section
  return (
    <div className={cn("rounded-xl border border-border/50 bg-surface/25 overflow-hidden", className)}>
      <div className="px-4 py-3 border-b border-border/40">
        <p className="text-[10px] font-mono uppercase tracking-widest text-signal">Proof ladder</p>
        <p className="text-xs text-foreground-muted mt-0.5">
          Conviction on BSC → anchored receipt → hireable JSON on two settlement rails
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border/40">
        {STEPS.map((step) => {
          const tone = stepTone(step.id);
          const StatusIcon = iconForTone(tone);
          const detail = stepDetail(step.id);

          return (
            <div key={step.id} className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <step.icon className={cn("w-4 h-4", tone === "ok" ? "text-patience" : tone === "warn" ? "text-amber-400" : "text-foreground-dim")} />
                <span className="text-xs font-semibold text-foreground">{step.label}</span>
                <StatusIcon className={cn("w-3.5 h-3.5 ml-auto", tone === "ok" ? "text-patience" : tone === "warn" ? "text-amber-400" : "text-foreground-dim")} />
              </div>
              <p className="text-[10px] font-mono text-foreground-muted leading-relaxed">{detail}</p>
              {step.id === "hire" && data?.capConnected && (
                <a
                  href={crooStoreUrl("proof-ladder")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] font-mono text-[#65b3ae] hover:underline"
                >
                  Open Store listing
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {step.id === "proof" && data?.anchorResults?.find((r) => r.adapter === "mantle" && r.explorerUrl)?.explorerUrl && (
                <a
                  href={data.anchorResults.find((r) => r.adapter === "mantle")!.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] font-mono text-signal hover:underline"
                >
                  Latest Mantle tx
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {step.id === "query" && (
                <Link href="/agent#hire" className="inline-flex items-center gap-1 text-[10px] font-mono text-signal hover:underline">
                  MCP + CROO panels
                  <ArrowRight className="w-3 h-3" />
                </Link>
              )}
            </div>
          );
        })}
      </div>
      {data && data.capPaidOrders > 0 && (
        <div className="px-4 py-2 border-t border-border/40 bg-[#65b3ae]/5 text-[10px] font-mono text-[#65b3ae]">
          Verified Store commerce · {data.capPaidOrders} paid CAP order{data.capPaidOrders === 1 ? "" : "s"} fulfilled on this VPS
        </div>
      )}
    </div>
  );
}
