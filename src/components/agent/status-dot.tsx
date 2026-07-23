import { cn } from "@/lib/utils";

export function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        "inline-block w-2 h-2 rounded-full shadow-[0_0_8px]",
        ok ? "bg-patience shadow-patience/50" : "bg-impatience shadow-impatience/50",
      )}
    />
  );
}
