"use client";

import { motion } from "framer-motion";
import { Signal, Network, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentView } from "./agent-section-nav-types";
import { VIEW_CONTEXT } from "./agent-section-nav-types";

const VIEWS: {
  id: AgentView;
  label: string;
  shortLabel: string;
  icon: typeof Signal;
  hash: string;
}[] = [
  { id: "live", label: "Live", shortLabel: "Live", icon: Signal, hash: "#signals" },
  { id: "proof", label: "On-chain proof", shortLabel: "Proof", icon: Network, hash: "#proof" },
  { id: "hire", label: "Hire / query", shortLabel: "Hire", icon: ShoppingBag, hash: "#hire" },
];

export type AgentTabBadges = Partial<Record<AgentView, string>>;

interface AgentSectionNavProps {
  active: AgentView;
  onChange: (view: AgentView) => void;
  className?: string;
  /** inline = under header copy; dock = fixed bottom bar (mobile) */
  layout?: "inline" | "dock";
  badges?: AgentTabBadges;
  showContext?: boolean;
}

export function AgentSectionNav({
  active,
  onChange,
  className,
  layout = "inline",
  badges,
  showContext = true,
}: AgentSectionNavProps) {
  const isDock = layout === "dock";

  const nav = (
    <nav
      aria-label={isDock ? "Agent sections (mobile)" : "Agent dashboard sections"}
      className={cn(
        "flex gap-1 p-1 rounded-xl border border-border/50",
        isDock
          ? "bg-background/95 backdrop-blur-md shadow-[0_-4px_24px_-8px_rgba(0,0,0,0.35)] safe-area-inset"
          : "bg-surface/40 w-full sm:w-fit",
      )}
    >
      {VIEWS.map(({ id, label, shortLabel, icon: Icon, hash }) => {
        const selected = active === id;
        const badge = badges?.[id];
        return (
          <button
            key={id}
            type="button"
            onClick={() => {
              onChange(id);
              if (typeof window !== "undefined") {
                window.history.replaceState(null, "", hash);
              }
            }}
            className={cn(
              "relative flex-1 min-h-[44px] px-3 py-2.5 rounded-lg touch-target",
              "text-xs font-mono uppercase tracking-wider",
              "flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-0.5 sm:gap-2",
              "transition-colors duration-200",
              selected
                ? "text-background"
                : "text-foreground-muted hover:text-foreground",
            )}
          >
            {selected && (
              <motion.span
                layoutId={isDock ? "agent-dock-pill" : "agent-section-pill"}
                className="absolute inset-0 rounded-lg bg-foreground"
                transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              <Icon className="w-3.5 h-3.5 shrink-0" />
              {isDock ? (
                <span className="text-[10px]">{shortLabel}</span>
              ) : (
                <>
                  <span className="hidden sm:inline">{label}</span>
                  <span className="sm:hidden">{shortLabel}</span>
                </>
              )}
            </span>
            {badge && (
              <span
                className={cn(
                  "relative z-10 text-[9px] font-mono normal-case tracking-normal px-1.5 py-0.5 rounded-full",
                  selected
                    ? "bg-background/20 text-background"
                    : "bg-surface/60 text-foreground-dim",
                )}
              >
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );

  if (isDock) {
    return (
      <div
        className={cn(
          "fixed bottom-0 left-0 right-0 z-40 px-3 pb-3 pt-2 sm:hidden",
          className,
        )}
      >
        {nav}
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {nav}
      {showContext && (
        <p className="text-xs text-foreground-dim leading-relaxed max-w-xl hidden sm:block">
          {VIEW_CONTEXT[active]}
        </p>
      )}
    </div>
  );
}

export type { AgentView } from "./agent-section-nav-types";
export { hashToView, VIEW_CONTEXT } from "./agent-section-nav-types";
