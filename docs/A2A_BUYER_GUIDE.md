# A2A Buyer Guide — Hire Early, Not Wrong

> **For buyer agents and integrators.** One conviction engine, two settlement rails, two schemas. **Monetization pivot (2026-09-20):** `signals-live` is free distribution until edge is proven (`GET /edge-report`) — it sells the commodity (token picks) and gives away the scarce thing as metadata. `wallet-score` ($0.05) is the hero paid SKU — behavioral conviction scoring of any wallet is the rare thing, not gated on the agent's own thin track record. Sales order: free signals → paid wallet-score audit.

| | |
|---|---|
| **Live MCP** | `POST http://144.202.117.160:31777/mcp` |
| **Dashboard / hire** | https://earlynotwrong.vercel.app/agent#hire |
| **CROO Store** | https://agent.croo.network/agents/90dd0e5a-a551-4dfb-aa64-b3c0274c2205 |
| **JSON Schema** | https://earlynotwrong.vercel.app/schemas/signals-live-v1.2.schema.json |
| **Example payload** | https://earlynotwrong.vercel.app/samples/signals-live-v1.2.example.json |
| **Reference requester** | [`examples/croo-requester/`](../examples/croo-requester/) |
| **Allocator buyer agent** | [`examples/buyer-agent/`](../examples/buyer-agent/) — full decision flow: free trust gate → edge check → free signals → paid wallet-score → act + audit. See [`DEPLOYMENT.md`](../examples/buyer-agent/DEPLOYMENT.md) for cron/Docker. |
| **Edge report** | `GET http://144.202.117.160:31777/edge-report` — conviction vs naive baseline; does the signal have demonstrable edge? |

---

## Which rail should I use?

