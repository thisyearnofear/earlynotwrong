"use client";

/**
 * LLM Conviction Jury card — the 7th scoring factor.
 *
 * Extracted from src/app/agent/page.tsx. Renders the jury's market assessment,
 * per-token verdicts (adjustments, reasoning, agreement, key risks), and the
 * provider/model when an LLM key is configured (template mode otherwise).
 */

import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ConvictionData } from "@/components/agent/agent-types";

export function LlmJuryCard({ conviction }: { conviction: ConvictionData | null }) {
  return (
    <Card className="bg-surface/30 border-border/50 border-purple-500/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
          <span className="w-3.5 h-3.5 rounded-full bg-purple-400/80 flex items-center justify-center text-[8px]">
            AI
          </span>
          LLM Conviction Jury
          <span className="ml-1 text-[9px] font-mono normal-case tracking-normal text-purple-400/70">
            7th factor
          </span>
          {conviction?.llmDeliberation && (
            <span className="ml-auto text-[9px] font-mono text-foreground-dim normal-case tracking-normal">
              {conviction.llmDeliberation.provider === "template"
                ? "template mode"
                : `${conviction.llmDeliberation.provider} · ${conviction.llmDeliberation.model}`}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-1 space-y-2.5">
        {conviction?.llmDeliberation && conviction.llmDeliberation.verdicts.length > 0 ? (
          <>
            <div className="p-2.5 rounded-lg bg-purple-500/5 border border-purple-500/15">
              <span className="text-[9px] font-mono uppercase tracking-wider text-purple-400/70">
                Market Assessment
              </span>
              <p className="text-xs text-foreground/80 mt-1 leading-relaxed">
                {conviction.llmDeliberation.marketAssessment}
              </p>
            </div>
            {conviction.llmDeliberation.verdicts.slice(0, 5).map((v, i) => {
              const agreementColor =
                v.agreement === "strong-agree" ? "text-emerald-400" :
                v.agreement === "agree" ? "text-emerald-400/70" :
                v.agreement === "neutral" ? "text-foreground-dim" :
                v.agreement === "disagree" ? "text-amber-400" :
                "text-impatience";
              const adjColor = v.adjustment > 0 ? "text-purple-400" : v.adjustment < 0 ? "text-rose-400" : "text-foreground-dim";
              const baseScore = v.adjustedScore - v.adjustment;
              return (
                <motion.div
                  key={v.symbol}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.06 }}
                  className="p-2.5 rounded-lg bg-surface/40 border border-border/30 hover:border-purple-500/20 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold">{v.symbol}</span>
                    <span className={`text-[10px] font-mono ${agreementColor}`}>
                      {v.agreement.replace("-", " ")}
                    </span>
                    <span className="ml-auto flex items-center gap-1 text-[10px] font-mono tabular-nums">
                      <span className="text-foreground-dim line-through">{baseScore}</span>
                      <span className={v.adjustment < 0 ? "text-rose-400" : v.adjustment > 0 ? "text-purple-400" : "text-foreground-dim"}>
                        {v.adjustment < 0 ? "→" : v.adjustment > 0 ? "→" : "="}
                      </span>
                      <span className={adjColor}>{v.adjustedScore}</span>
                      <span className={`px-1 py-0.5 rounded text-[9px] font-bold ${v.adjustment < 0 ? "bg-rose-500/15 text-rose-400" : v.adjustment > 0 ? "bg-purple-500/15 text-purple-400" : "bg-foreground-dim/10 text-foreground-dim"}`}>
                        {v.adjustment >= 0 ? "+" : ""}{v.adjustment}
                      </span>
                    </span>
                  </div>
                  <p className="text-[11px] text-foreground/70 leading-relaxed mb-1">
                    {v.reasoning}
                  </p>
                  <div className="flex items-start gap-1 text-[10px] font-mono text-foreground-dim">
                    <span className="text-amber-400/70 shrink-0">⚠ risk:</span>
                    <span>{v.keyRisk}</span>
                  </div>
                </motion.div>
              );
            })}
            <div className="text-[9px] font-mono text-foreground-dim pt-1">
              {conviction.llmDeliberation.tokensEvaluated} tokens evaluated ·
              deliberated {new Date(conviction.llmDeliberation.deliberatedAt).toLocaleTimeString()} ·
              reasoning digest anchored on-chain
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-foreground-muted">
            <span className="w-8 h-8 rounded-full bg-purple-400/20 flex items-center justify-center text-[10px] font-mono text-purple-400 mb-2">
              AI
            </span>
            <p className="text-xs font-mono">Jury in template mode</p>
            <p className="text-[10px] font-mono text-foreground-dim mt-1 text-center max-w-xs">
              No LLM API key configured — the jury runs with zero adjustments.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
