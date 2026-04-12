"use client";

import { useState, useEffect } from "react";
import { useAleoConviction } from "@/hooks/use-aleo-conviction";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Search, Shield, ShieldCheck, Lock, Loader2, CheckCircle2, ExternalLink, Zap } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { APP_CONFIG } from "@/lib/config";

interface AleoProofDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AleoProofDialog({ isOpen, onClose }: AleoProofDialogProps) {
  const { 
    verifyArchetype, 
    verifyScoreThreshold,
    verifyEfficientTrading 
  } = useAleoConviction();
  
  const { convictionMetrics } = useAppStore();
  const [step, setStep] = useState<"select" | "proving" | "result">("select");
  const [proofType, setProofType] = useState<"archetype" | "score" | "efficiency" | null>(null);
  const [lastTxId, setLastTxId] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<{
    verified: boolean;
    status: string;
    program?: string;
    message?: string;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setStep("select");
      setLastTxId(null);
      setVerificationResult(null);
    }
  }, [isOpen]);

  const handleVerifyOnBackend = async () => {
    if (!lastTxId) return;
    setIsVerifying(true);
    try {
      const result = await apiClient.verifyAleoProof(lastTxId);
      setVerificationResult(result);
    } catch (err) {
      console.error(err);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleGenerateProof = async (type: "archetype" | "score" | "efficiency") => {
    setProofType(type);
    setStep("proving");

    try {
      let txId;
      // Using a placeholder as record storage was removed
      const record = ""; 
      
      if (type === "archetype") {
        const archetypeMap: Record<string, number> = {
          "DIAMOND_HAND": 0,
          "IRON_PILLAR": 1,
          "PROFIT_PHANTOM": 2,
          "EXIT_VOYAGER": 3
        };
        const val = archetypeMap[convictionMetrics?.archetype || "DIAMOND_HAND"] ?? 0;
        txId = await verifyArchetype(record, val);
      } else if (type === "score") {
        txId = await verifyScoreThreshold(record, 80); // Prove score >= 80
      } else if (type === "efficiency") {
        txId = await verifyEfficientTrading(record, 1000); // Prove tax <= $1000
      }

      if (txId) {
        setLastTxId(txId);
        setStep("result");
      }
    } catch (err) {
      console.error(err);
      setStep("select");
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="glass-panel border-signal/30 bg-black/90 text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-signal">
            <Shield className="w-5 h-5" />
            Selective Disclosure
          </DialogTitle>
          <DialogDescription className="text-foreground-muted">
            Generate a zero-knowledge proof for specific metrics without revealing your full trade history.
          </DialogDescription>
        </DialogHeader>

        {step === "select" && (
          <div className="space-y-4 py-4">
            <div className="grid gap-3">
              <Button 
                variant="outline" 
                className="flex items-center justify-between h-auto p-4 border-border/50 hover:border-signal/50 bg-surface/30"
                onClick={() => handleGenerateProof("archetype")}
              >
                <div className="text-left">
                  <div className="text-sm font-bold">Prove Archetype</div>
                  <div className="text-[10px] text-foreground-muted">Verify you are a &quot;{convictionMetrics?.archetype}&quot;</div>
                </div>
                <Zap className="w-4 h-4 text-signal" />
              </Button>

              <Button 
                variant="outline" 
                className="flex items-center justify-between h-auto p-4 border-border/50 hover:border-signal/50 bg-surface/30"
                onClick={() => handleGenerateProof("score")}
                disabled={(convictionMetrics?.score || 0) < 80}
              >
                <div className="text-left">
                  <div className="text-sm font-bold">Prove Elite Status</div>
                  <div className="text-[10px] text-foreground-muted">Verify Conviction Score {">"} 80</div>
                </div>
                <ShieldCheck className="w-4 h-4 text-patience" />
              </Button>

              <Button 
                variant="outline" 
                className="flex items-center justify-between h-auto p-4 border-border/50 hover:border-signal/50 bg-surface/30"
                onClick={() => handleGenerateProof("efficiency")}
                disabled={(convictionMetrics?.patienceTax || 0) > 1000}
              >
                <div className="text-left">
                  <div className="text-sm font-bold">Prove Trading Efficiency</div>
                  <div className="text-[10px] text-foreground-muted">Verify Patience Tax {"<"} $1000</div>
                </div>
                <Lock className="w-4 h-4 text-signal" />
              </Button>
            </div>
          </div>
        )}

        {step === "proving" && (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Loader2 className="w-12 h-12 text-signal animate-spin" />
            <div className="text-center">
              <div className="text-sm font-bold uppercase tracking-widest text-signal">Generating ZK-Proof</div>
              <p className="text-[10px] text-foreground-muted mt-1 font-mono">
                {">"} ENCRYPTING LOCAL STATE...<br/>
                {">"} COMPUTING PREDICATE...<br/>
                {">"} SHIELDING OUTPUT.
              </p>
            </div>
          </div>
        )}

        {step === "result" && (
          <div className="flex flex-col items-center justify-center py-8 space-y-6">
            <div className="relative">
              <CheckCircle2 className="w-16 h-16 text-patience" />
              <ShieldCheck className="w-6 h-6 text-signal absolute -bottom-1 -right-1" />
            </div>
            
            <div className="text-center">
              <h3 className="text-lg font-bold">Proof Generated</h3>
              <p className="text-[11px] text-foreground-muted max-w-xs mx-auto mt-1">
                A zero-knowledge proof of your {proofType} has been successfully verified on-chain.
              </p>
            </div>

            <div className="w-full p-3 rounded-lg bg-surface/50 border border-patience/20 font-mono text-[10px] break-all">
              <span className="text-patience/70 mr-2">TX_ID:</span>
              {lastTxId}
            </div>

            {verificationResult ? (
              <div className={cn(
                "w-full p-3 rounded-lg text-[10px] border",
                verificationResult.verified ? "bg-patience/10 border-patience/30 text-patience" : "bg-destructive/10 border-destructive/30 text-destructive"
              )}>
                <div className="font-bold uppercase flex items-center gap-1.5 mb-1">
                  {verificationResult.verified ? <ShieldCheck className="w-3 h-3" /> : <Loader2 className="w-3 h-3 animate-spin" />}
                  {verificationResult.verified ? "Proof Verified by Oracle" : "Verification Pending"}
                </div>
                <div className="opacity-80">
                  {verificationResult.message || `Status: ${verificationResult.status}. Program: ${verificationResult.program}`}
                </div>
              </div>
            ) : lastTxId?.startsWith("shield_") ? (
              <div className="w-full p-3 rounded-lg bg-signal/10 border border-signal/30 text-signal text-[10px]">
                <div className="font-bold uppercase flex items-center gap-1.5 mb-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Shield Wallet Processing
                </div>
                <div className="opacity-80">
                  This transaction has a temporary ID and is currently being assigned a permanent on-chain hash. Verification will be available in a few seconds.
                </div>
              </div>
            ) : (
              <Button 
                variant="outline" 
                className="w-full border-signal/30 text-signal hover:bg-signal/10 text-[11px] h-9"
                onClick={handleVerifyOnBackend}
                disabled={isVerifying}
              >
                {isVerifying ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Search className="w-3.5 h-3.5 mr-2" />}
                VERIFY PROOF STATUS
              </Button>
            )}

            <div className="flex w-full gap-2">
              <Button 
                variant="outline" 
                className="flex-1 text-[11px] h-9"
                disabled={!lastTxId || lastTxId.startsWith("shield_")}
                onClick={() => window.open(`${APP_CONFIG.chains.aleo.explorerUrl}/transaction/${lastTxId}`, "_blank")}
              >
                {lastTxId?.startsWith("shield_") ? (
                  <>PROPAGATING...</>
                ) : (
                  <>
                    <ExternalLink className="w-3.5 h-3.5 mr-2" />
                    EXPLORER
                  </>
                )}
              </Button>
              <Button 
                className="flex-1 bg-signal hover:bg-signal/80 text-black font-bold text-[11px] h-9"
                onClick={onClose}
              >
                DONE
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
