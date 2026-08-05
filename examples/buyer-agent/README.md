# Buyer Agent — Allocator Decision Flow

> A complete, copy-paste-able example of an **allocator agent** consuming the
> Early, Not Wrong reputation marketplace to make a verifiable pre-trade
> decision.

This is the integration the marketplace exists for. An autonomous allocator
(treasury bot, yield agent, copy-trader) needs to answer one question before
deploying capital each cycle:

> **"Before I open risk this cycle, should I — and on what — given a
> verifiable track record?"**

The flow below answers it in three steps, using only the agent's MCP surface:

```
  ┌─────────────────────┐     FREE      ┌──────────────────────────┐
  │  1. Trust gate      │ ────────────► │  get_agent_reputation    │
  │  (should I listen?) │ ◄─────────── │  → totalAnchors,         │
  └─────────┬───────────┘                │    meanConviction,       │
            │ trust ≥ threshold          │    dualChain, archetypes  │
            ▼                            └──────────────────────────┘
  ┌─────────────────────┐     PAID       ┌──────────────────────────┐
  │  2. Get signals     │ ──x402/CROO──► │  get_live_signals        │
  │  (what's the call?) │ ◄──────────── │  → signals-live/v1.2     │
  └─────────┬───────────┘                │    guidance, signals[],  │
            │ guidance.recommendedAction │    execution, provenance │
            ▼                            └──────────────────────────┘
  ┌─────────────────────┐
  │  3. Act + audit     │  skip_entries → stand down this cycle
  │  (your rules)       │  evaluate     → size per sizeMultiplier, open
  │                     │  wait         → no candidates, hold cash
  └─────────────────────┘
```

## Why this exists

The marketplace has two rails (MCP x402 in CSPR, CROO CAP in USDC) and six
tools, but until now there was no end-to-end example of a **buyer agent
making a real decision** with them. The `x402-client/` example shows the
*payment mechanics* (the 402 round-trip); the `croo-requester/` shows the
*CROO SDK* call. Neither shows the decision logic that makes the data
worth paying for.

This example fills that gap. It is the reference integration a cold buyer
agent developer copies to go from "I found the agent on the CROO Store"
to "my agent skipped entries this cycle because the signal said so, and I
can prove why."

## Quick start

```bash
cd examples/buyer-agent
npm install

# Against the live agent (default):
node index.mjs

# Against a local agent:
AGENT_URL=http://localhost:31777 node index.mjs

# Dry-run (trust gate + free reputation only, no paid call):
node index.mjs --dry-run

# Machine-readable audit (one JSON object per line — for a real allocator
# agent to parse and persist as its verifiable pre-trade record):
node index.mjs --json

# Edge-report pre-check: fetch /edge-report before paying for signals.
# If the conviction signal has no demonstrable edge over a naive baseline,
# the buyer skips the paid call entirely (saves the CSPR):
node index.mjs --edge-report --json

# Override the trust threshold (default: 5 anchors, mean ≥ 50):
TRUST_MIN_ANCHORS=10 TRUST_MIN_MEAN_SCORE=60 node index.mjs
```

## The decision contract

The buyer agent implements this policy (edit it to match your own risk rules):

| `guidance.recommendedAction` | Buyer action |
|------------------------------|--------------|
| `skip_entries` | Stand down — a high-impact macro event is within the pause window. Log and hold cash. |
| `wait` | No conviction candidates this cycle (or signal data is stale). Hold cash. |
| `evaluate` | Size into `guidance.topCandidate` at `guidance.sizeMultiplier × yourMaxPosition`. Verify `provenance.behavioral.status === "ready"` first. |

The buyer **never** trusts the signal blindly — it cross-checks the agent's
own behavioral provenance (`provenance.behavioral.metrics.score`,
`provenance.behavioral.metrics.archetype`) against its trust threshold before
acting on `evaluate`. A signal from an agent with `insufficient_history`
provenance is downgraded to `wait`.

## Trust threshold

The free `get_agent_reputation` call returns:

```json
{
  "totalAnchors": 47,
  "meanConvictionScore": 68.2,
  "dualChain": true,
  "archetypes": ["Iron Pillar", "Diamond Hand"],
  "latestAnchor": { ... }
}
```

The buyer requires (configurable via env):

- `totalAnchors >= TRUST_MIN_ANCHORS` (default 5) — enough history to be meaningful
- `dualChain === true` — the agent commits to both Mantle + Casper (operator skin in the game)
- `meanConvictionScore >= TRUST_MIN_MEAN_SCORE` (default 50) — the agent's anchored theses aren't garbage

If any check fails, the buyer logs `UNTRUSTED` and stands down — no paid call
is made. This is the free-tier trust gate doing its job: it gates adoption of
everything else without costing the buyer a cent.

## Audit trail

Every run prints a structured log line a buyer can persist:

```
[buyer] 2026-07-23T14:02:11Z trust=TRUSTED anchors=47 mean=68.2 dualChain=true
[buyer] 2026-07-23T14:02:11Z signals paid=0.5CSPR cycle=312 stale=false
[buyer] 2026-07-23T14:02:11Z guidance=evaluate top=FET size=0.5x behavioral=ready(72,Iron Pillar)
[buyer] 2026-07-23T14:02:11Z action=OPEN symbol=FET usd=50 reason="conviction 74/100, behavioral provenance ready"
```

This is the verifiable pre-trade filter the positioning doc promises —
"skip, wait, or evaluate with on-chain proof" — made concrete.

## Files

- `index.mjs` — the buyer agent (zero dependencies, pure Node.js)
- `package.json` — just a name; no runtime deps
