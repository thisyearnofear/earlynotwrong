"use client";

import Link from "next/link";
import { ArrowRight, Wallet } from "lucide-react";
import { useConnections } from "@/hooks/use-connections";
import { OpenConnectionsButton } from "@/components/wallet/open-connections-button";
import { ALPHA_GATE_SCORE } from "@/lib/alpha/constants";

interface DiscoveryGateActionsProps {
  currentScore: number | null;
}

/**
 * Step-by-step CTAs when Conviction Discovery is Ethos-gated.
 * Discovery auth uses Base (EVM) — not Casper or Solana.
 */
export function DiscoveryGateActions({ currentScore }: DiscoveryGateActionsProps) {
  const { evm, primaryForGates } = useConnections();
  const score = currentScore ?? 0;
  const needsConnect = !evm.isConnected;
  const needsScore = score < ALPHA_GATE_SCORE;

  return (
    <div className="flex flex-col sm:flex-row items-center justify-center gap-2 mt-3 w-full max-w-md">
      {needsConnect ? (
        <OpenConnectionsButton
          focus="evm"
          className="w-full sm:w-auto rounded-full font-mono text-xs gap-2"
        >
          <Wallet className="w-3.5 h-3.5" />
          Connect Base (EVM)
        </OpenConnectionsButton>
      ) : needsScore ? (
        <Link
          href={
            primaryForGates
              ? `/analyzer?wallet=${encodeURIComponent(primaryForGates)}`
              : "/analyzer"
          }
          className="inline-flex items-center justify-center gap-2 w-full sm:w-auto rounded-full border border-border bg-background px-4 py-2 text-xs font-mono font-semibold text-foreground hover:bg-surface transition-colors"
        >
          Analyze your wallet ({score}/{ALPHA_GATE_SCORE} Ethos)
          <ArrowRight className="w-3 h-3" />
        </Link>
      ) : (
        <p className="text-[11px] font-mono text-patience">
          Requirements met — refresh if data hasn&apos;t loaded yet.
        </p>
      )}

      {!needsConnect && needsScore && (
        <OpenConnectionsButton
          focus="evm"
          variant="link"
          className="text-xs font-mono text-foreground-muted"
        >
          Wrong wallet?
        </OpenConnectionsButton>
      )}
    </div>
  );
}
