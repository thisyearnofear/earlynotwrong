"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { DisclosureSection } from "@/components/agent/disclosure-section";
import { NORTH_STAR_SHORT } from "@/lib/product-copy";

interface DemoWalkthroughIntroProps {
  cycle: number;
  nextRunAt?: number;
}

/** Compact demo header — one line visible; guide collapsed by default. */
export function DemoWalkthroughIntro({ cycle, nextRunAt }: DemoWalkthroughIntroProps) {
  const nextMin =
    nextRunAt != null
      ? Math.max(0, Math.round((nextRunAt - Date.now()) / 60_000))
      : null;

  return (
    <div className="space-y-2">
      <p className="text-sm text-foreground-muted leading-relaxed">
        Guided four-act walkthrough — pick an act above, expand sections as you go.
        <span className="text-foreground-dim font-mono text-[10px] ml-2">
          cycle #{cycle}
          {nextMin != null ? ` · next ~${nextMin}m` : ""}
        </span>
      </p>

      <DisclosureSection
        title="Walkthrough guide"
        subtitle="Pipeline · chains · conviction-core"
        icon={<Sparkles className="w-3.5 h-3.5 text-signal" />}
      >
        <div className="space-y-3 text-xs text-foreground-muted leading-relaxed">
          <p>{NORTH_STAR_SHORT}</p>
          <p>
            Every cycle: data → score → manage → execute → anchor → narrate.
            Anchored to{" "}
            <span className="text-signal">Casper Testnet + Mantle Sepolia</span>.
            The{" "}
            <Link href="/analyzer" className="text-signal hover:underline">
              wallet analyzer
            </Link>{" "}
            uses the same <span className="font-mono">conviction-core</span> framework.
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono text-foreground-dim">
            <span>
              <span className="text-signal">Act 1</span> Live status
            </span>
            <span>
              <span className="text-signal">Act 2</span> Score & trade
            </span>
            <span>
              <span className="text-signal">Act 3</span> Anchor proof
            </span>
            <span>
              <span className="text-signal">Act 4</span> Verify & hire
            </span>
          </div>
        </div>
      </DisclosureSection>
    </div>
  );
}
