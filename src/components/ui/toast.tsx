"use client";

import { useAppStore } from "@/lib/store";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, AlertCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Toast() {
  const { toast, hideToast } = useAppStore();

  const icons = {
    success: <CheckCircle className="w-4 h-4 text-patience" />,
    error: <AlertCircle className="w-4 h-4 text-impatience" />,
    info: <Info className="w-4 h-4 text-signal" />,
  };

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] pointer-events-none">
      <AnimatePresence>
        {toast.isVisible && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className={cn(
              "pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg border shadow-2xl backdrop-blur-md min-w-[300px] max-w-md",
              toast.type === "success" && "bg-patience/10 border-patience/20",
              toast.type === "error" && "bg-impatience/10 border-impatience/20",
              toast.type === "info" && "bg-surface/80 border-border"
            )}
          >
            <div className="shrink-0">{icons[toast.type]}</div>
            
            <div className="flex-1 text-sm font-medium text-foreground">
              {toast.message}
            </div>

            <button
              onClick={hideToast}
              className="shrink-0 p-1 rounded-md hover:bg-foreground/5 transition-colors"
            >
              <X className="w-3.5 h-3.5 text-foreground-muted" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
