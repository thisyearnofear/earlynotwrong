# Social Posts — Casper Buildathon Final Round

> Draft posts for Twitter/X and Telegram. Post these before the judging deadline.

---

## Twitter/X — Launch Thread (3 posts)

### Post 1 (anchor)

AI agents shouldn't trust each other's self-reported track records.

Early, Not Wrong fixes this: an autonomous DeFi agent that anchors every conviction decision to a Casper smart contract — verifiable by any agent via MCP, paid per query with x402 micropayments.

🧵 Thread 👇

- Live dashboard: https://earlynotwrong.vercel.app/agent
- Casper contract: https://testnet.cspr.live/contract-package/973e3c8654e6ee030483969503f21d6fab543317ef60ea2ca041a8e905087afa

### Post 2 (how it works)

How it works:

1️⃣ Agent scores conviction (6-factor + LLM jury)
2️⃣ Anchors thesis hash + score to Casper Odra contract
3️⃣ Other agents query reputation via MCP
4️⃣ Trust queries = free, live signals = 0.5 CSPR via x402
5️⃣ cspr.cloud facilitator settles CEP-18 transfers on-chain

Casper-native. Cannot replicate on EVM.

### Post 3 (toolkit + demo)

Built with the full Casper AI Toolkit:

✅ Odra Framework (Rust smart contract)
✅ MCP Server (7 tools, bidirectional)
✅ x402 Micropayments (CEP-18, facilitator)
✅ CSPR.cloud APIs (RPC, event reads)
✅ casper-js-sdk (contract calls)
✅ Casper Wallet (browser extension)

Demo video + live dashboard: https://earlynotwrong.vercel.app/agent

---

## Twitter/X — Short version (single post)

Early, Not Wrong: agent reputation marketplace, natively on Casper.

An autonomous DeFi agent anchors every conviction decision to a Casper Odra smart contract. Other agents query it via MCP and pay per call with x402 CEP-18 micropayments.

Trust queries free. Live signals = 0.5 CSPR.

Live now: https://earlynotwrong.vercel.app/agent

---

## Telegram — Channel announcement

🤖 **Early, Not Wrong — Agent Reputation Marketplace on Casper**

An autonomous DeFi agent that proves its conviction on-chain, every cycle.

**What it does:**
• 7-factor conviction scoring (6 deterministic + LLM jury)
• Anchors every thesis to a Casper Odra smart contract
• Exposes reputation via MCP (7 tools) with x402 micropayments
• Trust queries free, live signals = 0.5 CSPR per call
• Also mirrors to Mantle (ERC-8004) and Aleo (ZK privacy proof)

**Try it:**
• Dashboard: https://earlynotwrong.vercel.app/agent
• Casper contract: https://testnet.cspr.live/contract-package/973e3c8654e6ee030483969503f21d6fab543317ef60ea2ca041a8e905087afa
• MCP endpoint: `POST http://144.202.117.160:31777/mcp`

**One-curl x402 challenge:**
```
curl -sS -X POST http://144.202.117.160:31777/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_live_signals","arguments":{}}}'
```

Built with the full Casper AI Toolkit: Odra, MCP, x402, CSPR.cloud, casper-js-sdk, Casper Wallet.

---

## Twitter/X — Reply to Casper Association posts

When the Casper Association or DoraHacks posts about the buildathon, reply with:

We're in the final round with Early, Not Wrong — an agent reputation marketplace built on Casper's native stack: Odra contract, MCP server, x402 paywall. The agent is live on testnet right now, anchoring conviction decisions on-chain. 🔗 https://earlynotwrong.vercel.app/agent

---

## Notes

- Create the Twitter/X account at https://x.com and register @earlynotwrong (or @earlynotwrong_ if taken)
- Create the Telegram channel at https://t.me and name it "Early, Not Wrong"
- Post the launch thread first, then engage with Casper/DoraHacks posts
- Pin the main thread on the Twitter/X profile
- Link both socials in SUBMISSION.md (already done above)
