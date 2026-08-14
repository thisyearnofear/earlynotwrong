"use client";

/**
 * Delphi Prediction Arena card — the agent's second trading venue, surfaced
 * in the /agent dashboard's Proof view.
 *
 * Shows what the Delphi runner (separate pm2 process) is doing on Gensyn
 * Testnet prediction markets: cycle stats, open probability forecasts with
 * estimate-vs-implied edge, the calibration report (Brier / reliability —
 * the honest yardstick for prediction-market skill), and the on-chain anchor
 * receipt for the cycle's thesis.
 *
 * Design rules honored:
 *  - Lazy load (fetches on mount, manual refresh; never blocks the critical path)
 *  - Real data only, honest empty states (no fabricated traders, no fake
 *    Brier scores) — hasData=false means the runner hasn't produced state yet
 *  - Calibration is only reported once forecasts actually resolve; before
 *    that the card says so explicitly.
 */

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Target, RefreshCw, Link2, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fetchDelphiStatus, type DelphiStatus } from "@/lib/agent-client";

/** Format an 18-decimal token string as a human-readable number. */
function fmtTokens(dec18: string): string {
  try {
    const n = Number(dec18) / 1e18;
    if (n >= 1000) return n.toFixed(0);
    if (n >= 1) return n.toFixed(2);
    return n.toFixed(4);
  } catch {
    return dec18;
  }
}

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "closed";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  return days > 0 ? `${days}d ${hours}h left` : `${hours}h left`;
}

function fmtProb(p: number | null, digits = 2): string {
  return p === null ? "—" : p.toFixed(digits);
}

