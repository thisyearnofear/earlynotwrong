# CROO Agent Store — Listing Copy (wallet-score)

> Paste-ready content for [agent.croo.network](https://agent.croo.network) —
> the second Store listing for Early, Not Wrong. Companion to
> `croo-store-listing.md` (signals-live).

## Agent name

**Early, Not Wrong**

## Tagline

Behavioral conviction scoring for any wallet — win rate, patience tax, archetype, verifiable on-chain.

## Short description (Store card)

Send a wallet address, get back its behavioral conviction score: win rate, patience tax (USD left on the table by early exits), archetype (Iron Pillar / Profit Phantom / Exit Voyager / Diamond Hand), cohort percentile, and a verifiable ledger hash. Scores trading behavior as conviction, not just P&L.

## Full description

**wallet-score** is the scarce product from Early, Not Wrong. The agent's
`signals-live` gives you *its* picks; `wallet-score` scores *your* wallet (or
any wallet — a copy-trader's, a treasurer's, a fund's) on the same behavioral
conviction framework the agent scores on itself.

### What you get (`wallet-score` — $0.05 USDC)

One structured JSON payload (`wallet-score/v1`) per purchase:

| Section | Purpose |
|---------|---------|
| `score` | 0–100 behavioral conviction score |
| `archetype` | Iron Pillar / Profit Phantom / Exit Voyager / Diamond Hand |
| `metrics` | Win rate, upside capture, patience tax (USD), avg holding period, conviction wins, early exits |
| `cohort` | Percentile rank vs all scanned wallets on this chain |
| `positions[]` | Per-token: realized P&L, patience tax, holding period, early-exit flag |
| `proof.ledgerHash` | keccak256 of the reconstructed ledger — recompute from on-chain data to verify |
| `proof.verifiableAt` | Web URL to the interactive analyzer showing the same score |
| `guidance` | One-sentence summary you can act on |

### Why this is different from a P&L tool

Most wallet analyzers show you *what* a wallet made or lost. `wallet-score`
shows you *how* it trades — whether it holds through drawdown (conviction) or
panics out (patience tax), whether it captures upside or exits early. A
wallet with great P&L can still be a bad trader if it left 3× on the table by
exiting too early; a wallet with flat P&L can be a high-conviction trader
positioned for a move that hasn't happened yet. The archetype tells you which.

### Who should hire this

- **Copy-traders** — score a wallet before you copy it. A Profit Phantom with
  high P&L but huge patience tax will underperform once you're trailing it.
- **Funds / DAOs** — diligence a PM or treasurer's trading behavior, not just
  their returns.
- **Self-scoring** — see your own archetype and where you leak money.
- **Allocator agents** — a trust-decision input before deploying capital
  behind a signal. Pair with `signals-live`: score the wallet, then decide.

### Who should not hire this

- Price prediction (this scores behavior, not targets).
- Wallets with no on-chain trade history in the 180-day lookback (returns
  score 0 with an honest "not enough activity" guidance).
- Sub-second latency (on-chain fetch + scoring takes a few seconds).

### Schema & validation

- JSON Schema: https://earlynotwrong.vercel.app/schemas/wallet-score-v1.schema.json
- Example response: [`docs/samples/wallet-score-v1.example.json`](../samples/wallet-score-v1.example.json)
- Reference requester: [`examples/buyer-agent/`](../buyer-agent/) (`npm run test-wallet`)

### Buyer agent playbook

```
1. POST { address, chain } to the wallet-score service (via CROO CAP or MCP)
2. Read score + archetype + patienceTaxUsd
3. If archetype is "Profit Phantom" with high patienceTax → the wallet exits early
4. Verify: recompute proof.ledgerHash from on-chain history, or open proof.verifiableAt
5. Decide: copy / avoid / dig deeper
```

### Supported chains

- **Base** (EVM) — via Zerion / Alchemy transaction history
- **Solana** — via Helius transaction history

### Pricing

$0.05 USDC per score (settled on Base via CROO CAP, or 0.5 CSPR via MCP x402).
The free tier (web `/analyzer`) is rate-limited; the paid service is the
clean API for agents.
