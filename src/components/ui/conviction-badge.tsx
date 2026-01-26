"use client";

import * as React from "react";
import { Shield, Gem, Ghost, Zap, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

export type Archetype =
  | "Iron Pillar"
  | "Profit Phantom"
  | "Exit Voyager"
  | "Diamond Hand";

interface ConvictionBadgeProps {
  archetype: Archetype;
  className?: string;
  showDescription?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const ARCHETYPE_CONFIG = {
  "Iron Pillar": {
    icon: Shield,
    color: "text-signal",
    bg: "bg-signal/10",
    border: "border-signal/30",
    glow: "shadow-[0_0_20px_-5px_rgba(34,211,238,0.4)]",
    description: "Unyielding conviction through high-volatility drawdowns.",
  },
  "Diamond Hand": {
    icon: Gem,
    color: "text-patience",
    bg: "bg-patience/10",
    border: "border-patience/30",
    glow: "shadow-[0_0_20px_-5px_rgba(52,211,153,0.4)]",
    description: "Exceptional patience resulting in maximum upside capture.",
  },
  "Profit Phantom": {
    icon: Ghost,
    color: "text-impatience",
    bg: "bg-impatience/10",
    border: "border-impatience/30",
    glow: "shadow-[0_0_20px_-5px_rgba(251,191,36,0.4)]",
    description: "Systematically exits profitable positions before peak growth.",
  },
  "Exit Voyager": {
    icon: Zap,
    color: "text-ethos",
    bg: "bg-ethos/10",
    border: "border-ethos/30",
    glow: "shadow-[0_0_20px_-5px_rgba(139,92,246,0.4)]",
    description: "High trade velocity with limited thesis maturation periods.",
  },
};

/**
 * ConvictionBadge
 * A theatrical representation of a trader's behavioral archetype.
 * Utilizes the "Conviction Cockpit" visual language: high-contrast icons,
 * monospaced typography, and atmospheric glows.
 */
export function ConvictionBadge({
  archetype,
  className,
  showDescription = false,
  size = 'md',
}: ConvictionBadgeProps) {
  const config = ARCHETYPE_CONFIG[archetype];
  const Icon = config.icon;

  const sizeClasses = {
    sm: {
      container: "p-2 gap-1",
      icon: "p-1.5",
      iconSize: "w-3 h-3",
      text: "text-xs",
      label: "text-[7px]",
      sparkle: "w-2 h-2"
    },
    md: {
      container: "p-4 gap-1",
      icon: "p-2.5",
      iconSize: "w-6 h-6",
      text: "text-xl",
      label: "text-[9px]",
      sparkle: "w-3 h-3"
    },
    lg: {
      container: "p-6 gap-2",
      icon: "p-3",
      iconSize: "w-8 h-8",
      text: "text-2xl",
      label: "text-[10px]",
      sparkle: "w-4 h-4"
    }
  };

  const sizeConfig = sizeClasses[size];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      title={config.description}
      className={cn(
        "inline-flex flex-col rounded-xl border backdrop-blur-md transition-all duration-500",
        config.bg,
        config.border,
        config.glow,
        sizeConfig.container,
        className,
      )}
    >
      <div className="flex items-center gap-4">
        {/* Icon Container */}
        <div
          className={cn(
            "rounded-lg bg-black/40 border border-white/10 shadow-inner",
            config.color,
            sizeConfig.icon,
          )}
        >
          <Icon className={sizeConfig.iconSize} />
        </div>

        {/* Text Content */}
        <div className="flex flex-col">
          {size !== 'sm' && (
            <div className="flex items-center gap-1.5 mb-1">
              <span
                className={cn(
                  "font-mono font-bold uppercase tracking-[0.25em]",
                  config.color,
                  sizeConfig.label,
                )}
              >
                Archetype Detected
              </span>
              <Sparkles className={cn("animate-pulse", config.color, sizeConfig.sparkle)} />
            </div>
          )}
          <span className={cn(
            "font-bold text-foreground tracking-tight leading-none uppercase",
            sizeConfig.text
          )}>
            {archetype}
          </span>
        </div>
      </div>

      {showDescription && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-xs text-foreground-muted mt-3 font-mono leading-relaxed max-w-[240px] border-t border-white/5 pt-3"
        >
          {config.description}
        </motion.p>
      )}
    </motion.div>
  );
}
