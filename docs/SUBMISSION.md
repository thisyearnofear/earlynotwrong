# DoraHacks Mantle Turing Test Hackathon 2026: Submission Copy

## Project

**Name**: Early, Not Wrong
**Tagline**: AI conviction intelligence for asymmetric markets.

**Primary Track**: AI Alpha & Data
**Secondary Fit**: AI Trading & Strategy, Agentic Wallets & Economy

## Problem

Crypto traders do not have a credible way to prove decision quality. Public P&L is noisy, wallet history is easy to misread, and reputation usually requires exposing alpha, net worth, timing, and risk profile. The result is a gap between raw on-chain activity and a trustworthy behavioral signal.

The key question Early, Not Wrong answers is:

> Was this trader wrong, or were they early?

## Solution

Early, Not Wrong is an AI agent that analyzes Solana and Base wallet behavior, scores conviction quality, and anchors the agent's analysis on Mantle as a verifiable proof-of-analysis record.

The agent identifies:

- Early exits before major upside.
- Conviction wins where a trader held through drawdown.
- False conviction where holding destroyed asymmetry.
- Patience tax, upside capture, holding behavior, and behavioral archetype.

It then creates a deterministic thesis hash and anchors the cross-chain subject hash, thesis hash, score, and archetype to Mantle.

## Why Mantle

Mantle is the settlement layer for agent reputation in this architecture. Solana and Base provide rich wallet behavior data, while Mantle provides the durable on-chain record of what the AI agent concluded and when it concluded it.

Mantle also gives the submission a native strategy surface:

- **MNT**: ecosystem beta and governance conviction.
- **mETH**: liquid staking conviction and drawdown tolerance.
- **USDY**: RWA yield discipline and patience under low-volatility carry.

The app includes a curated Mantle Strategy Lens so judges can see how the same behavioral model extends from general wallet analysis into Mantle-native assets.

## Architecture

- **Analyze** Solana/Base wallet behavior to score conviction, patience tax, upside capture, and archetype.
- **Anchor** the AI report on Mantle using cross-chain subject hashes and an owner-managed agent operator allowlist.
- **Extend** into Mantle-native strategy intelligence for MNT, mETH, and USDY conviction/risk narratives.

## Mantle Deployment

- Registry: `0xBd93c9fd88d7D3D5a7b64b24C137f3666E287121`
- Registry explorer: `https://explorer.sepolia.mantle.xyz/address/0xBd93c9fd88d7D3D5a7b64b24C137f3666E287121`
- Agent/operator wallet: `0x4F01CB28EfC79bb0fF722b4d2B9cA62E313DC5fd`
- Contract access model: owner-managed operator allowlist. The deployer is authorized in the constructor, and the owner can authorize additional ENW operator wallets with `setOperatorAuthorization`.

## Demo Evidence

- Demo wallet: Jesse Dixon showcase wallet on Base, `0x32DA784C5A5813bAB4D52e84840869c273E15E28`
- Demo subject hash: `0xc78f6d94d7d5d14a7c4405d8ee0d33deabc924c53c8d587239271575c1202eff`
- Demo thesis hash: `0x059d648eca727effff50963c4098531041cf883541815130cd635173f0192160`
- First anchor transaction: `0xc2a1283ea23e394bf8a5b54f4329647ca3319235250d28861cdd9b6dd44907c4`
- Transaction explorer: `https://explorer.sepolia.mantle.xyz/tx/0xc2a1283ea23e394bf8a5b54f4329647ca3319235250d28861cdd9b6dd44907c4`
- Demo video: pending final recording

## Verification Status

Hardhat verification was attempted, but Mantle Explorer returned an HTML response from its API instead of JSON. Manual explorer verification was also blocked in the agent environment by Cloudflare. Complete manual verification in a normal browser session if automated verification remains unavailable.

Manual verification inputs:

- Contract: `MantleConvictionRegistry`
- Solidity version: `0.8.20`
- Constructor args: none
- Source: `mantle/contracts/MantleConvictionRegistry.sol`

## Roadmap

- Publish `mantle/agent-card.json` to IPFS or a stable app-hosted URL.
- Register the agent card URI if Mantle exposes an official agent identity registry flow for the hackathon.
- Add a recorded demo link.
- Add live Mantle asset ingestion for MNT, mETH, and USDY instead of the current curated strategy lens.
- Add user-submitted EIP-712 report anchoring so users can submit signed AI reports without the operator wallet sending every transaction.

## Previous Aleo Work

Early, Not Wrong also includes an Aleo privacy workstream for private conviction credentials and selective disclosure. That layer is complementary: Aleo handles private proofs, while Mantle handles public agent reputation and proof-of-analysis anchoring.
