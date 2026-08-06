"use client";

/**
 * Signal Edge Panel
 *
 * Surfaces the on-demand edge report: conviction strategy vs naive baseline,
 * head-to-head metrics, and factor attribution of winning exits. This is the
 * answer to the buyer question "does the conviction signal have demonstrable
 * edge, or would any disciplined exit policy do as well?"
 *
 * The report runs a backtest on each fetch (a few seconds), so the panel loads
 * lazily behind a disclosure — it's not part of the default critical path.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Activity, TrendingUp, TrendingDown, AlertTriangle, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { EdgeReport } from "@/lib/agent-client";

function fmtPct(n: number, suffix = ""): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}${suffix}`;
}

function fmtSigned(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
}

interface MetricRow {
  label: string;
  conviction: string;
  naive: string;
  edge: string;
  edgePositive: boolean;
}

export function SignalEdgePanel() {
  const [report, setReport] = useState<EdgeReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch via the Vercel proxy (same path as the other dashboard cards).
      // The proxy has an 8-min timeout for edge-report (the cold backtest can
      // take ~7 min through the rolling-window rate limiter; the agent caches
      // the result for 30 min so repeat calls are instant).
      const res = await fetch("/api/agent/proxy?endpoint=edge-report");
      if (!res.ok) throw new Error(`edge-report returned ${res.status}`);
      const r = (await res.json()) as EdgeReport;
      setReport(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "edge report unavailable");
    }
    setLoading(false);
  };

  useEffect(() => {
    // Don't auto-fetch on mount; the report runs a backtest and can take a few
    // seconds. Let the user opt in via the Refresh button. Once fetched, we
    // don't poll — the edge verdict changes slowly (it's a 90-day backtest).
  }, []);

  const metrics: MetricRow[] = report
    ? [
        {
          label: "Total return",
          conviction: `${report.conviction.totalReturnPercent.toFixed(1)}%`,
          naive: `${report.naive.totalReturnPercent.toFixed(1)}%`,
          edge: fmtPct(report.edge.totalReturnPercent, "pp"),
          edgePositive: report.edge.totalReturnPercent > 0,
        },
        {
          label: "Sharpe ratio",
          conviction: report.conviction.sharpeRatio.toFixed(2),
          naive: report.naive.sharpeRatio.toFixed(2),
          edge: fmtSigned(report.edge.sharpeRatio),
          edgePositive: report.edge.sharpeRatio > 0,
        },
        {
          label: "Max drawdown",
          conviction: `${report.conviction.maxDrawdownPercent.toFixed(1)}%`,
          naive: `${report.naive.maxDrawdownPercent.toFixed(1)}%`,
          edge: fmtPct(report.edge.maxDrawdownPercent, "pp"),
          edgePositive: report.edge.maxDrawdownPercent < 0, // lower drawdown is better
        },
        {
          label: "Win rate",
          conviction: `${(report.conviction.winRate * 100).toFixed(0)}%`,
          naive: `${(report.naive.winRate * 100).toFixed(0)}%`,
          edge: fmtPct(report.edge.winRate * 100, "pp"),
          edgePositive: report.edge.winRate > 0,
        },
        {
          label: "Profit factor",
          conviction: report.conviction.profitFactor.toFixed(2),
          naive: report.naive.profitFactor.toFixed(2),
          edge: fmtSigned(report.edge.profitFactor),
          edgePositive: report.edge.profitFactor > 0,
        },
      ]
    : [];

  return (
    <Card className="bg-surface/30 border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-signal" />
          Signal Edge
          <span className="ml-1 text-[9px] font-mono normal-case tracking-normal text-foreground-dim">
            conviction vs naive baseline
          </span>
          <button
            onClick={load}
            disabled={loading}
            className="ml-auto inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border border-border/50 hover:border-signal/40 text-foreground-muted hover:text-signal transition-colors disabled:opacity-50"
            aria-label="Run edge report"
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            {loading ? "Running…" : report ? "Re-run" : "Run backtest"}
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-foreground-muted leading-relaxed">
          Does the conviction signal beat a naive random-entry baseline (same risk
          rules, no scoring) on risk-adjusted return? Edge = conviction Sharpe &gt; naive
          Sharpe <span className="text-foreground-dim">and</span> non-negative absolute
          return — a strategy that just loses less isn&apos;t edge.
        </p>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-impatience/30 bg-impatience/5 p-2.5">
            <AlertTriangle className="w-3.5 h-3.5 text-impatience shrink-0 mt-0.5" />
            <p className="text-[11px] text-foreground-muted leading-relaxed">{error}</p>
          </div>
        )}

        {!report && !error && !loading && (
          <div className="flex flex-col items-center justify-center py-6 text-foreground-muted">
            <Activity className="w-6 h-6 text-foreground-dim mb-2" />
            <p className="text-xs font-mono">No edge report yet</p>
            <p className="text-[10px] font-mono text-foreground-dim mt-1 text-center max-w-xs">
              Click <span className="text-signal">Run backtest</span> to compare the
              conviction strategy against a naive baseline over the last 90 days.
            </p>
          </div>
        )}

        {report && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="space-y-3"
          >
            {/* Verdict banner */}
            <div
              className={cn(
                "flex items-center gap-2 rounded-lg border p-2.5",
                report.hasEdge
                  ? "border-patience/30 bg-patience/5"
                  : "border-impatience/30 bg-impatience/5",
              )}
            >
              {report.hasEdge ? (
                <TrendingUp className="w-4 h-4 text-patience shrink-0" />
              ) : (
                <TrendingDown className="w-4 h-4 text-impatience shrink-0" />
              )}
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-xs font-mono font-semibold",
                    report.hasEdge ? "text-patience" : "text-impatience",
                  )}
                >
                  {report.hasEdge ? "EDGE CONFIRMED" : "NO EDGE"}
                </p>
                <p className="text-[10px] font-mono text-foreground-dim leading-relaxed">
                  {report.verdict}
                </p>
              </div>
            </div>

            {/* Head-to-head table */}
            <div className="rounded-lg border border-border/30 overflow-hidden">
              <table className="w-full text-[10px] font-mono">
                <thead>
                  <tr className="bg-surface/40 text-foreground-dim uppercase tracking-wider">
                    <th className="text-left px-2 py-1.5 font-normal">Metric</th>
                    <th className="text-right px-2 py-1.5 font-normal">Conviction</th>
                    <th className="text-right px-2 py-1.5 font-normal">Naive</th>
                    <th className="text-right px-2 py-1.5 font-normal">Edge</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((m) => (
                    <tr key={m.label} className="border-t border-border/20">
                      <td className="px-2 py-1.5 text-foreground-muted">{m.label}</td>
                      <td className="px-2 py-1.5 text-right text-foreground tabular-nums">
                        {m.conviction}
                      </td>
                      <td className="px-2 py-1.5 text-right text-foreground-dim tabular-nums">
                        {m.naive}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-1.5 text-right tabular-nums font-semibold",
                          m.edgePositive ? "text-patience" : "text-impatience",
                        )}
                      >
                        {m.edge}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Factor attribution */}
            {report.factorAttribution.length > 0 && (
              <div>
                <p className="text-[9px] font-mono uppercase tracking-wider text-foreground-dim mb-1.5">
                  Winning exits by leading factor
                </p>
                <div className="space-y-1">
                  {report.factorAttribution.map((a) => {
                    const maxPnl = Math.max(
                      ...report.factorAttribution.map((f) => Math.abs(f.realizedPnlUsd)),
                      1,
                    );
                    const barWidth = (Math.abs(a.realizedPnlUsd) / maxPnl) * 100;
                    return (
                      <div key={a.factor} className="flex items-center gap-2 text-[10px] font-mono">
                        <span className="w-20 text-foreground-muted capitalize">{a.factor}</span>
                        <div className="flex-1 h-3 bg-surface/40 rounded-sm overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-sm",
                              a.realizedPnlUsd >= 0 ? "bg-patience/60" : "bg-impatience/60",
                            )}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                        <span className="w-16 text-right text-foreground tabular-nums">
                          ${a.realizedPnlUsd.toFixed(2)}
                        </span>
                        <span className="w-8 text-right text-foreground-dim tabular-nums">
                          {a.winningExits}w
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[9px] font-mono text-foreground-dim mt-1.5">
                  Each winning exit is attributed to the conviction factor that scored
                  highest on its entry — answering &ldquo;is the contrarian factor doing the work?&rdquo;
                </p>
              </div>
            )}

            {/* Regime-conditional edge breakdown */}
            {report.regimeBreakdown && report.regimeBreakdown.length > 0 && (
              <div>
                <p className="text-[9px] font-mono uppercase tracking-wider text-foreground-dim mb-1.5">
                  Edge by regime (the signal is designed for fear)
                </p>
                <div className="space-y-1.5">
                  {report.regimeBreakdown.map((seg) => (
                    <div
                      key={seg.regime}
                      className={cn(
                        "flex items-center gap-2 rounded border px-2 py-1.5 text-[10px] font-mono",
                        seg.regime === "fear"
                          ? "border-signal/30 bg-signal/5"
                          : "border-border/30 bg-surface/20",
                      )}
                    >
                      <span className={cn("w-16 capitalize", seg.regime === "fear" ? "text-signal" : "text-foreground-muted")}>
                        {seg.regime}
                      </span>
                      <span className="text-foreground-dim">{seg.days}d</span>
                      <span className="text-foreground-dim">·</span>
                      <span className="text-foreground-muted">Sharpe</span>
                      <span className="text-foreground tabular-nums">{seg.conviction.sharpeRatio.toFixed(1)}</span>
                      <span className="text-foreground-dim">vs</span>
                      <span className="text-foreground-dim tabular-nums">{seg.naive.sharpeRatio.toFixed(1)}</span>
                      <span
                        className={cn(
                          "ml-auto px-1.5 py-0.5 rounded text-[9px] font-bold",
                          seg.hasEdge
                            ? "bg-patience/15 text-patience"
                            : "bg-foreground-dim/10 text-foreground-dim",
                        )}
                      >
                        {seg.hasEdge ? "EDGE" : "no edge"}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[9px] font-mono text-foreground-dim mt-1.5">
                  The conviction signal is contrarian by design — it enters quality assets down
                  during fear. Edge in the fear segment is the thesis working; underperformance
                  in non-fear is expected, not a bug.
                </p>
              </div>
            )}

            {report.dataSource === "synthetic" && (
              <p className="text-[9px] font-mono text-foreground-dim leading-relaxed">
                ⚠ Synthetic data — set <span className="text-foreground-muted">SOSOVALUE_API_KEY</span> on
                the agent to run against live historical klines.
              </p>
            )}
            {report.dataSource === "live-stale" && (
              <p className="text-[9px] font-mono text-foreground-dim leading-relaxed">
                ◔ Real SoSoValue history served from the disk cache (API rate-limited).
                {report.staleSymbols.length > 0 && (
                  <> Stale symbols: <span className="text-foreground-muted">{report.staleSymbols.join(", ")}</span>. May lag the current cycle.
                  </>
                )}
              </p>
            )}
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}
