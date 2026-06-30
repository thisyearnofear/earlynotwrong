# Early, Not Wrong: Privacy Model (Aleo x ZK)

> **Current state (Jun 2026)**: `early_not_wrong_v3.aleo` is live on Aleo
> Testnet (deploy tx
> [`at1z0qfk…cyzsshsmsn`](https://testnet.explorer.provable.com/transaction/at1z0qfkzagq7tt0rmktfxadah2uga569tls6rfa96n5lrn5yadcyzsshsmsn)).
> Selective-disclosure proofs (score / archetype / efficiency) AND the
> signed-voucher patience-rebate flow are both wired end-to-end. Reentrancy
> warnings flagged by the v4 compiler were fixed before deploy — checks and
> state writes precede the cross-program transfer in the `Final` block.

## Problem: The Reputation Dilemma
In traditional Web3, building a reputation as a "skilled trader" or "high-conviction holder" requires exposing your entire wallet history. This creates a trade-off:
1. **Public Identity**: Build trust but expose your strategies, alpha, and net worth to front-running and surveillance.
2. **Anonymous Identity**: Preserve privacy but lack the credentials to prove your skill to investors or communities.

## Solution: Zero-Knowledge Selective Disclosure
"Early, Not Wrong" uses **Aleo** to decouple *behavioral verification* from *wallet identity*.

### 1. Private Metric Commitment
When a user analyzes their Solana or Base wallet, we compute their **Conviction Index (CI)**. Instead of posting these metrics to a public ledger, the user "mints" a private **Aleo Record**.
- **Program**: [`early_not_wrong_v3.aleo`](https://testnet.explorer.provable.com/program/early_not_wrong_v3.aleo) (live on Aleo Testnet)
- **Record**: `ConvictionRecord`
- **Fields (Encrypted)**: `score`, `patience_tax`, `archetype`, `timestamp`.

### 2. Selective Disclosure (ZK-Proofs)
Once the record is in the user's Shield Wallet, they can generate **Zero-Knowledge Proofs** for specific predicates without revealing the underlying data.

| Proof Type | Predicate | Use Case |
|------------|-----------|----------|
| **Archetype Verification** | `assert(record.archetype == required_archetype)` | Gating access to specific "Diamond Hand" or "Iron Pillar" social circles. |
| **Elite Score Proof** | `assert(record.score >= 80)` | Proving you are a top-tier trader without revealing your exact score. |
| **Efficiency Proof** | `assert(record.patience_tax <= 1000)` | Proving disciplined execution without revealing the total volume of trades. |

### 3. Private Payments & Incentives
Aleo's native private stablecoin support creates a circular privacy economy:
- **Premium Alpha** ✅ live: users pay `0.5 credits` via `credits.aleo` to unlock advanced behavioral metrics (Whale Signals, Exit Maps).
- **Patience Rebates** ✅ live (v3): traders who prove high efficiency (low patience tax) via ZK-proofs claim a `0.2 credits` rebate from our treasury (`credits.aleo::transfer_public`), incentivizing disciplined trading. USDCx is the long-term target for mainnet once Aleo's private stablecoin program ships; testnet ships with native credits because the cross-program call is already wired. The flow:
   1. Client requests a voucher via `POST /api/aleo/rebate` on Vercel (per-address 1h cooldown).
   2. The Vercel route is a thin HMAC-authed proxy — it forwards to the VPS sign service at `POST /aleo/sign-voucher`. The Aleo treasury key never lives on Vercel.
   3. The VPS signs `nonce_field` with the treasury's Aleo private key — `crypto.randomBytes(32)` for the nonce, per-process collision detection — and returns `{ nonce, signature }`.
   4. Client submits `claim_rebate(recipient, amount, nonce, sig)` to v3 on-chain. The contract verifies the treasury signature, marks the nonce in `used_vouchers` (replay-safe Checks-Effects-Interactions order), and finalizes the `credits.aleo::transfer_public` to the recipient.

  **Why two hops instead of signing on Vercel?** Vercel decrypts env vars into the process memory of every serverless invocation, plus any post-install npm dependency in the Next.js build has access via `process.env`. By moving signing to the VPS, the key stays in one long-lived process with file-level perms. A Vercel platform compromise (or a supply-chain attack in the build) can't leak it. The HMAC channel between Vercel and the VPS uses a 30-second replay window over `${timestamp}.${body}`.

  **Transport: plain HTTP for testnet, TLS for mainnet.** The Vercel→VPS hop currently rides plain HTTP (`http://144.202.117.160:31777`). For the buildathon/testnet window this is acceptable because the security boundary is the HMAC, not the transport:
  - **Forgery**: HMAC-SHA256 over `${timestamp}.${body}` with a 32-byte shared secret. An attacker on the wire can't mint a valid signature without the secret.
  - **Tampering**: the request body is bound to the signature, so a MITM swapping recipient/amount fails the HMAC check.
  - **Replay**: 30s replay window at the VPS + the on-chain `used_vouchers` mapping in `early_not_wrong_v3.aleo` (each `nonce_field` is single-use). Practical replay impact is zero.
  - **What plain HTTP leaks**: voucher metadata (recipient address, amount) is visible to any on-path observer. The treasury key, the HMAC secret, and the signing capability are not.

  Mainnet migration path: Cloudflare Tunnel (no port-443 conflict with the VPS's existing Traefik proxy, gives Vercel a stable `https://` origin without managing certs). Caddy/Let's Encrypt was ruled out because Coolify's Traefik already owns 443 on this VPS.

### 4. Private Intent & Strategy (The "Strategist" Mode)
To address the "how to trade" paradox on a public-ledger world, we introduce **Private Thesis Commitments**:
- **Commitment**: Traders hash their trade thesis (e.g., "$ETH target 5k due to EIP-XXXX") and commit it to Aleo as a `PrivateThesis` record.
- **Privacy**: The thesis is encrypted/hashed; no MEV bot or copy-trader can see your alpha.
- **Proof**: Later, the trader can reveal the thesis and prove they were "early" without having leaked the info prematurely.

### 5. Architecture Overview
1. **Frontend**: Analyzes public chain history (Solana/Base).
2. **Shield Wallet**: Acts as the secure vault for private behavioral records and trade intents.
3. **Leo Smart Contract**: Defines the rules for record issuance, verification, and thesis commitment.
4. **On-Chain Verification**: Third parties (or our own backend) can verify the `TX_ID` of a proof to confirm the user meets the criteria.

## Why Aleo?
- **Off-chain Execution**: Proofs are generated locally in the user's browser/wallet, ensuring the raw metrics never leave their device.
- **Privacy by Default**: Unlike EVM-based privacy solutions, data is hidden unless explicitly disclosed.
- **Composability**: Private reputation can be used as a "ZK-Credential" for other Aleo-based DeFi protocols (e.g., undercollateralized lending based on conviction).

