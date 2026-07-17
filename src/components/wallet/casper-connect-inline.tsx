"use client";

import Link from "next/link";
import { CheckCircle2, ExternalLink, Loader2, Wallet } from "lucide-react";
import { useConnections } from "@/hooks/use-connections";
import { OpenConnectionsButton } from "@/components/wallet/open-connections-button";
import { cn } from "@/lib/utils";

function shortKey(hex: string): string {
  if (hex.length <= 14) return hex;
  return `${hex.slice(0, 8)}…${hex.slice(-6)}`;
}

/** Compact Casper row for analyzer anchor tab — connect via panel, anchor on /agent. */
export function CasperConnectInline({ className }: { className?: string }) {
  const { casper, openConnections } = useConnections();
  const { status, isConnected, publicKey } = casper;

  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-teal-400/30 bg-teal-400/5 p-4 flex flex-col gap-3",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <div className="w-1 h-3 bg-teal-400 rounded-full shrink-0" />
        <p className="text-[10px] font-mono uppercase tracking-wider text-foreground-dim">
          Casper anchor
        </p>
      </div>

      {status === "loading" && (
        <div className="flex items-center gap-2 text-[11px] font-mono text-foreground-muted">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Detecting Casper Wallet…
        </div>
      )}

      {(status === "not-installed" || status === "conflict") && (
        <div className="space-y-2">
          <p className="text-[11px] text-foreground-muted leading-relaxed">
            Install the Casper Wallet extension, then connect in Connections.
          </p>
          <div className="flex flex-wrap gap-2">
            <OpenConnectionsButton
              focus="casper"
              size="sm"
              className="rounded-full text-[10px] font-mono uppercase tracking-wider h-8"
            >
              Open Connections
            </OpenConnectionsButton>
            <a
              href="https://www.casperwallet.io/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-3 h-8 rounded-full border border-border/50 text-[10px] font-mono text-foreground-muted hover:text-signal transition-colors"
            >
              Install extension
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      )}

      {status === "locked" && (
        <p className="text-[11px] font-mono text-foreground-muted">
          Unlock Casper Wallet in your browser, then{" "}
          <OpenConnectionsButton focus="casper" variant="link" className="text-[11px]">
            connect
          </OpenConnectionsButton>
          .
        </p>
      )}

      {(status === "disconnected" || status === "connecting") && (
        <div className="space-y-2">
          <p className="text-[11px] text-foreground-muted leading-relaxed">
            Connect Casper to sign a personal conviction record on testnet.
          </p>
          <OpenConnectionsButton
            focus="casper"
            size="sm"
            disabled={status === "connecting"}
            className="rounded-full text-[10px] font-mono uppercase tracking-wider h-8"
          >
            {status === "connecting" ? (
              <>
                <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                Connecting…
              </>
            ) : (
              <>
                <Wallet className="w-3 h-3 mr-1.5" />
                Connect Casper
              </>
            )}
          </OpenConnectionsButton>
        </div>
      )}

      {isConnected && publicKey && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] font-mono text-foreground">
            <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 shrink-0" />
            <span className="truncate">{shortKey(publicKey)}</span>
          </div>
          <p className="text-[11px] text-foreground-muted leading-relaxed">
            Full anchor form (balance, thesis, sign proof) lives on the agent
            dashboard.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/agent#personal-anchor"
              className="inline-flex items-center gap-1 px-3 h-8 rounded-full bg-signal text-background text-[10px] font-mono font-semibold hover:bg-signal/90 transition-colors"
            >
              Open anchor form
            </Link>
            <button
              type="button"
              className="inline-flex items-center gap-1 px-3 h-8 rounded-full border border-border/50 text-[10px] font-mono text-foreground-muted hover:text-foreground transition-colors"
              onClick={() => openConnections("casper")}
            >
              Manage connection
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
