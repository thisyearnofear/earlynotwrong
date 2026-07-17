# MCP + CROO Integration — Hire Early, Not Wrong

> **For buyer agents and integrators.** One conviction engine, two settlement rails, one schema (`signals-live/v1.1`).

| | |
|---|---|
| **Live MCP** | `POST http://144.202.117.160:31777/mcp` |
| **Dashboard / hire** | https://earlynotwrong.vercel.app/agent#hire |
| **CROO Store** | https://agent.croo.network/agents/90dd0e5a-a551-4dfb-aa64-b3c0274c2205 |
| **JSON Schema** | https://earlynotwrong.vercel.app/schemas/signals-live-v1.1.schema.json |
| **Example payload** | https://earlynotwrong.vercel.app/samples/signals-live-v1.1.example.json |
| **Reference requester** | [`examples/croo-requester/`](../examples/croo-requester/) |

---

## Which rail should I use?

| Rail | Best for | Settlement | Hero SKU | Price |
|------|----------|------------|----------|-------|
| **MCP + x402** | Direct HTTP clients, Casper-native agents, Cursor/Claude MCP | CSPR (Casper testnet) | `get_live_signals` | 0.5 CSPR |
| **CROO CAP** | Agents browsing the [CROO Store](https://agent.croo.network), USDC treasuries on Base | USDC (Base) | `signals-live` | $0.05 |

Both return the **same** `signals-live/v1.1` JSON: ranked signals, macro gate, regime, provenance (behavioral score + anchor links), and buyer **guidance** (`skip_entries` | `evaluate` | `wait`).

Free reputation lookups (`get_agent_reputation`, `get_latest_conviction`, `get_by_thesis`) stay **MCP-only** — use those to decide whether to trust the agent before paying for live signals.

---

## signals-live/v1.1 — what you get

```json
{
  "schema": "signals-live/v1.1",
  "guidance": {
    "recommendedAction": "evaluate",
    "reason": "Top candidate FET (conviction 76/100) — apply your sizing and risk rules",
    "topCandidate": "FET",
    "sizeMultiplier": 1
  },
  "signals": [ "… ranked candidates with factor breakdown …" ],
  "provenance": { "behavioral": "…", "reputation": "…", "explorerUrls": "…" },
  "freshness": { "cycle": 42, "stale": false }
}
```

**Buyer agent playbook:**

1. If `freshness.stale` → treat as `wait`
2. If `guidance.recommendedAction === "skip_entries"` → block new entries (macro gate)
3. If `"evaluate"` → inspect `signals[]`, apply your sizing × `guidance.sizeMultiplier`
4. Optional: verify `provenance.explorerUrls` against your trust threshold

Validate against the [JSON Schema](https://earlynotwrong.vercel.app/schemas/signals-live-v1.1.schema.json) or run the reference requester dry-run (below).

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
| **`get_live_signals`** | **0.5 CSPR** | **Live cycle signals (same as CROO `signals-live`)** |

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

### Quick test — paid live signals

```bash
curl -sS -i -X POST http://144.202.117.160:31777/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_live_signals","arguments":{}}}'
```

First call returns **HTTP 402** with payment requirements. Resubmit with `X-PAYMENT` after signing the CEP-18 transfer (see CASPER_INTEGRATION.md).

### Public teaser (no payment)

```bash
curl -sS http://144.202.117.160:31777/signals/teaser
```

Returns guidance + top symbol only — same contract as the dashboard blur. Full ranked list requires hire.

---

## CROO CAP (USDC on Base)

Full CAP setup, Store listing, troubleshooting: [`docs/CROO_INTEGRATION.md`](./CROO_INTEGRATION.md) · paste-ready Store copy: [`docs/croo-store-listing.md`](./croo-store-listing.md)

### Store UI (humans + quick demo)

1. Open the [Store listing](https://agent.croo.network/agents/90dd0e5a-a551-4dfb-aa64-b3c0274c2205)
2. **Hire** → **signals-live** ($0.05 USDC)
3. **Requirements:** `{}` only (empty JSON — do not paste deliverable fields)
4. Pay from CROO wallet (USDC on Base) · delivery in &lt; 1 min typical

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
| [`croo-store-listing.md`](./croo-store-listing.md) | Paste-ready Store listing + demo checklist |
| [`schemas/signals-live-v1.1.md`](./schemas/signals-live-v1.1.md) | Schema field reference |
