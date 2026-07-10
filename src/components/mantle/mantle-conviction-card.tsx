"use client";

import React from "react";
import { useAppStore } from "@/lib/store";
import { Zap, ShieldCheck, ExternalLink, Loader2, Anchor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { useAccount, useSwitchChain, useWriteContract } from "wagmi";
import {
  getMantleExplorerAddressUrl,
  getMantleExplorerTxUrl,
  MANTLE_CONVICTION_REGISTRY_ABI,
  MANTLE_CONVICTION_REGISTRY_ADDRESS,
  mantleSepolia,
} from "@/lib/mantle";

type MantleConvictionCardProps = {
  thesisHash: `0x${string}`;
  subjectHash: `0x${string}`;
  subjectLabel: string;
  convictionScore: number;
  archetype: string;
};

export function MantleConvictionCard({
  thesisHash,
  subjectHash,
  subjectLabel,
  convictionScore,
  archetype,
}: MantleConvictionCardProps) {
  const {
    mantle,
    anchorToMantle,
    setMantleAnchoring,
    setMantleAnchorError,
    showToast,
  } = useAppStore();
  const { address: connectedAddress, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const isAnchored = mantle.lastAnchoredThesis === thesisHash;
  const isAnchoring = mantle.isAnchoring;
  const explorerUrl = mantle.lastAnchorTxHash
    ? getMantleExplorerTxUrl(mantle.lastAnchorTxHash)
    : MANTLE_CONVICTION_REGISTRY_ADDRESS
      ? getMantleExplorerAddressUrl(MANTLE_CONVICTION_REGISTRY_ADDRESS)
      : null;

  const handleAnchor = async () => {
    if (!MANTLE_CONVICTION_REGISTRY_ADDRESS) {
      setMantleAnchorError("Mantle registry address is not configured.");
      showToast("Configure NEXT_PUBLIC_MANTLE_CONVICTION_REGISTRY first", "error");
      return;
    }

    if (!isConnected || !connectedAddress) {
      setMantleAnchorError("Connect the ENW agent/operator wallet to anchor this analysis.");
      showToast("Connect the agent wallet first", "error");
      return;
    }

    try {
      setMantleAnchoring(true);
      if (chainId !== mantleSepolia.id) {
        await switchChainAsync({ chainId: mantleSepolia.id });
      }

      const txHash = await writeContractAsync({
        address: MANTLE_CONVICTION_REGISTRY_ADDRESS,
        abi: MANTLE_CONVICTION_REGISTRY_ABI,
        functionName: "anchorConviction",
        chainId: mantleSepolia.id,
        args: [
          subjectHash,
          thesisHash,
          BigInt(Math.round(Math.max(0, Math.min(100, convictionScore)))),
          archetype,
        ],
      });

      anchorToMantle(thesisHash, txHash);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Mantle transaction failed.";
      setMantleAnchorError(message);
      showToast("Failed to anchor to Mantle", "error");
    }
  };

  return (
    <div className="p-4 rounded-xl border border-[#65b3ae]/20 bg-[#65b3ae]/5 backdrop-blur-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[#65b3ae]/10">
            <Zap className="w-4 h-4 text-[#65b3ae]" />
          </div>
          <div>
            <h4 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">
              Mantle L2 Registry
            </h4>
            <p className="text-[10px] text-foreground-muted font-mono">
              Agentic Verification Layer
            </p>
          </div>
        </div>
        
        <AnimatePresence mode="wait">
          {isAnchored ? (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-[#65b3ae]/20 border border-[#65b3ae]/30"
            >
              <ShieldCheck className="w-3 h-3 text-[#65b3ae]" />
              <span className="text-[10px] font-mono font-bold text-[#65b3ae]">VERIFIED</span>
            </motion.div>
          ) : (
            <div className="text-[10px] font-mono text-foreground-muted">
              NOT ANCHORED
            </div>
          )}
        </AnimatePresence>
      </div>

      <div className="p-3 rounded-lg bg-surface/50 border border-border/50">
        <div className="flex justify-between items-center mb-1">
          <span className="text-[10px] font-mono text-foreground-muted uppercase">Thesis Hash</span>
          <span className="text-[10px] font-mono text-foreground-muted">KECCAK-256</span>
        </div>
        <div className="font-mono text-[10px] text-foreground break-all bg-background/50 p-2 rounded border border-border/30">
          {thesisHash}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
        <div className="p-2 rounded border border-border/30 bg-background/30">
          <div className="text-foreground-muted uppercase">Score</div>
          <div className="text-foreground font-bold">{Math.round(convictionScore)}/100</div>
        </div>
        <div className="p-2 rounded border border-border/30 bg-background/30">
          <div className="text-foreground-muted uppercase">Subject</div>
          <div className="text-foreground truncate">
            {subjectLabel}
          </div>
        </div>
      </div>

      {mantle.anchorError && (
        <p className="text-[10px] text-impatience font-mono leading-relaxed">
          {mantle.anchorError}
        </p>
      )}

      <div className="flex gap-2">
        {!isAnchored ? (
          <Button
            onClick={handleAnchor}
            disabled={isAnchoring}
            className="flex-1 h-9 text-[10px] font-mono bg-[#65b3ae] hover:bg-[#54a29d] text-background border-none"
          >
            {isAnchoring ? (
              <>
                <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                ANCHORING...
              </>
            ) : (
              <>
                <Anchor className="w-3 h-3 mr-2" />
                ANCHOR TO MANTLE L2
              </>
            )}
          </Button>
        ) : (
          <Button
            variant="outline"
            className="flex-1 h-9 text-[10px] font-mono border-[#65b3ae]/30 text-[#65b3ae] hover:bg-[#65b3ae]/10"
            onClick={() => explorerUrl && window.open(explorerUrl, '_blank', 'noopener,noreferrer')}
            disabled={!explorerUrl}
          >
            <ExternalLink className="w-3 h-3 mr-2" />
            VIEW ON EXPLORER
          </Button>
        )}
      </div>

      <p className="text-[10px] text-foreground-muted font-mono leading-relaxed italic">
        * Anchoring records this cross-chain AI analysis on Mantle. Solana/Base wallet identifiers are stored as hashes; the connected EVM wallet signs as the ENW agent/operator.
      </p>
    </div>
  );
}
