"use client";

import { motion } from "framer-motion";
import { Users, TrendingUp, Target, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { TierGate } from "@/components/reputation/tier-gate";
import { getTierInfo } from "@/lib/ethos-gates";
import { useCohortComparison } from "@/hooks/use-cohort-comparison";

interface CohortComparisonProps {
  address: string | null;
  chain?: "solana" | "base";
  userScore: number;
  userPatienceTax: number;
  userWinRate: number;
  /** Connected wallet's Ethos score (for the gate check) */
  ethosScore: number | null;
  enabled?: boolean;
}

const COHORT_GATE_SCORE = 1400;

export function CohortComparison({
  address,
  chain,
  userScore,
  userPatienceTax,
  userWinRate,
  ethosScore,
  enabled = true,
}: CohortComparisonProps) {
  const data = useCohortComparison({
    address,
    chain,
    score: userScore,
    enabled,
  });

  if (!enabled) return null;

  if (data.isLoading) {
    return (
      <div className="rounded-xl border border-border bg-surface/30 p-5">
        <div className="flex items-center gap-2 text-foreground-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-xs font-mono uppercase tracking-wider">
            Computing cohort comparison…
          </span>
        </div>
      </div>
    );
  }

  if (data.isGated) {
    return (
      <TierGate
        requiredScore={COHORT_GATE_SCORE}
        currentScore={ethosScore}
        feature="Cohort Comparison"
        description="Benchmark your conviction metrics against wallets in your reputation tier."
        preview={
          <div className="space-y-3 p-2">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-surface p-3 text-center">
                <div className="text-xs text-foreground-muted">You</div>
                <div className="text-xl font-bold text-foreground">
                  {userScore}
                </div>
              </div>
              <div className="rounded-lg bg-surface p-3 text-center">
                <div className="text-xs text-foreground-muted">Median</div>
                <div className="text-xl font-bold text-foreground">—</div>
              </div>
              <div className="rounded-lg bg-surface p-3 text-center">
                <div className="text-xs text-foreground-muted">Percentile</div>
                <div className="text-xl font-bold text-foreground">—</div>
              </div>
            </div>
          </div>
        }
        compact
      />
    );
  }

  if (!data.cohort) {
    return (
      <div className="rounded-xl border border-border bg-surface/30 p-5 text-center">
        <p className="text-xs font-mono text-foreground-muted">
          Not enough cohort data yet. Scan more wallets to build the
          comparative dataset.
        </p>
      </div>
    );
  }

  const cohort = data.cohort;
  const scoreDelta = userScore - cohort.medianScore;
  const taxDelta = userPatienceTax - cohort.avgPatienceTax;
  const winRateDelta = userWinRate - cohort.avgWinRate;
  const tierInfo = getTierInfo(data.tier);

  return (
    <div className="rounded-xl border border-border bg-surface/30 overflow-hidden">
      <div className={cn("px-5 py-3 border-b border-border/50", tierInfo.bgColor)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className={cn("w-3.5 h-3.5", tierInfo.color)} />
            <h3 className="text-xs font-mono uppercase tracking-wider text-foreground">
              Cohort Comparison
            </h3>
          </div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-foreground-muted">
            {tierInfo.name} · {cohort.totalWallets} wallets
            {chain ? ` · ${chain}` : ""}
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Percentile strip */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-foreground-muted">
              Your Percentile
            </span>
            <span className="text-sm font-mono font-bold tabular-nums text-signal">
              {data.percentile}
              <span className="text-xs text-foreground-muted">th</span>
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-background/60 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${data.percentile}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="h-full bg-signal rounded-full"
            />
          </div>
        </div>

        {/* Metric comparisons */}
        <div className="grid grid-cols-3 gap-3">
          <Metric
            icon={<Target className="w-3 h-3" />}
            label="Conviction"
            userValue={userScore}
            cohortValue={cohort.medianScore}
            delta={scoreDelta}
            higherIsBetter
          />
          <Metric
            icon={<TrendingUp className="w-3 h-3" />}
            label="Patience Tax"
            userValue={userPatienceTax}
            cohortValue={cohort.avgPatienceTax}
            delta={taxDelta}
            higherIsBetter={false}
            formatCurrency
          />
          <Metric
            icon={<Users className="w-3 h-3" />}
            label="Win Rate"
            userValue={userWinRate}
            cohortValue={cohort.avgWinRate}
            delta={winRateDelta}
            higherIsBetter
            formatPercent
          />
        </div>

        {/* Most common archetype */}
        {cohort.mostCommonArchetype && (
          <div className="pt-3 border-t border-border/50 flex items-center justify-between text-xs">
            <span className="text-foreground-muted">
              Cohort&apos;s most common archetype
            </span>
            <span className="font-mono text-foreground">
              {cohort.mostCommonArchetype.replace(/_/g, " ")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({
  icon,
  label,
  userValue,
  cohortValue,
  delta,
  higherIsBetter,
  formatCurrency = false,
  formatPercent = false,
}: {
  icon: React.ReactNode;
  label: string;
  userValue: number;
  cohortValue: number;
  delta: number;
  higherIsBetter: boolean;
  formatCurrency?: boolean;
  formatPercent?: boolean;
}) {
  const positive = higherIsBetter ? delta >= 0 : delta <= 0;
  const deltaColor = positive ? "text-patience" : "text-foreground-muted";

  const format = (n: number) => {
    if (formatCurrency) {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(n);
    }
    if (formatPercent) return `${n.toFixed(1)}%`;
    return Math.round(n).toString();
  };

  return (
    <div className="rounded-lg bg-background/40 border border-border/60 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-foreground-muted mb-2">
        {icon}
        {label}
      </div>
      <div className="text-lg font-bold tabular-nums text-foreground">
        {format(userValue)}
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] font-mono">
        <span className="text-foreground-dim">
          median {format(cohortValue)}
        </span>
        <span className={cn("tabular-nums", deltaColor)}>
          {delta >= 0 ? "+" : ""}
          {format(delta)}
        </span>
      </div>
    </div>
  );
}
