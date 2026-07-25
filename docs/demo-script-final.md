# Casper Agentic Buildathon 2026 — Final Round Demo Script

> 3-5 minute video walkthrough. Record with screen capture + voiceover.
> The goal: a judge who watches 60 seconds understands this is a Casper-native agent reputation marketplace, not a BSC trading bot.

---

## Pre-Recording Setup

1. Open these tabs:
   - https://earlynotwrong.vercel.app/agent (dashboard)
   - https://testnet.cspr.live/contract-package/973e3c8654e6ee030483969503f21d6fab543317ef60ea2ca041a8e905087afa (Casper contract)
   - Terminal (for curl commands)

2. Test that the agent is live:
   ```bash
   curl -sS http://144.202.117.160:31777/status | jq .status
   ```

---

## Script

### 0. Opening (10 seconds)

> "This is Early, Not Wrong — an agent reputation marketplace, natively on Casper. An autonomous DeFi agent makes conviction-based trading decisions, anchors every thesis to a Casper smart contract, and other AI agents query that reputation through MCP with x402 micropayments."

### 1. The Casper Smart Contract (45 seconds)

**Action:** Show the cspr.live contract page.

> "Here's the ConvictionRegistry smart contract, written in Odra — Casper's Rust framework. It's deployed on Casper Testnet. Every time the trading agent completes a cycle, it anchors a conviction record here: the subject hash, thesis hash, conviction score, and archetype. These records are immutable and publicly verifiable."

**Point to:** The contract package hash, the deploy list showing live anchors.

> "The contract uses Casper Event Standard events, so reads are completely free — no gas needed to query the reputation history."

### 2. The x402 Payment Challenge (45 seconds)

**Action:** Switch to terminal. Run:

```bash
curl -sS -X POST http://144.202.117.160:31777/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_live_signals","arguments":{}}}'
```

> "This is the MCP endpoint. When an AI agent queries the paid tool — `get_live_signals` — without payment, the server returns an HTTP 402 with Casper-native PaymentRequirements."

**Point to:** The `network: casper:casper-test`, `asset: Cep18x402`, `amount: 50` (0.5 CSPR).

> "The client signs a CEP-18 transfer authorization, re-POSTs with the X-PAYMENT header, and the cspr.cloud facilitator settles it on-chain. The facilitator pays the gas — the client only signs the transfer. This is a payment pattern EVM cannot replicate natively."

### 3. The Free MCP Tools (30 seconds)

**Action:** Run the free reputation query:

```bash
curl -sS -X POST http://144.202.117.160:31777/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_agent_reputation","arguments":{"subjectHash":"0x4a937673ea542abdf587e6b509793b2173980228cc65180a2f32c24fd3ac459a"}}}'
```

> "Trust-decision queries are free — an agent can check the reputation before deciding whether to pay. Here's the aggregate report: total anchors, mean conviction score, dual-chain presence on both Casper and Mantle."

### 4. The Dashboard (45 seconds)

**Action:** Switch to the browser, show https://earlynotwrong.vercel.app/agent

> "This is the agent dashboard. It shows the live agent's state — portfolio, conviction signals, and the cross-chain anchor panel."

**Point to:**
- The conviction signals table (6-factor breakdown + LLM jury adjustments)
- The multi-chain anchor panel (Casper, Mantle, Aleo — each with tx hash + explorer link)
- The "Agent Reputation API" panel (MCP query stats, x402 fees collected)
- The Casper Wallet connect panel

> "The same conviction framework that scores the agent's trades also powers the wallet analyzer — users can analyze any wallet's behavioral conviction and anchor the result to Casper."

### 5. The LLM Conviction Jury (30 seconds)

**Action:** Scroll to the jury deliberation section or mention it.

> "The 7th scoring factor is an LLM conviction jury. After the 6 deterministic factors score each token, an LLM reviews the top candidates and adjusts scores by up to 15 points. The jury's reasoning digest is included in the thesis hash anchored on Casper — so the AI's participation is provably on-chain, not just commentary."

> "The agent is also a bidirectional MCP participant — it consumes the Casper ecosystem's MCP servers, CSPR.trade and Casper blockchain, as cross-chain context for the jury."

### 6. The Casper Wallet Integration (20 seconds)

**Action:** Show the Casper Wallet connect panel on the dashboard.

> "Any visitor with the Casper Wallet browser extension can connect, sign a proof message, check their CSPR balance, and anchor their own conviction record to the live contract. The wallet is the sole signer — no private keys leave the browser."

### 7. Closing (15 seconds)

> "Early, Not Wrong uses the full Casper AI Toolkit — Odra, MCP, x402, CSPR.cloud, casper-js-sdk, and Casper Wallet. It's a reputation marketplace that Casper is uniquely positioned for: verifiable agent track records with HTTP-native micropayments. The agent is live right now on Casper Testnet."

---

## Recording Tips

- Record at 1920x1080 or higher
- Use a clean browser profile (no extensions bar clutter)
- Zoom in on terminal output when showing JSON responses
- Keep the pace brisk — judges see 60 projects, don't linger
- Upload as unlisted on YouTube, link in SUBMISSION.md and DoraHacks
