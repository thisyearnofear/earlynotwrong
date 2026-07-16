"use client";

/**
 * Recent Anchors — shows the agent's recent on-chain anchor history.
 *
 * Fetches from /api/agent/proxy?endpoint=casper/anchors and displays a
 * compact list of recent conviction records anchored across all chains
 * (Casper, Mantle, etc.). Each entry shows the chain, status, cycle,
 * timestamp, and an explorer link.
 *
 * This is "Act 3" of the dashboard narrative — proof that the agent is
 * anchoring in production, not just when a judge clicks the button.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExternalLink, Anchor, Loader2, CheckCircle2, XCircle, MinusCircle } from "lucide-react";

interface AnchorEntry {
  adapter: string;
  status: "success" | "skipped" | "failed";
  txHash?: string;
  explorerUrl?: string;
  timestamp: number;
  cycle: number;
}

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

function chainLabel(adapter: string): string {
  const map: Record<string, string> = {
    casper: "Casper",
    mantle: "Mantle",
    aleo: "Aleo",
  };
  return map[adapter.toLowerCase()] ?? adapter;
}

function chainColor(adapter: string): string {
  const map: Record<string, string> = {
    casper: "text-signal",
    mantle: "text-blue-400",
    aleo: "text-purple-400",
  };
  return map[adapter.toLowerCase()] ?? "text-foreground-muted";
}

export function RecentAnchors() {
  const [anchors, setAnchors] = useState<AnchorEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchAnchors = async () => {
      try {
        const res = await fetch("/api/agent/proxy?endpoint=casper/anchors");
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as { anchors: AnchorEntry[] };
        if (!cancelled) {
          setAnchors(data.anchors ?? []);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load anchors.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchAnchors();
    const id = setInterval(fetchAnchors, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const successCount = anchors.filter((a) => a.status === "success").length;

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
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-[11px] font-mono text-foreground-muted py-4">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-signal" />
            Loading anchor history…
          </div>
        ) : error ? (
          <p className="text-[11px] font-mono text-foreground-muted py-4">
            Anchor history unavailable.
          </p>
        ) : anchors.length === 0 ? (
          <p className="text-[11px] font-mono text-foreground-muted py-4">
            No anchors yet. The agent anchors conviction records at the end of each cycle.
          </p>
        ) : (
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {anchors.slice(0, 20).map((anchor, i) => (
              <motion.div
                key={`${anchor.cycle}-${anchor.adapter}-${i}`}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.3) }}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-surface/30 border border-border/30 hover:border-border/50 transition-colors"
              >
                {/* Status icon */}
                {anchor.status === "success" ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-patience shrink-0" />
                ) : anchor.status === "failed" ? (
                  <XCircle className="w-3.5 h-3.5 text-impatience shrink-0" />
                ) : (
                  <MinusCircle className="w-3.5 h-3.5 text-foreground-dim shrink-0" />
                )}

                {/* Chain label */}
                <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${chainColor(anchor.adapter)}`}>
                  {chainLabel(anchor.adapter)}
                </span>

                {/* Cycle + time */}
                <span className="text-[10px] font-mono text-foreground-dim">
                  cycle {anchor.cycle}
                </span>
                <span className="text-[10px] font-mono text-foreground-dim ml-auto">
                  {timeAgo(anchor.timestamp)}
                </span>

                {/* Explorer link */}
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
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
