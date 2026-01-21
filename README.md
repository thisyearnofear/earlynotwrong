# EARLY, NOT WRONG

> Being early feels like being wrong. Until it doesn't.

An agentic on-chain behavioral analysis app that helps crypto traders understand whether their biggest losses came from being wrong — or from not staying right long enough.

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

## Recent Updates: Phase 3 - Advanced Reputation Perks & Real-Time Intelligence

### 🆕 Comprehensive Reputation Tier System
- **4-Tier Perk Structure**: Premium (100+), Whale (500+), Alpha (1000+), Elite (2000+)
- **Progressive Perks**: Faster refresh rates, deeper history, advanced features unlock by tier
- **Visual Tier Indicators**: Clear progression path with next-tier requirements and new perks preview
- **Elite Status**: Maximum perks for 2000+ Ethos users including API access and early feature access

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
- **Ethos 2000+**: API access, custom dashboard, early access, 30sec refresh

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

## License

MIT

---

## Contact

For questions, feedback, or collaboration inquiries, reach out via [your contact method].
