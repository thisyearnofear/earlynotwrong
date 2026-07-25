# Early, Not Wrong — Casper Agentic Buildathon 2026 Submission

> **Agent reputation marketplace, natively on Casper.**  
> Autonomous conviction → on-chain proof → MCP-queriable reputation → x402 micropayments.

---

## TL;DR

This submission is a **Casper-native reputation marketplace for AI agents**, built around an autonomous DeFi agent. The agent makes contrarian-conviction decisions, then anchors a verifiable record of every thesis to Casper. Other AI agents query that record through **Model Context Protocol** and pay per call with **x402 CEP-18 micropayments** — a paywall pattern that EVM cannot replicate without extra services.

We built the Casper layer — the Odra smart contract, the Casper adapter, the MCP server, and the x402 middleware — for the **Casper Agentic Buildathon 2026**. The BSC trading agent is its conviction source, not a side feature.

| Component | Status |
|---|---|
| Autonomous AI agent with 7-factor conviction engine (6 deterministic + LLM jury) | Live |
| LLM conviction jury — OpenRouter (openrouter/auto) with on-chain reasoning digest | Live on VPS |
| Casper ecosystem MCP consumer — CSPR.trade + blockchain MCP as cross-chain signal input | Live |
| Odra `ConvictionRegistry` on Casper Testnet | Deployed |
| MCP server (7 tools) — exposes conviction data to other agents | Live |
| x402 paid paywall via cspr.cloud facilitator | Live |
| Casper Wallet browser extension integration — connect, sign, user-initiated anchoring | Live |
| Next.js web app — landing page, dashboard, wallet analyzer | Live |
| Cross-chain anchoring — Casper + Mantle + Aleo | Live |
| CROO Agent Store — `signals-live` ($0.05 USDC on Base) | Live + 3 verified purchases |
| Test suite (Vitest) | 23 files, 306 tests |

---

## Casper AI Toolkit Usage