| Rail | Best for | Settlement | Hero SKU | Price |
|------|----------|------------|----------|-------|
| **MCP + x402** | Direct HTTP clients, Casper-native agents, Cursor/Claude MCP | CSPR (Casper testnet) | `score_wallet` | $0.05 equiv |
| **CROO CAP** | Agents browsing the [CROO Store](https://agent.croo.network), USDC treasuries on Base | USDC (Base) | `wallet-score` | $0.05 |

Both return the **same** `signals-live/v1.2` JSON: ranked signals, macro gate, regime, **execution** (what the agent did this cycle vs what it ranked), provenance (behavioral status + anchor links), and buyer **guidance** (`skip_entries` | `evaluate` | `wait`).

Free reputation lookups (`get_agent_reputation`, `get_latest_conviction`, `get_by_thesis`) plus `get_live_signals` stay **free** — start with free signals, then hire the paid `wallet-score` audit ($0.05) when you need behavioral scoring of a specific wallet.

---

## signals-live/v1.2 — what you get

```json
{
  "schema": "signals-live/v1.2",
  "guidance": {
    "recommendedAction": "evaluate",
    "reason": "Top candidate FET (conviction 76/100) — apply your sizing and risk rules",
    "topCandidate": "FET",
    "sizeMultiplier": 1
  },
  "execution": { "alignment": { "topRankedEntered": false }, "entries": [], "skips": [] },
  "provenance": {
    "behavioral": { "status": "ready", "metrics": "…" }
  },
  "freshness": { "cycle": 42, "stale": false }
}
```

**Buyer agent playbook:**

1. If `freshness.stale` → treat as `wait`
2. If `guidance.recommendedAction === "skip_entries"` → block new entries (macro gate)
3. If `"evaluate"` → inspect `signals[]`, apply your sizing × `guidance.sizeMultiplier`
4. Compare `execution.alignment.topRankedEntered` to `guidance.topCandidate` — the agent may rank a token but skip entry (cap, bankroll, guardrails)
5. If `provenance.behavioral.status !== "ready"` → do not treat behavioral metrics as available yet
6. Optional: verify `provenance.explorerUrls` against your trust threshold

Validate against the [JSON Schema](https://earlynotwrong.vercel.app/schemas/signals-live-v1.2.schema.json) or run the reference requester dry-run (below).

---

## MCP (Casper x402)

Full Casper/MCP/x402 details: [`docs/CASPER_INTEGRATION.md`](./CASPER_INTEGRATION.md)

### Tools

| Tool | Paid? | Use |
|------|-------|-----|
| `get_agent_reputation` | Free | Trust decision before first hire |
| `get_latest_conviction` | Free | Latest anchored thesis |
| `get_by_thesis` | Free | Lookup by thesis hash |
| `get_subject_history` | 0.1 CSPR | Full anchor history |
| `cross_chain_lookup` | 0.1 CSPR | Mantle + Casper side-by-side |
| **`get_live_signals`** | **Free** | **Live cycle signals (free distribution until edge is proven)** |
| `score_wallet` | Paid | Behavioral conviction score for any wallet (hero paid SKU) |

### Cursor / Claude MCP config

```json
{
  "mcpServers": {
    "early-not-wrong": {
      "url": "https://earlynotwrong.vercel.app/api/agent/proxy?endpoint=mcp"
    }
  }
}
```

Direct agent endpoint (no Vercel proxy): `http://144.202.117.160:31777/mcp`

### Quick test — free reputation

```bash
curl -sS -X POST http://144.202.117.160:31777/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_agent_reputation","arguments":{}}}'
```

### Quick test — free live signals

```bash
curl -sS -X POST http://144.202.117.160:31777/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_live_signals","arguments":{}}}'
```

Free distribution — no payment required. Paid hire is the `score_wallet` / `wallet-score` audit ($0.05).

### Public teaser (no payment)

```bash
curl -sS http://144.202.117.160:31777/signals/teaser
```

Returns guidance + top symbol only — same contract as the dashboard blur. Full ranked list requires hire.

---

## CROO CAP (USDC on Base)

Full CAP setup, Store listing, troubleshooting: [`CROO_INTEGRATION.md`](./CROO_INTEGRATION.md) · paste-ready Store copy: [`archive/croo-store-listing.md`](./archive/croo-store-listing.md)

### Store UI (humans + quick demo)

1. Open the [Store listing](https://agent.croo.network/agents/90dd0e5a-a551-4dfb-aa64-b3c0274c2205)
2. **Hire** → **signals-live** (Free distribution — no payment)
3. **Hire** → **wallet-score** ($0.05 USDC — hero paid SKU; send `{ "address", "chain" }`)
4. **Requirements for signals-live:** `{}` only (empty JSON — do not paste deliverable fields)
5. Pay from CROO wallet (USDC on Base) for wallet-score · delivery in &lt; 1 min typical

> **Store operators:** Leave **Deliverable → Schema** empty. Field-builder rows cause `INVALID_DELIVERABLE` on delivery.

### SDK requester (automated buyer agent)

```bash
git clone https://github.com/thisyearnofear/earlynotwrong.git
cd earlynotwrong/examples/croo-requester
npm install
npm run dry-run          # validate sample JSON + print guidance (no payment)
export CROO_SDK_KEY=croo_sk_your_requester_key   # NOT the ENW provider key
npm start                # negotiate → pay → deliver
```

Use a **separate requester SDK key** from the provider key running on the VPS WebSocket.

---

## Monitoring

| Endpoint | Purpose |
|----------|---------|
| `GET /status` | Agent cycle, portfolio, behavioral metrics |
| `GET /cap/status` | CROO WebSocket connected + advertised services |
| `GET /reputation/stats` | x402 + CAP payment counters |
| `GET /signals/teaser` | Public guidance preview |

---

## Related docs

| Doc | Topic |
|-----|-------|
| [`CASPER_INTEGRATION.md`](./CASPER_INTEGRATION.md) | Odra registry, x402 paywall, MCP server internals |
| [`CROO_INTEGRATION.md`](./CROO_INTEGRATION.md) | CAP WebSocket, UUID mapping, delivery troubleshooting |
| [`croo-store-listing.md`](./archive/croo-store-listing.md) | Paste-ready Store listing + demo checklist (archived) |
| [`schemas/signals-live-v1.2.md`](./schemas/signals-live-v1.2.md) | Schema field reference (v1.2) |
| [`schemas/signals-live-v1.1.md`](./schemas/signals-live-v1.1.md) | Prior schema reference |

---

## Outbound — who to hire-hunt (5 personas)

> Full DMs, ask sequence, tracker: [`archive/OUTBOUND_INTEGRATORS.md`](./archive/OUTBOUND_INTEGRATORS.md) (archived — copy still valid).

| # | Persona | Where to look | Why they'd hire |
|---|---------|---------------|-----------------|
| 1 | **CROO hackathon buidl team** | CROO Discord, buidl pages | Already on CAP + USDC; free signals hook, paid wallet-score audit closes |
| 2 | **CAP requester author** | CROO Discord #dev, GitHub SDK examples | Needs a real provider SKU to test against — free signals to try, wallet-score audit to buy |
| 3 | **BSC/Base allocator agent** | CT, Farcaster builders | Pre-trade filter, not price feeds |
| 4 | **Agent-commerce builder** | Store early buyers, x402/CAP threads | One honest listing with schema + dry-run |
| 5 | **Reputation/proof nerd** | Casper/Mantle Discord, ERC-8004 repos | Provenance block + explorer URLs |

Rules: 1:1 only (no broadcast), one ask per message, no server IP in cold DMs, follow up once after 5–7 days. Lead with the job (free signals hook → paid wallet-score audit: score any wallet's conviction, patience tax, archetype).
