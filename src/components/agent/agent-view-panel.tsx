"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

interface AgentViewPanelProps {
  viewKey: string;
  children: ReactNode;
  /** Tab switch animation (simple view). Demo mode uses scroll layout instead. */
  animate?: boolean;
  id?: string;
}

/** Tab content wrapper — ease-out enter/exit (~200ms) or static scroll section (demo). */
export function AgentViewPanel({
  viewKey,
  children,
  animate = true,
  id,
}: AgentViewPanelProps) {
  if (!animate) {
    return (
      <motion.div
        id={id}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: EASE_OUT }}
        className="space-y-4"
      >
        {children}
      </motion.div>
    );
  }

  return (
    <motion.div
      key={viewKey}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.2, ease: EASE_OUT }}
      className="space-y-6"
    >
      {children}
    </motion.div>
  );
}
