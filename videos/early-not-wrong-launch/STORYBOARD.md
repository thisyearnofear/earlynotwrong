---
format: 1920x1080
message: "An on-chain trading agent that scores conviction, not predictions — and turns SoSoValue data into actual trades."
arc: Hook → Thesis → SoSoValue Signals → Execution → Anchor + Reputation → CTA
audience: SoSoValue Buildathon judges (Terminal, SSI Indexes, SoDEX teams)
music: skipped — voice-led journalistic narration, no BGM this cut
---

## Video direction

- palette: from frame.md — bg `#0A0A0A` (true near-black, never #000), primary cyan `#22D3EE` is the only accent (scarce voltage — used for the moment a signal lands, never for backdrop wash), text `#EDEDED`, text-muted `#949494`. Positive `#059669` only on a deliberate "trade-executed" beat. Never inflate the accent into a gradient or background colour-wash.
- motion grammar + reveal model: long-tail eases (`power3` default). VO-paced reveals — at t=0 only what the voice is saying enters; further pieces reveal on their spoken cue, distributed across the back half of each frame. Subtle drift (≤2px / cycle) is the only allowed motion during a held read; no breathing zooms, no continuous push.
- rhythm: Frame 1 is contemplative-typographic (held read after the second line). Frame 3 (the SoSoValue centerpiece) and Frame 4 (execution) carry most of the motion. Frame 6 closes on a held URL.
- negative list: no purple/blue AI gradient washes, no glassmorphism, no off-brand serif type, no scrollbars, no browser chrome, no spinning rings; both motion failure modes are out — never front-load-then-freeze (everything at t=0) and never screensaver (every element floating independently of the VO). Caption band keep-out: nothing important below 83% of the canvas.

## Frame 1 — Hook

- scene: Cold open. The phrase "Being early feels like being wrong." lands typographically; "Until it doesn't." resolves it under a thin cyan rule.
- duration: 3.994s
- transition_in: cut
- poster: 6s
- status: animated
- voiceover: "Being early feels like being wrong. Until it doesn't."
- asset_candidates:
    - capture/assets/svgs/logo-16fc1d72.svg
- src: compositions/frames/01-hook.html
- blueprint: kinetic-type-beats (Adapt)
- focal: brand-mantra typography
- roles: logo = supporting (small top-left); typography = cutout (centered hero)
- sfx: (none)

Open with the brand mantra — the contrarian thesis as a typographic statement, no chrome. Cyan signal underline only.

Adapt: keep the kinetic-type signature (statement builds across full-screen beats, each its own move); the build is two lines, not a token swap.

Scene 1 (0.0–1.2s): solid `#0A0A0A` canvas, all empty. The line "BEING EARLY FEELS LIKE BEING WRONG." enters as a single block — DM Sans 700, tight tracking, white, 7.5cqw, slow ease from 8px below. Centered template, ~70% of frame width. The small wordmark "EARLY, NOT WRONG" sits dim (40%) in upper-left.
Scene 2 (1.2–2.6s): line holds dead still — no jitter, no drift. The VO's pause between sentences plays out here as visual silence. Caption band clear.
Scene 3 (2.6–3.5s): a 60px × 2px cyan `#22D3EE` hairline rule draws in below the line, left-to-right on a power3 ease. Underneath, "UNTIL IT DOESN'T." types in word-by-word in DM Sans Mono, smaller (3.2cqw), cyan colour — paced to the spoken cue.
Scene 4 (3.5–3.99s): everything held still. The cyan rule glows a single beat (0.15 → 0.25 opacity) then settles. Read-and-hold.

## Frame 2 — Thesis

- scene: "Predict" gets struck through; "Score conviction" lands as the replacement. A six-factor breakdown ladder (contrarian · RSI · quality · regime · holders · news) animates in below.
- duration: 9.427s
- transition_in: crossfade
- poster: 8s
- status: animated
- voiceover: "Most trading agents predict prices. Early, Not Wrong scores conviction — the willingness to hold quality assets through fear."
- asset_candidates:
    - capture/screenshots/scroll-035.png
- src: compositions/frames/02-thesis.html
- blueprint: kinetic-type-beats (Adapt)
- focal: predict→conviction token swap
- roles: dashboard screenshot = background (dim 30%, behind the type); typography = cutout
- sfx: (none)

Frame the category mismatch. Predictions are noise; conviction is the signal we actually score. Surface the 6-factor scoring breakdown as proof we're not waving hands.

Adapt: keep the kinetic-type signature (in-place token swap); after the swap, reveal a six-factor breakdown ladder as the VO continues.

Scene 1 (0.0–1.6s): centered, "MOST TRADING AGENTS" white type lands top-line; "PREDICT PRICES." lands below in DM Sans 600, white, 5.5cqw. Asymmetric layout: text occupies left 60%, right 40% blank.
Scene 2 (1.6–3.4s): "PREDICT PRICES." gets a thin cyan strikethrough drawn left-to-right (1.5px, `#22D3EE`). Then the words swap in place — "PREDICT" → "SCORE", "PRICES" → "CONVICTION" — hard cut on the spoken word.
Scene 3 (3.4–6.0s): "SCORE CONVICTION." now reads as the affirmative claim, with "CONVICTION" in cyan; "PREDICT PRICES." remains greyed below it (text-muted, 0.6 opacity, strikethrough intact) so the contrast is visible.
Scene 4 (6.0–9.4s): below the swapped line, a six-row stack reveals one row at a time on a 0.4s stagger paced to the VO's tail: `CONTRARIAN · RSI · QUALITY · REGIME · HOLDERS · NEWS`. Each row is DM Sans Mono 13px, text-muted, with a 4px cyan tick beside it. The last row "NEWS" tick glows on land. Held-read final.

## Frame 3 — SoSoValue Signals

- scene: Three stacked cards arrive in sequence — (1) "SSI Indices" with `ssiMAG7 · ssiLayer1 · ssiAI · ssiMeme` and a green/red regime fold-in arrow; (2) "News Sentiment" with `featured.matchedCurrencies + keyword extraction from hot` and a per-symbol ±10pp chip; (3) "Macro Pause" with `CPI · FOMC · NFP — within 4h: skip · within 12h: halve`. Each card pulses the cyan signal as the voice names it.
- duration: 22.756s
- transition_in: wipe
- poster: 14s
- status: animated
- voiceover: "It reads SoSoValue every cycle. SSI baskets confirm or contradict the contrarian regime. News sentiment per symbol — pulled from featured tags, keyword-extracted from hot. And a macro pause: when CPI or FOMC is within four hours, no new entries."
- asset_candidates:
    - capture/screenshots/scroll-069.png
- src: compositions/frames/03-sosovalue.html
- blueprint: grid-card-assemble (Adapt)
- focal: three signal cards in vertical stack
- roles: dashboard screenshot = background (dim 25%, blurred 8px); cards = cutout (foreground)
- sfx: (none — the cards land silently to keep the read pristine)

The centerpiece for the SoSoValue judges. Three signals — one for each judging team. SSI Indexes → regime confirmation; Terminal news → per-symbol sentiment; macro → trade-time gating. Show actual endpoint paths/ticker names so judges see the integration is real.

Adapt: keep the grid-assemble signature (cards arrive in sequence as the VO names them). Vertical stack of 3 (not a grid) so each card is full-width on the right column.

Scene 1 (0.0–2.5s): heading "SoSoValue → Trade Decisions" types in upper-left (DM Sans Mono, 2.2cqw, text-muted, all-caps tracking). Subtle dashboard screenshot ghosts behind, blurred 8px, 25% opacity. Empty card grid placeholders sit on the right 55% as 1.5px cyan border ghosts.
Scene 2 (2.5–9.0s): as VO says "SSI baskets confirm or contradict the contrarian regime", CARD 1 fills with content — title "SSI INDEX CONFIRMATION" (cyan eyebrow), tickers `ssiMAG7 · ssiLayer1 · ssiAI · ssiMeme` in DM Sans Mono 1.4cqw, a tiny ROI sparkline showing `−3.7%` in cyan, and a label "regime score: 78/100 · FGI 17". Card slides from right, settles, holds.
Scene 3 (9.0–15.5s): as VO says "news sentiment per symbol — pulled from featured tags, keyword-extracted from hot", CARD 2 fills — "NEWS SENTIMENT" (cyan eyebrow), then two source rows: `/news/featured → matchedCurrencies[]` (cyan), `/news/hot → keyword-extract title` (text-muted). Then three sample symbol chips: `BTC −1`, `ETH +1`, `DOGE +1` — each ±N styled as ±10pp news component badges.
Scene 4 (15.5–22.0s): as VO says "macro pause: when CPI or FOMC is within four hours, no new entries", CARD 3 fills — "MACRO PAUSE" (impatience amber eyebrow), a small calendar-row showing today/tomorrow with a high-impact CPI event glow-highlighted, then the rule chips: `< 4h: SKIP ENTRIES`, `< 12h: HALVE SIZE`. The amber pulses once on "skip entries" and holds.
Scene 5 (22.0–22.76s): three cards held still side-by-side. Held read.

## Frame 4 — Execution

- scene: Top half — a pipe diagram: `SoSoValue signals → conviction → guardrails → SoDEX testnet → TWAK BSC mainnet`. Each node pulses green as the voice names it. Bottom half — a terminal-style snippet shows a real cycle log fragment: `[7/8] Executing… ✓ Trade executed — 0x...` with cyan accent on the tx hash.
- duration: 7.848s
- transition_in: crossfade
- poster: 9s
- status: animated
- voiceover: "Signals drive trades, not just commentary. SoDEX testnet first, BSC mainnet fallback through TWAK."
- asset_candidates:
    - capture/screenshots/scroll-100.png
- src: compositions/frames/04-execution.html
- blueprint: cursor-ui-demo (Adapt)
- focal: pipe-diagram → terminal log
- roles: dashboard screenshot = background (dim 30%); pipe diagram = cutout (top half); terminal log = cutout (bottom half)
- sfx: ui-soft-click (on the trade-executed line)

Differentiate from "another analytics dashboard." Self-custody execution on a real chain. Show the venue cascade so the SoDEX team sees their API is wired in as preferred, not just listed.

Adapt: keep the cursor-ui-demo signature (a path is highlighted in sequence). No cursor — instead a glowing dot traverses the pipe stations as the voice names them.

Scene 1 (0.0–2.0s): top half — five pipe stations laid out left-to-right with cyan 1.5px connectors: `SOSOVALUE` → `CONVICTION` → `GUARDRAILS` → `SODEX` → `TWAK`. All stations start dim (text-muted, 0.4 opacity). Bottom half — empty terminal window outline (1px cyan border, dark surface) with a `~/agent $` prompt and a slow-blinking caret.
Scene 2 (2.0–4.5s): on VO "Signals drive trades, not just commentary", a green-positive dot ignites at `SOSOVALUE`, traverses each station in sequence — each station fades to full white as the dot passes through (300ms per station). Connectors brighten to full cyan one-by-one.
Scene 3 (4.5–7.8s): on VO "SoDEX testnet first, BSC mainnet fallback through TWAK", the `SODEX` station gets a cyan ring drawn around it labeled "PREFERRED"; an arrow drops from SODEX to TWAK labeled "FALLBACK · BSC MAINNET". Simultaneously in the terminal: lines type in monospace — `[7/8] Executing 1 entry via SoDEX → TWAK fallback...`, then `✓ Trade executed — 0xc810ed3f2adcc3b2...` with the tx hash in cyan and a `↗` link glyph. Final beat is the green checkmark on the success line.

## Frame 5 — Anchor + Reputation

- scene: A dual-chain split — left half "MANTLE" with an ERC-8004 tx hash; right half "CASPER" with an Odra deploy hash. They link via a glowing cyan keccak256 hash in the middle. Then the camera pulls back to reveal a small node graph — the agent in the center, three external "AGENT" nodes querying via MCP, each request labeled `x402 · per-call payment`.
- duration: 8.731s
- transition_in: crossfade
- poster: 9s
- status: animated
- voiceover: "Every decision anchored to Mantle and Casper, queryable by other agents through MCP — paid per call with x402."
- asset_candidates:
    - capture/screenshots/scroll-100.png
- src: compositions/frames/05-anchor.html
- blueprint: constellation-hub (Adapt)
- focal: agent-as-hub node graph
- roles: dashboard screenshot = background (dim 25%); two chain hash cards + node graph = cutout
- sfx: (none)

The reputation marketplace. The conviction record isn't just for us — it's a product other agents can buy. Two chains as proof, MCP+x402 as the distribution layer.

Adapt: keep the constellation-hub signature (a hub node with N satellites connected). Two of the satellites are blockchain anchors; three more are external AI agents querying via MCP.

Scene 1 (0.0–3.0s): split-screen top half — left card "MANTLE · ERC-8004" with tx hash `0xb94c74b3cf...` and block `40618340`; right card "CASPER · ODRA" with deploy hash `5142ec33d3d0...` and "deploy verified" tag. Both cards have a thin cyan border, the hash strings in DM Sans Mono cyan, ledger-style.
Scene 2 (3.0–5.5s): a thin cyan keccak256 hash string `0x4a937673ea542abd...` draws across the screen connecting the two cards — labelled "SAME PAYLOAD · TWO CHAINS". The hash glows once and holds.
Scene 3 (5.5–8.7s): camera pulls back (zoom-out scale 1.0 → 0.7) — the two chain cards become the bottom half of a wider graph. A central node "ENW AGENT" with the brand wordmark appears upper-middle. Three smaller "AGENT" nodes peel off from corners — labelled `YIELD-BOT`, `WALLET-AI`, `ORACLE`. Cyan connector lines link each external agent to the centre, with `x402 · per-call` labels along each line. Final beat: a small price tag "$0.05 per query" floats by one of the connectors. Held read.

## Frame 6 — CTA

- scene: The wordmark "EARLY, NOT WRONG" lands centered. Three small stat chips underneath fade in in sequence: `8 live positions · BSC Mainnet`, `78/100 regime · FGI 17`, `181 tests passing`. Then the URL `earlynotwrong.vercel.app/agent` types in below in monospace, with a thin cyan caret. Brand mantra repeats as a closing whisper.
- duration: 15.232s
- transition_in: cut
- poster: 6s
- status: animated
- voiceover: "Eight live positions. Real on-chain record. One stack from data to execution to reputation. Early, Not Wrong. earlynotwrong dot vercel dot app slash agent."
- asset_candidates:
    - capture/assets/svgs/logo-16fc1d72.svg
- src: compositions/frames/06-cta.html
- blueprint: logo-assemble-lockup (Adapt)
- focal: wordmark + URL lockup
- roles: logo SVG = supporting; wordmark + URL = cutout
- sfx: (none)

Close on the URL. The three stat chips are the proof points the prior frames implied. The mantra book-ends the hook.

Adapt: keep the lockup-assemble signature (multiple elements snap together into a single locked composition). The "lockup" here is wordmark + tagline + URL.

Scene 1 (0.0–2.5s): black canvas. "EARLY, NOT WRONG" wordmark lands centered, DM Sans 700, white, 9cqw, with a sharp cyan 4px underline beneath. The brand mantra "Being early feels like being wrong. Until it doesn't." appears below in DM Sans italic 2.0cqw, text-muted.
Scene 2 (2.5–6.0s): three stat chips appear in a horizontal row below the mantra, on a 0.4s stagger paced to the VO's three sentences — each a pill (100px radius, cyan border 1.5px, transparent fill): `8 LIVE POSITIONS · BSC MAINNET`, `REGIME 78/100 · FGI 17`, `181 TESTS PASSING`. DM Sans Mono, all-caps, 1.2cqw, text on the white side.
Scene 3 (6.0–11.0s): on VO "Early, Not Wrong.", the wordmark gets a single beat of cyan glow (opacity 0.0 → 0.15 on the underline shadow) then settles. Below the stat chips, the URL `earlynotwrong.vercel.app/agent` types in word-by-word in DM Sans Mono 2.4cqw, cyan, with a thin blinking caret. As each segment lands ("earlynotwrong" / "vercel" / "app" / "agent") the spoken cue matches.
Scene 4 (11.0–15.23s): everything held still. The URL caret continues to blink (cyan, 0.5Hz). All other elements completely motionless. Read-and-hold final.
