export type AgentView = "live" | "proof" | "hire";

export function hashToView(hash: string): AgentView {
  if (hash === "#proof" || hash === "#act-3") return "proof";
  if (hash === "#hire" || hash === "#act-4") return "hire";
  return "live";
}

export const VIEW_CONTEXT: Record<AgentView, string> = {
  live: "Top conviction signal and open positions — tap a row for thesis detail.",
  proof: "Thesis hashes anchored on Casper + Mantle each cycle.",
  hire: "Query signals-live/v1.2 via MCP or CROO — same payload, two rails.",
};
