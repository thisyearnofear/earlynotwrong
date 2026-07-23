"use client";

import { useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

interface DisclosureSectionProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}

/** Progressive disclosure panel — ease-out, ~200ms, no height jank. */
export function DisclosureSection({
  title,
  subtitle,
  icon,
  badge,
  defaultOpen = false,
  children,
  className,
}: DisclosureSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className={cn(
        "rounded-xl border border-border/40 bg-surface/20 overflow-hidden",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "w-full flex items-center gap-2 px-4 py-3 text-left",
          "text-xs font-mono uppercase tracking-wider text-foreground-muted",
          "hover:text-signal transition-colors duration-200",
          "active:scale-[0.995] motion-reduce:active:scale-100",
        )}
      >
        {icon && <span className="shrink-0">{icon}</span>}
        <span className="font-semibold normal-case tracking-normal text-foreground text-sm">
          {title}
        </span>
        {subtitle && (
          <span className="hidden sm:inline text-[10px] font-mono text-foreground-dim normal-case tracking-normal truncate">
            {subtitle}
          </span>
        )}
        {badge && <span className="ml-1 shrink-0">{badge}</span>}
        <ChevronDown
          className={cn(
            "w-4 h-4 ml-auto shrink-0 text-foreground-dim",
            "transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
            open && "rotate-180",
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
            className="border-t border-border/30"
          >
            <div className="px-4 pb-4 pt-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
