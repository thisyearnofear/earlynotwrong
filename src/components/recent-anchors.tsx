"use client";

/**
 * On-chain proof panel (Act 3).
 *
 * Shows **agent auto-anchor** status for Casper + Mantle with honest skip reasons.
 * Aleo is human-wallet path via /analyzer — not part of the agent's cycle loop.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
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
  ArrowRight,
} from "lucide-react";

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
  error?: string;
}

interface ConvictionData {
  anchorResults?: AnchorResult[];
}

/** Chains the autonomous agent anchors each cycle. */
const AGENT_CHAINS = [
  {
    id: "mantle",
    label: "Mantle",
    role: "EVM mirror · ERC-8004 registry",
    color: "text-blue-400",
    border: "border-blue-400/30",
    bg: "bg-blue-400/5",
  },
  {
    id: "casper",
    label: "Casper",
    role: "Public registry · MCP host chain",
    color: "text-signal",
    border: "border-signal/30",
    bg: "bg-signal/5",
  },
] as const;

function timeAgo(epochMs: number): string {
  const diff = Date.now() - epochMs;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function chainMeta(adapter: string) {
  return (
    AGENT_CHAINS.find((c) => c.id === adapter.toLowerCase()) ?? {
      id: adapter,
      label: adapter,
      role: "",
      color: "text-foreground-muted",
      border: "border-border/40",
      bg: "bg-surface/30",
    }
  );
}

function statusIcon(status: string) {
  if (status === "success") return <CheckCircle2 className="w-3.5 h-3.5 text-patience shrink-0" />;
  if (status === "failed") return <XCircle className="w-3.5 h-3.5 text-impatience shrink-0" />;
  return <MinusCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
}

function statusLabel(status: string): string {
  if (status === "success") return "Anchored";
  if (status === "failed") return "Failed";
  return "Skipped";
}

function formatSkipReason(error?: string): string | undefined {
  if (!error) return undefined;
  if (/balance too low/i.test(error)) return "Operator CSPR below minimum — fund testnet faucet";
  if (/identical to the last/i.test(error)) return "Thesis unchanged since last anchor";
  return error;
}

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
          setConviction((await convRes.json()) as ConvictionData);
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
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const latestByChain = AGENT_CHAINS.map((chain) => {
    const result = conviction?.anchorResults?.find(
      (r) => r.adapter.toLowerCase() === chain.id,
    );
    return { ...chain, result };
  });

  const successCount = history.filter((a) => a.status === "success").length;

  return (
    <Card className="bg-surface/30 border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
          <Anchor className="w-3.5 h-3.5 text-signal" />
          On-Chain Proof
          <span className="ml-auto text-[10px] text-foreground-dim font-normal normal-case">
            Agent auto-anchor · each cycle
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                  <span className="ml-auto">{statusIcon(chain.result.status)}</span>
                )}
              </div>
              <p className="text-[9px] font-mono text-foreground-dim leading-tight">{chain.role}</p>
              {chain.result ? (
                <div className="space-y-1.5 pt-1 border-t border-border/20">
                  <div className="flex items-center gap-1.5 text-[10px] font-mono">
                    <span className={chain.color}>{statusLabel(chain.result.status)}</span>
                    {chain.result.explorerUrl && (
                      <a
                        href={chain.result.explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto text-signal hover:underline inline-flex items-center gap-0.5"
                      >
                        explorer
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </div>
                  {(chain.result.status === "skipped" || chain.result.status === "failed") &&
                    chain.result.error && (
                      <p className="text-[9px] font-mono text-amber-400/90 leading-relaxed">
                        {formatSkipReason(chain.result.error)}
                      </p>
                    )}
                  {chain.result.txHash && chain.result.status === "success" && (
                    <p className="text-[9px] font-mono text-foreground-dim break-all">
                      {chain.result.txHash.slice(0, 28)}…
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-[10px] font-mono text-foreground-dim pt-1 border-t border-border/20">
                  {loading ? "Loading…" : "No result this cycle yet"}
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 rounded-lg border border-border/40 bg-surface/20 px-3 py-2 text-[10px] font-mono">
          <span className="text-purple-400 font-semibold uppercase tracking-wider shrink-0">Aleo</span>
          <span className="text-foreground-dim leading-relaxed">
            Privacy proof for <strong className="font-normal text-foreground-muted">your wallet</strong> — not
            the autonomous agent loop.
          </span>
          <Link
            href="/analyzer"
            className="inline-flex items-center gap-1 text-purple-400 hover:underline shrink-0 sm:ml-auto"
          >
            Wallet analyzer
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        <p className="text-[9px] font-mono text-foreground-dim leading-relaxed">
          Proof in paid deliveries bundles anchor history + explorer URLs under{" "}
          <span className="text-foreground-muted">provenance</span> — hire section below.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-[11px] font-mono text-foreground-muted py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-signal" />
            Loading anchor history…
          </div>
        ) : history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <Anchor className="w-6 h-6 text-foreground-dim mb-2 opacity-40" />
            <p className="text-[11px] font-mono text-foreground-muted">No anchor history yet</p>
            <p className="text-[10px] font-mono text-foreground-dim mt-1 max-w-sm">
              History appears after the agent completes its anchor step (~4h cycles).
            </p>
          </div>
        ) : (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            <p className="text-[9px] font-mono text-foreground-dim uppercase tracking-wider px-1 pb-1">
              Recent history · {successCount} successful
            </p>
            {history.slice(0, 12).map((anchor, i) => {
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
                  <span className="text-[10px] font-mono text-foreground-dim">cycle {anchor.cycle}</span>
                  <span className="text-[10px] font-mono text-foreground-dim ml-auto">{timeAgo(anchor.timestamp)}</span>
                  {anchor.explorerUrl && (
                    <a
                      href={anchor.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-signal hover:underline shrink-0"
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
