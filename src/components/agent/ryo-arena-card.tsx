"use client";

/**
 * RYO Arena card — the RYO-CHAN practice agent's surface in the /agent
 * Proof view, mirroring the Options/Delphi arena cards.
 *
 * Unlike the other venues, the data here is file-backed: the practice
 * runner persists agent/data/ryo-state.json + ryo-ledger.jsonl, so the
 * card renders the actual hash-chained reasoning trail — every BUY/HOLD/
 * EXIT/SKIP verdict with its factor rationale and chain link — plus live
 * chain-integrity status recomputed on every fetch.
 *
 * Design rules honored (same as the other arena cards):
 *  - Lazy load on mount, manual refresh — never blocks the critical path
 *  - Real data only, honest empty states (hasData=false before the first cycle)
 *  - No fabricated verdicts or chain state.
 */

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Activity, RefreshCw, AlertTriangle, ShieldCheck, ShieldAlert, Link2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fetchRyoStatus, type RyoStatus, type RyoVerdict } from "@/lib/agent-client";

function fmtUsd(n: number, digits = 0): string {
  if (!isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 })}`;
}

const ACTION_STYLE: Record<RyoVerdict["action"], { label: string; cls: string }> = {
  BUY: { label: "BUY", cls: "text-patience border-patience/40 bg-patience/10" },
  HOLD: { label: "HOLD", cls: "text-foreground-muted border-border/40 bg-surface/20" },
  EXIT: { label: "EXIT", cls: "text-impatience border-impatience/40 bg-impatience/10" },
  SKIP: { label: "SKIP", cls: "text-[#e8b64c] border-[#e8b64c]/40 bg-[#e8b64c]/10" },
  THESIS: { label: "THESIS", cls: "text-[#a78bfa] border-[#a78bfa]/40 bg-[#a78bfa]/10" },
  ANCHOR: { label: "ANCHOR", cls: "text-[#38bdf8] border-[#38bdf8]/40 bg-[#38bdf8]/10" },
};

function VerdictRow({ v }: { v: RyoVerdict }) {
  const a = ACTION_STYLE[v.action] ?? ACTION_STYLE.HOLD;
  return (
    <div className="flex items-start gap-2 rounded-md border border-border/20 bg-surface/10 px-2 py-1.5">
      <span className={cn("shrink-0 rounded border px-1 py-0.5 text-[8px] font-mono uppercase", a.cls)}>{a.label}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] text-foreground">{v.symbol}</span>
          {v.conviction > 0 && <span className="font-mono text-[9px] text-patience">{v.conviction}/100</span>}
          {v.sizeUsd !== undefined && <span className="font-mono text-[9px] text-foreground-dim">{fmtUsd(v.sizeUsd)}</span>}
          <span className="ml-auto font-mono text-[8px] text-foreground-dim">#{v.hash.slice(0, 8)}</span>
        </div>
        <p className="font-mono text-[9px] text-foreground-muted leading-snug truncate" title={v.reason}>
          {v.reason}
        </p>
      </div>
    </div>
  );
}

export function RyoArenaCard() {
  const [status, setStatus] = useState<RyoStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const s = await fetchRyoStatus();
    setStatus(s);
    setLoaded(true);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await fetchRyoStatus();
      if (!cancelled) {
        setStatus(s);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card className="bg-surface/30 border-border/50 border-[#e8b64c]/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
          <Link2 className="w-3.5 h-3.5 text-[#e8b64c]" />
          RYO Arena
          <span className="ml-1 text-[9px] font-mono normal-case tracking-normal text-foreground-dim">
            RYO-CHAN · paper · hackathon
          </span>
          {status && status.hasData && (
            <span className="ml-auto text-[9px] font-mono normal-case tracking-normal text-foreground-dim">
              cycle {status.cycle}
            </span>
          )}
          <button
            onClick={load}
            disabled={loading}
            className={cn(
              "inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border border-border/50 hover:border-[#e8b64c]/40 text-foreground-muted hover:text-[#e8b64c] transition-colors disabled:opacity-50",
              !status && "ml-auto",
            )}
            aria-label="Refresh RYO status"
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            Refresh
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-foreground-muted leading-relaxed">
          A <span className="text-foreground">fourth venue</span>: the same harness runs as a
          conviction-native practice agent on{" "}
          <span className="text-foreground">RYO-CHAN&apos;s research tools</span>. Every
          decision — including refusals — lands in a{" "}
          <span className="text-foreground">hash-chained reasoning ledger</span> recomputed
          on each fetch: the trail you see is the trail the agent made.
        </p>

        {/* Unreachable / fetch failed */}
        {loaded && !status && (
          <div className="flex items-start gap-2 rounded-lg border border-impatience/30 bg-impatience/5 p-2.5">
            <AlertTriangle className="w-3.5 h-3.5 text-impatience shrink-0 mt-0.5" />
            <p className="text-[11px] text-foreground-muted leading-relaxed">
              RYO status unavailable — no agent endpoint answered. The practice
              runner writes state to disk; serve it with{" "}
              <span className="font-mono text-foreground">npx tsx agent/ryo/serve.ts</span>.
            </p>
          </div>
        )}

        {/* Honest empty state: runner hasn't completed a cycle yet */}
        {status && !status.hasData && (
          <div className="flex flex-col items-center justify-center py-6 text-foreground-muted">
            <Activity className="w-6 h-6 text-foreground-dim mb-2" />
            <p className="text-xs font-mono">No RYO activity yet</p>
            <p className="text-[10px] font-mono text-foreground-dim mt-1 text-center max-w-sm leading-relaxed">
              The RYO-CHAN practice agent hasn&apos;t completed a cycle. When it does,
              scored candidates, safety vetoes, paper positions, and the chain
              integrity of the reasoning ledger appear here.
            </p>
          </div>
        )}

        {status && status.hasData && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="space-y-3"
          >
            {/* Stats */}
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { label: "Cash", value: fmtUsd(status.cashUsd) },
                { label: "Positions", value: String(status.positions.length) },
                { label: "Verdicts", value: String(status.chain.entries) },
                { label: "Vetoes", value: String(status.stats.vetoes) },
              ].map((m) => (
                <div key={m.label} className="rounded-lg border border-border/30 bg-surface/20 px-1 py-2">
                  <p className="text-sm font-mono tabular-nums text-foreground">{m.value}</p>
                  <p className="text-[9px] font-mono uppercase tracking-wider text-foreground-dim mt-0.5">{m.label}</p>
                </div>
              ))}
            </div>

            {/* Chain integrity — the differentiator, rendered not described */}
            <div
              className={cn(
                "rounded-lg border px-2.5 py-2",
                status.chain.intact ? "border-patience/30 bg-patience/5" : "border-impatience/40 bg-impatience/10",
              )}
            >
              <div className="flex items-center gap-2">
                {status.chain.intact ? (
                  <ShieldCheck className="w-3.5 h-3.5 text-patience shrink-0" />
                ) : (
                  <ShieldAlert className="w-3.5 h-3.5 text-impatience shrink-0" />
                )}
                <span className={cn("text-[10px] font-mono", status.chain.intact ? "text-patience" : "text-impatience")}>
                  chain {status.chain.intact ? "intact" : "BROKEN"} · {status.chain.entries} entries
                </span>
                <span className="ml-auto text-[8px] font-mono text-foreground-dim">
                  head #{status.chain.headHash?.slice(0, 12) ?? "—"}
                </span>
              </div>
              {/* Visual chain — each hash links to the next */}
              {status.chain.headHashes.length > 1 && (
                <div className="mt-1.5 flex items-center gap-1 overflow-hidden">
                  {status.chain.headHashes.map((h, i) => (
                    <span key={h} className="flex items-center gap-1 shrink-0">
                      {i > 0 && <span className="text-[8px] text-foreground-dim">→</span>}
                      <span className="font-mono text-[8px] text-foreground-dim">{h}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Open paper positions */}
            {status.positions.length > 0 && (
              <div>
                <p className="text-[9px] font-mono uppercase tracking-wider text-foreground-dim mb-1">
                  Paper positions · since entry
                </p>
                <div className="space-y-0.5">
                  {status.positions.map((p) => (
                    <div key={p.symbol} className="flex items-center justify-between rounded-md border border-border/20 bg-surface/10 px-2 py-1">
                      <span className="font-mono text-[10px] text-foreground">{p.symbol}</span>
                      <span className="font-mono text-[9px] text-foreground-dim">
                        {fmtUsd(p.sizeUsd)} @ ${p.entryPriceUsd.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Verdict feed — the reasoning trail */}
            {status.verdicts.length > 0 && (
              <div>
                <p className="text-[9px] font-mono uppercase tracking-wider text-foreground-dim mb-1">
                  Reasoning trail · latest {status.verdicts.length}
                </p>
                <div className="space-y-0.5 max-h-64 overflow-y-auto">
                  {status.verdicts.slice(0, 10).map((v, i) => (
                    <VerdictRow key={`${v.hash}-${i}`} v={v} />
                  ))}
                </div>
              </div>
            )}

            <p className="text-[8px] font-mono text-foreground-dim text-center">
              paper fills only — no real funds · audit: npx tsx agent/ryo/run.ts --verify
            </p>
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}
