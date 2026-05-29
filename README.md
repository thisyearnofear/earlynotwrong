# EARLY, NOT WRONG

> Being early feels like being wrong. Until it doesn't.

**Built for the [Aleo Privacy Buildathon 2026](https://luma.com/aleo-buildathon)** — *Where Privacy Becomes the Default.*

An agentic on-chain behavioral analysis app that helps crypto traders understand whether their biggest losses came from being wrong — or from not staying right long enough. The app analyzes **Solana** and **Base** wallet behavior, then anchors AI-generated conviction records to **Mantle** as a verifiable agent reputation layer. "Early, Not Wrong" also uses **Aleo ZK-Proofs** to allow traders to build and prove portable behavioral reputation without revealing their underlying wallet history.

## Chain Architecture

- **Solana + Base**: Source chains for wallet history, trade behavior, exits, holding periods, and conviction analysis.
- **Mantle**: Agent identity and reputation settlement layer for anchoring thesis hashes, conviction scores, and verification events.
- **Aleo**: Private credential and selective-disclosure layer for proving conviction predicates without exposing raw wallet history.

---

## Aleo Privacy Integration (Buildathon Focus)

### The Privacy Dilemma
In traditional Web3, building reputation as a "skilled trader" requires exposing your entire wallet history. This creates a trade-off between **Public Identity** (trust but exposure) and **Anonymous Identity** (privacy but lack of credentials).

### The Solution: Selective Disclosure
"Early, Not Wrong" decouples behavioral verification from wallet identity using Aleo.
1. **Private Commitment**: Mint your Conviction Metrics as encrypted Aleo records.
2. **ZK-Proofs**: Generate proofs for specific predicates (e.g., "Score > 80") without revealing the raw data.
3. **Shield Wallet**: Secure, off-chain management of your behavioral credentials.
4. **Private Payments (USDCx)**: Unlock premium features and claim "Patience Rebates" using Zero-Knowledge stablecoins.

[Read our full Privacy Model →](docs/PRIVACY_MODEL.md)

---

## Core Thesis

In asymmetric markets, conviction isn't tested when you're wrong — it's tested when you're early. Losses are capped (−1x), but wins are uncapped. The most expensive mistake isn't being wrong — it's selling winners too early.

## The Problem

Crypto traders systematically:
- Exit profitable positions prematurely due to volatility or social pressure
- Hold losers longer than winners, despite asymmetric payoff structures
- Misinterpret "early" as "wrong" due to short-term drawdowns
- Lack objective, wallet-level evidence of how patience/impatience affects their P&L
- Have no portable reputation that proves their conviction quality across platforms

**No tool exists that reframes trading history through the lens of conviction vs timing, and no composable reputation layer captures this behavioral truth.**

---

## What It Does

An autonomous agent that analyzes historical trades on Solana and Base to:

### Identify:
- Positions sold early before significant upside
- Losses capped correctly vs allowed to spiral
- Drawdowns that preceded outsized gains

### Quantify:
- Dollar value of impatience vs conviction
- Asymmetry score (capped losses vs uncapped gains captured)
- Patience tax (value lost to premature exits)

### Surface:
- **"Early, Not Wrong" events** — trades exited at loss/small gain that later mooned
- **Conviction wins** — holding through drawdowns → outsized returns
- **False conviction** — stubbornness that destroyed asymmetry

---

## User Flow

1. Connect wallet (Solana/Base or both) + Ethos profile
2. Agent autonomously explores token interactions, entry/exit timing, holding periods, post-exit price trajectories
3. Receive **Conviction Report** with behavioral scores, missed upside vs avoided downside, comparative insights
4. **Conviction Index accrues to your Ethos reputation** — portable, composable, credibility-backed

---

## Innovation: Conviction Index (CI) as Reputation

A wallet-level score measuring how consistently a trader:
- Allows upside to compound
- Caps downside efficiently
- Holds through drawdowns when asymmetry remains
- Avoids reflexive exits

**CI is not performance. CI is behavior under uncertainty.**

### Conviction Labels:

| Label | Characteristics |
|-------|----------------|
| **High Conviction** | Rare trades, large outcome dispersion, thesis-driven exits |
| **Early but Right** | Often underwater initially, disproportionate upside capture |
| **Reactive** | High turnover, frequent early exits, low asymmetry |
| **Stubborn** | Holds losers beyond asymmetry, low signal quality |

---

## Ethos Integration: Reputation as Infrastructure

### Why Ethos?

Conviction is meaningless if it's siloed. Ethos makes behavioral reputation **composable, portable, and credible** across the crypto ecosystem.

### How We Integrate:

#### 1. Credibility Score as Entry Point
- Use Ethos credibility score to filter out sybil wallets and wash trading
- Only analyze wallets with sufficient on-chain reputation to ensure signal quality
- Prevents gaming: conviction analysis requires real trading history

#### 2. Conviction Index → Ethos Reputation
- CI scores are written to user's Ethos profile as attestations
- Behavioral labels (High Conviction, Early but Right, etc.) become reputation badges
- Creates a **reputation-native trading identity** that travels with the wallet

#### 3. Reputation-Gated Insights
- Advanced analytics unlock based on Ethos credibility tier
- Higher reputation users access comparative cohort data
- Creates incentive alignment: build reputation, unlock deeper self-knowledge

#### 4. Social Layer via Ethos Profiles
- Users can display their Conviction Index publicly on Ethos
- Other traders filter wallets by CI percentile using Ethos API
- **"Quiet conviction" becomes discoverable reputation** before performance shows

#### 5. Meta-Signal Attribution
When a high-CI wallet (verified via Ethos) enters/exits/holds:
- *"This wallet [Ethos credibility: 850] ranks 92nd percentile for upside capture"*
- *"This wallet [Ethos credibility: 450] historically exits winners early"*
- Ethos credibility score adds trust layer to behavioral insights

#### 6. Reputation Staking (Future)
- Wallets can stake Ethos reputation on their conviction thesis
- False conviction degrades Ethos score
- Proven conviction compounds reputation
- Creates **skin-in-the-game for signal quality**

### Technical Integration:
- **Ethos API** for credibility score queries and attestation writes
- **Reputation-weighted analytics** (higher Ethos score = access to richer comparative data)
- **Composable reputation:** CI becomes queryable via Ethos by any dApp
- **Slash protection:** Gaming detection triggers Ethos reputation penalties

---

## What This Is NOT

❌ Trading bot  
❌ Signals platform  
❌ Leaderboard for speculation  
❌ Financial advice  

**This is self-knowledge for asymmetric markets — backed by portable, composable reputation.**

---

## Meta-Signal Layer

Not trade copying. Not alerts. **Meta-signal about the trader, not the trade** — verified and weighted by Ethos credibility.

The app doesn't tell you what to buy. It tells you **how seriously to take a wallet's action**, backed by their reputation.

---

## Tone & Aesthetic

Calm, clinical, contrarian. Minimalist, data-forward. No hype, no price predictions. 

Inspired by value investing, risk asymmetry, behavioral finance, quiet conviction.

**Ethos integration is invisible to the user** — reputation just works, accrues, and compounds naturally.

---

## Success Metrics

- "I didn't realize how much upside I gave away" moments
- Users discovering non-obvious behavioral mistakes
- Conviction Index accruing to Ethos profiles
- Cross-platform reputation portability
- High-CI wallets becoming discoverable via Ethos before alpha emerges

---

## Chain Support

**Initial:** Solana, Base  
**Vision:** Chain-agnostic, reputation-composable across all EVM and non-EVM chains

---

## Philosophy

**In asymmetric markets, conviction itself is a signal — but only if it's earned.**

**With Ethos, that conviction becomes reputation you can take anywhere.**

---

## Recent Updates: Phase 3B - Cluster Detection & Social Signals

### 🆕 Cluster Signal Detection
- **Multi-Trader Confluence:** Real-time detection when 3+ high-trust traders (score ≥65) enter the same token within a 15-minute window
- **Cross-Chain Coverage:** Cluster detection active on both Solana (Helius webhooks) and Base (Alchemy polling)
- **Weighted Signals:** Clusters weighted by average trust score of participating traders
- **Cooldown Protection:** 30-minute cooldown per token to prevent signal spam

### 🆕 Email & Telegram Notifications
- **Email Alerts:** Resend-powered transactional emails with rich HTML formatting
- **Telegram Bot:** Real-time push notifications via Telegram bot integration
- **In-App Alerts:** Cluster signals displayed alongside trade alerts in the Conviction Alerts panel
- **Rate Limiting:** Per-user rate limits (configurable, default 10/hour) to prevent notification fatigue

### 🆕 Notification Preferences
- **Channel Selection:** Choose in-app, email, Telegram, or any combination
- **Threshold Tuning:** Configure minimum trust score (default 65) and cluster size (default 3)
- **Chain Filtering:** Subscribe to Solana-only, Base-only, or all chains
- **Self-Serve UI:** Integrated settings panel in Conviction Alerts component

### 🆕 Architecture Improvements
- **Watchlist Consolidation:** Migrated from hardcoded constant to Postgres-backed service (DRY)
- **TradeEvent Normalization:** Canonical event model shared across Helius and Alchemy ingestion
- **Modular Alerts System:** `src/lib/alerts/` with types, cluster-detector, and converters
- **Queue-Based Delivery:** Async notification processing via Vercel Cron

---

## Phase II Workstream - Mantle Turing Test Hackathon 2026

### Sovereign AI Agent Identity (ERC-8004)
- **Agent Passport**: ENW is prepared for registration as a sovereign agent on Mantle using an ERC-8004-style identity flow.
- **Agent Card**: Metadata schema describes ENW's capabilities in wallet analysis, conviction scoring, and on-chain strategy.
- **On-Chain Reputation**: Verified conviction analyses are designed to become Mantle-anchored reputation records for the ENW agent.

### Mantle L2 Conviction Registry
- **Proof of Analysis**: Behavioral insights and conviction scores are hashed and anchored on Mantle L2, creating a verifiable history of the agent's logic.
- **Cross-Chain Subject Hashes**: Solana/Base wallet identifiers are stored on Mantle as hashes, so Mantle can settle reputation without pretending every analyzed wallet is EVM-native.
- **Agentic Economy**: ENW is being extended from a dashboard into an **Agentic Strategist** that can support Mantle-native assets like **mETH**, **USDY**, and **MNT**.

### Mantle Ecosystem Integration
- **RWA Analysis**: Planned support for Mantle's Real-World Asset ecosystem, including conviction analysis around **USDY** and **mETH** holders.
- **Agent-to-Agent (A2A)**: Planned MCP/A2A endpoints so other Mantle agents can request ENW risk assessment and behavioral audits.

---

## Recent Updates: Phase 5 - Aleo Privacy Integration (Aleo Buildathon 2026)

### 🆕 Selective Disclosure via Aleo ZK-Proofs
- **Private CI Records**: Commit your conviction metrics (Score, Archetype, Patience Tax) to Aleo as encrypted records.
- **Zero-Knowledge Proofs**: Generate proofs for specific predicates (e.g., "Score > 80") without revealing your full wallet history.
- **Shield Wallet Integration**: Full support for Aleo Shield Wallet for secure, off-chain record management.
- **Proof Verification API**: Backend Oracle to verify Aleo transaction proofs and validate user claims.

### 🆕 Hardened Treasury: The 'Pull' (Signed Voucher) Model
- **Platform Authorization**: Our backend verifies eligibility and generates a signed voucher using the treasury's private key.
- **User Execution**: The user submits this voucher to the smart contract, which verifies the signature and releases the rebate.
- **Zero Custody**: This model eliminates the need for the platform to hold a spending private key on the server, providing production-grade security for behavioral incentives.

### 🆕 Leo Smart Contract
- **Live Program ID**: `early_not_wrong_v3.aleo`
- **Transaction ID**: `at1m2g48kf8j6cml7dclhywfewxujhcdjnmxrckfnxjgnxxxk53cq8qqcc83j` (Latest deployment v3)
- **Selective Disclosure Logic**: Custom Leo contract implementing privacy-preserving verification transitions.
- **On-Chain Identity**: Decouple behavioral reputation from public wallet addresses using Aleo's private-by-default architecture.

### 🆕 UI/UX Enhancements
- **Aleo Conviction Card**: Dedicated interface for minting private records and generating ZK-proofs.
- **Selective Disclosure Dialog**: User-friendly proof generation flow with real-time status updates and explorer integration.

---

## Recent Updates: Phase 4 - Privacy Mode (Privacy Hack 2026)

### 🆕 Privacy Cash Integration
- **Private Sessions**: Sign a message to derive encryption key, enabling configurable private analysis sessions (basic: 30 min, extended: 24 hours, custom: user-defined)
- **Unlinkable Analysis**: Wallet addresses cannot be correlated to analysis requests
- **Zero Custody**: Encryption keys derived from user signatures, never stored
- **Audited Protocol**: Privacy Cash has 14 audits and $210M+ in private volume

### 🆕 Enhanced Privacy Features
- **Privacy Tiers**: Basic (30 min), Extended (24 hours), and Custom (user-defined) session durations
- **Privacy Preferences**: Configurable options to hide specific metrics, enable private peer comparison, and allow anonymous reputation building
- **Private Peer Comparison**: Compare your conviction metrics against others without revealing your identity
- **Privacy-Enhanced Reputation**: Build reputation by contributing to aggregate metrics without revealing your wallet address

### 🆕 Private Attestations
- **Encrypted Conviction Scores**: Create attestations without revealing wallet address
- **Selective Disclosure**: Share conviction proofs with specific parties via unique URLs
- **Hash-Based Verification**: Third parties can verify attestation authenticity without seeing data
- **Anonymous Reputation Building**: Contribute to aggregate reputation metrics without revealing identity

### 🆕 UI Enhancements
- **Privacy Toggle**: Enable/disable in wallet connect dialog with tier selection
- **Session Timer**: Countdown with visual indicator and tier display
- **Privacy Preferences Panel**: Configure privacy settings (hide metrics, peer comparison, reputation building)
- **Green Shield Badge**: Navbar indicator when privacy mode active
- **Private Attestation Option**: Choose between public (Base EAS) or private (Privacy Cash) attestations
- **Anonymous Reputation Builder**: Option to contribute to aggregate metrics without revealing identity

### Technical Implementation
- **SDK**: `privacycash@1.1.12` npm package
- **Session Management**: `src/lib/privacy-cash.ts`
- **Store Integration**: Enhanced `privacyMode` state in Zustand store with tier and preference settings
- **Attestation Service**: `writePrivateAttestation()`, `verifyPrivateAttestation()`, and `buildPrivacyEnhancedReputation()`
- **Hook Integration**: `useConviction` hook with `comparePeersPrivately()` and `updatePrivacyPreferences()`

### Hackathon Eligibility
- **Privacy Cash Bounty**: $15k — SDK integration, private sessions, encrypted attestations
- **Helius Bounty**: $5k — Already using Helius RPC for Solana data
- **Open Track**: $18k — "Private behavioral reputation" is a novel use case

---

## Recent Updates: Phase 3A - Advanced Reputation Perks & Real-Time Intelligence

### 🆕 Comprehensive Reputation Tier System
- **4-Tier Perk Structure**: Premium (100+), Whale (500+), Alpha (1000+), Elite (2000+)
- **Progressive Perks**: Faster refresh rates, deeper history, advanced features unlock by tier
- **Visual Tier Indicators**: Clear progression path with next-tier requirements and new perks preview
- **Elite Status**: Maximum perks for 2000+ Ethos users including early feature access

### 🆕 Real-Time Conviction Alerts (Ethos 1000+)
- **Live Monitoring**: Instant notifications when high-conviction traders make significant moves
- **Severity Classification**: Critical/High/Medium alerts based on wallet reputation and trade size
- **Rich Context**: Full trader profiles with Ethos scores, conviction history, and Farcaster identity
- **Smart Filtering**: Customizable alert thresholds and sound notifications

### 🆕 Advanced Cohort Analysis (Ethos 500+)
- **Peer Comparison**: Compare your metrics against traders in your reputation tier
- **Performance Benchmarking**: Win rates, returns, and Sharpe ratios by cohort
- **Percentile Rankings**: See where you stand within your tier (Top 10%, Average, etc.)
- **Archetype Distribution**: Most common trading patterns by reputation level

### 🆕 Enhanced Reputation Perks Dashboard
- **Perk Visualization**: Clear display of active perks and tier benefits
- **Upgrade Path**: Progress bars and requirements for next tier
- **Feature Unlocking**: Real-time access control based on Ethos score
- **Tier-Specific Benefits**: Refresh rates from 5min (Premium) to 30sec (Elite)

### 🆕 Advanced Feature Gating
- **Ethos 100+**: Basic analytics, 5min refresh, 90-day history
- **Ethos 500+**: Alpha discovery, cohort analysis, data export, 3min refresh
- **Ethos 1000+**: Real-time alerts, whale tracking, priority support, 1min refresh  
- **Ethos 2000+**: Custom dashboard, early access, 30sec refresh

---

## Recent Updates: Phase 2B - Alpha Discovery Dashboard

### 🆕 Alpha Discovery Engine
- **High-Conviction Tracker**: Real-time leaderboard of Iron Pillar traders with Ethos scores >1000
- **Reputation-Weighted Rankings**: Wallets sorted by conviction score × reputation multiplier
- **Cross-Chain Alpha**: Unified discovery across Solana and Base networks
- **Social Context**: Farcaster identities displayed when available

### 🆕 Token Conviction Heatmap
- **Credible Holder Analysis**: Shows tokens with highest concentration of high-conviction, high-Ethos holders
- **Conviction Intensity Scoring**: 0-100 scale measuring collective conviction strength
- **Multi-Chain Token Discovery**: Filter and sort by Solana/Base tokens
- **Value-Weighted Insights**: Total value held by credible conviction traders

### 🆕 Enhanced Reputation Gating
- **Ethos Score >500**: Unlocks Alpha Discovery and Token Heatmap
- **Ethos Score >1000**: Access to real-time conviction alerts (coming soon)
- **Progressive Feature Unlocking**: Clear path to higher reputation tiers
- **Sybil-Resistant Analytics**: All features filter out low-credibility wallets

### 🆕 Enhanced UI Components
- **Conviction Badge Sizes**: Small/medium/large variants for different contexts
- **Alpha Rating System**: Unknown/Low/Medium/High/Elite classifications
- **Reputation Tier Indicators**: Visual credibility status with color coding
- **Responsive Dashboard**: Optimized layout for alpha discovery features

---

## Recent Updates: Phase 2A - Reputation-Native Alpha Discovery

### 🆕 Enhanced Reputation Weighting
- **Ethos-Weighted Conviction Scores**: Base conviction scores are now multiplied by reputation tiers (Elite: 1.5x, High: 1.3x, Medium: 1.15x, Low: 1.05x)
- **Credibility Tiers**: Visual indicators showing Unknown/Low/Medium/High/Elite reputation status
- **Sybil-Resistant Analytics**: All scoring now filters out low-credibility wallets to surface genuine alpha

### 🆕 Farcaster Identity Bridge (Selective)
- **Social Context**: Wallets with Farcaster profiles display username, PFP, and bio
- **Cross-Chain Discovery**: Automatically suggests linked Ethereum/Solana wallets via Farcaster verified addresses
- **Enhanced UI**: Reputation cards show both Ethos credibility and social identity when available

### 🆕 Reputation-Gated Features (Coming Soon)
- **Premium Access**: Ethos score >100 unlocks advanced analytics
- **Whale Analysis**: Ethos score >500 enables cohort comparisons
- **Alpha Signals**: Ethos score >1000 provides real-time conviction alerts

### Technical Implementation
- **Neynar API Integration**: Resolves wallet addresses to Farcaster identities
- **Enhanced Caching**: Farcaster data cached alongside Ethos reputation
- **Modular Design**: Social features are additive, not foundational - works for all wallets

---

## Farcaster Integration

### Frame Specification Compliance
This project implements the [Farcaster Frames Specification](https://docs.farcaster.xyz/developers/frames/spec) for seamless social integration.

### Authentication Flow
- Sign In with Farcaster (SIWF) via AuthKit
- Neynar API integration for Farcaster identity resolution
- Secure wallet-to-Farcaster linking
- Cross-chain identity verification

### Frame Endpoints
```
GET /api/frame/home - Main landing frame
GET /api/frame/analysis/[wallet] - Individual analysis frame
GET /api/frame/leaderboard - Conviction leaderboard frame
POST /api/frame/action - Frame action handler
```

### Neynar Integration
- Farcaster username and profile picture resolution
- Verified address linking across chains
- Social context for behavioral analysis
- Rate-limited API calls with caching

### Development
Test frames locally using:
```bash
npm run dev:frame-debugger
```

Validate frames using the [Warpcast Frame Validator](https://warpcast.com/~/developers/frames)

## API Documentation

### Core Endpoints
```
GET /api/user/profile - User profile and reputation
GET /api/trades/history - Historical trade analysis
GET /api/conviction/score - Conviction index calculation
GET /api/alerts/recent - Recent conviction alerts
```

### Authentication
All API calls require:
- Valid Farcaster signature
- Connected wallet address
- Ethos credibility verification

### Rate Limits
- 100 requests/minute per user
- 1000 requests/hour per IP
- Burst limit of 10 requests/second

## Self-Hosted Deployment

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Redis 6+
- Docker (optional)

### Environment Variables
```bash
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/earlynotwrong"

# API Keys
ETHOS_API_KEY="your_ethos_key"
NEYNAR_API_KEY="your_neynar_key" 
ALCHEMY_API_KEY="your_alchemy_key"
HELIUS_API_KEY="your_helius_key"

# Farcaster
FARCASTER_DEVELOPER_ID="your_developer_fid"
FARCASTER_SIGNER_UUID="your_signer_uuid"

# Security
JWT_SECRET="your_jwt_secret"
ENCRYPTION_KEY="your_encryption_key"

# Mantle anchoring
NEXT_PUBLIC_MANTLE_CONVICTION_REGISTRY="0x6568418B033F229988bc09c378D16B869829Ab57"
```

### Deployment Steps
1. Clone repository
2. Set environment variables
3. Run database migrations
4. Start services
5. Configure reverse proxy (nginx/Caddy)

### Monitoring
- Health checks at `/api/health`
- Metrics endpoint at `/api/metrics`
- Error tracking via Sentry
- Performance monitoring with Datadog

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details on:

- Development setup
- Coding standards
- Testing requirements
- Pull request process
- Farcaster integration specifics

## License

MIT

---

## Contact

For questions, feedback, or collaboration inquiries, reach out via [your contact method].
