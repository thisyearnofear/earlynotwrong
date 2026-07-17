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
import { Shield, Lock, Send, Loader2, CheckCircle2, AlertCircle, BotMessageSquare } from "lucide-react";
import { getAIThesisSuggestion } from "@/lib/strategist";

export function AleoPrivateThesis() {
  const { commitPrivateThesis, isMinting, lastTxId, isAleoConnected } = useAleoConviction();
  const { openConnections, convictionMetrics } = useAppStore();
  const [thesis, setThesis] = useState("");
  const [intent, setIntent] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!intent || !convictionMetrics) return;
    setIsGenerating(true);
    try {
      const generated = await getAIThesisSuggestion(intent, convictionMetrics);
      setThesis(generated);
    } catch (err) {
      setError("AI generation failed. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!thesis || !targetPrice) return;
    
    setError(null);
    try {
      const hash = BigInt(
        thesis.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)
      ).toString();
      
      await commitPrivateThesis(hash, parseFloat(targetPrice));
      setIsSuccess(true);
      setThesis("");
      setTargetPrice("");
      setIntent("");
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
          Securely commit your trade intent to Aleo to prevent front-running.
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
              <div className="flex justify-between items-center">
                <label className="text-[10px] font-mono text-foreground-muted uppercase">Trade Thesis (Secret)</label>
              </div>
              <div className="flex gap-2">
                <Input 
                  placeholder="What's your strategy? e.g. 'Shorting on trend reversal'"
                  className="bg-surface border-border h-9 text-xs flex-1"
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                />
                <Button 
                  type="button"
                  variant="outline"
                  className="h-9 border-signal/30 text-signal"
                  onClick={handleGenerate}
                  disabled={isGenerating || !intent}
                >
                  {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <BotMessageSquare className="w-4 h-4" />}
                </Button>
              </div>
              <Textarea 
                placeholder="Describe your entry and outlook..."
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
              onClick={isAleoConnected ? undefined : () => openConnections("aleo")}
            >
              {isMinting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  SHIELDING...
                </>
              ) : isAleoConnected ? (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  COMMIT THESIS
                </>
              ) : (
                <>
                  <Shield className="w-4 h-4 mr-2" />
                  CONNECT SHIELD
                </>
              )}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
