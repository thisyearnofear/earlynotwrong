"use client";

/**
 * Options Arena card — the Alpaca options agent's surface in the /agent
 * Proof view, mirroring the Delphi Arena card (a separate process/venue).
 *
 * The options agent runs as its own pm2 process on its own port (31778)
 * and manages a $100k Alpaca paper options account. This card shows its
 * live state: portfolio, market-hours gate, cycle/P&L, top scored contracts
 * (IV vs realized vol), and open positions.
 *
 * Design rules honored (same as the Delphi card):
 *  - Lazy load on mount, manual refresh — never blocks the critical path
 *  - Real data only, honest empty states (hasData=false before the first cycle)
 *  - No fabricated IV/RV/position data.
 */

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Activity, RefreshCw, AlertTriangle, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fetchOptionsStatus, type OptionsStatus } from "@/lib/agent-client";

function fmtUsd(n: number, digits = 0): string {
  if (!isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 })}`;
}

function fmtPct(n: number, digits = 1): string {
  if (!isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

/** OSI-style short symbol: underlying + type + strike + expiry. */
function shortSymbol(s: { underlyingSymbol: string; contractType: string; strike: number; expiry: string }): string {
  const date = s.expiry ? s.expiry.slice(5) : "";
  return `${s.underlyingSymbol} ${s.contractType.toUpperCase()} ${s.strike} '${date}`;
}

