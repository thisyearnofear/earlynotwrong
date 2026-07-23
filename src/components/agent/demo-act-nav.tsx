"use client";

import { cn } from "@/lib/utils";
import { ElectricBorder } from "@/components/ui/electric-border";

export type DemoAct = 1 | 2 | 3 | 4;

const ACTS: { id: DemoAct; label: string; short: string; blurb: string }[] = [
  { id: 1, label: "Act 1 · Live", short: "Live", blurb: "Agent status, health, and trace" },
  { id: 2, label: "Act 2 · Score", short: "Score", blurb: "Conviction signals, jury, positions" },
  { id: 3, label: "Act 3 · Proof", short: "Proof", blurb: "Mantle + Casper anchor ledger" },
  { id: 4, label: "Act 4 · Hire", short: "Hire", blurb: "Query, integrate, and hire" },
];

interface DemoActNavProps {
  active: DemoAct;
  onChange: (act: DemoAct) => void;
  className?: string;
}

export function DemoActNav({ active, onChange, className }: DemoActNavProps) {
  const current = ACTS.find((a) => a.id === active)!;

  return (
    <div className={cn("space-y-2", className)}>
      <nav
        aria-label="Demo walkthrough acts"
        className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {ACTS.map((act) => {
          const selected = active === act.id;
          return (
            <ElectricBorder
              key={act.id}
              as="button"
              type="button"
              hint={!selected}
              active={selected}
              borderRadius={999}
              onClick={() => onChange(act.id)}
              aria-current={selected ? "step" : undefined}
              className={cn(
                "shrink-0 px-3 py-1.5 rounded-full text-[10px] font-mono uppercase tracking-wider transition-colors",
                selected
                  ? "bg-signal/15 text-signal"
                  : "text-foreground-muted hover:text-foreground bg-surface/30",
              )}
            >
              <span className="hidden sm:inline">{act.label}</span>
              <span className="sm:hidden">{act.short}</span>
            </ElectricBorder>
          );
        })}
      </nav>
      <p className="text-[10px] font-mono text-foreground-dim">
        {current.blurb}
      </p>
    </div>
  );
}

export { ACTS as DEMO_ACTS };
