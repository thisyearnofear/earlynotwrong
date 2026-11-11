"use client";

/**
 * /ryo — standalone Track 2 surface (RYO-CHAN Hackathon 2026).
 *
 * One screen, judged on its own: what changed, why it matters, what to do.
 * Not a card on a dashboard — a dedicated route that works for keyboard
 * users (semantic lists, focus rings, skip link) and reads in 30 seconds.
 *
 * Data: /api/agent/proxy?endpoint=ryo/status → the file-backed reasoning
 * ledger. Every verdict links out to its shareable receipt page on the
 * status server (NEXT_PUBLIC_RYO_STATUS_BASE for demo/local runs).
 */

import { useCallback, useEffect, useState } from "react";
import { fetchRyoStatus, type RyoStatus, type RyoVerdict } from "@/lib/agent-client";
import { ShieldCheck, ShieldAlert, ExternalLink, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_BASE = process.env.NEXT_PUBLIC_RYO_STATUS_BASE ?? "http://localhost:31800";

const ACTION_STYLE: Record<string, string> = {
  BUY: "text-patience border-patience/50 bg-patience/10",
  HOLD: "text-foreground-muted border-border/50 bg-surface/20",
  EXIT: "text-impatience border-impatience/50 bg-impatience/10",
  SKIP: "text-[#e8b64c] border-[#e8b64c]/50 bg-[#e8b64c]/10",
  JURY: "text-[#a78bfa] border-[#a78bfa]/50 bg-[#a78bfa]/10",
  THESIS: "text-[#a78bfa] border-[#a78bfa]/50 bg-[#a78bfa]/10",
  ANCHOR: "text-[#38bdf8] border-[#38bdf8]/50 bg-[#38bdf8]/10",
};

export default function RyoPage() {
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
    void load();
  }, [load]);

  const jury = status?.verdicts.find((v) => v.action === "JURY");
  const vetoes = status?.verdicts.filter((v) => v.action === "SKIP" && v.conviction === 0) ?? [];

  return (
    <main className="min-h-screen bg-[#0d0f0a] text-foreground font-mono px-5 py-8 md:px-10">
      <a
        href="#verdicts"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-surface focus:px-3 focus:py-2 focus:rounded"
      >
        Skip to verdicts
      </a>

      <header className="max-w-3xl mx-auto mb-8">
        <p className="text-[10px] uppercase tracking-[0.2em] text-foreground-dim mb-2">
          RYO-CHAN Hackathon · Track 2 · paper trades only
        </p>
        <h1 className="text-2xl md:text-3xl text-foreground">
          What the agent decided — <span className="text-[#e8b64c]">and why you can trust the trail</span>
        </h1>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {status?.chain ? (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px]",
                status.chain.intact ? "border-patience/40 text-patience" : "border-impatience/40 text-impatience",
              )}
            >
              {status.chain.intact ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
              {status.chain.intact ? "chain intact" : "CHAIN BROKEN"} · {status.chain.entries} entries
            </span>
          ) : null}
          {status && (
            <span className="text-[11px] text-foreground-dim">
              {status.positions.length} open · {fmtUsd(status.cashUsd)} cash · cycle {status.cycle}
            </span>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/50 px-2.5 py-1 text-[11px] text-foreground-muted hover:text-foreground hover:border-foreground/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e8b64c] disabled:opacity-50"
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto space-y-8">
        {loaded && !status && (
          <p role="status" className="rounded-lg border border-impatience/30 bg-impatience/5 p-4 text-sm text-foreground-muted">
            Status endpoint unreachable. Run <code className="text-foreground">npx tsx agent/ryo/serve.ts</code> and
            set <code className="text-foreground">RYO_AGENT_PORT</code> / <code className="text-foreground">NEXT_PUBLIC_RYO_STATUS_BASE</code>.
          </p>
        )}
        {status && !status.hasData && (
          <p role="status" className="rounded-lg border border-border/40 p-4 text-sm text-foreground-muted">
            No cycles yet — run <code className="text-foreground">RYO_MCP_KEY=… npx tsx agent/ryo/run.ts</code>.
          </p>
        )}

        {status?.hasData && (
          <>
            {/* WHY IT MATTERS — the jury's actual judgement, plus vetoes */}
            <section aria-labelledby="why">
              <h2 id="why" className="text-[10px] uppercase tracking-[0.2em] text-foreground-dim mb-3">
                Why it matters
              </h2>
              {jury ? (
                <blockquote className="border-l-2 border-[#a78bfa]/60 pl-4 text-sm text-foreground-muted leading-relaxed">
                  {jury.reason}
                  <footer className="mt-1 text-[10px] text-foreground-dim">
                    — conviction jury verdict on {jury.symbol} · <a className="underline decoration-[#e8b64c]/60 underline-offset-2 hover:text-[#e8b64c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e8b64c]" href={`${STATUS_BASE}/ryo/receipt/${jury.hash}`}>receipt #{jury.hash.slice(0, 8)}</a>
                  </footer>
                </blockquote>
              ) : (
                <p className="text-sm text-foreground-muted">No jury verdicts yet — the jury runs on the top-4 shortlist each cycle.</p>
              )}
              {vetoes.length > 0 && (
                <p className="mt-3 text-[11px] text-foreground-muted">
                  <span className="text-impatience">{vetoes.length} hard veto{vetoes.length > 1 ? "es" : ""} honored</span> — the
                  agent refused entries its own evidence flagged unsafe, and recorded the refusal rather than rationalizing it.
                </p>
              )}
            </section>

            {/* WHAT CHANGED — the verdict feed */}
            <section id="verdicts" aria-labelledby="changed">
              <h2 id="changed" className="text-[10px] uppercase tracking-[0.2em] text-foreground-dim mb-3">
                What changed — latest {Math.min(status.verdicts.length, 12)} verdicts
              </h2>
              <ol className="space-y-1.5">
                {status.verdicts.slice(0, 12).map((v) => (
                  <VerdictItem key={v.hash} v={v} />
                ))}
              </ol>
            </section>

            {/* WHAT TO DO — actions, not just readout */}
            <section aria-labelledby="act">
              <h2 id="act" className="text-[10px] uppercase tracking-[0.2em] text-foreground-dim mb-3">
                What to do
              </h2>
              <ul className="grid gap-2 sm:grid-cols-3 text-[11px]">
                {[
                  { label: "Audit the chain", href: `${STATUS_BASE}/ryo/verify`, note: "recompute every hash" },
                  { label: "Read the feed", href: `${STATUS_BASE}/ryo/feed`, note: "shareable verdicts, newest first" },
                  { label: "Commit a thesis", href: `${STATUS_BASE}/ryo/status`, note: "POST /tools/thesis_commit/call" },
                ].map((a) => (
                  <li key={a.label}>
                    <a
                      href={a.href}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-2 rounded-md border border-border/40 px-3 py-2.5 hover:border-[#e8b64c]/60 hover:text-[#e8b64c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e8b64c]"
                    >
                      <span>
                        {a.label}
                        <span className="block text-[9px] text-foreground-dim">{a.note}</span>
                      </span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        <footer className="pt-6 border-t border-border/20 text-[10px] text-foreground-dim leading-relaxed">
          Early, Not Wrong · practice agent on RYO-CHAN read-only tools · every verdict above is a
          hash-chained ledger entry — the receipt links are the shareable SocialFi surface.
        </footer>
      </div>
    </main>
  );
}

function VerdictItem({ v }: { v: RyoVerdict }) {
  const style = ACTION_STYLE[v.action] ?? ACTION_STYLE.HOLD;
  return (
    <li className="rounded-md border border-border/25 bg-surface/10 px-3 py-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn("rounded border px-1.5 py-0.5 text-[9px] uppercase", style)}>{v.action}</span>
        <span className="text-[12px] text-foreground">{v.symbol}</span>
        {v.conviction > 0 && <span className="text-[10px] text-patience">{v.conviction}/100</span>}
        <a
          href={`${STATUS_BASE}/ryo/receipt/${v.hash}`}
          target="_blank"
          rel="noreferrer"
          className="ml-auto text-[9px] text-foreground-dim underline decoration-[#e8b64c]/40 underline-offset-2 hover:text-[#e8b64c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e8b64c]"
        >
          #{v.hash.slice(0, 8)}
        </a>
      </div>
      {/* Full reason — never truncated; the trail is the product */}
      <p className="mt-1 text-[11px] text-foreground-muted leading-relaxed">{v.reason}</p>
    </li>
  );
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
