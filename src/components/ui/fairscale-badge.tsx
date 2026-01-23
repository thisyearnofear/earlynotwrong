"use client";

import * as React from "react";
import { Sparkles, Award, TrendingUp, Target, Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import type { FairScaleBadge as FairScaleBadgeType } from "@/lib/fairscale";

interface FairScaleBadgeProps {
  badge: FairScaleBadgeType;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

// Badge tier colors matching FairScale's design
const TIER_CONFIG = {
  platinum: {
    color: "text-cyan-400",
    bg: "bg-cyan-400/10",
    border: "border-cyan-400/30",
    glow: "shadow-[0_0_20px_-5px_rgba(34,211,238,0.5)]",
  },
  gold: {
    color: "text-amber-400",
    bg: "bg-amber-400/10",
    border: "border-amber-400/30",
    glow: "shadow-[0_0_20px_-5px_rgba(251,191,36,0.5)]",
  },
  silver: {
    color: "text-gray-300",
    bg: "bg-gray-300/10",
    border: "border-gray-300/30",
    glow: "shadow-[0_0_20px_-5px_rgba(209,213,219,0.4)]",
  },
  bronze: {
    color: "text-orange-400",
    bg: "bg-orange-400/10",
    border: "border-orange-400/30",
    glow: "shadow-[0_0_20px_-5px_rgba(251,146,60,0.4)]",
  },
};

// Badge icons based on common badge IDs
const getBadgeIcon = (badgeId: string) => {
  if (badgeId.includes('diamond_hands') || badgeId.includes('holder')) return Award;
  if (badgeId.includes('staker') || badgeId.includes('lst')) return Coins;
  if (badgeId.includes('maxi') || badgeId.includes('sol')) return Target;
  if (badgeId.includes('dump') || badgeId.includes('sell')) return TrendingUp;
  return Sparkles;
};

/**
 * FairScaleBadge
 * Displays FairScale achievement badges with tier-based styling
 * Matches the Conviction Cockpit visual language
 */
export function FairScaleBadge({
  badge,
  className,
  size = 'md',
}: FairScaleBadgeProps) {
  const tierKey = badge.tier.toLowerCase() as keyof typeof TIER_CONFIG;
  const config = TIER_CONFIG[tierKey] || TIER_CONFIG.silver;
  const Icon = getBadgeIcon(badge.id);

  const sizeClasses = {
    sm: {
      container: "p-2 gap-1.5",
      icon: "p-1.5",
      iconSize: "w-3 h-3",
      text: "text-[10px]",
      label: "text-[8px]",
    },
    md: {
      container: "p-3 gap-2",
      icon: "p-2",
      iconSize: "w-4 h-4",
      text: "text-xs",
      label: "text-[9px]",
    },
    lg: {
      container: "p-4 gap-2",
      icon: "p-2.5",
      iconSize: "w-5 h-5",
      text: "text-sm",
      label: "text-[10px]",
    }
  };

  const sizeConfig = sizeClasses[size];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={cn(
        "inline-flex items-center rounded-lg border backdrop-blur-sm transition-all duration-300 hover:scale-105",
        config.bg,
        config.border,
        config.glow,
        sizeConfig.container,
        className,
      )}
      title={badge.description}
    >
      {/* Icon */}
      <div
        className={cn(
          "rounded-md bg-black/40 border border-white/10 shadow-inner flex items-center justify-center",
          config.color,
          sizeConfig.icon,
        )}
      >
        <Icon className={sizeConfig.iconSize} />
      </div>

      {/* Badge Info */}
      <div className="flex flex-col min-w-0">
        <span
          className={cn(
            "font-mono font-semibold uppercase tracking-wider text-foreground truncate",
            sizeConfig.text,
          )}
        >
          {badge.label}
        </span>
        <span
          className={cn(
            "font-mono uppercase tracking-widest opacity-60",
            config.color,
            sizeConfig.label,
          )}
        >
          {badge.tier}
        </span>
      </div>
    </motion.div>
  );
}

/**
 * FairScaleBadgeGrid
 * Grid display for multiple FairScale badges
 */
export function FairScaleBadgeGrid({
  badges,
  className,
  maxVisible = 6,
}: {
  badges: FairScaleBadgeType[];
  className?: string;
  maxVisible?: number;
}) {
  const visibleBadges = badges.slice(0, maxVisible);
  const hiddenCount = Math.max(0, badges.length - maxVisible);

  if (badges.length === 0) {
    return (
      <div className={cn("text-xs font-mono text-foreground-muted p-3 text-center border border-dashed border-border/50 rounded-lg", className)}>
        No badges earned yet
      </div>
    );
  }

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {visibleBadges.map((badge) => (
        <FairScaleBadge key={badge.id} badge={badge} size="sm" />
      ))}
      {hiddenCount > 0 && (
        <div className="inline-flex items-center px-3 py-2 rounded-lg border border-border/50 bg-surface/20 text-xs font-mono text-foreground-muted">
          +{hiddenCount} more
        </div>
      )}
    </div>
  );
}
