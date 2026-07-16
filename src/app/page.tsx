"use client";

/**
 * Home page — single-narrative landing.
 *
 * The home page's job is to get a visitor to click "Enter the dashboard".
 * It tells the product story in 4 acts (Score → Trade → Anchor → Verify)
 * with live data points, then hands off to /agent (the dashboard) or
 * /analyzer (the wallet analyzer tool).
 *
 * The wallet analyzer used to live here; it's now at /analyzer so the
 * home page can focus on one narrative instead of competing for attention.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Navbar } from "@/components/layout/navbar";
import { TunnelBackground } from "@/components/ui/tunnel-background";
import { cn } from "@/lib/utils";
import {
  Activity,
  TrendingUp,
  Anchor,
  ShieldCheck,
  ArrowRight,
  Zap,
  Brain,
  Link2,
} from "lucide-react";

// ─── Agent status (for the live indicator) ──────────────────────────────────

interface AgentStatus {
  status: string;
  lastRunAt: number | null;
  cycle: number;
  totalTrades: number;
  totalVolumeUsd: number;
}

interface ConvictionSignal {
  symbol: string;
  score: number;
  rationale: string;
}

interface HeldPosition {
  symbol: string;
  entryCycle: number;
  cyclesHeld: number;
  maxUnderwaterPercent: number;
  amountUsd: number;
  stuck?: boolean;
}

interface PositionVerdict {
  symbol: string;
  unrealizedPnLPercent: number;
  heldThroughDrawdown: boolean;
  reason: string;
}

interface ConvictionResponse {
  signals: ConvictionSignal[];
  heldPositions: HeldPosition[];
  positionVerdicts: PositionVerdict[];
}

function timeAgo(epochMs: number | null): string {
  if (!epochMs) return "";
  const diff = Date.now() - epochMs;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── The 4 acts ──────────────────────────────────────────────────────────────

const ACTS = [
  {
    icon: Brain,
    title: "Score",
    label: "Act 1",
    description: "A 6-factor contrarian conviction engine scores every token. Fear & greed, holder growth, RSI timing, quality, regime — not momentum, conviction.",
    color: "text-signal",
  },
  {
    icon: Activity,
    title: "Trade",
    label: "Act 2",
    description: "The agent enters on fear, holds through drawdown, and lets winners run. Asymmetric by design: losses capped at −1x, wins uncapped.",
    color: "text-patience",
  },
  {
    icon: Anchor,
    title: "Anchor",
    label: "Act 3",
    description: "Every decision is hashed and written on-chain. Casper, Mantle, Aleo — three chains, one conviction record, verifiable by anyone.",
    color: "text-signal",
  },
  {
    icon: ShieldCheck,
    title: "Verify",
    label: "Act 4",
    description: "Connect your Casper Wallet and anchor your own conviction record. Or audit any wallet's behavioral score with the analyzer.",
    color: "text-patience",
  },
] as const;

export default function Home() {
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [signals, setSignals] = useState<ConvictionSignal[]>([]);
  const [convictionData, setConvictionData] = useState<ConvictionResponse | null>(null);

  // Fetch agent live status + conviction data (signals + held positions + verdicts)
  useEffect(() => {
    let cancelled = false;

    const fetchAll = async () => {
      try {
        const [statusRes, convRes] = await Promise.all([
          fetch("/api/agent/proxy?endpoint=status"),
          fetch("/api/agent/proxy?endpoint=conviction"),
        ]);

        if (!cancelled && statusRes.ok) {
          const data = (await statusRes.json()) as Partial<AgentStatus>;
          setAgentStatus(data as AgentStatus);
        }
        if (!cancelled && convRes.ok) {
          const data = (await convRes.json()) as ConvictionResponse;
          setConvictionData(data);
          if (data.signals?.length) setSignals(data.signals.slice(0, 4));
        }
      } catch {
        /* best-effort — landing still works without live data */
      }
    };

    fetchAll();
    const id = setInterval(fetchAll, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Find a "conviction proven" position — held through ≥10% drawdown, now profitable
  const convictionProven = convictionData?.heldPositions
    .map((p) => {
      const verdict = convictionData.positionVerdicts.find(
        (v) => v.symbol === p.symbol
      );
      const signal = convictionData.signals.find(
        (s) => s.symbol === p.symbol
      );
      const isProven =
        verdict?.heldThroughDrawdown &&
        p.maxUnderwaterPercent <= -10 &&
        (verdict?.unrealizedPnLPercent ?? 0) > 0 &&
        !p.stuck;
      return { position: p, verdict, signal, isProven };
    })
    .find((x) => x.isProven);

  const isLive = agentStatus?.status === "running";

  return (
    <div
      className="min-h-screen text-foreground selection:bg-signal/20 overflow-x-hidden relative"
      suppressHydrationWarning
    >
      <TunnelBackground />
      <Navbar />

      <main className="pt-24 pb-16 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto flex flex-col">
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <motion.section
          layout
          className="relative z-10 flex flex-col items-center text-center space-y-6 max-w-3xl mx-auto mb-20"
        >
          {/* Ambient Glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-125 h-125 bg-signal/5 rounded-full blur-[100px] -z-10 pointer-events-none" />

          {/* Conviction Engine badge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-surface/50 backdrop-blur-sm text-xs font-mono text-foreground-muted"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-signal shadow-[0_0_10px_var(--signal)]" />
            CONVICTION ENGINE
          </motion.div>

          <motion.h1
            layout
            className="text-4xl md:text-6xl font-bold tracking-tight text-foreground leading-tight"
          >
            Being early feels like <br />
            <span className="text-foreground-muted">being wrong.</span>
          </motion.h1>

          <motion.p
            layout
            className="text-base md:text-lg text-foreground-muted max-w-2xl leading-relaxed"
          >
            An AI trading agent that scores its own conviction, manages
            positions through drawdown, and anchors every decision on-chain.
            Conviction is tested not when you&apos;re wrong — it&apos;s tested
            when you&apos;re{" "}
            <span className="text-foreground font-semibold">early</span>.
          </motion.p>

          {/* Primary CTA */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="flex flex-col sm:flex-row items-center gap-3 pt-2"
          >
            <Link
              href="/agent"
              className="group inline-flex items-center gap-2 px-6 py-3 rounded-full bg-foreground text-background text-sm font-semibold hover:bg-signal hover:text-black transition-all"
            >
              Enter the Dashboard
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <Link
              href="/analyzer"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-border bg-surface/50 text-sm font-mono text-foreground-muted hover:text-foreground hover:border-signal/40 transition-all"
            >
              <TrendingUp className="w-4 h-4" />
              Wallet Analyzer
            </Link>
          </motion.div>

          {/* Live indicator + chain strip */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45, duration: 0.4 }}
            className="flex items-center gap-3 flex-wrap justify-center text-[10px] font-mono pt-2"
          >
            {isLive ? (
              <span className="inline-flex items-center gap-1.5 text-patience">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-patience opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-patience" />
                </span>
                <span className="uppercase tracking-wider">Agent live</span>
                {agentStatus?.lastRunAt && (
                  <span className="text-foreground-dim">
                    · cycle {agentStatus.cycle} · {timeAgo(agentStatus.lastRunAt)}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-foreground-dim uppercase tracking-wider">
                {agentStatus?.status ?? "connecting…"}
              </span>
            )}

            <span className="text-foreground-dim">·</span>

            <span className="uppercase tracking-wider text-foreground-dim">Anchored on:</span>
            <span className="px-2 py-0.5 rounded-full border border-signal/30 bg-signal/10 text-signal">
              Casper
            </span>
            <span className="px-2 py-0.5 rounded-full border border-border/40 bg-surface/30 text-foreground-muted">
              Mantle
            </span>
            <span className="px-2 py-0.5 rounded-full border border-border/40 bg-surface/30 text-foreground-muted">
              Aleo
            </span>
          </motion.div>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.4 }}
            className="text-[10px] font-mono text-foreground-dim max-w-md leading-relaxed"
            title="Each chain plays a distinct role in the conviction stack"
          >
            Casper = public registry · Mantle = EVM mirror · Aleo = privacy proof
          </motion.p>
        </motion.section>

        {/* ── The 4 Acts — how it works ────────────────────────────────────── */}
        <section className="relative z-10 mb-16">
          <div className="text-center mb-8">
            <p className="text-[10px] font-mono uppercase tracking-widest text-foreground-dim">
              How it works
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {ACTS.map((act, i) => {
              const Icon = act.icon;
              return (
                <motion.div
                  key={act.title}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 * i, duration: 0.4 }}
                  className="group relative flex flex-col gap-3 p-4 rounded-xl border border-border/40 bg-surface/30 hover:border-signal/30 transition-all"
                >
                  <div className="flex items-center gap-2">
                    <Icon className={cn("w-5 h-5", act.color)} />
                    <span className="text-sm font-semibold text-foreground">
                      {act.title}
                    </span>
                    <span className="ml-auto text-[9px] font-mono text-foreground-dim uppercase tracking-wider">
                      {act.label}
                    </span>
                  </div>
                  <p className="text-[11px] font-mono text-foreground-muted leading-relaxed">
                    {act.description}
                  </p>

                  {/* Live data for each act */}
                  {act.title === "Score" && signals.length > 0 && (
                    <div className="mt-auto pt-2 border-t border-border/30 space-y-1">
                      {signals.slice(0, 2).map((s) => (
                        <div key={s.symbol} className="flex items-center gap-2 text-[10px] font-mono">
                          <Zap className="w-2.5 h-2.5 text-signal" />
                          <span className="text-foreground">{s.symbol}</span>
                          <span className="text-signal ml-auto tabular-nums">{s.score}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {act.title === "Trade" && agentStatus && (
                    <div className="mt-auto pt-2 border-t border-border/30 flex items-center gap-2 text-[10px] font-mono">
                      <Activity className="w-2.5 h-2.5 text-patience" />
                      <span className="text-foreground-muted">Trades</span>
                      <span className="text-foreground ml-auto tabular-nums">
                        {agentStatus.totalTrades}
                      </span>
                    </div>
                  )}
                  {act.title === "Anchor" && (
                    <div className="mt-auto pt-2 border-t border-border/30 flex items-center gap-2 text-[10px] font-mono">
                      <Link2 className="w-2.5 h-2.5 text-signal" />
                      <span className="text-foreground-muted">3 chains</span>
                      <span className="text-signal ml-auto">live</span>
                    </div>
                  )}
                  {act.title === "Verify" && (
                    <div className="mt-auto pt-2 border-t border-border/30">
                      <Link
                        href="/agent"
                        className="inline-flex items-center gap-1 text-[10px] font-mono text-signal hover:underline"
                      >
                        Connect Casper Wallet
                        <ArrowRight className="w-2.5 h-2.5" />
                      </Link>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* ── "Early, Not Wrong" — the product thesis proven live ──────────── */}
        {convictionProven && convictionProven.verdict && (
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55, duration: 0.4 }}
            className="relative z-10 mb-16"
          >
            <div className="rounded-2xl border-2 border-patience/40 bg-patience/8 p-6 shadow-[0_0_30px_-10px_var(--patience-dim)]">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-patience">
                  ◆ Early, Not Wrong
                </span>
                <span className="text-[10px] font-mono text-foreground-dim">
                  — conviction proven, live on-chain
                </span>
              </div>

              {/* The full arc: scored → entered → dipped → held → now */}
              <div className="flex items-center gap-2 flex-wrap text-sm md:text-base font-mono mb-3">
                <span className="text-foreground font-semibold text-lg">
                  {convictionProven.position.symbol}
                </span>
                {convictionProven.signal && (
                  <>
                    <span className="text-foreground-dim">·</span>
                    <span className="text-signal" title={convictionProven.signal.rationale}>
                      scored {convictionProven.signal.score}
                    </span>
                  </>
                )}
                <span className="text-foreground-dim">→</span>
                <span className="text-foreground-muted">
                  entered cycle {convictionProven.position.entryCycle}
                </span>
                <span className="text-foreground-dim">→</span>
                <span className="text-impatience font-semibold">
                  dipped −{convictionProven.position.maxUnderwaterPercent.toFixed(1)}%
                </span>
                <span className="text-foreground-dim">→</span>
                <span className="text-patience font-semibold">
                  held {convictionProven.position.cyclesHeld} cycles
                </span>
                <span className="text-foreground-dim">→</span>
                <span className="text-patience font-bold text-lg">
                  now +{convictionProven.verdict.unrealizedPnLPercent.toFixed(1)}%
                </span>
              </div>

              {convictionProven.verdict.reason && (
                <p className="text-[11px] md:text-xs font-mono text-foreground-muted leading-relaxed max-w-2xl">
                  {convictionProven.verdict.reason}
                </p>
              )}

              <Link
                href="/agent"
                className="mt-4 inline-flex items-center gap-1 text-[11px] font-mono text-signal hover:underline"
              >
                See the full conviction ledger
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </motion.section>
        )}

        {/* ── Live conviction preview ──────────────────────────────────────── */}
        {signals.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.4 }}
            className="relative z-10 mb-16"
          >
            <div className="rounded-xl border border-border/40 bg-surface/20 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Brain className="w-4 h-4 text-signal" />
                <span className="text-xs font-mono uppercase tracking-wider text-foreground-muted">
                  Agent&apos;s live conviction — this cycle
                </span>
                {isLive && agentStatus?.lastRunAt && (
                  <span className="ml-auto text-[10px] font-mono text-foreground-dim">
                    {timeAgo(agentStatus.lastRunAt)}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {signals.map((s, i) => (
                  <motion.div
                    key={s.symbol}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.7 + i * 0.05 }}
                    className="flex flex-col gap-1 p-3 rounded-lg bg-surface/40 border border-border/30"
                  >
                    <span className="text-[10px] font-mono text-foreground-dim uppercase tracking-wider">
                      {s.symbol}
                    </span>
                    <span className="text-2xl font-bold font-mono text-signal tabular-nums">
                      {s.score}
                    </span>
                    <span className="text-[9px] font-mono text-foreground-muted leading-tight line-clamp-2">
                      {s.rationale}
                    </span>
                  </motion.div>
                ))}
              </div>
              <Link
                href="/agent"
                className="mt-4 inline-flex items-center gap-1 text-[11px] font-mono text-signal hover:underline"
              >
                See all signals on the dashboard
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </motion.section>
        )}

        {/* ── Footer links ─────────────────────────────────────────────────── */}
        <section className="relative z-10 mt-auto pt-8 border-t border-border/30">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-[10px] font-mono text-foreground-dim">
            <span className="uppercase tracking-wider text-center sm:text-left">
              Autonomous conviction, anchored on-chain
            </span>
            <div className="flex items-center gap-4 flex-wrap justify-center sm:justify-end">
              <Link href="/agent" className="hover:text-signal transition-colors">
                Dashboard
              </Link>
              <Link href="/analyzer" className="hover:text-signal transition-colors">
                Analyzer
              </Link>
              <Link href="/leaderboard" className="hover:text-signal transition-colors">
                Leaderboard
              </Link>
              <Link href="/alpha" className="hover:text-signal transition-colors">
                Alpha
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
