"use client";

/**
 * Wallet Search Input Component
 * 
 * Allows users to search and analyze any wallet by:
 * - Ethereum/Solana address
 * - ENS name (vitalik.eth)
 * - Farcaster handle (@username)
 * 
 * Uses identity resolution service to normalize inputs.
 */

import * as React from "react";
import { useState } from "react";
import { Search, Loader2, X, CheckCircle2, AlertCircle } from "lucide-react";
import { useWalletIdentity } from "@/hooks/use-wallet-analysis";
import type { ResolvedIdentity } from "@/lib/services/identity-resolver";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface WalletSearchInputProps {
  onWalletSelected: (identity: ResolvedIdentity) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  showResolvedPreview?: boolean;
}

export function WalletSearchInput({
  onWalletSelected,
  placeholder = "vitalik.eth, 0x..., or @username",
  className,
  autoFocus = false,
  showResolvedPreview = true,
}: WalletSearchInputProps) {
  const [input, setInput] = useState("");
  const { identity, loading, error, resolve, reset } = useWalletIdentity(null, false);

  const handleSearch = async () => {
    if (!input.trim()) return;
    await resolve(input.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  const handleClear = () => {
    setInput("");
    reset();
  };

  const handleSelect = () => {
    if (identity) {
      onWalletSelected(identity);
      // Optionally clear after selection
      // handleClear();
    }
  };

  return (
    <div className={cn("space-y-3", className)}>
      {/* Search Input */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
          {loading ? (
            <Loader2 className="w-5 h-5 text-foreground-muted animate-spin" />
          ) : (
            <Search className="w-5 h-5 text-foreground-muted" />
          )}
        </div>

        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          disabled={loading}
          className={cn(
            "w-full pl-10 pr-10 py-3 bg-surface border border-border rounded-lg",
            "text-foreground placeholder:text-foreground-muted",
            "focus:outline-none focus:ring-2 focus:ring-signal focus:border-transparent",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            "transition-all duration-200"
          )}
        />

        {input && (
          <button
            onClick={handleClear}
            className="absolute inset-y-0 right-0 flex items-center pr-3 hover:opacity-70 transition-opacity"
            type="button"
          >
            <X className="w-5 h-5 text-foreground-muted" />
          </button>
        )}
      </div>

      {/* Search Button */}
      {input && !identity && (
        <Button
          onClick={handleSearch}
          disabled={loading || !input.trim()}
          className="w-full"
          variant="default"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Resolving...
            </>
          ) : (
            <>
              <Search className="w-4 h-4 mr-2" />
              Search Wallet
            </>
          )}
        </Button>
      )}

      {/* Error State */}
      {error && (
        <div className="flex items-start gap-2 p-3 bg-impatience/10 border border-impatience/30 rounded-lg">
          <AlertCircle className="w-5 h-5 text-impatience flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-impatience">Could not resolve wallet</p>
            <p className="text-xs text-foreground-muted mt-1">
              {error || "Please check the address, ENS name, or handle and try again."}
            </p>
          </div>
        </div>
      )}

      {/* Resolved Identity Preview */}
      {showResolvedPreview && identity && (
        <div className="p-4 bg-surface border border-border rounded-lg space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              {/* Avatar/Icon */}
              <div className="w-12 h-12 rounded-full bg-signal/20 border border-signal/30 flex items-center justify-center flex-shrink-0">
                {identity.ens.avatar ? (
                  <img
                    src={identity.ens.avatar}
                    alt={identity.ens.name || "Wallet"}
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  <CheckCircle2 className="w-6 h-6 text-signal" />
                )}
              </div>

              {/* Identity Info */}
              <div className="flex-1 min-w-0">
                {/* Primary Name */}
                <h3 className="font-semibold text-foreground truncate">
                  {identity.ens.name || 
                   identity.farcaster?.displayName || 
                   `${identity.address.slice(0, 6)}...${identity.address.slice(-4)}`}
                </h3>

                {/* Secondary Info */}
                <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-foreground-muted">
                  {identity.farcaster && (
                    <span className="flex items-center gap-1">
                      @{identity.farcaster.username}
                    </span>
                  )}
                  {identity.ens.name && identity.farcaster && (
                    <span className="text-border">•</span>
                  )}
                  <span className="font-mono">
                    {identity.address.slice(0, 6)}...{identity.address.slice(-4)}
                  </span>
                </div>

                {/* Ethos Score */}
                {identity.ethos.score && (
                  <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-ethos/10 border border-ethos/30">
                    <span className="text-xs font-medium text-ethos">
                      Ethos: {identity.ethos.score.score}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Success Icon */}
            <CheckCircle2 className="w-5 h-5 text-signal flex-shrink-0" />
          </div>

          {/* Social Proof Badges */}
          <div className="flex flex-wrap gap-2">
            {identity.ens.name && (
              <span className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-surface border border-border">
                ✓ ENS
              </span>
            )}
            {identity.farcaster && (
              <span className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-surface border border-border">
                ✓ Farcaster
              </span>
            )}
            {identity.ethos.profile && (
              <span className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-surface border border-border">
                ✓ Ethos
              </span>
            )}
            {identity.lens?.handle && (
              <span className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-surface border border-border">
                ✓ Lens
              </span>
            )}
          </div>

          {/* Analyze Button */}
          <Button
            onClick={handleSelect}
            className="w-full"
            variant="default"
          >
            Analyze Wallet
          </Button>
        </div>
      )}
    </div>
  );
}
