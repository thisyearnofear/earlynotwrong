# Feedback Guide for CROO Test & Earn Testers

> For the CROO "Test & Earn" initiative (Aug 4–17). Use this when testing
> the **Early, Not Wrong** agent (`signals-live` on the
> [CROO Agent Store](https://agent.croo.network)).

## One-command test flow

This example ships **two** testable products for the CROO Test & Earn
initiative. Run either (or both) — each is one order.

### Product 1 — `signals-live` (the agent's own conviction signals)

```bash
cd examples/buyer-agent
npm install
npm run test    # = node index.mjs --test
```

Runs **one paid `signals-live` order** ($0.05 USDC via CROO CAP),
pretty-prints the delivered JSON, and prints an inline feedback prompt.
If you don't want to pay, use `npm run dry-run` — it stops after the free
trust gate and shows the agent's reputation without ordering.

### Product 2 — `wallet-score` (behavioral scoring of any wallet)

```bash
npm run test-wallet    # = node index.mjs --test-wallet
```

Scores a famous public wallet (vitalik.eth by default) via the
`wallet-score` service: win rate, patience tax, archetype, cohort
percentile, and a verifiable ledger hash. Override the wallet:

```bash
node index.mjs --test-wallet --wallet=0x... --chain=base --name=...
```

This is the **scarce** product — behavioral conviction scoring of an
arbitrary wallet, not the agent's own signals. It's not gated on the
agent's track record; it scores *your* (or anyone's) wallet.

## What you're testing

`signals-live` delivers one structured JSON payload per order
(`signals-live/v1.2`). It's the output of an autonomous BSC conviction
agent that scores tokens every 4 hours and anchors every thesis on Casper
+ Mantle. The payload has:

| Section | What to look at |
|---------|-----------------|
| `signals[]` | Top conviction candidates — is the ranking sensible? |
| `guidance.recommendedAction` | `skip_entries` / `evaluate` / `wait` — does it match what you'd do? |
| `regime` | Fear/greed context — is it useful, or noise? |
| `macroPause` | Entry gate before high-impact events — clear? |
| `provenance.behavioral` | The agent's own track record (win rate, archetype) |
| `provenance.reputation` | On-chain anchor count + dual-chain flag |
| `provenance.explorerUrls` | Do the Casper/Mantle links resolve? |

## The 5 feedback questions

These are the questions that make feedback useful to the builder (and
that the Test & Earn initiative is really asking for). Answer as many
as you can. Questions 1–5 apply to **both** products; the product-specific
ones are called out.

### For `signals-live` (the agent's own signals)

1. **Clarity.** Could you find the top candidate and the recommended
   action in under 10 seconds? If not, what was buried?

2. **Actionability.** Did `guidance.recommendedAction` tell you
   something you could act on, or was it hedged into uselessness? Was
   `sizeMultiplier` meaningful or just always `1`?

3. **Honesty of the edge.** The agent publishes an on-demand edge report
   (conviction strategy vs a naive random-entry baseline, segmented by
   market regime). If you ran it: did the verdict feel honest, or did it
   read like it was trying to look good? Did the regime-conditional
   framing ("edge in fear, not in greed") land, or did it feel like an
   excuse?

4. **Provenance.** Did the on-chain anchor links resolve? Did the
   behavioral track record (win rate, archetype) match what you'd expect
   from the signals, or was there a gap between the self-reported metrics
   and the actual signal quality?

5. **One thing.** If you could change one thing about the deliverable,
   what would it be?

### For `wallet-score` (behavioral scoring of any wallet)

1. **Intuition match.** Did the score match your read of the wallet? If you
   scored a wallet you know (vitalik.eth, a known copy-trader, your own),
   did the archetype and win rate feel right, or was it off?

2. **Patience tax honesty.** The `patienceTaxUsd` is the headline number —
   USD left on the table by exiting before the peak. Did it feel honest, or
   inflated/deflated? Could you see *which* positions drove it?

3. **Verifiability.** The `proof.ledgerHash` is a keccak256 of the
   reconstructed ledger. Could you (in principle) recompute it from on-chain
   data? Did the `verifiableAt` link resolve to the interactive analyzer
   showing the same score?

4. **Cohort context.** The `cohort.percentile` ranks the wallet vs all
   scanned wallets on that chain. Was the cohort size big enough to be
   meaningful? Did the percentile add context, or was it noise?

5. **One thing.** If you could change one thing about the deliverable,
   what would it be?

## How to submit

Per the Test & Earn rules:

1. Use 5 agents from [agent.croo.network](https://agent.croo.network)
   (this is one of them).
2. Complete 5 orders (your `npm run test` order counts as one).
3. Give the builders real feedback (use the questions above).
4. Quote-post on X + submit in Discord.

## What this agent is NOT

- Not price prediction. It's conviction-to-enter, not targets.
- Not sub-minute. The cycle runs every 4 hours (may double when bankroll
  is low). `freshness.stale` tells you if the signal is from the current
  cycle.
- Not for tokens it hasn't scored. Max 5 signals per cycle, scoped to
  its BSC universe.

If any of these are dealbreakers for your use case, that's exactly the
kind of feedback to quote-post — it tells the builder who this is for and
who it isn't.
