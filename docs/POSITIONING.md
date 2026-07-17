# Positioning & Strategy — Early, Not Wrong

> Single source of truth for ICP, differentiation, distribution loop, and copy.  
> Last updated: 2026-07-17.

---

## Category

**Conviction infrastructure** — a verifiable pre-trade filter for autonomous allocators.

Not: trading bot, price alerts, copy-trading, or generic “AI alpha.”

---

## One-liners

| Audience | Line |
|----------|------|
| **Buyer agents (primary)** | Verifiable conviction API for autonomous allocators — skip, wait, or evaluate with on-chain proof. |
| **Humans / Store browse** | An autonomous agent that publishes what it’s acting on — and proves it on-chain every cycle. |
| **North star (internal)** | Other agents shouldn’t trust self-reported track records. This one proves conviction on-chain — and you can query it. |

---

## The secret (contrarian insight)

In asymmetric markets, conviction is tested when you’re **early**, not when you’re wrong. Losses are capped; the expensive mistake is selling winners too early (“patience tax”). That behavior is **measurable** — and this agent publishes both live intent and a cross-chain receipt every cycle.

---

## What we sell

**SKU:** `signals-live` / MCP `get_live_signals`  
**Schema:** `signals-live/v1.1`  
**Price:** $0.05 USDC (CROO) · 0.5 CSPR (MCP x402)

One structured payload per hire:

| Section | Job for buyer |
|---------|----------------|
| `guidance` | Action contract — `skip_entries` \| `evaluate` \| `wait` |
| `signals[]` | Ranked conviction candidates (score, breakdown, rationale) |
| `macroPause` | Entry gate before high-impact events |
| `provenance` | Behavioral score, anchors, thesis hash, explorer URLs |
| `freshness` | Cycle timing + staleness flag |

**Skin in the game:** The agent trades its own BSC book; signals reflect live behavior, not backtest theater.

---

## ICP (ideal customer profile) — priority order

### 1. Allocator / treasury **agents** (primary)

- Discovers services on **CROO Store** or via **MCP**
- Has USDC on Base (CROO) or CSPR + x402 client (MCP)
- Needs a **pre-trade filter** before deploying capital
- Can parse JSON and act on `guidance.recommendedAction`

**Job to be done:** “Before I open risk this cycle, should I — and on what — given verifiable track record?”

### 2. MCP-native **developers**

- Builds agent stacks on Casper / MCP / x402
- Starts with free `get_agent_reputation`, upgrades to paid live signals
- Values HTTP-native paywall (no accounts)

### 3. Human **researchers / allocators** (secondary)

- Uses dashboard, analyzer, Telegram teaser
- May hire via Store UI once; lower repeat rate than agents
- Good for brand and feedback, not primary revenue

---

## Anti-personas (say no in copy; don’t optimize for)

| Anti-persona | Why not |
|--------------|---------|
| Retail memecoin chasers | Wrong latency, wrong trust model, wrong expectations |
| HFT / sub-minute traders | 4h cycle; not built for tick data |
| “Guaranteed returns” seekers | We sell conviction-to-enter, not targets |
| Full-chain omnivores (day one) | BSC-scored universe only; be honest |
| Buyers who want raw price feeds | Use CMC/DexScreener; we’re a filter + proof layer |

---

## Differentiation

| vs | They offer | We offer |
|----|------------|----------|
| Market data APIs | Quotes, volume, screens | **Conviction + guidance + proof** |
| Opaque signal groups | Trust me bro | **On-chain anchors + behavioral score** |
| Static reputation / ERC-8004 listings | Identity badge | **Live cycle output** + history |
| Other Store agents (generic tasks) | One-off automation | **Repeatable conviction SKU**, schema, reference requester, dual rail |
| Backtest-only vendors | Historical sim | **Live book + public ledger** |

**Defensible wedge today:** *Conviction you can verify before you pay — and an action contract after you pay.*

**Moat over time:** Compounding anchor history, CAP/x402 paid stats, behavioral ledger — copy the format, not the track record.

---

## Distribution strategy (Thiel frame)

> Distribution must be engineered into the product. At $0.05/call we cannot use sales teams or broad ads — only **zero-touch programmatic** paths.

### Primary channel (nail this first)

**Programmatic hire loop — CROO-first, MCP second**

