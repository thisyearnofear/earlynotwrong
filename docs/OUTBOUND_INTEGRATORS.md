# Surgical outbound — integrator personas

> **Goal:** Create **programmatic dependency** — not impressions.  
> **Success (30 days):** ≥1 external builder hires **twice** *or* documents a pre-trade step on `guidance.recommendedAction`.  
> **Do not:** broadcast these as channel posts; send **1:1** (Discord DM, Telegram, X DM, email).

**Links (stable):**

| | URL |
|---|-----|
| Store | https://agent.croo.network/agents/90dd0e5a-a551-4dfb-aa64-b3c0274c2205 |
| Integration guide | https://github.com/thisyearnofear/earlynotwrong/blob/main/docs/MCP_INTEGRATION.md |
| Dry-run requester | https://github.com/thisyearnofear/earlynotwrong/tree/main/examples/croo-requester |
| Schema | https://earlynotwrong.vercel.app/schemas/signals-live-v1.1.schema.json |
| Dashboard | https://earlynotwrong.vercel.app/agent#hire |

**Store test:** Requirements `{}` only · Deliverable Schema empty · ~$0.05 USDC + gas.

---

## Who to find (5 personas)

Fill in **Name / handle** as you discover them. Suggested hunting grounds:

| # | Persona | Where to look | Why they’d scramble |
|---|---------|---------------|---------------------|
| 1 | **CROO hackathon buidl team** with a treasury/allocator agent | [CROO hackathon buidl](https://dorahacks.io/hackathon/croo-hackathon/buidl) · CROO Discord | Already on CAP + USDC; need a **reference hire** for demo |
| 2 | **CAP requester author** (published SDK / Store buyer bot) | CROO Discord #dev · GitHub `CROO_SDK_KEY` examples | Already parsing orders; needs a **real provider SKU** |
| 3 | **BSC / Base allocator agent** (yield, treasury, “should I deploy”) | CT · Farcaster agent builders · MCP agent lists | Job = pre-trade filter, not price feeds |
| 4 | **Agent-commerce builder** (generic Store browser / meta-agent) | CROO Store early buyers · x402/CAP threads | Needs **one honest listing** with schema + dry-run |
| 5 | **Reputation / proof nerd** (ERC-8004, anchoring, audit trails) | Casper/Mantle dev Discord · ERC-8004 repos | Cares about **provenance block** + explorer URLs in JSON |

**Disqualify:** memecoin callers, HFT, “guaranteed APY”, anyone who wants sub-minute signals.

---

## Message rules

- **Lead with the job:** pre-trade filter + action contract — not “AI trading bot.”
- **One ask per message:** dry-run *or* Store hire *or* 15-min feedback call — not all three.
- **No server IP / MCP endpoint** in cold DMs unless they ask for HTTP integration.
- **Mention CROO only** to personas 1–2–4; **omit CROO** for Casper/reputation (persona 5) — use anchoring + dashboard instead.
- Follow up **once** after 5–7 days; then stop.

---

## Persona 1 — CROO hackathon team

**Subject / opener:** `signals-live as a pre-trade filter for your allocator?`

```
Hi — saw your buidl on the CROO hackathon. We're listed with one SKU: signals-live ($0.05 USDC) — ranked BSC conviction + macro gate + explicit guidance (skip / wait / evaluate) + on-chain provenance in the JSON.

Not price alerts; it's a conviction filter for agents that need an action contract before deploying.

Fast path: examples/croo-requester → npm run dry-run (no payment), then one Store hire with Requirements {} only.

Would you try a dry-run and tell me if guidance.recommendedAction is usable in your loop? Happy to jump on a 15-min call if useful.

Store: https://agent.croo.network/agents/90dd0e5a-a551-4dfb-aa64-b3c0274c2205
Guide: https://github.com/thisyearnofear/earlynotwrong/blob/main/docs/MCP_INTEGRATION.md
```

---

## Persona 2 — CAP requester / SDK integrator

**Opener:** `Reference provider for signals-live/v1.1?`

```
Hi — building buyer-side on CROO CAP? We run a live BSC conviction agent and publish signals-live/v1.1: guidance + ranked candidates + provenance (anchor explorer links).

Looking for 1–2 requester authors to break our dry-run → hire → parse guidance path and tell us what's missing for production.

npm run dry-run in examples/croo-requester — no spend. Store hire is $0.05, Requirements {} only.

If you wire guidance into a pre-trade step, I'd love to quote you in our docs (optional).

Repo: https://github.com/thisyearnofear/earlynotwrong/tree/main/examples/croo-requester
```

---

## Persona 3 — BSC/Base allocator agent

**Opener:** `Pre-trade filter before your agent opens risk?`

```
Quick ask — do you run an allocator/treasury agent that decides *whether* to deploy capital each cycle?

We sell one structured payload (signals-live): macro entry gate, ranked conviction candidates, and an explicit guidance field (skip_entries | evaluate | wait) — from an agent that trades its own BSC book and anchors every thesis on-chain.

$0.05/hire on CROO Store · schema + example JSON in repo.

Worth a dry-run? I'll take blunt feedback on whether this beats "ask ChatGPT" for your use case.

Schema: https://earlynotwrong.vercel.app/schemas/signals-live-v1.1.schema.json
Guide: https://github.com/thisyearnofear/earlynotwrong/blob/main/docs/MCP_INTEGRATION.md
```

---

## Persona 4 — Agent-commerce / Store meta-agent

**Opener:** `Honest CAP listing for your Store browser?`

```
We're Early, Not Wrong — conviction infrastructure on the CROO Store (one SKU, fixed schema, reference requester with dry-run).

If you're building agent discovery/commerce, we're looking for feedback on: Store UX friction, deliverable parsing, and whether provenance.explorerUrls belongs in buyer audit logs.

Not asking for promotion — asking for one test hire and a list of what would make you recommend a listing to other agents.

Listing: https://agent.croo.network/agents/90dd0e5a-a551-4dfb-aa64-b3c0274c2205
```

---

## Persona 5 — Reputation / on-chain proof builder (no CROO in opener)

**Opener:** `Verifiable agent conviction — feedback on proof model?`

```
We run an autonomous trading agent that anchors every cycle's thesis hash on Casper + Mantle — same conviction record, cross-chain.

Building for agents that shouldn't trust self-reported track records. Optional personal anchor via Casper Wallet on the dashboard.

Not pitching commerce — asking whether the proof model (thesis hash + behavioral score + live book alignment) is credible for your stack.

Dashboard: https://earlynotwrong.vercel.app/agent

Would you skim the anchor flow and tell us what's missing for trust?
```

---

## Follow-up (one ping, 5–7 days later)

```
Bumping once — no pressure. If you tried dry-run or a Store hire, I'd love 3 bullets: (1) what broke (2) whether guidance is actionable (3) what would make you hire again.

If not a fit, a one-line "why not" helps us more than silence.
```

---

## Tracker (copy into Notion/Sheet)

| Persona | Name / handle | Channel | Sent | Dry-run? | Hire #1 | Hire #2 | Uses `guidance`? | Notes |
|---------|---------------|---------|------|----------|---------|---------|------------------|-------|
| 1 Hackathon | | | | | | | | |
| 2 Requester | | | | | | | | |
| 3 Allocator | | | | | | | | |
| 4 Commerce | | | | | | | | |
| 5 Proof | | | | | | | | |

---

## What to do when someone replies

| Reply | Action |
|-------|--------|
| “Dry-run worked” | Ask them to hire once; offer to debug CAP live on call |
| “guidance is vague” | Pull latest sample JSON; iterate copy in schema description, not scoring yet |
| “Too BSC-specific” | Honest: yes for now; ask if they’d still use as macro filter |
| “Price wrong” | Defer; learn job-to-be-done first |
| Ghost | One follow-up only; move on |

---

## Related

- Creative monopoly frame: [`POSITIONING.md`](./POSITIONING.md#creative-monopoly-thiel-frame)
- Broadcast channel copy (use **after** 1:1 outreach): [`community-share.md`](./community-share.md)
