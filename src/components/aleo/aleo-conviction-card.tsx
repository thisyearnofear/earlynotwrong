"use client";

import { useState } from "react";
import { useAleoConviction } from "@/hooks/use-aleo-conviction";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Shield, ShieldCheck, Lock, Loader2, CheckCircle2, ExternalLink, Zap } from "lucide-react";
import { AleoProofDialog } from "./aleo-proof-dialog";
import { APP_CONFIG } from "@/lib/config";

export function AleoConvictionCard() {
  const { isMinting, lastTxId, mintConvictionRecord, purchasePremium, claimPatienceRebate, isAleoConnected } = useAleoConviction();
  const { convictionMetrics, isAleoPremium, setWalletModalOpen } = useAppStore();
  const [isSuccess, setIsSuccess] = useState(false);
  const [isProofDialogOpen, setIsProofDialogOpen] = useState(false);
  const [isRebateClaimed, setIsRebateClaimed] = useState(false);

  if (!convictionMetrics) return null;

  const handleMint = async () => {
    try {
      await mintConvictionRecord();
      setIsSuccess(true);
    } catch (err) {
      console.error(err);
    }
  };

  const handlePurchasePremium = async () => {
    try {
      await purchasePremium();
    } catch (err) {
      console.error(err);
    }
  };

  const handleClaimRebate = async () => {
    try {
      await claimPatienceRebate();
      setIsRebateClaimed(true);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <Card className="glass-panel border-signal/30 bg-signal/5 flex flex-col justify-between h-full relative overflow-hidden group">
      <div className="absolute top-0 right-0 p-4 opacity-20 group-hover:opacity-40 transition-opacity">
        <Shield className="w-12 h-12 text-signal" />
      </div>

      <CardHeader>
        <div className="flex items-center justify-between mb-2">
          <CardTitle className="text-sm font-mono text-signal tracking-wider uppercase flex items-center gap-2">
            <Lock className="w-3.5 h-3.5" />
            Private Proofs
          </CardTitle>
          {isAleoConnected && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-patience uppercase">
              <ShieldCheck className="w-3 h-3" />
              Shield Protected
            </span>
          )}
        </div>
        <div className="text-2xl font-bold text-foreground">
          Zero-Knowledge CI
        </div>
        <CardDescription className="text-xs text-foreground-muted">
          Commit your conviction metrics to Aleo Testnet. Prove your archetype without revealing your wallet history.
        </CardDescription>
        {/* Verifiable: link to the deployed program on the Aleo explorer.
            Lets users (and skeptical reviewers) confirm what's actually
            live before connecting a wallet. */}
        <a
          href={`${APP_CONFIG.chains.aleo.explorerUrl}/program/${APP_CONFIG.chains.aleo.programId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] font-mono text-signal/70 hover:text-signal inline-flex items-center gap-1 mt-1.5 transition-colors"
        >
          <ExternalLink className="w-2.5 h-2.5" />
          {APP_CONFIG.chains.aleo.programId} on Aleo Testnet
        </a>
      </CardHeader>

      <CardContent className="space-y-4">
        {!isSuccess ? (
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-surface/50 border border-border/50 text-[11px] font-mono text-foreground-muted leading-relaxed">
              {">"} ENCRYPTING METRICS...<br/>
              {">"} GENERATING ZK-COMMITMENT...<br/>
              {">"} READY FOR SELECTIVE DISCLOSURE.
            </div>

            <Button
              className="w-full bg-signal hover:bg-signal/80 text-black font-bold tracking-tight h-10"
              disabled={isMinting}
              onClick={isAleoConnected ? handleMint : () => setWalletModalOpen(true)}
            >
              {isMinting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  MINTING PRIVATE RECORD...
                </>
              ) : isAleoConnected ? (
                <>
                  <ShieldCheck className="w-4 h-4 mr-2" />
                  MINT PRIVATE CI RECORD
                </>
              ) : (
                <>
                  <Shield className="w-4 h-4 mr-2" />
                  CONNECT SHIELD WALLET
                </>
              )}
            </Button>
            
            {!isAleoConnected && (
              <p className="text-[10px] text-center text-foreground-muted italic">
                Connect Shield Wallet to enable privacy features
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="flex flex-col items-center justify-center gap-2 text-center">
              <CheckCircle2 className="w-10 h-10 text-patience" />
              <div className="text-sm font-bold text-foreground">Record Minted Privately</div>
              <p className="text-[10px] text-foreground-muted max-w-[200px]">
                Your conviction metrics are now stored as a private Aleo record.
              </p>
            </div>

            {lastTxId && (
              <div className="space-y-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={lastTxId.startsWith("shield_")}
                  className="w-full text-[10px] font-mono text-foreground-muted hover:text-foreground h-8 disabled:opacity-50"
                  onClick={() => window.open(`${APP_CONFIG.chains.aleo.explorerUrl}/transaction/${lastTxId}`, "_blank")}
                >
                  {lastTxId.startsWith("shield_") ? (
                    <>PROPAGATING TRANSACTION...</>
                  ) : (
                    <>
                      VIEW ON EXPLORER
                      <ExternalLink className="w-3 h-3 ml-1.5" />
                    </>
                  )}
                </Button>
                {lastTxId.startsWith("shield_") && (
                  <p className="text-[9px] text-center text-signal italic px-4 leading-tight">
                    Shield Wallet is assigning a permanent ID. Please check back in a few seconds.
                  </p>
                )}
              </div>
            )}
            
            <Button
              variant="outline"
              className="w-full border-patience/30 text-patience hover:bg-patience/10 text-xs h-9"
              onClick={() => setIsProofDialogOpen(true)}
            >
              GENERATE PROOF
            </Button>
          </div>
        )}

        <div className="pt-4 border-t border-border/10 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-mono text-signal/70 uppercase flex items-center gap-1.5">
              <Zap className="w-3 h-3" />
              Premium Alpha
            </div>
            {isAleoPremium && (
              <Badge className="bg-signal/20 text-signal border-signal/30 text-[8px] h-4 px-1">
                UNLOCKED
              </Badge>
            )}
          </div>
          
          {!isAleoPremium ? (
            <Button 
              variant="ghost" 
              className="w-full h-8 text-[9px] font-mono border border-signal/20 hover:bg-signal/10 hover:text-signal transition-all"
              onClick={handlePurchasePremium}
              disabled={isMinting || !isAleoConnected}
            >
              {isMinting ? "PROCESSING..." : "UNLOCK DEEP ALPHA (0.5 CREDITS)"}
            </Button>
          ) : (
            <div className="p-2.5 rounded-lg bg-signal/5 border border-signal/20 space-y-1.5">
              {/* Rebate row hidden when the on-chain program doesn't expose
                  claim_rebate (v2 doesn't; v3 does, but v3 isn't deployed yet).
                  Showing a button that calls a missing entry point produces
                  silent wallet errors — better to hide it cleanly. */}
              {APP_CONFIG.chains.aleo.rebatesEnabled && (
                <div className="flex justify-between items-center text-[9px] font-mono">
                  <span className="text-foreground-muted">PATIENCE REBATE:</span>
                  {!isRebateClaimed ? (
                    <button
                      onClick={handleClaimRebate}
                      disabled={isMinting || convictionMetrics.patienceTax > 1000}
                      className="text-patience hover:underline cursor-pointer disabled:opacity-50"
                    >
                      CLAIM (0.2 USDCx)
                    </button>
                  ) : (
                    <span className="text-patience/50 italic">CLAIMED</span>
                  )}
                </div>
              )}
              <div className="flex justify-between items-center text-[9px] font-mono">
                <span className="text-foreground-muted">WHALE SIGNALS:</span>
                <span className="text-signal">ACTIVE</span>
              </div>
              <div className="flex justify-between items-center text-[9px] font-mono">
                <span className="text-foreground-muted">EXIT MAP:</span>
                <span className="text-signal">SYNCED</span>
              </div>
            </div>
          )}
        </div>
      </CardContent>

      <AleoProofDialog 
        isOpen={isProofDialogOpen} 
        onClose={() => setIsProofDialogOpen(false)} 
      />
    </Card>
  );
}
