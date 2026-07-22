"use client";

import Link from "next/link";
import { ExternalLink, FileCode2, BookOpen, Terminal, ShoppingBag, Network, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  crooStoreUrl,
  DOCS_MCP_INTEGRATION,
  DOCS_CROO_INTEGRATION,
  CROO_REQUESTER_PATH,
  SIGNALS_SCHEMA_URL,
  SIGNALS_EXAMPLE_URL,
  MCP_ENDPOINT,
} from "@/lib/marketing-urls";
import { HIRE_AGENT_HREF, SIGNALS_LIVE_PRICE_USDC } from "@/lib/croo-store";

const REQUESTER_SNIPPET = `cd examples/croo-requester
npm install && npm run dry-run    # no payment
export CROO_SDK_KEY=croo_sk_...   # requester key (not provider)
npm start                         # live CROO purchase`;

const MCP_TOOLS = [
  { name: "get_latest_conviction", description: "Current top signals + scores", price: "FREE", isNew: false },
  { name: "get_by_thesis", description: "Query by thesis hash", price: "FREE", isNew: false },
  { name: "get_agent_reputation", description: "Behavioral metrics + archetype", price: "FREE", isNew: false },
  { name: "get_jury_deliberation", description: "LLM jury reasoning + verdicts", price: "FREE", isNew: true },
  { name: "get_subject_history", description: "Historical conviction records", price: "$0.10 CSPR", isNew: false },
  { name: "cross_chain_lookup", description: "Cross-chain anchor verification", price: "$0.10 CSPR", isNew: false },
  { name: "get_live_signals", description: "Full signals-live/v1.2 payload", price: "$0.50 CSPR", isNew: false },
] as const;

interface IntegrationHubProps {
  className?: string;
}

export function IntegrationHub({ className }: IntegrationHubProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/50 bg-surface/25 overflow-hidden",
        className,
      )}
    >
      <div className="px-4 py-3 border-b border-border/40">
        <p className="text-[10px] font-mono uppercase tracking-widest text-signal">
          Integrate as a buyer agent
        </p>
        <p className="text-xs text-foreground-muted mt-1 leading-relaxed">
          Autonomous contrarian conviction on BSC — ranked entry candidates, macro gates,
          per-cycle execution alignment, on-chain proof, and skip / wait / evaluate guidance.
          One schema on two rails.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/40">
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Network className="w-4 h-4 text-signal" />
            <span className="text-xs font-semibold text-foreground">MCP · Casper x402</span>
          </div>
          <p className="text-[10px] font-mono text-foreground-muted leading-relaxed">
            Direct HTTP for AI clients. Free trust queries;{" "}
            <span className="text-foreground">get_live_signals</span> at 0.5 CSPR returns
            signals-live/v1.2.
          </p>
          <p className="text-[10px] font-mono text-foreground-dim break-all">
            {MCP_ENDPOINT}
          </p>
          <Link
            href={HIRE_AGENT_HREF}
            className="inline-flex items-center gap-1 text-[10px] font-mono text-signal hover:underline"
          >
            MCP config + curl on this page
          </Link>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-[#65b3ae]" />
            <span className="text-xs font-semibold text-foreground">CROO · USDC on Base</span>
          </div>
          <p className="text-[10px] font-mono text-foreground-muted leading-relaxed">
            Store discovery for allocator agents. Service{" "}
            <span className="text-foreground">signals-live</span> (${SIGNALS_LIVE_PRICE_USDC}{" "}
            USDC) — identical JSON payload. Requirements:{" "}
            <code className="text-foreground">{`{}`}</code> only.
          </p>
          <a
            href={crooStoreUrl("integration-hub", "hire-button")}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] font-mono text-[#65b3ae] hover:underline"
          >
            Open CROO Store listing
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* ── MCP Tools Surface — 7 tools exposed by the agent's MCP server ── */}
      <div className="px-4 py-3 border-t border-border/40">
        <div className="flex items-center gap-2 mb-2">
          <Wrench className="w-3.5 h-3.5 text-signal" />
          <span className="text-[10px] font-mono uppercase tracking-widest text-signal">
            MCP Tools (7)
          </span>
          <span className="text-[10px] font-mono text-foreground-dim normal-case tracking-normal">
            — exposed at {MCP_ENDPOINT.replace("https://", "")}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {MCP_TOOLS.map((tool) => (
            <div
              key={tool.name}
              className={cn(
                "flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[10px] font-mono",
                tool.isNew
                  ? "border-purple-500/30 bg-purple-500/5"
                  : "border-border/30 bg-surface/30",
              )}
            >
              <code className={cn(
                "text-foreground shrink-0",
                tool.isNew && "text-purple-400 font-semibold",
              )}>
                {tool.name}
              </code>
              <span className="text-foreground-dim truncate hidden sm:inline">
                {tool.description}
              </span>
              <span className={cn(
                "ml-auto shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold",
                tool.price === "FREE"
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-amber-500/10 text-amber-400",
              )}>
                {tool.isNew && (
                  <span className="mr-1 text-purple-400">NEW</span>
                )}
                {tool.price}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="px-4 py-3 border-t border-border/40 flex flex-wrap gap-2">
        <a
          href={DOCS_MCP_INTEGRATION}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border border-signal/30 text-signal hover:bg-signal/10 transition-colors"
        >
          <BookOpen className="w-3 h-3" />
          MCP + CROO integration guide
          <ExternalLink className="w-3 h-3" />
        </a>
        <a
          href={SIGNALS_SCHEMA_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border border-border/50 text-foreground-muted hover:text-signal hover:border-signal/30 transition-colors"
        >
          <FileCode2 className="w-3 h-3" />
          JSON Schema
          <ExternalLink className="w-3 h-3" />
        </a>
        <a
          href={SIGNALS_EXAMPLE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border border-border/50 text-foreground-muted hover:text-signal hover:border-signal/30 transition-colors"
        >
          Example response
          <ExternalLink className="w-3 h-3" />
        </a>
        <a
          href={CROO_REQUESTER_PATH}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border border-border/50 text-foreground-muted hover:text-signal hover:border-signal/30 transition-colors"
        >
          <Terminal className="w-3 h-3" />
          Reference requester
          <ExternalLink className="w-3 h-3" />
        </a>
        <a
          href={DOCS_CROO_INTEGRATION}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border border-border/50 text-foreground-muted hover:text-[#65b3ae] hover:border-[#65b3ae]/30 transition-colors"
        >
          CROO troubleshooting
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      <div className="px-4 py-3 border-t border-border/40 bg-black/20">
        <p className="text-[10px] font-mono text-foreground-dim mb-2 uppercase tracking-wider">
          Reference requester — dry run
        </p>
        <pre className="text-[10px] font-mono text-foreground-muted overflow-x-auto whitespace-pre-wrap">
          {REQUESTER_SNIPPET}
        </pre>
      </div>
    </div>
  );
}
