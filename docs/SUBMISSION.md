# Aleo Privacy Buildathon: Submission Draft

**Project Name**: Early, Not Wrong
**Tagline**: Behavioral Reputation for Asymmetric Markets — Where Privacy is the Default.

## 1. Project Overview

### Problem Being Solved
Crypto traders lack an objective way to prove their conviction without exposing their entire financial history. This "Privacy-Reputation Paradox" means high-conviction traders are either vulnerable to surveillance or invisible to the ecosystem.

### Why Privacy Matters
Reputation in trading is a double-edged sword. If your alpha is public, it's front-run. If your net worth is public, you're a target. "Early, Not Wrong" uses ZK-proofs to prove *skill* (e.g., "I hold winners long enough") without revealing *identity* or *exposure*.

### Product Market Fit (PMF) & GTM
- **PMF**: Targeted at sophisticated on-chain traders, alpha groups, and undercollateralized lending protocols looking for behavioral signals.
- **GTM**: Initial launch at ETHDenver/EthCC to the Aleo and Ethos communities. Leverage Farcaster-native distribution for trader onboarding.

## 2. Working Demo

- **Aleo Program**: `early_not_wrong_v3.aleo` (Deployed on Testnet)
- **Transaction ID**: `at1m2g48kf8j6cml7dclhywfewxujhcdjnmxrckfnxjgnxxxk53cq8qqcc83j` (Latest deployment v3)
- **Key Features**:
  - Solana/Base wallet analysis via Helius/Alchemy.
  - "Mint Private CI" flow via Aleo Shield Wallet.
  - Selective Disclosure proofs for Archetype, Score, and Efficiency.
  - **Hardened 'Pull' Model Treasury**: Secure behavioral rebates via signed vouchers.

## 3. Technical Documentation

- **GitHub Repository**: [Link to Repository]
- **Architecture**:
  - **Backend**: Next.js API for trade analysis and proof verification.
  - **ZK-Logic**: Leo contract for record issuance and transition-based verification.
  - **Wallet Integration**: @provablehq SDK for Shield Wallet.

[Read Full Privacy Model](docs/PRIVACY_MODEL.md)

## 4. Progress Changelog (Wave 1 Recap)

- **Initial State**: Solana-only analyzer with public Ethos reputation.
- **Milestone 1**: Audited and consolidated the codebase to create a lean foundation.
- **Milestone 2**: Developed a non-trivial Leo contract for conviction index records.
- **Milestone 3**: Integrated Aleo Shield Wallet and implemented a complete "Selective Disclosure" flow.
- **Milestone 4**: Built a backend Oracle to verify Aleo transaction proofs.
- **Milestone 5**: Integrated $USDCx and `credits.aleo` payments to satisfy Buildathon Rule #4, including a **Treasury-backed Rebate API**.
- **Milestone 6**: Launched "Private Strategist" mode for encrypted trade intent commitments on Aleo.

## 5. Judging Criteria Highlights

- **Privacy Usage (40%)**: Core features are ZK-based selective disclosure and **Private Thesis Commitments**. We demonstrate how to hide trade alpha until the moment of proof.
- **Technical Implementation (20%)**: Uses full Aleo SDK stack, including custom Leo transitions and backend verification logic for both reputation and strategy.
- **Buildathon Rule #4 (Mandatory)**: Full integration of `credits.aleo` for premium unlocks and `USDCx` for behavioral rebates via Shield Wallet.
- **Novelty (10%)**: First project to bridge Solana/Base behavioral history to Aleo-native private reputation and **Private Strategy Execution**.
