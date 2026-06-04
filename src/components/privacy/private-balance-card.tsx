"use client";

import { motion } from "framer-motion";
import {
  ShieldCheck,
  EyeOff,
  RefreshCw,
  ExternalLink,
  Lock,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePrivacyCash } from "@/hooks/use-privacy-cash";
import { privacyCashExplorerUrl } from "@/lib/privacy-cash";

/**
 * Privacy Cash balance card.
 *
 * Displays the connected Solana wallet's private SOL balance (read via
 * LightProtocol on the server). Intentionally read-only for the browser —
 * deposits and withdrawals require a signer and should flow through a
 * backend-held session key in a future iteration.
 */
export function PrivateBalanceCard() {
  const { balance, isLoading, isConnected, publicKey, refresh } =
    usePrivacyCash();

  if (!isConnected) {
    return (
      <Card>
        <Header />
        <div className="p-5 text-center">
          <Lock className="w-6 h-6 text-foreground-dim mx-auto mb-2" />
          <p className="text-xs font-mono text-foreground-muted">
            Connect a Solana wallet to view your private balance.
          </p>
        </div>
      </Card>
    );
  }

  const explorerUrl = publicKey
    ? privacyCashExplorerUrl(publicKey)
    : null;

  return (
    <Card>
      <Header />
      <div className="p-5 space-y-4">
        {/* Balance */}
        <div className="flex items-baseline justify-between">
          <div className="flex items-center gap-2">
            <EyeOff className="w-4 h-4 text-foreground-muted" />
            <span className="text-xs font-mono uppercase tracking-wider text-foreground-muted">
              Private SOL
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={isLoading}
            className="h-7 px-2 text-foreground-muted hover:text-foreground"
          >
            <RefreshCw
              className={cn(
                "w-3.5 h-3.5",
                isLoading && "animate-spin",
              )}
            />
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-4 text-foreground-muted">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            <span className="text-xs font-mono">Reading private state…</span>
          </div>
        ) : balance.ok ? (
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums text-foreground">
              {balance.solFormatted}
            </span>
            <span className="text-sm font-mono text-foreground-muted">
              SOL
            </span>
          </div>
        ) : (
          <div className="rounded-lg bg-foreground/5 border border-border p-3">
            <p className="text-xs font-mono text-foreground-muted">
              {balance.error ?? "Unable to read private balance"}
            </p>
            <p className="text-[10px] font-mono text-foreground-dim mt-1">
              Privacy Cash requires a Solana RPC that supports LightProtocol.
              Configure HELIUS_API_KEY or HELIUS_RPC_URL server-side.
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="pt-3 border-t border-border/50 flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-wider text-foreground-dim">
            Powered by LightProtocol
          </span>
          {explorerUrl && (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-mono uppercase tracking-wider text-signal hover:text-signal/80 flex items-center gap-1"
            >
              Explorer
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border bg-surface/40 overflow-hidden h-full"
    >
      {children}
    </motion.div>
  );
}

function Header() {
  return (
    <div className="px-5 py-3 border-b border-border/50 flex items-center gap-2">
      <ShieldCheck className="w-3.5 h-3.5 text-patience" />
      <h3 className="text-xs font-mono uppercase tracking-wider text-foreground">
        Private Treasury
      </h3>
    </div>
  );
}
