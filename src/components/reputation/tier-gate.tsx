"use client";

import { motion } from "framer-motion";
import { Lock, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { getEthosTier, getTierInfo, type EthosTier } from "@/lib/ethos-gates";

interface TierGateProps {
  /** Minimum Ethos score required to access the gated content */
  requiredScore: number;
  /** The user's current Ethos score (null if not fetched) */
  currentScore: number | null;
  /** Name of the feature trying to access */
  feature: string;
  /** Optional short description of the feature's value */
  description?: string;
  /** Content to render when gate passes */
  children?: React.ReactNode;
  /** Optional preview/teaser to render behind the gate when locked */
  preview?: React.ReactNode;
  /** Compact variant for inline/panel use */
  compact?: boolean;
}

export function TierGate({
  requiredScore,
  currentScore,
  feature,
  description,
  children,
  preview,
  compact = false,
}: TierGateProps) {
  const score = currentScore ?? 0;
  const allowed = score >= requiredScore;
  const pointsAway = Math.max(0, requiredScore - score);
  const requiredTier: EthosTier =
    requiredScore >= 2000
      ? "elite"
      : requiredScore >= 1700
      ? "alpha"
      : requiredScore >= 1400
      ? "whale"
      : requiredScore >= 1000
      ? "premium"
      : score > 0
      ? "member"
      : "visitor";
  const tierInfo = getTierInfo(requiredTier);

  if (allowed) {
    return <>{children}</>;
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-surface/30",
        compact ? "p-4" : "p-6 sm:p-8",
      )}
    >
      {/* Blurred preview layer */}
      {preview && (
        <div className="relative mb-4 overflow-hidden rounded-lg">
          <div className="pointer-events-none select-none blur-sm opacity-60">
            {preview}
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-background/40 to-transparent" />
        </div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="relative flex flex-col items-center text-center gap-3"
      >
        <div
          className={cn(
            "flex items-center justify-center rounded-full border",
            tierInfo.bgColor,
            tierInfo.borderColor,
            compact ? "w-10 h-10" : "w-12 h-12",
          )}
        >
          <Lock
            className={cn(
              tierInfo.color,
              compact ? "w-4 h-4" : "w-5 h-5",
            )}
          />
        </div>

        <div className="space-y-1.5">
          <h3
            className={cn(
              "font-semibold text-foreground",
              compact ? "text-base" : "text-lg",
            )}
          >
            {feature}
          </h3>
          {description && (
            <p className="text-sm text-foreground-muted max-w-md mx-auto">
              {description}
            </p>
          )}
        </div>

        <div className="flex flex-col items-center gap-1.5 pt-1">
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="text-foreground-muted">
              Your score: <span className="text-foreground">{score}</span>
            </span>
            <ArrowRight className="w-3 h-3 text-foreground-dim" />
            <span className={tierInfo.color}>
              {requiredScore} required ({tierInfo.name})
            </span>
          </div>
          {pointsAway > 0 && (
            <p className="text-xs text-foreground-dim">
              {pointsAway} Ethos points away
            </p>
          )}
        </div>

        <a
          href="/"
          className={cn(
            "mt-2 inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-xs font-mono font-semibold text-foreground hover:bg-surface transition-colors",
            compact && "py-1.5",
          )}
        >
          Analyze a wallet to build reputation
          <ArrowRight className="w-3 h-3" />
        </a>
      </motion.div>
    </div>
  );
}

/**
 * Hook-style helper that returns gate status for a feature.
 * Useful when a component wants to conditionally render multiple gates
 * without wrapping each one.
 */
export function useGateStatus(currentScore: number | null, requiredScore: number) {
  const score = currentScore ?? 0;
  const tier = getEthosTier(score);
  const allowed = score >= requiredScore;
  return {
    allowed,
    tier,
    score,
    pointsAway: Math.max(0, requiredScore - score),
  };
}