export function DelphiArenaCard() {
  const [status, setStatus] = useState<DelphiStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const s = await fetchDelphiStatus();
    setStatus(s);
    setLoaded(true);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Fetch once on mount; the runner moves hourly, so no polling.
    let cancelled = false;
    (async () => {
      const s = await fetchDelphiStatus();
      if (!cancelled) {
        setStatus(s);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const anchorOk = status?.lastAnchor?.results.some((r) => r.status === "success");
  const buckets = status?.calibration.buckets ?? [];
  const maxCount = Math.max(...buckets.map((b) => b.count), 1);

  return (
    <Card className="bg-surface/30 border-border/50 border-[#f59e0b]/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
          <Target className="w-3.5 h-3.5 text-[#f59e0b]" />
          Prediction Arena
          <span className="ml-1 text-[9px] font-mono normal-case tracking-normal text-foreground-dim">
            Delphi · Gensyn Agent Arena
          </span>
          {status && (
            <span className="ml-auto text-[9px] font-mono text-foreground-dim normal-case tracking-normal">
              {fmtCountdown(status.competition.msRemaining)} · {status.network}
            </span>
          )}
          <button
            onClick={load}
            disabled={loading}
            className={cn(
              "inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border border-border/50 hover:border-[#f59e0b]/40 text-foreground-muted hover:text-[#f59e0b] transition-colors disabled:opacity-50",
              !status && "ml-auto",
            )}
            aria-label="Refresh arena status"
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            Refresh
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-foreground-muted leading-relaxed">
          A second venue: the agent forecasts probabilities on multi-outcome LMSR
          prediction markets and trades where estimate − implied clears the edge
          gate. Skill is graded by <span className="text-foreground">calibration</span> (Brier),
          not Sharpe, and the per-cycle thesis is anchored on-chain with the same
          registries as the token book.
        </p>

        {/* Unreachable / fetch failed */}
        {loaded && !status && (
          <div className="flex items-start gap-2 rounded-lg border border-impatience/30 bg-impatience/5 p-2.5">
            <AlertTriangle className="w-3.5 h-3.5 text-impatience shrink-0 mt-0.5" />
            <p className="text-[11px] text-foreground-muted leading-relaxed">
              Arena status unavailable — the agent endpoint did not respond.
            </p>
          </div>
        )}

        {/* Honest empty state: runner has never produced data */}
        {status && !status.hasData && (
          <div className="flex flex-col items-center justify-center py-6 text-foreground-muted">
            <Target className="w-6 h-6 text-foreground-dim mb-2" />
            <p className="text-xs font-mono">No arena activity yet</p>
            <p className="text-[10px] font-mono text-foreground-dim mt-1 text-center max-w-xs">
              The Delphi runner hasn&apos;t completed a cycle
              {status.enabled ? "" : " (DELPHI_ENABLED is off)"}. Forecasts,
              calibration, and anchor receipts appear here after the first run.
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
            {/* Cycle stats */}
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { label: "Cycles", value: String(status.snapshot?.cyclesRun ?? 0) },
                { label: "Markets seen", value: String(status.snapshot?.marketsSeen ?? 0) },
                { label: "Entries", value: String(status.snapshot?.tradesPlaced ?? 0) },
                { label: "Exposure", value: fmtTokens(status.totalExposureTokens) },
              ].map((m) => (
                <div key={m.label} className="rounded-lg border border-border/30 bg-surface/20 px-1 py-2">
                  <p className="text-sm font-mono text-foreground tabular-nums">{m.value}</p>
                  <p className="text-[9px] font-mono uppercase tracking-wider text-foreground-dim mt-0.5">{m.label}</p>
                </div>
              ))}
            </div>

            {/* Open forecasts */}
            {status.openPositions.length > 0 && (
              <div>
                <p className="text-[9px] font-mono uppercase tracking-wider text-foreground-dim mb-1.5">
                  Open forecasts ({status.openPositions.length})
                </p>
                <div className="space-y-1.5">
                  {status.openPositions.slice(0, 6).map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-2 rounded border border-border/30 bg-surface/20 px-2 py-1.5 text-[10px] font-mono"
                    >
                      <span className="flex-1 min-w-0 truncate text-foreground-muted">{p.question}</span>
                      <span className="text-foreground tabular-nums">{fmtProb(p.forecast)}</span>
                      <span className="text-foreground-dim">vs</span>
                      <span className="text-foreground-dim tabular-nums">{fmtProb(p.impliedProbability)}</span>
                      <span
                        className={cn(
                          "tabular-nums font-semibold",
                          p.edge > 0 ? "text-patience" : "text-impatience",
                        )}
                      >
                        {p.edge >= 0 ? "+" : ""}
                        {p.edge.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Calibration — the honest yardstick */}
            <div>
              <p className="text-[9px] font-mono uppercase tracking-wider text-foreground-dim mb-1.5">
                Calibration · {status.calibration.resolved} resolved / {status.calibration.unresolved} open
              </p>
              {status.calibration.resolved === 0 ? (
                <p className="text-[10px] font-mono text-foreground-dim leading-relaxed">
                  No forecasts have resolved yet — Brier, log-loss, and the
                  reliability diagram are reported once the first market settles.
                  No placeholder numbers: calibration is the claim this venue
                  exists to test.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 text-center mb-2">
                    <div className="rounded-lg border border-[#f59e0b]/30 bg-[#f59e0b]/5 px-1 py-2">
                      <p className="text-sm font-mono text-[#f59e0b] tabular-nums">{fmtProb(status.calibration.brierScore, 3)}</p>
                      <p className="text-[9px] font-mono uppercase tracking-wider text-foreground-dim mt-0.5">Brier (0 = perfect)</p>
                    </div>
                    <div className="rounded-lg border border-border/30 bg-surface/20 px-1 py-2">
                      <p className="text-sm font-mono text-foreground tabular-nums">{fmtProb(status.calibration.logLoss, 3)}</p>
                      <p className="text-[9px] font-mono uppercase tracking-wider text-foreground-dim mt-0.5">Log loss</p>
                    </div>
                    <div className="rounded-lg border border-border/30 bg-surface/20 px-1 py-2">
                      <p className="text-sm font-mono text-foreground tabular-nums">
                        {status.calibration.hitRate === null ? "—" : `${Math.round(status.calibration.hitRate * 100)}%`}
                      </p>
                      <p className="text-[9px] font-mono uppercase tracking-wider text-foreground-dim mt-0.5">Hit rate</p>
                    </div>
                  </div>

                  {/* Reliability diagram: 10 bins, bar = count, color = calibration */}
                  <div className="flex items-end gap-[3px] h-16 px-1">
                    {buckets.map((b) => {
                      const h = b.count === 0 ? 0 : Math.max(8, (b.count / maxCount) * 100);
                      const wellCalibrated = b.gap !== null && b.gap <= 0.1;
                      return (
                        <div key={b.bucket} className="flex-1 flex flex-col items-center gap-0.5" title={b.count === 0 ? "no forecasts" : `forecast ~${(b.lower + 0.05).toFixed(1)}: said ${fmtProb(b.meanForecast)}, happened ${fmtProb(b.meanOutcome)}`}>
                          <div
                            className={cn(
                              "w-full rounded-sm",
                              b.count === 0 ? "bg-border/30" : wellCalibrated ? "bg-patience/60" : "bg-impatience/50",
                            )}
                            style={{ height: b.count === 0 ? "2px" : `${h}%` }}
                          />
                          <span className="text-[8px] font-mono text-foreground-dim">{b.bucket}</span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[9px] font-mono text-foreground-dim mt-1 leading-relaxed">
                    Reliability diagram — each bar is a 10% forecast bin (height =
                    count). <span className="text-patience">Green</span> bins are calibrated
                    (said ≈ happened); <span className="text-impatience">red</span> bins are over/underconfident.
                  </p>
                </>
              )}
            </div>

            {/* On-chain anchor receipt */}
            {status.lastAnchor && (
              <div className="rounded-lg border border-border/30 bg-surface/20 px-2.5 py-2">
                <p className="text-[9px] font-mono uppercase tracking-wider text-foreground-dim mb-1 flex items-center gap-1.5">
                  <Link2 className="w-3 h-3" />
                  Thesis anchored on-chain
                  <span
                    className={cn(
                      "ml-auto px-1.5 py-0.5 rounded text-[8px] font-bold",
                      anchorOk ? "bg-patience/15 text-patience" : "bg-foreground-dim/10 text-foreground-dim",
                    )}
                  >
                    {anchorOk ? "ON-CHAIN" : "ATTEMPTED"}
                  </span>
                </p>
                <p className="text-[10px] font-mono text-foreground-muted break-all">
                  {status.lastAnchor.thesisHash.slice(0, 20)}…
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                  {status.lastAnchor.results.map((r) => (
                    <span key={r.adapter} className="text-[9px] font-mono text-foreground-dim">
                      {r.adapter}=<span className={r.status === "success" ? "text-patience" : r.status === "failed" ? "text-impatience" : "text-foreground-dim"}>{r.status}</span>
                      {r.explorerUrl && (
                        <a href={r.explorerUrl} target="_blank" rel="noreferrer" className="ml-1 underline hover:text-foreground-muted">
                          tx
                        </a>
                      )}
                    </span>
                  ))}
                  <span className="text-[9px] font-mono text-foreground-dim ml-auto">
                    conviction {status.lastAnchor.convictionScore}/100
                  </span>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}
