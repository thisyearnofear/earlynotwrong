# Early, Not Wrong: Privacy Model (Aleo x ZK)

> **Current state (Jun 2026)**: Selective-disclosure proofs are live against
> `early_not_wrong_v2.aleo` on Aleo Testnet. v3 (which adds the signed-voucher
> rebate flow) is written and tested but not yet deployed — the rebate UI is
> hidden behind a config flag until v3 lands on-chain.

## Problem: The Reputation Dilemma
In traditional Web3, building a reputation as a "skilled trader" or "high-conviction holder" requires exposing your entire wallet history. This creates a trade-off:
1. **Public Identity**: Build trust but expose your strategies, alpha, and net worth to front-running and surveillance.
2. **Anonymous Identity**: Preserve privacy but lack the credentials to prove your skill to investors or communities.

## Solution: Zero-Knowledge Selective Disclosure
"Early, Not Wrong" uses **Aleo** to decouple *behavioral verification* from *wallet identity*.

### 1. Private Metric Commitment
When a user analyzes their Solana or Base wallet, we compute their **Conviction Index (CI)**. Instead of posting these metrics to a public ledger, the user "mints" a private **Aleo Record**.
- **Program**: [`early_not_wrong_v2.aleo`](https://testnet.explorer.provable.com/program/early_not_wrong_v2.aleo) (live on Aleo Testnet)
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
- **Patience Rebates** ⏳ pending v3 deploy: traders who prove high efficiency (low patience tax) via ZK-proofs can claim a `0.2 USDCx` rebate from our treasury, incentivizing disciplined trading. The `claim_rebate` entry point + `used_vouchers` replay-protection mapping live in `early_not_wrong_v3.aleo` — the contract is written and the off-chain signed-voucher treasury is hardened (`crypto.randomBytes` nonces, per-process collision detection, per-address rate limit), but v3 hasn't been deployed yet so the rebate button is currently hidden in the UI via the `aleo.rebatesEnabled` config flag.

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

---
*Built for the Aleo Privacy Buildathon 2026*
