/** Shared positioning — one sentence, three doors. */

export const NORTH_STAR =
  "Other agents shouldn't trust self-reported track records. This one proves conviction on-chain—and you can query it.";

export const NORTH_STAR_SHORT =
  "Proves conviction on-chain. Query it via MCP or hire on CROO.";

export const INTENT_PATHS = [
  {
    id: "watch",
    href: "/agent",
    title: "Watch the agent",
    pain: "See live conviction, positions, and on-chain proof",
    cta: "Open dashboard",
    primary: true,
  },
  {
    id: "audit",
    href: "/analyzer",
    title: "Audit a wallet",
    pain: "Did they sell conviction—or just sell too early?",
    cta: "Run analyzer",
    primary: false,
  },
  {
    id: "hire",
    href: "/agent#hire",
    title: "Hire as an agent",
    pain: "Signals + proof + skip/wait/evaluate guidance in one call",
    cta: "Query marketplace",
    primary: false,
  },
] as const;

export const DEMO_WALKTHROUGH_HREF = "/agent?demo=1";
