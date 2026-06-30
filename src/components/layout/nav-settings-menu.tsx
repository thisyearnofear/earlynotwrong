"use client";

import { Settings, Sparkles, Zap } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Settings popover that consolidates feature-flag toggles previously rendered
 * inline in the navbar (Demo / Showcase mode + Mantle mode). Keeping these
 * out of the top-level nav reclaims horizontal space and makes the connect
 * + wallet UX the visual centre of attention.
 */
export function NavSettingsMenu({ className }: { className?: string }) {
  const { isShowcaseMode, toggleShowcaseMode, mantle } = useAppStore();

  const anyActive = isShowcaseMode || mantle.isMantleMode;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-10 w-10 text-foreground-muted hover:text-foreground relative",
            className,
          )}
          aria-label="Settings"
          title="Settings"
        >
          <Settings className="w-5 h-5" />
          {anyActive && (
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-signal shadow-[0_0_6px_var(--signal)]" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-[10px] font-mono uppercase tracking-widest text-foreground-muted">
          Modes
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <SettingRow
          icon={<Sparkles className="w-4 h-4 text-signal" />}
          label="Demo Mode"
          hint="Show showcase data"
          active={isShowcaseMode}
          onToggle={() => toggleShowcaseMode()}
          accent="signal"
        />

        <SettingRow
          icon={<Zap className="w-4 h-4 text-[#65b3ae]" />}
          label="Mantle Mode"
          hint="Highlight ERC-8004 anchor"
          active={mantle.isMantleMode}
          onToggle={() =>
            useAppStore
              .getState()
              .setMantleState({ isMantleMode: !mantle.isMantleMode })
          }
          accent="mantle"
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SettingRow({
  icon,
  label,
  hint,
  active,
  onToggle,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  active: boolean;
  onToggle: () => void;
  accent: "signal" | "mantle";
}) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center w-full gap-3 px-2 py-2.5 rounded-sm hover:bg-surface-hover transition-colors text-left"
      role="menuitemcheckbox"
      aria-checked={active}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-foreground">{label}</span>
        <span className="block text-[10px] text-foreground-dim font-mono">
          {hint}
        </span>
      </span>
      <span
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          active
            ? accent === "mantle"
              ? "bg-[#65b3ae]"
              : "bg-signal"
            : "bg-surface",
        )}
      >
        <span
          className={cn(
            "pointer-events-none block h-3.5 w-3.5 rounded-full bg-white shadow-lg ring-0 transition-transform",
            active ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}
