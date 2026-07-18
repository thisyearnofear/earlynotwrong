# Community share copy — ready to post

> Paste-ready announcements for CROO, Casper, and ENW channels. Update dates/order counts if needed.

**Links (stable):**

| | URL |
|---|-----|
| CROO Store | https://agent.croo.network/agents/90dd0e5a-a551-4dfb-aa64-b3c0274c2205 |
| Dashboard / hire | https://earlynotwrong.vercel.app/agent#hire |
| Integration guide | https://github.com/thisyearnofear/earlynotwrong/blob/main/docs/MCP_INTEGRATION.md |
| Requester example | https://github.com/thisyearnofear/earlynotwrong/tree/main/examples/croo-requester |
| MCP endpoint | `http://144.202.117.160:31777/mcp` |

**Tester checklist:** Requirements `{}` only · Deliverable Schema on Store listing stays empty · ~$0.06 total on CROO · 4h cycle (check `freshness.stale`).

---

## CROO — Telegram (short)

```
🤖 Early, Not Wrong is live on the CROO Store

Service: signals-live ($0.05 USDC)
→ Ranked BSC conviction + macro gate + on-chain provenance + skip/wait/evaluate guidance

Try it:
1. Store → Hire → signals-live
2. Requirements: {} only
3. Pay from CROO wallet (Base)

Integrate: github.com/thisyearnofear/earlynotwrong/blob/main/docs/MCP_INTEGRATION.md
Dry-run: examples/croo-requester (npm run dry-run)

Dashboard: earlynotwrong.vercel.app/agent#hire
```

---

## CROO — Discord #showcase (longer)

**Title:** `[Agent] Early, Not Wrong — live conviction signals on CROO ($0.05 USDC)`

**Body:**

Autonomous contrarian trading agent on BNB Smart Chain. Every 4 hours it scores tokens with a 6-factor engine, trades with "early, not wrong" discipline, and anchors every thesis on **Casper + Mantle**.

**What's hireable:** `signals-live` on the [CROO Agent Store](https://agent.croo.network/agents/90dd0e5a-a551-4dfb-aa64-b3c0274c2205) — **$0.05 USDC** per delivery, SLA &lt; 5 min.

**Payload:** `signals-live/v1.2` JSON — ranked candidates, factor breakdown, macro entry gate, **execution** alignment (what we ranked vs entered), behavioral status + score, anchor explorer links, and an explicit buyer **guidance** contract (`skip_entries` | `evaluate` | `wait`).

**Quick test (Store UI):**
1. Open listing → **Hire** → select **signals-live**
2. **Requirements:** `{}` (empty JSON — ignore placeholder text describing the deliverable)
3. Pay ~$0.06 from CROO wallet on Base
4. Parse delivery JSON → act on `guidance.recommendedAction`

**Integrate as a buyer agent:**
- Guide: [MCP + CROO integration](https://github.com/thisyearnofear/earlynotwrong/blob/main/docs/MCP_INTEGRATION.md)
- Reference requester: [`examples/croo-requester`](https://github.com/thisyearnofear/earlynotwrong/tree/main/examples/croo-requester) — `npm run dry-run` first (no payment)
- JSON Schema: https://earlynotwrong.vercel.app/schemas/signals-live-v1.2.schema.json

**Live stats:** CAP connected · 3+ verified Store deliveries · same SKU on MCP (Casper x402) for direct HTTP clients.

**Not for:** price targets, sub-minute latency, or guaranteed returns — conviction-to-enter with verifiable track record.

Feedback welcome — especially from allocator agents wiring this into a pre-trade filter.

---

## Casper — Telegram (short)

```
📡 Early, Not Wrong — MCP reputation + live signals on Casper testnet

Free: get_agent_reputation, get_latest_conviction
Paid: get_live_signals (0.5 CSPR, x402) — same JSON as our CROO Store SKU

POST http://144.202.117.160:31777/mcp
Guide: github.com/thisyearnofear/earlynotwrong/blob/main/docs/MCP_INTEGRATION.md

Also on CROO Store ($0.05 USDC) if you prefer USDC on Base.
```

---

## Casper — Discord (dev channel)

**Title:** `MCP + x402: queryable agent reputation with paid live conviction signals`

**Body:**

We shipped an MCP server on the same process as our autonomous BSC trading agent — reputation reads from **Casper + Mantle** anchors, paid tier via **x402 CEP-18** on Casper testnet.

**Endpoint:** `POST http://144.202.117.160:31777/mcp`

| Tool | Price | Use |
|------|-------|-----|
| `get_agent_reputation` | Free | Trust decision before hiring |
| `get_latest_conviction` | Free | Latest anchored thesis |
| `get_live_signals` | 0.5 CSPR | Live cycle signals (`signals-live/v1.2`) |
| `get_subject_history` | 0.1 CSPR | Full anchor history |
| `cross_chain_lookup` | 0.1 CSPR | Mantle + Casper side-by-side |

**Try free first:**
```bash
curl -sS -X POST http://144.202.117.160:31777/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_agent_reputation","arguments":{}}}'
```

Paid `get_live_signals` returns HTTP 402 first — see [CASPER_INTEGRATION.md](https://github.com/thisyearnofear/earlynotwrong/blob/main/docs/CASPER_INTEGRATION.md).

**Same payload on CROO:** [Store listing](https://agent.croo.network/agents/90dd0e5a-a551-4dfb-aa64-b3c0274c2205) · $0.05 USDC · easier if you already use the CROO wallet.

Full buyer guide: [MCP_INTEGRATION.md](https://github.com/thisyearnofear/earlynotwrong/blob/main/docs/MCP_INTEGRATION.md) · Strategy: [POSITIONING.md](https://github.com/thisyearnofear/earlynotwrong/blob/main/docs/POSITIONING.md)

---

## ENW public Telegram — one-time launch pin (optional)

```
📣 Now hireable on CROO + MCP

This bot publishes cycle guidance here (free teaser). Full ranked signals + on-chain provenance:

• CROO Store — signals-live ($0.05 USDC)
• MCP — get_live_signals (0.5 CSPR)

Integration: github.com/thisyearnofear/earlynotwrong/blob/main/docs/MCP_INTEGRATION.md
Dashboard: earlynotwrong.vercel.app/agent#hire

Subscribe via /start on this channel for every-cycle guidance.
```

---

## Posting order (recommended)

1. **CROO Discord #showcase** — best fit for Store testers
2. **CROO Telegram** — same day, shorter version
3. **Casper Discord** — 1–2 days later, MCP/x402 angle
4. **Pin on ENW Telegram** — after CROO post (avoid duplicate spam same hour)

---

## If someone reports a failed Store order

Ask for order ID. Common fixes:
- Requirements must be `{}` only
- Store **Deliverable Schema** must be empty (operator-side — already fixed)
- See [CROO_INTEGRATION.md](./CROO_INTEGRATION.md) troubleshooting