```
Discover (Store · MCP docs · teaser · community posts)
  → Free trust (get_agent_reputation · /signals/teaser)
  → Hire signals-live
  → Act on guidance
  → (Optional) cite provenance / explorer links in buyer’s audit trail
```

### Distribution baked into product

| Surface | Role |
|---------|------|
| `/signals/teaser` + dashboard blur | Free sample → paid payload |
| `guidance` in every delivery | Lowers buyer integration cost |
| Free MCP reputation tools | Trust decision before spend |
| `provenance.explorerUrls` | Every delivery is a shareable proof artifact |
| Analyzer → hire bridge | Human path to same SKU |
| Telegram guidance broadcast | Retention → CROO hire |
| Reference requester `dry-run` | Zero-CAC integrator onboarding |
| Dual rail (CROO + x402) | Two discovery surfaces, **one JSON** |

### Do not split focus (yet)

- Second Store agent listing  
- Extra paid SKUs on Store  
- Chain expansion before one channel shows repeat hires  
- Retail “alpha” marketing  

---

## Single loop metric (next 30 days)

**Primary:** ≥1 **external integrator** (not us) completes Store or SDK hire **twice** — or wires `guidance` into a documented pre-trade step.

**Secondary:** 5+ Store completions with ≥80% completion rate (heals early schema scar).

**Not primary yet:** Total revenue, Twitter impressions, human dashboard MAU.

---

## Competitive / ecosystem context (2026)

| Layer | Players | Our role |
|-------|---------|----------|
| **Commerce** | CROO CAP, Store, escrow, delivery proof | Live provider listing; Text delivery; 3+ verified orders |
| **Paywall** | x402, facilitators (CSPR.cloud, CDP, Stripe preview) | MCP on Casper testnet; paid `get_live_signals` |
| **Discovery** | CROO Store, x402 Bazaar (emerging) | Schema + requester + integration docs |
| **Identity** | ERC-8004, CAP PTS | Anchors on Mantle + Casper; reputation in payload |

Agentic commerce **volume is still early** — win by being a **reference listing** with honest docs, not by expecting mass revenue this quarter.

---

## Messaging do / don’t

| Do | Don’t |
|----|-------|
| “Pre-trade filter for allocator agents” | “Best BSC bot” |
| “Verifiable on-chain proof” | “Guaranteed profits” |
| “Same JSON on CROO and MCP” | “Two different products” |
| “4h cycle — check freshness.stale” | “Real-time signals” |
| “Requirements `{}` only” | Paste deliverable fields as input |
| Point to `examples/croo-requester` dry-run | Ask humans to set up x402 first |

---

## Ready-to-post anchor (CROO Discord)

**Title:** `[Agent] Early, Not Wrong — verifiable conviction API ($0.05 USDC)`

**Body (short):**

Allocator agents shouldn’t trust self-reported track records. **Early, Not Wrong** runs live on BSC, anchors every cycle on Casper + Mantle, and sells one SKU: **`signals-live`** — ranked conviction, macro gate, **`guidance`** (skip / wait / evaluate), and on-chain **provenance**.

- **Try:** [Store](https://agent.croo.network/agents/90dd0e5a-a551-4dfb-aa64-b3c0274c2205) → Hire → Requirements: `{}` only  
- **Integrate:** [MCP + CROO guide](./MCP_INTEGRATION.md) · [`examples/croo-requester`](../examples/croo-requester/) (`npm run dry-run`)  
- **Dashboard:** https://earlynotwrong.vercel.app/agent#hire  

Looking for 2–3 buyer agents to test the CAP loop and give feedback on schema + guidance.

Longer Telegram/Casper variants: [`community-share.md`](./community-share.md).

---

## Related docs

| Doc | Purpose |
|-----|---------|
| [`MCP_INTEGRATION.md`](./MCP_INTEGRATION.md) | Buyer technical guide |
| [`community-share.md`](./community-share.md) | Paste-ready channel copy |
| [`croo-store-listing.md`](./croo-store-listing.md) | Store operator paste |
| [`CROO_INTEGRATION.md`](./CROO_INTEGRATION.md) | CAP troubleshooting |
| [`CASPER_INTEGRATION.md`](./CASPER_INTEGRATION.md) | x402 + MCP depth |
| [`SOUL.md`](../SOUL.md) | Design philosophy |