Every component of the [Casper AI Toolkit](https://www.casper.network/ai) is used in this submission:

| Toolkit Component | How We Use It | Status |
|---|---|---|
| **Odra Framework** | `ConvictionRegistry` smart contract in Rust, compiled to WASM, deployed on Casper Testnet. On-chain tests via `cargo odra test`. | Deployed |
| **MCP Servers** | Agent exposes 7 tools at `POST /mcp` (Streamable HTTP transport). Agent also *consumes* 2 Casper ecosystem MCP servers (CSPR.trade + Casper blockchain) as cross-chain context for the LLM jury. Bidirectional MCP participant. | Live |
| **x402 Micropayments** | HTTP-native paywall middleware: paid MCP tools return `PaymentRequirements`, clients sign CEP-18 transfer authorization, CSPR.cloud facilitator verifies + submits on-chain. Facilitator pays gas. | Live |
| **CSPR.cloud APIs** | RPC for contract writes (`put_transaction`), contract reads (`state_get_dictionary_item` for free CES event reads), and balance checks. RPC fallback chain with 429 backoff. | Live |
| **casper-js-sdk** | `ContractCallBuilder` for anchor transaction construction, `SessionBuilder` for contract deploys, Ed25519 key signing. | Live |
| **Casper Wallet (browser extension)** | In-browser wallet connect (`window.CasperWalletProvider`), message signing for proof, user-initiated anchoring via build-anchor/submit-anchor flow. No private keys leave the browser. | Live |

---

## RWA Applicability

The reputation marketplace applies directly to **Real-World Asset (RWA) oracle agents**, one of the buildathon's example build directions:

> *"RWA Oracle Agents with Verifiable On-Chain Identity: an agent that scrapes off-chain data, runs a risk assessment model, and posts verified data on-chain via x402."*

Our architecture is a drop-in template for this use case:

1. **An RWA oracle agent** scrapes off-chain data (real-estate yields, commodity prices, credit scores).
2. It runs a **risk assessment model** (our 7-factor conviction engine is the analog — any model fits the `ConvictionRecord` schema).
3. It posts the result to the **`ConvictionRegistry` on Casper** with the same `anchor_conviction` entry point, creating a verifiable on-chain track record.
4. Other agents query its historical accuracy via **MCP** and pay per call with **x402**.
5. The oracle's **reputation score** (mean accuracy, anchor count, dual-chain presence) is computed from the same on-chain record.

The `AnchorAdapter` interface (`agent/lib/anchors/types.ts`) is generic — any "subject → record" data fits it. An RWA oracle would anchor risk assessments instead of trading theses; the MCP tools, x402 paywall, and reputation scoring all work unchanged. This is the **trust-minimized RWA oracle** pattern the buildathon description calls for, built on Casper's native primitives.

---

## Live Links

- **Landing page** — https://earlynotwrong.vercel.app/
- **Agent dashboard** — https://earlynotwrong.vercel.app/agent
- **Wallet analyzer** — https://earlynotwrong.vercel.app/analyzer
- **Casper contract package** — https://testnet.cspr.live/contract-package/973e3c8654e6ee030483969503f21d6fab543317ef60ea2ca041a8e905087afa
- **MCP endpoint** — `POST http://144.202.117.160:31777/mcp`
- **Agent API** — `GET http://144.202.117.160:31777/status`
- **Reputation stats** — `GET http://144.202.117.160:31777/reputation/stats`
- **CROO Agent Store** — https://agent.croo.network/agents/90dd0e5a-a551-4dfb-aa64-b3c0274c2205 (`signals-live`, $0.05 USDC)
- **GitHub** — https://github.com/thisyearnofear/earlynotwrong
- **Twitter/X** — https://x.com/earlynotwrong
- **Telegram** — https://t.me/earlynotwrong

---

## The Problem

AI agents are about to trade, lend, and govern on-chain. But **no agent can trust another agent's self-reported track record**. We need a verifiable, portable reputation layer — and a payment rail that lets agents pay each other for that data without human setup.

Casper uniquely provides the primitives to fix this:

| Capability | Why it matters |
|---|---|
| Odra smart contracts | Deploy a registry in Rust that any agent can read/write. |
| MCP servers | Standard tool surface that Claude Desktop, Cursor, and custom agents consume natively. |
| x402 micropayments | HTTP-native, per-request payment with cryptographic proof — no subscription, no custody. |
| cspr.cloud facilitator | The facilitator pays the on-chain CSPR gas; clients only sign a CEP-18 transfer authorization. |

This is what we built.

---

## What We Built for This Buildathon

### 1. Casper ConvictionRegistry (Odra / Rust)

`casper/src/conviction_registry.rs` — a smart contract that stores immutable conviction analysis records. Each record contains a subject hash, thesis hash, conviction score, archetype label, and timestamp. The contract emits CES events on every anchor and provides read methods for history, latest record, and point lookup by thesis hash.

Key design choices:

- **Same schema as Mantle ERC-8004** — cross-chain reputation parity.
- **Permissionless anchoring** — any caller can anchor; the caller address is recorded as `anchored_by`, removing Casper 2.0 entity-model friction without changing the trust story.
- **On-chain tests** — `cargo odra test` covers deploy, anchor/read-back, history accumulation, and score validation.

### 2. Casper Adapter

`agent/lib/anchors/casper.ts` — the bridge between the agent and Casper.

- **Writes**: builds a `ContractCallBuilder` transaction, signs with the operator Ed25519 key, and calls `anchor_conviction` via `cspr.cloud` RPC.
- **Reads**: walks the contract's CES `__events` dictionary with `state_get_dictionary_item` — free, no gas — and decodes each event with a custom `bytesrepr` parser.
- **Edge cases handled**: em-dash UTF-8 panic in Odra strings, `CLList<U8>` vs `CLByteArray(N)` distinction, event-log cache TTL.

### 3. MCP Server

`agent/src/mcp/server.ts` and `agent/src/mcp/tools.ts` — six tools served on the existing Hono process at `POST /mcp`:

| Tool | Price | Purpose |
|---|---|---|
| `get_latest_conviction` | Free | Most recent record across Mantle + Casper. |
| `get_by_thesis` | Free | Point lookup by 32-byte thesis hash. |
| `get_agent_reputation` | Free | Aggregate report: total anchors, mean score, dual-chain presence. |
| `get_jury_deliberation` | Free | LLM jury verdicts: provider, model, per-token adjustments, reasoning, Casper ecosystem context. |
| `get_subject_history` | 0.1 CSPR | Full chronological history. |
| `cross_chain_lookup` | 0.1 CSPR | Side-by-side Mantle + Casper view with sync flag. |
| `get_live_signals` | 0.5 CSPR | Live conviction signals for the current cycle (the tradeable data). |

The trust-decision queries are free — including the jury deliberation and aggregate reputation report a first-time evaluator needs to decide whether to trust the agent at all. The paid tier is the recurring-value data: history walks, cross-chain reconciliation, and the agent's live current-cycle conviction signals.

### 4. x402 Paywall

`agent/src/mcp/x402.ts` — Hono middleware that:

1. Detects paid MCP tools.
2. Returns `HTTP 402 + PaymentRequirements` if no payment header is present.
3. Decodes the client's `X-PAYMENT` header and forwards it to `https://x402-facilitator.cspr.cloud/settle`.
4. On facilitator success, attaches `X-PAYMENT-RESPONSE` and serves the tool result.

This makes the reputation marketplace **self-funding at the API-request level**.

### 4b. CROO Agent Protocol — second settlement rail

The same live conviction SKU is also hireable on the **[CROO Agent Store](https://agent.croo.network/agents/90dd0e5a-a551-4dfb-aa64-b3c0274c2205)** via **CAP** (CROO Agent Protocol), settled in **USDC on Base**. Service **`signals-live`** ($0.05) returns the identical **`signals-live/v1.2`** JSON as MCP's paid `get_live_signals` — including ranked signals, macro gates, per-cycle **execution** alignment, on-chain **provenance**, and buyer **guidance** (`skip_entries` | `evaluate` | `wait`).

| Rail | Discovery | Settlement | SKU |
|------|-----------|------------|-----|
| **MCP + x402** | Direct HTTP / AI clients | CSPR (Casper testnet, CEP-18) | `get_live_signals` · 0.5 CSPR |
| **CROO CAP** | Agent Store | USDC (Base) | `signals-live` · $0.05 |

Casper remains the **MCP host chain** and public registry; CROO is the **USDC commerce layer** for allocator agents that discover services on the Store. One conviction engine, two payment rails, one schema: [`signals-live-v1.2.schema.json`](https://earlynotwrong.vercel.app/schemas/signals-live-v1.2.schema.json). Verified Store purchases (2026-07-17): `d3e51b1f-…`, `ad8b40fc-…`, `0990e061-…` (3 completed after clearing empty Deliverable Schema). See [`docs/CROO_INTEGRATION.md`](docs/CROO_INTEGRATION.md).

### 4c. LLM Conviction Jury — the 7th scoring factor

`agent/lib/llm-jury.ts` — an LLM-powered conviction jury that reviews the top-scoring token candidates each cycle and adjusts their conviction scores by ±15 points based on market context the deterministic scoring can't capture.

**How it works:**

1. After the 6-factor deterministic scoring completes, the top candidates are packaged with their price data, breakdown, regime context, and news headlines.
2. The jury sends a structured prompt to an LLM (OpenRouter `openrouter/auto` preferred, OpenAI/Anthropic fallback, template mode if no key) asking for per-token adjustments, reasoning traces, agreement levels, and key risks.
3. The LLM returns JSON verdicts. Adjustments are clamped to ±15 and applied to the conviction score — **the AI actually moves the score**, it's not just decoration.
4. A deliberation digest (deterministic hash of provider, model, and per-token adjustments) is included in the thesis hash anchored on Casper — **proving the AI participated in the decision, not just the commentary**.
5. When no API key is configured, a template mode generates zero-adjustment verdicts with rule-based reasoning, so the system degrades gracefully.

**Why this matters for the buildathon:**

This is **meaningful AI integration** — the LLM's judgment directly influences trading decisions, and its reasoning is provably anchored on-chain. The jury uses OpenRouter (`openrouter/auto`) as its primary provider, routing to the best available free model for maximum reliability. The jury can see cross-chain context (Casper DEX prices, network status) alongside BSC signals, giving it a multi-chain perspective. **Live on VPS** — first deployed cycle delivered real verdicts (DAI -4, USDC -4, XRP -8 with "strong-disagree" on XRP due to SEC litigation risk).

### 4d. Casper Ecosystem MCP Consumer — the agent as MCP client

`agent/lib/casper-mcp-client.ts` — the agent doesn't just EXPOSE an MCP server; it CONSUMES the Casper ecosystem's MCP servers as part of its trading cycle.

**Two MCP servers consumed:**

| MCP Server | Endpoint | Data fetched | Used for |
|---|---|---|---|
| CSPR.trade | `https://mcp.cspr.trade/mcp` | Token prices, pair liquidity, DEX tokens | Cross-chain price comparison, Casper DEX health signal |
| Casper Blockchain | `https://mcp.cspr-ai.xyz/mcp` | Era, validators, total stake, supply | Network health monitoring, macro context |

The Casper ecosystem context is:
1. Fed to the LLM jury as cross-chain market context (the jury can see what's happening on Casper's DEX alongside BSC signals)
2. Stored in agent state and surfaced on the dashboard
3. Included in the cycle summary logs

This makes the agent a **bidirectional participant in the Casper agent economy** — it both provides conviction data via its own MCP server and consumes Casper-native data from the ecosystem's MCP servers. The consumer module degrades gracefully: if either MCP endpoint is unreachable, the jury proceeds without cross-chain context (no crash, no stall). Both endpoints were temporarily unavailable at deploy time; the code will pick up data automatically when they return.

### 5. Next.js Web App — 3-Page Architecture

#### Landing page (`/`)

A single-narrative landing page that tells the product story in 4 acts and gets visitors to click "Enter the Dashboard". It fetches live agent status and conviction signals on mount, so a visitor sees real data before clicking through:

- **Hero**: "Being early feels like being wrong." + live indicator ("Agent live · cycle 127 · 12m ago") + chain strip (Casper · Mantle · Aleo)
- **4 Acts**: Score → Trade → Anchor → Verify, each card with a live data point (top signal scores, trade count, chain count, wallet link)
- **Live conviction preview**: top 4 signals with scores and rationale from the current cycle
- **Primary CTA**: "Enter the Dashboard" → `/agent`; secondary: "Wallet Analyzer" → `/analyzer`

#### Agent dashboard (`/agent`)

A 4-act guided scroll that mirrors the landing page's narrative but with full depth. Each act surfaces progressively more detail:

- **Act 1 — Agent is live**: Orientation text + cycle timeline strip (`✓ data → ✓ score → ✓ manage → ✓ execute → ✓ anchor → ✓ narrate · next in 47m`) + 4 status cards (portfolio, guardrails, performance, behavioral self-score)
- **Act 2 — It scores conviction**: Conviction Signals card (6-factor breakdown per token, regime score, signal weights) + Conviction Ledger card (held positions with the conviction score that motivated each entry). Includes the **"Early, Not Wrong" callout** — when a position was held through ≥10% drawdown and is now profitable, a highlighted box shows the full arc: `FET · scored 72 → entered cycle 124 → dipped −15.2% → held 3 cycles → now +38.4%`. This is the product thesis made visible in one data point.
- **Act 3 — It anchors on-chain**: Multi-chain anchor panel showing all three chains (Casper, Mantle, Aleo) with equal visual weight — each with its own colored status card, latest tx hash, and explorer link. Chain legend explains why three chains: `Casper = public registry · Mantle = EVM mirror · Aleo = privacy proof`. Rolling history list below with per-chain color coding.
- **Act 4 — Anchor your own**: Casper Wallet connect panel (balance, anchor form pre-filled from the agent's live conviction data, sign proof) + Agent-to-Agent Reputation card (MCP query stats, x402 fees collected, CROO CAP services). The wallet extension is the sole signer; no private keys leave the browser.
- **Supporting detail**: Recent trades, market data (Fear & Greed, funding rates, BTC dominance), AI market narrative, pipeline architecture diagram, resource links.

The same `conviction-core` framework that scores the agent's trades also powers the wallet analyzer — this connection is surfaced explicitly in the orientation text.

#### Wallet analyzer (`/analyzer`)

The behavioral wallet analyzer — a separate tool that applies the same conviction lens to any wallet. Users paste a BSC address, and the analyzer fetches on-chain transaction history, builds a canonical ledger, and runs `conviction-core`'s `calculateBehavioralMetrics` to produce a behavioral conviction score, archetype classification, and position-by-position analysis. Includes showcase wallets, deep-link support (`?wallet=0x...`), and a "Verify & Anchor" disclosure that lets users anchor their analysis to Casper/Mantle.

#### Shared design system

All three pages share a distinctive aesthetic: a tunnel-gradient background, a signal/patience/impatience color system (green/purple/red), monospace labels with uppercase tracking, glass-panel cards with subtle borders, and staggered motion reveals. The visual language is consistent across the landing page, dashboard, and analyzer.

---

## Reproduce the Live 402 Challenge (One Command)

```bash
curl -sS -X POST http://144.202.117.160:31777/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get_live_signals",
      "arguments": {}
    }
  }'
```

Returns a live Casper `PaymentRequirements` object. A client with the testnet `Cep18x402` token can then sign and re-POST with `X-PAYMENT` to complete the paid round trip.

### Live 402 evidence (captured 2026-07-17)

Direct POST to the agent MCP endpoint — no payment header:

```bash
curl -sS -i -X POST http://144.202.117.160:31777/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_live_signals","arguments":{}}}'
```

Response:

```
HTTP/1.1 402 Payment Required
content-type: application/json

{"x402Version":2,"accepts":[{"scheme":"exact","network":"casper:casper-test","payTo":"23058a429ae31f0de556b5747546cc6d7817a559afe2657f297186dc509cd30a","amount":"50","asset":"9824d60dc3a5c44a20b9fd260a412437933835b52fc683d8ae36e4ec2114843e","maxTimeoutSeconds":300,"extra":{"name":"Cep18x402","version":"1","decimals":"2","symbol":"CSPR"}}],"error":"payment required for this MCP tool"}
```

`amount: "50"` with 2-decimal CEP-18 = **0.5 CSPR** per `get_live_signals` call. The trust-decision query `get_agent_reputation` remains free (returns live aggregate stats with no wallet).

Free tools work immediately without payment:

```bash
curl -sS -X POST http://144.202.117.160:31777/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_latest_conviction","arguments":{"subjectHash":"0x4a937673ea542abdf587e6b509793b2173980228cc65180a2f32c24fd3ac459a"}}}'
```

---

## Why This Fits the Buildathon

- **Agentic AI**: the agent autonomously fetches market data, scores conviction with a 7-factor engine (6 deterministic + LLM jury), manages positions, executes trades, and anchors theses to Casper without human intervention. The LLM conviction jury reviews top candidates each cycle, adjusts scores ±15 based on cross-chain context, and its reasoning digest is anchored on-chain — **meaningful AI integration, not cosmetic**. The agent is also a **bidirectional MCP participant**: it exposes 7 MCP tools for other agents to query, and consumes 2 Casper ecosystem MCP servers (CSPR.trade + blockchain) as cross-chain signal input.
- **DeFi**: the agent trades BSC assets with self-custody execution, and the reputation layer applies directly to DeFi agents (yield bots, oracles, treasury managers).
- **RWA**: the reputation marketplace is a drop-in template for RWA oracle agents — any agent that scrapes off-chain data, runs a risk model, and posts results on-chain gets the same verifiable track record. See the **RWA Applicability** section above.
- **Casper-native**: uses all 6 Casper AI Toolkit components — Odra, MCP, x402, CSPR.cloud, casper-js-sdk, and Casper Wallet. See the **Casper AI Toolkit Usage** section above. Casper is the primary anchor chain; the agent also mirrors to Mantle (EVM verification) and commits to Aleo (privacy-preserving thesis proof), giving each chain a distinct role in the conviction stack.
- **Cannot be replicated on EVM**: the x402 + MCP + facilitator combination is Casper's native agent-economy stack. We document this explicitly in `docs/CASPER_INTEGRATION.md`.

---

## Submission Checklist

| Requirement | Evidence |
|---|---|
| Working prototype on Casper Testnet with transaction-producing component | `ConvictionRegistry` deployed; live anchors visible on `testnet.cspr.live`; MCP server responding at `POST /mcp` |
| Open-source GitHub repo with README and usage docs | https://github.com/thisyearnofear/earlynotwrong + `README.md` + `AGENTS.md` + `SUBMISSION.md` |
| Demo video | [Demo video walkthrough](https://www.youtube.com/) (3-5 min: Casper contract, MCP 402 challenge, dashboard, LLM jury, anchor history) + [asciinema replay](https://asciinema.org/a/ox0AlPA1AN7uwfWJ) |
| Socials in place | [Twitter/X](https://x.com/earlynotwrong) + [Telegram](https://t.me/earlynotwrong) + [GitHub](https://github.com/thisyearnofear/earlynotwrong) |
| Long-term launch plans | See **Long-Term Launch Plans** section above (5-phase roadmap to mainnet + RWA) |
| Focus on Agentic AI / DeFi / RWA on Casper | Agentic AI + DeFi + RWA applicability, all on Casper with native MCP/x402 reputation marketplace |
| Original work for the buildathon | Casper contract, adapter, MCP server, x402 middleware, and Casper Wallet integration were built for this buildathon; see `# What We Built for This Buildathon` |

---

## Team & Origin

This submission extends a conviction-analysis platform built across several 2026 hackathons. **The Casper reputation marketplace — the Odra registry, MCP server, and x402 paywall — is new work created for the Casper Agentic Buildathon 2026.** The BSC trading agent serves as the live reputation source feeding the registry.

---

## Long-Term Launch Plans

This is a real project, not a hackathon-only demo. The agent is live on a VPS, trading on BSC testnet, anchoring to Casper testnet, and selling signals on the CROO Agent Store. Socials are in place:

- **Twitter/X**: https://x.com/earlynotwrong
- **Telegram**: https://t.me/earlynotwrong
- **GitHub**: https://github.com/thisyearnofear/earlynotwrong (open-source, MIT)
- **Live dashboard**: https://earlynotwrong.vercel.app/agent

### Roadmap to mainnet

| Phase | Timeline | Scope |
|---|---|---|
| **Phase 1: Testnet validation** (current) | Q3 2026 | Agent live, contract deployed, MCP + x402 working, 3 CROO orders verified |
| **Phase 2: Multi-agent anchoring** | Q4 2026 | Open `anchor_conviction` to other agents via a discovery directory. Any agent can publish its conviction records to the same registry and earn from MCP queries. |
| **Phase 3: CEP-18 token gating** | Q4 2026 | Tiered access: free reads (reputation), paid search (history), premium feed (live signals). CEP-18 token as access credential. |
| **Phase 4: Mainnet migration** | Q1 2027 | Migrate `ConvictionRegistry` to Casper Mainnet once x402 facilitator launches on mainnet. Agent transitions from testnet to mainnet trading. |
| **Phase 5: RWA oracle support** | Q1 2027 | Extend the `AnchorAdapter` interface to support RWA oracle agents (real-estate yields, commodity prices, credit scores). Same registry, same MCP tools, same x402 paywall. |

### Ecosystem impact

This project demonstrates a **use case Casper is uniquely positioned for**: agent-to-agent trust and payment. The x402 + MCP + facilitator combination cannot be replicated on EVM without bolting on multiple separate services. By being a reference implementation for the agent reputation marketplace pattern, this project:

- Drives MCP server adoption on Casper (other agents fork the pattern)
- Creates CEP-18 token velocity (paid queries require Cep18x402 tokens)
- Showcases Odra as a production smart contract framework for agent infrastructure
- Positions Casper as the trust layer for the agent economy

---

## Future Work

- Open `anchor_conviction` to other agents via a discovery directory.
- CEP-18 token gating for tiered access (free read / paid search / premium feed).
- Mainnet migration once the x402 facilitator launches on Casper Mainnet.
- RWA oracle agent support (same registry, different data type).
- Multi-agent reputation leaderboard (aggregate across all agents anchoring to the registry).

---

MIT License.
