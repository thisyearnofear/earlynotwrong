"use client";

import { useState } from "react";
import { useAleoConviction } from "@/hooks/use-aleo-conviction";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Shield, Lock, Send, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function AleoPrivateThesis() {
  const { commitPrivateThesis, isMinting, lastTxId, isAleoConnected } = useAleoConviction();
  const { setWalletModalOpen } = useAppStore();
  const [thesis, setThesis] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!thesis || !targetPrice) return;
    
    setError(null);
    try {
      // Simple hash simulation: in a real app we'd use a proper field hash function
      // Here we just use a numeric representation of the first few chars for demo
      const hash = BigInt(
        thesis.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)
      ).toString();
      
      await commitPrivateThesis(hash, parseFloat(targetPrice));
      setIsSuccess(true);
      setThesis("");
      setTargetPrice("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to commit thesis");
    }
  };

  return (
    <Card className="glass-panel border-signal/30 bg-black/40 relative overflow-hidden">
      <div className="absolute top-0 right-0 p-4 opacity-10">
        <Lock className="w-16 h-16 text-signal" />
      </div>

      <CardHeader>
        <CardTitle className="text-sm font-mono text-signal tracking-widest uppercase flex items-center gap-2">
          <Shield className="w-4 h-4" />
          Private Strategist
        </CardTitle>
        <CardDescription className="text-xs text-foreground-muted">
          Commit your trade thesis to Aleo. Hides your intent from MEV bots and copy-traders. 
          Only reveal when you are ready to prove you were &quot;early&quot;.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {isSuccess ? (
          <div className="py-8 flex flex-col items-center text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-signal/20 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-signal" />
            </div>
            <div className="space-y-1">
              <h4 className="text-foreground font-bold">Thesis Committed</h4>
              <p className="text-xs text-foreground-muted max-w-[250px]">
                Your intent is now secured on Aleo. Transaction ID: <br/>
                <span className="text-[10px] font-mono break-all">{lastTxId}</span>
              </p>
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              className="font-mono text-[10px]"
              onClick={() => setIsSuccess(false)}
            >
              COMMIT ANOTHER
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-mono text-foreground-muted uppercase">Trade Thesis (Secret)</label>
              <Textarea 
                placeholder="e.g. Buying $ALE because of V4 mainnet hype..."
                className="bg-surface border-border min-h-[80px] text-xs resize-none"
                value={thesis}
                onChange={(e) => setThesis(e.target.value)}
                disabled={isMinting || !isAleoConnected}
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-[10px] font-mono text-foreground-muted uppercase">Target Exit Price ($)</label>
              <Input 
                type="number"
                placeholder="0.00"
                className="bg-surface border-border h-9 text-xs"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                disabled={isMinting || !isAleoConnected}
              />
            </div>

            {error && (
              <div className="p-2 rounded bg-impatience/10 border border-impatience/20 flex items-center gap-2 text-impatience text-[10px]">
                <AlertCircle className="w-3 h-3 shrink-0" />
                {error}
              </div>
            )}

            <Button
              type={isAleoConnected ? "submit" : "button"}
              className="w-full bg-signal hover:bg-signal/80 text-black font-bold h-10"
              disabled={isMinting || (isAleoConnected && (!thesis || !targetPrice))}
              onClick={isAleoConnected ? undefined : () => setWalletModalOpen(true)}
            >
              {isMinting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  SHIELDING INTENT...
                </>
              ) : isAleoConnected ? (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  COMMIT PRIVATE THESIS
                </>
              ) : (
                <>
                  <Shield className="w-4 h-4 mr-2" />
                  CONNECT SHIELD WALLET
                </>
              )}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
