"use client";

/**
 * Multi-Chain Anchor Panel.
 *
 * Shows the agent's cross-chain anchoring status across Casper, Mantle, and
 * Aleo. Each chain gets equal visual weight — a 3-column status panel showing
 * the latest anchor for each, plus a rolling history list below.
 *
 * This is "Act 3" of the dashboard narrative — proof that the agent anchors
 * every conviction record on-chain across three chains, not just Casper.
 *
 * Data sources:
 *   - /conviction (anchorResults — latest cycle's per-adapter results)
 *   - /casper/anchors (rolling anchor history)
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ExternalLink,
  Anchor,
  Loader2,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Link2,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface AnchorResult {
  adapter: string;
  status: "success" | "skipped" | "failed";
  txHash?: string;
  blockNumber?: number;
  explorerUrl?: string;
  error?: string;
}

interface AnchorHistoryEntry {
  adapter: string;
  status: "success" | "skipped" | "failed";
  txHash?: string;
  explorerUrl?: string;
  timestamp: number;
  cycle: number;
}

interface ConvictionData {
  anchorResults?: AnchorResult[];
}

// ─── Chain metadata ─────────────────────────────────────────────────────────

const CHAINS = [
  {
    id: "casper",
    label: "Casper",
    role: "Public conviction registry",
    color: "text-signal",
    border: "border-signal/30",
    bg: "bg-signal/5",
  },
  {
    id: "mantle",
    label: "Mantle",
    role: "EVM verification",
    color: "text-blue-400",
    border: "border-blue-400/30",
    bg: "bg-blue-400/5",
  },
  {
    id: "aleo",
    label: "Aleo",
    role: "Privacy-preserving thesis proof",
    color: "text-purple-400",
    border: "border-purple-400/30",
    bg: "bg-purple-400/5",
  },
] as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(epochMs: number): string {
  const diff = Date.now() - epochMs;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function chainMeta(adapter: string) {
  return CHAINS.find((c) => c.id === adapter.toLowerCase()) ?? {
    id: adapter,
    label: adapter,
    role: "",
    color: "text-foreground-muted",
    border: "border-border/40",
    bg: "bg-surface/30",
  };
}

function statusIcon(status: string) {
  if (status === "success") return <CheckCircle2 className="w-3.5 h-3.5 text-patience shrink-0" />;
  if (status === "failed") return <XCircle className="w-3.5 h-3.5 text-impatience shrink-0" />;
  return <MinusCircle className="w-3.5 h-3.5 text-foreground-dim shrink-0" />;
}

function statusLabel(status: string): string {
  if (status === "success") return "Anchored";
  if (status === "failed") return "Failed";
  return "Skipped";
}

// ─── Component ──────────────────────────────────────────────────────────────

export function RecentAnchors() {
  const [conviction, setConviction] = useState<ConvictionData | null>(null);
  const [history, setHistory] = useState<AnchorHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      try {
        const [convRes, histRes] = await Promise.all([
          fetch("/api/agent/proxy?endpoint=conviction"),
          fetch("/api/agent/proxy?endpoint=casper/anchors"),
        ]);

        if (!cancelled && convRes.ok) {
          const data = (await convRes.json()) as ConvictionData;
          setConviction(data);
        }
        if (!cancelled && histRes.ok) {
          const data = (await histRes.json()) as { anchors: AnchorHistoryEntry[] };
          setHistory(data.anchors ?? []);
        }
      } catch {
        /* best-effort */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchAll();
    const id = setInterval(fetchAll, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Latest result per chain (from this cycle's anchorResults)
  const latestByChain = CHAINS.map((chain) => {
    const result = conviction?.anchorResults?.find(
      (r) => r.adapter.toLowerCase() === chain.id
    );
    return { ...chain, result };
  });

  const successCount = history.filter((a) => a.status === "success").length;

  return (
    <Card className="bg-surface/30 border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
          <Anchor className="w-3.5 h-3.5 text-signal" />
          On-Chain Anchor History
          <span className="ml-auto text-[10px] text-foreground-dim">
            {successCount > 0 ? `${successCount} anchored` : ""}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ── 3-column chain status panel ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {latestByChain.map((chain) => (
            <div
              key={chain.id}
              className={`rounded-xl border ${chain.border} ${chain.bg} p-3 space-y-2`}
            >
              <div className="flex items-center gap-2">
                <Link2 className={`w-3.5 h-3.5 ${chain.color}`} />
                <span className={`text-xs font-mono font-bold uppercase tracking-wider ${chain.color}`}>
                  {chain.label}
                </span>
                {chain.result && (
                  <span className="ml-auto">
                    {statusIcon(chain.result.status)}
                  </span>
                )}
              </div>
              <p className="text-[9px] font-mono text-foreground-dim leading-tight">
                {chain.role}
              </p>
              {chain.result ? (
                <div className="space-y-1 pt-1 border-t border-border/20">
                  <div className="flex items-center gap-1.5 text-[10px] font-mono">
                    <span className={chain.color}>{statusLabel(chain.result.status)}</span>
                    {chain.result.explorerUrl && (
                      <a
                        href={chain.result.explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto text-signal hover:underline inline-flex items-center gap-0.5"
                      >
                        tx
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </div>
                  {chain.result.txHash && (
                    <p className="text-[9px] font-mono text-foreground-dim break-all">
                      {chain.result.txHash.slice(0, 24)}…
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-[10px] font-mono text-foreground-dim pt-1 border-t border-border/20">
                  {loading ? "Loading…" : "No anchor this cycle"}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* ── Chain legend ── */}
        <div className="flex items-center gap-3 flex-wrap text-[9px] font-mono text-foreground-dim">
          <span className="uppercase tracking-wider">Why three chains:</span>
          <span className="text-signal">Casper = public registry</span>
          <span className="text-foreground-dim">·</span>
          <span className="text-blue-400">Mantle = EVM mirror</span>
          <span className="text-foreground-dim">·</span>
          <span className="text-purple-400">Aleo = privacy proof</span>
        </div>

        {/* ── Rolling history list ── */}
        {loading ? (
          <div className="flex items-center gap-2 text-[11px] font-mono text-foreground-muted py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-signal" />
            Loading anchor history…
          </div>
        ) : history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <Anchor className="w-6 h-6 text-foreground-dim mb-2 opacity-40" />
            <p className="text-[11px] font-mono text-foreground-muted">
              No anchors recorded yet
            </p>
            <p className="text-[10px] font-mono text-foreground-dim mt-1 max-w-xs">
              The agent anchors conviction records to Casper, Mantle, and Aleo at the end of each ~4h cycle. History will appear here after the next cycle completes.
            </p>
          </div>
        ) : (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            <p className="text-[9px] font-mono text-foreground-dim uppercase tracking-wider px-1 pb-1">
              Recent history
            </p>
            {history.slice(0, 15).map((anchor, i) => {
              const meta = chainMeta(anchor.adapter);
              return (
                <motion.div
                  key={`${anchor.cycle}-${anchor.adapter}-${i}`}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(i * 0.02, 0.2) }}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-surface/20 border border-border/20 hover:border-border/40 transition-colors"
                >
                  {statusIcon(anchor.status)}
                  <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${meta.color}`}>
                    {meta.label}
                  </span>
                  <span className="text-[10px] font-mono text-foreground-dim">
                    cycle {anchor.cycle}
                  </span>
                  <span className="text-[10px] font-mono text-foreground-dim ml-auto">
                    {timeAgo(anchor.timestamp)}
                  </span>
                  {anchor.explorerUrl && (
                    <a
                      href={anchor.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-signal hover:underline shrink-0"
                      title="View on explorer"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