export function OptionsArenaCard() {
  const [status, setStatus] = useState<OptionsStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const s = await fetchOptionsStatus();
    setStatus(s);
    setLoaded(true);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Fetch once on mount; the cycle runs hourly, so no polling.
    let cancelled = false;
    (async () => {
      const s = await fetchOptionsStatus();
      if (!cancelled) {
        setStatus(s);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isOpen = status?.market?.is_open ?? null;
  const openPositions = status?.positions ?? [];

  return (
    <Card className="bg-surface/30 border-border/50 border-[#22c55e]/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-[#22c55e]" />
          Options Arena
          <span className="ml-1 text-[9px] font-mono normal-case tracking-normal text-foreground-dim">
            Alpaca · paper
          </span>
          {status && status.hasData && (
            <span className="ml-auto text-[9px] font-mono normal-case tracking-normal text-foreground-dim">
              cycle {status.cycle}
              {status.market
                ? isOpen
                  ? " · market open"
                  : ` · next open ${status.market.next_open ? `${status.market.next_open.slice(5, 10)} ${status.market.next_open.slice(11, 16)}` : ""} UT`
                : ""}
            </span>
          )}
          <button
            onClick={load}
            disabled={loading}
            className={cn(
              "inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border border-border/50 hover:border-[#22c55e]/40 text-foreground-muted hover:text-[#22c55e] transition-colors disabled:opacity-50",
              !status && "ml-auto",
            )}
            aria-label="Refresh options status"
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            Refresh
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-foreground-muted leading-relaxed">
          A <span className="text-foreground">third venue</span>: the same harness
          skeleton trades <span className="text-foreground">options on Alpaca paper</span>.
          Instead of a paid volatility feed it derives IV + greeks from the free
          quote feed (Black-Scholes inversion) and scores premium
          <span className="text-foreground"> relative to each underlier&apos;s realized vol</span>
          (IV/RV ≪ 1 = cheap premium to buy; ≫ 1 = crush risk to avoid). Market-hours
          gated; the cycle thesis is anchored on-chain like the other venues.
        </p>

        {/* Unreachable / fetch failed */}
        {loaded && !status && (
          <div className="flex items-start gap-2 rounded-lg border border-impatience/30 bg-impatience/5 p-2.5">
            <AlertTriangle className="w-3.5 h-3.5 text-impatience shrink-0 mt-0.5" />
            <p className="text-[11px] text-foreground-muted leading-relaxed">
              Options status unavailable — the agent endpoint did not respond.
            </p>
          </div>
        )}

        {/* Honest empty state: agent hasn't completed a cycle yet */}
        {status && !status.hasData && (
          <div className="flex flex-col items-center justify-center py-6 text-foreground-muted">
            <Activity className="w-6 h-6 text-foreground-dim mb-2" />
            <p className="text-xs font-mono">No options activity yet</p>
            <p className="text-[10px] font-mono text-foreground-dim mt-1 text-center max-w-sm leading-relaxed">
              The options agent hasn&apos;t completed a cycle on the paper account.
              When it does, scored contracts with IV/RV, open positions, and the
              market-hours gate appear here.
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
                { label: "Value", value: fmtUsd(status.portfolio?.totalValueUsd ?? 0) },
                { label: "Cash", value: fmtUsd(status.portfolio?.cashUsd ?? 0) },
                { label: "Trades", value: String(status.totalTrades) },
                { label: "P&L", value: fmtUsd(status.realizedPnlUsd) },
              ].map((m) => (
                <div key={m.label} className="rounded-lg border border-border/30 bg-surface/20 px-1 py-2">
                  <p className="text-sm font-mono text-foreground tabular-nums">{m.value}</p>
                  <p className="text-[9px] font-mono uppercase tracking-wider text-foreground-dim mt-0.5">{m.label}</p>
                </div>
              ))}
            </div>

            {/* Market gate */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/30 bg-surface/20 px-2.5 py-2 text-[9px] font-mono text-foreground-dim">
              {isOpen === null ? (
                <span>market status unknown</span>
              ) : isOpen ? (
                <span className="text-patience">● market open — executing</span>
              ) : (
                <span className="text-impatience">● market closed — orders deferred</span>
              )}
              {status.market?.next_open && (
                <span>next open {new Date(status.market.next_open).toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span>
              )}
              <span className="ml-auto">top signal {status.topSignals[0] ? `${status.topSignals[0].score}/100` : "—"}</span>
            </div>

            {/* Top scored contracts (IV vs realized vol) */}
            {status.topSignals.length > 0 && (
              <div>
                <p className="text-[9px] font-mono uppercase tracking-wider text-foreground-dim mb-1">
                  Top scored contracts · IV/RV
                </p>
                <div className="space-y-0.5">
                  {status.topSignals.slice(0, 6).map((s) => (
                    <div key={s.symbol} className="flex items-center justify-between rounded-md border border-border/20 bg-surface/10 px-2 py-1">
                      <span className="font-mono text-[10px] text-foreground">
                        {shortSymbol(s)}
                        <span className="text-foreground-dim ml-1.5">
                          IV {s.iv.toFixed(2)}
                          {s.ivToRealized > 0 && ` / RV ${s.ivToRealized.toFixed(1)}×`}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "font-mono text-[10px] tabular-nums",
                          s.score >= 50 ? "text-patience" : s.score >= 40 ? "text-impatience" : "text-foreground-dim",
                        )}
                      >
                        {s.score}/100
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Open positions */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[9px] font-mono uppercase tracking-wider text-foreground-dim">
                  Open positions
                </p>
                <span className="text-[9px] font-mono text-foreground-dim">{openPositions.length}</span>
              </div>
              {openPositions.length === 0 ? (
                <p className="text-[10px] font-mono text-foreground-dim">None — no open contracts.</p>
              ) : (
                <div className="space-y-0.5">
                  {openPositions.map((p) => (
                    <div key={p.symbol} className="flex items-center justify-between rounded-md border border-border/20 bg-surface/10 px-2 py-1">
                      <span className="font-mono text-[10px] text-foreground">
                        {shortSymbol(p)} · {p.quantity}×
                        <span className="text-foreground-dim ml-1.5">@ {p.avgEntryPrice.toFixed(2)}</span>
                      </span>
                      <span
                        className={cn(
                          "font-mono text-[10px] tabular-nums",
                          p.unrealizedPnlUsd >= 0 ? "text-patience" : "text-impatience",
                        )}
                      >
                        {fmtUsd(p.unrealizedPnlUsd)} ({fmtPct(p.unrealizedPnlPercent)})
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Anchor receipt footer */}
            <div className="flex items-center gap-1.5 text-[9px] font-mono text-foreground-dim">
              <TrendingUp className="w-3 h-3" />
              Cycle {status.cycle} · {status.totalTrades} trades · {status.errors} errors
              {status.market?.next_open && ` · gated until ${new Date(status.market.next_open).toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit" })}`}
            </div>
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}
