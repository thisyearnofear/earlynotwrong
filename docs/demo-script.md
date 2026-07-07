# Demo Scripts: Early, Not Wrong

This document contains demo scripts for different aspects of the platform.

- [Casper Agentic Buildathon Demo](#casper-agentic-buildathon-demo) — Odra reputation registry, MCP, x402 paywall
- [SoSoValue Buildathon Demo](#sosovalue-buildathon-demo) — Multi-source market data, SoDEX execution, AI narrative
- [Aleo ZK-Privacy Demo](#aleo-zk-privacy-demo) — Private behavioral data on Aleo

---

# Casper Agentic Buildathon Demo

## Overview

This walkthrough demonstrates the **Casper-native reputation marketplace**
built for the Casper Agentic Buildathon 2026: an Odra smart contract stores
verifiable conviction records from an autonomous agent, other AI agents query
those records through Model Context Protocol, and paid queries are gated by the
x402 micropayment protocol.

**Target length:** 3–4 minutes.  
**Recommended recording:** screen capture + terminal curls, with the dashboard
and Casper explorer visible.

## Demo Objectives

- Show the deployed `ConvictionRegistry` contract on Casper Testnet producing
  real transactions.
- Demonstrate free MCP queries returning live on-chain data.
- Trigger the live `402 Payment Required` challenge for a paid MCP tool.
- Explain why this architecture is Casper-native and hard to replicate on EVM.
- Surface the dashboard's "Agent Reputation API" panel.

## Demo Setup

1. Agent running in **simulator mode** (or live mode if credentials are set):
   `AGENT_MODE=simulator npm run --prefix agent dev`
2. Dashboard open: https://earlynotwrong.vercel.app/agent
3. Casper Testnet explorer open:
   https://testnet.cspr.live/contract-package/973e3c8654e6ee030483969503f21d6fab543317ef60ea2ca041a8e905087afa
4. Terminal ready with the one-curl commands below.

## Demo Flow

### 1. Hook (15 seconds)

> "AI agents are about to trade, lend, and govern on-chain. But no agent can
> trust another agent's self-reported track record. Today we're demoing a
> reputation marketplace for agents — built natively on Casper. The agent
> anchors every decision to the chain; other agents query it through MCP and pay
> per call with x402."

### 2. The Contract on Casper Testnet (30 seconds)

Navigate to the Casper Testnet explorer link above. Point out:

- Contract package hash: `973e3c86…`
- Latest deployed version under the package.
- The latest anchor transaction hash visible in the deploy history.

> "This is a real Odra smart contract, compiled to WASM and deployed on Casper
> Testnet. It stores conviction records — subject hash, thesis hash, score,
> archetype, timestamp — and emits CES events every time the agent anchors."

### 3. Free MCP Query — Live On-Chain Read (45 seconds)

Run the free `get_latest_conviction` curl:

```bash
curl -sS -X POST http://144.202.117.160:31777/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_latest_conviction","arguments":{"subjectHash":"0x4a937673ea542abdf587e6b509793b2173980228cc65180a2f32c24fd3ac459a"}}}'
```

Narrate as the JSON comes back:

> "This is a live MCP tool call. No wallet, no payment, no gas. The server
> reads the contract's CES event log directly from Casper state — free
> state queries — and returns the most recent conviction record anchored by
> the agent."

### 4. Paid MCP Query — x402 in Action (60 seconds)

Run the paid `get_agent_reputation` curl:

```bash
curl -sS -X POST http://144.202.117.160:31777/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get_agent_reputation",
      "arguments": {
        "subjectHash": "0x4a937673ea542abdf587e6b509793b2173980228cc65180a2f32c24fd3ac459a"
      }
    }
  }'
```

The response will be `HTTP 402 Payment Required` with a `PaymentRequirements`
object:

```json
{
  "x402Version": 2,
  "accepts": [{
    "scheme": "exact",
    "network": "casper:casper-test",
    "asset": "9824d60dc3a5c44a20b9fd260a412437933835b52fc683d8ae36e4ec2114843e",
    "payTo": "23058a429ae31f0de556b5747546cc6d7817a559afe2657f297186dc509cd30a",
    "amount": "20",
    "extra": { "name": "Cep18x402", "symbol": "CSPR", "decimals": "2", "version": "1" }
  }]
}
```

Narrate:

> "This is the x402 paywall. The MCP tool is real and live, but it's paid.
> Instead of a subscription or an API key, the server returns an HTTP 402 with
> a signed-payment requirement. The client would sign a CEP-18 transfer
> authorization, re-POST it in the `X-PAYMENT` header, and the cspr.cloud
> facilitator settles the transfer on-chain — including the gas."

Optional (if you can obtain testnet `Cep18x402` tokens): record the full
settled round trip by constructing and sending the `X-PAYMENT` header.

### 5. Dashboard — Reputation API Panel (45 seconds)

Switch to the live dashboard at `/agent`. Scroll to the "Agent Reputation API"
panel. Point out:

- MCP endpoint URL.
- Free vs paid tool breakdown.
- Live query stats: queries served, paid queries, fees collected.
- Latest anchor link back to the Casper explorer.

> "The dashboard is the human-readable window into the same infrastructure.
> Agents don't need this UI — they talk MCP directly — but operators can see
> that the marketplace is live and earning CSPR per query."

### 6. Why Casper (30 seconds)

Show the comparison from `docs/CASPER_INTEGRATION.md`:

```
Capability                    EVM (Mantle)        Casper
─────────────────────────────────────────────────────────────────
Smart contract registry       ✓ (ERC-8004)        ✓ (Odra)
HTTP-native paywall           ✗  needs separate    ✓  x402 facilitator
                                 service              + CSPR.cloud
Free event-log reads          ✓  via getLogs      ✓  via state queries
Agent-discoverable surface    via custom API      ✓  via MCP
Facilitator pays the gas      ✗                   ✓
```

> "We anchor to both Mantle and Casper for redundancy. But the reputation
> *marketplace* — paid per-request access over MCP — only works natively on
> Casper because of x402 and the facilitator. EVM would need separate services
> bolted on. That's why we submitted this layer for the Casper Buildathon."

### 7. The Agentic Loop (60 seconds)

Return to the terminal. If running live, show a cycle reaching step 8:

```
[8/8] Anchoring to Mantle + Casper...
  → Mantle: success (tx: 0x...)
  → Casper: success (deploy: d843b61b...)
[8b/8] Generating market narrative...
```

Explain:

> "The agent runs an 8-step loop every few hours. It fetches market data,
> scores contrarian conviction, manages open positions, proposes entries, runs
> guardrails, executes trades, and then anchors a record of its thesis to both
> Mantle and Casper. The record on Casper is what the MCP server exposes to
> other agents."

### 8. Conclusion (30 seconds)

> "What we built for the Casper Buildathon is the trust layer between agents:
> verifiable reputation, queryable over MCP, paid with x402. The trading agent
> is the first customer of that layer. We're live on Casper Testnet today,
> and the architecture is reusable for any agent that wants to publish
> reputation on-chain."

Cut to the closing slide with:

- GitHub: https://github.com/thisyearnofear/earlynotwrong
- Dashboard: https://earlynotwrong.vercel.app/agent
- Casper contract: https://testnet.cspr.live/contract-package/973e3c8654e6ee030483969503f21d6fab543317ef60ea2ca041a8e905087afa

## Demo Tips

- Keep the terminal font large; the curls return compact JSON.
- Pre-open the Casper explorer so the latest deploy hash is visible.
- If the paid round trip isn't fully funded, the `402` challenge alone is a
  valid, impressive demonstration — the facilitator and server-side flow are
  live.
- The free tool call should respond in under 300 ms on first hit and <10 ms
  when cached; mention that speed if true.

---

# SoSoValue Buildathon Demo

## Overview

Walk through the **three new capabilities** added for Wave 3 of the SoSoValue
Buildathon: **SoSoValue API** as a market data source, **SoDEX testnet** as
an orderbook execution venue, and **AI market narrative** generation from
SoSoValue news feeds and macroeconomic events.

## Demo Objectives

- **SoSoValue API integration**: Show real-time token market snapshots and SSI
  index data alongside CMC data in a seamless composite feed
- **SoDEX testnet execution**: Demonstrate EIP-712 signed market orders on
  ValueChain, with graceful TWAK fallback
- **AI market narrative**: Show natural-language market commentary generated
  from SoSoValue news feeds, macro events, and conviction data

## Demo Setup

1. **SoSoValue API key**: `SOSOVALUE_API_KEY` set in `agent/.env`
2. **SoDEX credentials**: `SODEX_API_KEY_PRIVATE` set (or skip — TWAK fallback
   will be visible in the logs)
3. **LLM API key** (optional): `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` for
   LLM-enhanced narrative mode
4. **Terminal**: Have the agent running with `AGENT_MODE=simulator` so no real
   funds are at risk
5. **SoDEX testnet explorer** (optional): Open
   `https://testnet.sodex.dev/explorer` to verify trades

## Demo Flow

### 1. Introduction (30 seconds)

> "Today, I'll demonstrate how Early, Not Wrong integrates three new capabilities
> for the SoSoValue Buildathon — combining SoSoValue's on-chain financial data
> API, SoDEX's high-performance orderbook, and AI-driven market commentary into
> a single autonomous trading agent.
>
> All three additions are **additive** — the agent worked before, and it still
> works if any component is unavailable. What these add is **depth**: fresher
> data, an additional execution venue, and natural-language explainability."

### 2. Startup: Three-Way Health Check (45 seconds)

Run the agent and catch the startup banner:

```
── Startup Health Check ──
  TWAK:        ✓ (simulator)
  CMC REST:    ✓ (connected)
  SoSoValue:   ✓ (connected)
  Guardrails:  ✓ (0/6 trades today)
  Mode:        SIMULATOR (no real execution)
```

**Narrator**: "Notice the three-way health check — TWAK, CMC, and now
SoSoValue. Each service independently reports its status. If SoSoValue were
unreachable right now, the agent would fall back to CMC-only mode and keep
running."

### 3. Market Data: Composite Data Provider (1 minute)

Wait for the first cycle to hit step [2/8]. The terminal will show:

```
[2/8] Fetching market data (SoSoValue + CMC composite)...
  Source: SoSoValue (145 tokens) + CMC (147 tokens) → 147 merged
  Fear & Greed: 20/100 (Extreme Fear)
  Total Market Cap: $2.14T
  BTC Funding Rate: 0.0041%
  Top gainers: ...
  Top losers: ...
```

**Narrator**: "The agent now fetches token prices from **two** data providers
in parallel. SoSoValue's market snapshots refresh every 30 seconds — that's
fresher than CMC's cache. The composite merge deduplicates by symbol:
SoSoValue prices are preferred where available, and CMC fills any gaps.

Critically, CMC still provides the Fear & Greed index and funding rates that
SoSoValue doesn't offer. The two sources are **complementary**, not redundant."

### 4. SSI Index as a Regime Signal (45 seconds)

Show the conviction scoring output:

```
[3/8] Scoring market regime + token conviction (contrarian)...
  Regime: 85/100 — DEEP FEAR — PRIME CONTRARIAN (FGI=20)
  Top conviction: INJ 76 [down 18% · extreme fear · SSI-index constituent]
                   FET 72 [down 15% · extreme fear · deep liquidity]
```

**Narrator**: "The SSI (SoSoValue Index) adds a new quality dimension to our
conviction scoring. Tokens that are constituents of a major SoSoValue Index get
a **quality score boost** — they're not just random tokens, they've passed
SoSoValue's methodology screen. This increases our conviction in them.

SSI index market snapshots also serve as a **regime proxy**: if the SoSoValue
Top Index is deeply negative, that's a strong contrarian signal — the market is
fearful, which is when 'Early, Not Wrong' enters."

### 5. SoDEX Testnet Execution (1 minute)

When the agent reaches step [7/8] and has a valid proposal:

```
[7/8] Executing 1 entries via SoDEX testnet → TWAK fallback...
  → Buying $5 INJ (conviction: 76)
    [SoDEX] Market buy INJUSDC @ $5
    ✓ [SoDEX] Order filled — ID: 12345678, avg: 0.2856
```

**Narrator**: "The agent attempted an order on the SoDEX testnet — a
high-performance on-chain orderbook on ValueChain. The order was signed using
EIP-712 typed structured data and submitted with an `X-API-Sign` header.

The nonce is generated from the Unix millisecond timestamp, guaranteeing
monotonicity. If SoDEX rejected the order for any reason, the agent would
fall through to TWAK on BSC with zero interruption."

**If the user has no SoDEX credentials**, the terminal will show:

```
[7/8] Executing 1 entries via TWAK...
  → Buying $5 INJ (conviction: 76)
    [TWAK] Swapping BNB → INJ
    ✓ Trade executed
```

**Narrator**: "Without SoDEX credentials, the agent routes through TWAK
exactly as before. The SoDEX integration is purely additive — the agent never
breaks without it."

### 6. AI Market Narrative from SoSoValue Feeds (1 minute)

After anchoring, the terminal shows step [8b/8]:

```
[8b/8] Generating market narrative from SoSoValue feeds...
  Headline: "Bitcoin Drops Below $60K as Traders Brace for FOMC"
  3 news items · 2 macro events
  Summary: Market regime: deep fear (FGI 20/100). Contrarian opportunity
  scores 85/100 — favorable entry conditions. Top conviction: INJ scores
  76/100 (down 18%, strong contrarian opportunity). Headline: "Bitcoin Drops
  Below $60K as Traders Brace for FOMC" [CoinDesk]. Upcoming: 🔴 FOMC
  Minutes (forecast: 5.25%) · 🟡 CPI Data (forecast: 3.1%). Portfolio:
  $28.69 across 2 held position(s).
```

**Narrator**: "This is the **template mode** of the market narrative generator.
It works with zero LLM API keys — the text is composed from structured
templates that describe the regime, top conviction signals, news headlines
from SoSoValue's `/news/hot` and `/news/featured` endpoints, and upcoming
macroeconomic events from `/macro/events`.

When an LLM API key is available, the narrative switches to **LLM-enhanced
mode** — the same data is fed into GPT-4o-mini or Claude 3 Haiku for richer,
more natural commentary."

### 7. /conviction Endpoint with Narrative (30 seconds)

Open `http://localhost:31777/conviction`:

```json
{
    "regime": { "score": 85, "label": "DEEP FEAR — PRIME CONTRARIAN" },
    "signals": [
        { "symbol": "INJ", "score": 76, "breakdown": { ... } }
    ],
    "narrative": {
        "summary": "Market regime: deep fear (FGI 20/100)...",
        "headline": "Bitcoin Drops Below $60K...",
        "newsCount": 3,
        "macroEventCount": 2,
        "generatedAt": "2026-07-05T12:35:21.328Z"
    },
    "anchoredHash": "0xec817b...",
    "anchorResults": [...]
}
```

**Narrator**: "The narrative is surfaced in the `/conviction` HTTP endpoint
alongside the agent's raw conviction data. Any frontend that renders the
agent state can display this as a human-readable summary — dashboards,
Telegram bots, or external JSON consumers."

### 8. Technical Architecture (30 seconds)

Highlight the key architectural decisions:

1. **Composite data provider**: SoSoValue preferred for token prices (fresher),
   CMC for regime data (Fear & Greed, funding rates) — complementary, not
   redundant. Merged with deduplication.

2. **Additive execution**: SoDEX testnet preferred, TWAK fallback. Zero changes
   to existing TWAK code. The agent works identically without SoDEX credentials.

3. **EIP-712 signing**: Full typed structured data signing with 0x01 prefix,
   Go-compatible field ordering, ms-level monotonic nonce management.

4. **Non-blocking narrative**: The market narrative generator is step 8b — it
   runs after anchoring and never blocks the trading cycle. Errors are logged
   and silently swallowed.

5. **Graceful degradation**: 6 failure modes tested — SoSoValue offline, CMC
   offline, both offline, SoDEX offline, LLM API key missing, network timeout.
   Every mode produces a working agent.

### 9. Conclusion (30 seconds)

> "What we've shown today is that **Early, Not Wrong** is not a single-vendor
> system. It's an **adaptive, multi-source conviction engine** that pulls data
> from wherever it's freshest, executes on whichever venue has the best
> liquidity, and explains its reasoning in natural language.
>
> With SoSoValue's 30-second market snapshots, we get fresher pricing. With
> SoDEX's orderbook, we get tighter execution. And with the narrative generator,
> we make the agent's decision-making transparent.
>
> All three are **additive enhancements** — the agent was autonomous before, and
> it remains autonomous without any of them. But together, they make it
> **smarter, faster, and more explainable**."

---

# Aleo ZK-Privacy Demo

## Overview

This document provides a step-by-step script for demonstrating the **Aleo-First Privacy Integration** of the Early, Not Wrong platform. The demo showcases how users can bridge their behavioral data from public chains (Solana/Base) to private, verifiable Zero-Knowledge (ZK) records on Aleo.

## Demo Objectives

- **Shield Wallet Integration**: Show seamless login via Aleo's most advanced ZK-wallet.
- **ZK-Conviction Index (ZK-CI)**: Mint private behavioral metrics as on-chain Aleo records.
- **Selective Disclosure**: Generate ZK-proofs for specific traits without revealing full wallet data.
- **Private Strategist Mode**: Commit encrypted trade intents (theses) to the Aleo blockchain.
- **Hardened Rebate Model**: Demonstrate the "Pull" model (Signed Vouchers) for behavioral rebates.

## Demo Setup

1.  **Shield Wallet**: Ensure the extension is installed and funded with Aleo Testnet credits.
2.  **Treasury Account**: Ensure the platform's treasury has credits to cover signed voucher claims.
3.  **Target Wallet**: Have a Solana/Base wallet with trading history ready for initial analysis.

## Demo Flow

### 1. Introduction (30 seconds)

"Welcome to Early, Not Wrong—the reputation-native platform for the private internet. Today, we'll demonstrate how we use the Aleo blockchain to turn public behavioral data into private, verifiable ZK-reputation. We bridge the gap between transparency and privacy using Leo smart contracts."

### 2. ZK-Onboarding & Shield Wallet (1 minute)

- Click the **"Sign In"** button in the navbar.
- Select the **Shield Wallet** from the provider list.
- **Highlight**: "We prioritize the Shield Wallet to ensure our users benefit from the latest improvements in Aleo's developer and user experience."
- Show the **"Shield Protected"** badge appearing in the UI once connected.
- Point out the **Aleo Network Status** (Testnet) indicator.

### 3. Minting Your ZK-CI (1 minute)

- Perform a wallet scan for a Solana/Base address in the **"Analyzer"** tab.
- Once results appear, scroll to the **Aleo Conviction Card**.
- Click **"Mint ZK-CI"**.
- **Explain**: "We are taking the calculated Conviction Index and committing it to the Aleo blockchain as a private record. This record belongs only to you and is hidden by default from everyone else."
- Confirm the transaction in the Shield Wallet.

### 4. Selective Disclosure & Proof Generation (1 minute)

- Click **"Generate Proof"** on the minted ZK-CI card.
- Select a specific attribute to disclose (e.g., **"Prove I am a 'Diamond Hand' archetype"**).
- **Explain**: "This is the 'Gold Standard' of ZK. I am proving I have this specific high-reputation trait without revealing my actual balance, my transaction volume, or even my wallet address."
- Generate the proof and show the **"Verify Proof Status"** link to the Provable Explorer.

### 5. Private Strategist Mode (1 minute)

- Switch to the **"Strategist"** tab.
- Enter a trade thesis (e.g., "Accumulating $SOL based on 4H support flip").
- Click **"Commit Private Thesis"**.
- **Explain**: "In the Strategist mode, traders can commit their intents to Aleo as encrypted records. This prevents front-running and copy-trading while creating a verifiable trail of their decision-making process."
- Show the transaction success message.

### 6. Hardened "Pull" Rebate Flow (1 minute)

- Scroll to the **"Premium Alpha"** section.
- Click **"Claim Patience Rebate"**.
- **First Step (Authorize)**: Show the API call to the backend. "The platform verifies your behavioral eligibility and issues a cryptographically signed voucher."
- **Second Step (Claim)**: Confirm the on-chain claim in the Shield Wallet.
- **Technical Highlight**: "We use a 'Pull' model. The platform never holds your private keys or executes on your behalf. You use the signed voucher to claim your rebate directly from the `early_not_wrong_v3.aleo` contract."

### 7. Technical Architecture (30 seconds)

- Point to the **Leo Smart Contract** structure in the docs.
- Mention the use of **`signature::verify`** for replay protection and security.
- Highlight the **Provable SDK** integration for server-side voucher signing on the VPS — the treasury key never touches Vercel.
- Mention the migration path to **USDCx** for private stablecoin payouts once Aleo's private stablecoin program ships; testnet runs on native `credits.aleo`.

## Key Talking Points

### Why Aleo?

- **Offchain Execution**: Complex behavioral analysis is verified publicly but computed privately.
- **Encrypted State**: Reputation data is hidden by default.
- **Composability**: Our private contracts are ready to interact with DeFi protocols for undercollateralized lending.

### User Benefits

- **Reputation Without Exposure**: Build a high-value profile without being doxxed.
- **Anti-Frontrunning**: Protect your edge by encrypting your strategy.
- **Selective Disclosure**: Share only what is necessary for a specific opportunity.

### Real-World Use Cases

- **Private Alpha Groups**: Join based on verified skill, not just a high balance.
- **ZK-Undercollateralized Lending**: Prove creditworthiness via your Conviction Index.
- **Institutional Compliance**: Selective disclosure for auditors without leaking strategies.

## Technical Details

- **Program ID**: `early_not_wrong_v3.aleo` (live on Aleo Testnet)
- **Language**: Leo v4.3.1
- **Privacy Model**: Decoupled Data Layer (Public) and Reputation Layer (Aleo ZK).
- **Security**: Signed Voucher model eliminates platform spending-key risk; signing runs on the VPS over an HMAC-authed channel, never on Vercel.

## Conclusion

"Early, Not Wrong isn't just a demo; it's a production-ready infrastructure for the private internet. By leveraging Aleo, we ensure that in the era of mass data collection, your reputation belongs to you—and only you. Join us in making privacy the default."

## Demo Tips

- **Pre-Minted Record**: Have a wallet that already has a minted ZK-CI to save time during the 10-day build cycles.
- **Explorer Links**: Keep the Provable Explorer open to show the "Accepted" transaction status of the v3 contract.
- **Emphasize the 'Aha!' Moment**: When generating a proof, explicitly state: "My identity is hidden, my balance is hidden, but my skill is proven."
