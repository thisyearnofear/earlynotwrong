/**
 * MCP server — exposes the agent's cross-chain reputation registry to any
 * MCP-compatible client (Claude Desktop, Cursor, custom agents, etc.).
 *
 * The transport is mounted at /mcp on the existing Hono server (see
 * src/server.ts) — one HTTP boot, shared state. We're NOT spinning up a
 * second process: ENHANCEMENT FIRST.
 *
 * Tool implementations live in ./tools.ts as pure functions over the
 * AnchorAdapter interface; this file just wires them into MCP via zod
 * schemas + the SDK's Hono-friendly transport.
 *
 * Free vs paid: the paywall middleware (./x402.ts) decides per-tool. The
 * MCP server itself doesn't know about pricing — it just calls the tools.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
  crossChainLookup,
  getAgentReputation,
  getByThesis,
  getJuryDeliberation,
  getLatestConviction,
  getLiveSignalsV1,
  getSubjectHistory,
} from "./tools.js";

/** Zod schema for a 0x-prefixed 32-byte hex string (keccak256 digest). */
const Bytes32HexSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, "expected 0x-prefixed 32-byte hex")
  .transform((s) => s.toLowerCase() as `0x${string}`);

const SubjectInputShape = { subjectHash: Bytes32HexSchema };
const ThesisInputShape = { thesisHash: Bytes32HexSchema };

/**
 * Build a fresh MCP server instance with our tool surface registered.
 * Called per HTTP request because the WebStandardStreamableHTTPServerTransport
 * is request-scoped (stateless mode). Stateful mode would let us reuse one
 * server + transport across many requests; for read-only tools, stateless is
 * simpler and avoids cross-tenant leakage.
 */
export function buildMcpServer(): McpServer {
  const server = new McpServer({
    name: "early-not-wrong-reputation",
    version: "0.1.0",
  });

  server.registerTool(
    "get_latest_conviction",
    {
      description:
        "Get the most recent conviction record for an agent (by subject hash) across either Mantle or Casper. FREE — designed for quick reputation checks before paid lookups.",
      inputSchema: {
        ...SubjectInputShape,
        preferChain: z.enum(["mantle", "casper"]).optional(),
      },
    },
    async (args) => {
      const result = await getLatestConviction({
        subjectHash: args.subjectHash,
        preferChain: args.preferChain,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    "get_by_thesis",
    {
      description:
        "Look up a specific anchored thesis by its 32-byte hash. Returns the record from whichever chain it lives on, or null if never anchored.",
      inputSchema: ThesisInputShape,
    },
    async (args) => {
      const result = await getByThesis({ thesisHash: args.thesisHash });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    "get_subject_history",
    {
      description:
        "Full chronological history of every conviction record anchored for a subject, across both Mantle and Casper. PAID (x402).",
      inputSchema: SubjectInputShape,
    },
    async (args) => {
      const result = await getSubjectHistory({ subjectHash: args.subjectHash });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    "cross_chain_lookup",
    {
      description:
        "Side-by-side dual-chain view for a subject: counts, latest record, in-sync status (do both chains agree on the most recent thesis?). PAID (x402).",
      inputSchema: SubjectInputShape,
    },
    async (args) => {
      const result = await crossChainLookup({ subjectHash: args.subjectHash });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    "get_agent_reputation",
    {
      description:
        "Aggregate reputation report for an agent: total anchors, mean conviction score, dual-chain presence, distinct archetypes. The one-shot 'should I trust this agent' lookup. FREE — the trust decision gates everything else, so it costs nothing.",
      inputSchema: SubjectInputShape,
    },
    async (args) => {
      const result = await getAgentReputation({ subjectHash: args.subjectHash });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    "get_jury_deliberation",
    {
      description:
        "Get the LLM conviction jury's latest deliberation — the 7th scoring factor. Returns the LLM provider/model, market assessment, per-token verdicts (adjustments, reasoning, agreement levels, key risks), and the Casper ecosystem cross-chain context fed to the jury. FREE — this is metadata about the scoring process, not the tradeable signals themselves.",
      inputSchema: {},
    },
    async () => {
      const result = await getJuryDeliberation();
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    "get_live_signals",
    {
      description:
        "The agent's LIVE conviction signals for the current cycle: market regime (score/label/FGI), top token conviction scores with factor breakdowns and rationale, macro-pause status, and cycle metadata. The tradeable data. PAID (x402, 0.5 CSPR).",
      inputSchema: {},
    },
    async () => {
      const result = await getLiveSignalsV1({
        settlementRail: "mcp-x402",
        tool: "get_live_signals",
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  return server;
}

/**
 * Handle a single MCP HTTP request from Hono.
 *
 * Stateless mode: one server + transport per request, ephemeral. This is the
 * pattern the docs recommend for serverless / stateless deployments, and it
 * fits our read-only tool surface fine — no cross-request state to preserve.
 *
 * Pass the Hono raw request in (`c.req.raw`); we return a Web Standard
 * Response that Hono streams back to the client.
 */
export async function handleMcpRequest(req: Request): Promise<Response> {
  const server = buildMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: no session id
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(req);
  } finally {
    // No persistent state; transport closes naturally with the Response stream.
  }
}
