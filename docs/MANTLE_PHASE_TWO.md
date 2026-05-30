# Mantle Phase Two Submission Plan

## Positioning

Early, Not Wrong is an AI conviction agent that analyzes trader behavior across Solana and Base, then anchors the agent's analysis on Mantle as a verifiable reputation record.

## Chain Roles

- Solana: Source chain for high-velocity wallet behavior and token exits.
- Base: Source chain for EVM wallet behavior, Ethos identity, and trading history.
- Mantle: Agent identity, proof-of-analysis anchoring, and reputation settlement.

## Primary Track

AI Alpha & Data.

Secondary fit: AI Trading & Strategy and Agentic Wallets & Economy.

## Demo Flow

1. Analyze a Solana or Base wallet.
2. Generate a deterministic thesis hash from the report.
3. Hash the analyzed subject as `<chain>:<wallet>`.
4. Anchor subject hash, thesis hash, score, and archetype to Mantle Sepolia.
5. Open the Mantle explorer transaction as proof.

## Deployment

- Mantle Sepolia `MantleConvictionRegistry`: `0xBd93c9fd88d7D3D5a7b64b24C137f3666E287121`
- Explorer: `https://explorer.sepolia.mantle.xyz/address/0xBd93c9fd88d7D3D5a7b64b24C137f3666E287121`
- Agent/operator wallet: `0x4F01CB28EfC79bb0fF722b4d2B9cA62E313DC5fd`
- Contract access model: owner-managed operator allowlist. The deployer is authorized in the constructor, and the owner can authorize additional ENW operator wallets with `setOperatorAuthorization`.
- Hardhat verification status: attempted, but Mantle Explorer returned an HTML response from its API instead of JSON. Manual UI verification was also blocked in this environment by Cloudflare. Complete manual verification in a normal browser session if automated verification remains unavailable.

## Demo Evidence

- Selected submission track: AI Alpha & Data.
- Demo wallet analyzed: Jesse Dixon showcase wallet on Base, `0x32DA784C5A5813bAB4D52e84840869c273E15E28`.
- Demo subject hash: `0xc78f6d94d7d5d14a7c4405d8ee0d33deabc924c53c8d587239271575c1202eff`.
- Demo thesis hash: `0x059d648eca727effff50963c4098531041cf883541815130cd635173f0192160`.
- First anchor transaction: `0xc2a1283ea23e394bf8a5b54f4329647ca3319235250d28861cdd9b6dd44907c4`.
- Transaction explorer: `https://explorer.sepolia.mantle.xyz/tx/0xc2a1283ea23e394bf8a5b54f4329647ca3319235250d28861cdd9b6dd44907c4`.

## Mantle-Native Asset Story

The Phase II demo includes a curated Mantle strategy lens so ENW is Mantle-native, not only Mantle-settled:

- MNT: ecosystem beta and governance conviction.
- mETH: liquid staking conviction and drawdown tolerance.
- USDY: RWA yield discipline and patience under low-volatility carry.

The agent narrative compares a wallet's historical patience profile against these Mantle-native asset classes, then anchors the assessment as proof-of-analysis on Mantle.

## Before Submission

- Verify `MantleConvictionRegistry` on Mantle Explorer manually if automated verification remains unavailable.
- Publish the agent card to a stable URI.
- Record a demo using the real Mantle anchor transaction.
