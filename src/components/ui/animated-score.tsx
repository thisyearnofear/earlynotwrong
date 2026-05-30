"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface AnimatedScoreProps {
  value: number;
  duration?: number;
  className?: string;
}

export function AnimatedScore({ value, duration = 1200, className }: AnimatedScoreProps) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    let start = 0;
    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(eased * value);

      setDisplay(current);

      if (progress < 1) {
        start = requestAnimationFrame(tick);
      }
    };

    start = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(start);
  }, [value, duration]);

  return (
    <span className={cn("tabular-nums", className)}>
      {display}
    </span>
  );
}
