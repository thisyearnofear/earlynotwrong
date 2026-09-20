# Documentation

Use this page to find the current source of truth. Competition write-ups,
launch copy, and submission text live in [`archive/`](archive/) — they are
history, not operational documentation.

## Start Here

- [Project overview](../README.md)
- [Core principles](CORE_PRINCIPLES.md)
- [Security and privacy](SECURITY.md) · [Privacy model](PRIVACY_MODEL.md)
- [Harness architecture](HARNESS_ARCHITECTURE_PLAN.md) — the domain-agnostic
  agent skeleton (crypto + options domains, adapter registry)
- [BSC agent design](AGENT_DESIGN.md) — crypto-domain specifics: 6-factor
  signal, bankroll discipline, scam-token defense

## Sell the signal

- [A2A buyer guide](A2A_BUYER_GUIDE.md) — **start here for buyers**: MCP + CROO
  rails, signals-live/v1.2, curl + requester, 5 outbound personas
- [CROO CAP setup](CROO_INTEGRATION.md) — WebSocket client, UUID mapping,
  delivery troubleshooting
- [Signal schema](schemas/signals-live-v1.2.md)
- [Wallet score plan](WALLET_SCORE_PLAN.md)

## Chain integrations

- [Casper](CASPER_INTEGRATION.md) — Odra registry, MCP server, x402 paywall
- [Mantle](MANTLE_INTEGRATION.md) — ERC-8004 ConvictionRegistry
- [SoSoValue](SOSOVALUE_INTEGRATION.md) — market data + SoDEX + AI narrative
- [Observability](observability/README.md)

## Operations and history

- [Lessons learned](LESSONS.md) — dated post-mortems, the ops log
- [Roadmap](../ROADMAP.md)
- [Hackathon archive](hackathons.md) — SigNoz research + per-competition index
- [Current Casper demo script](demo-script-final.md)

## Archive

Historical submission material — do not treat as implementation docs.
Relative links inside these files point at their original locations.

- [Delphi arena strategy](archive/DELPHI_AGENT_ARENA.md) (arena closed 2026-08-24)
- [Alpaca options writeup](archive/ALPACA_HACKATHON_WRITEUP.md) (closed +2.28%)
- [Delphi submission](archive/HACKATHON_SUBMISSION_DELPHI.md)
- [Mantle submission](archive/SUBMISSION.md)
- [BNB plan](archive/HACKATHON_PLAN.md) (superseded — copy-trading direction abandoned)
- [OKX research](archive/OKX_HACKATHON.md) (did not ship)
- [Positioning](archive/POSITIONING.md) · [Community share copy](archive/community-share.md) · [Social posts](archive/social-posts-final.md)
- [CROO Store copy](archive/croo-store-listing.md) · [Wallet score listing](archive/croo-store-listing-wallet-score.md)
- [Outbound DMs](archive/OUTBOUND_INTEGRATORS.md) (copy folded into the buyer guide § Outbound)
- [Older demo scripts](archive/demo-script.md)

## Maintenance Rules

- Add new implementation guidance to the owning integration or architecture document.
- Put dated decisions and postmortems in [Lessons learned](LESSONS.md).
- Put launch copy, scripts, and submission text in [`archive/`](archive/).
- Update this index when adding or retiring a document.
