# TrendSpider Hackathon 2026 — Research & Strategy

> Status: **SUBMITTED 2026-10-20** — "Options Conviction Score" published to
> the TrendSpider Store (pending moderation, open source/public/free) and the
> official form submitted to **Most Unique Options Indicator**.
> Store: https://trendspider.com/trading-tools-store/indicators/6ad6d1-options-conviction-score/
> Script: `trendspider/options-conviction-score.js` · checklist/copy:
> `trendspider/README.md`. Winners announced **2026-11-04**.
> Source: https://trendspider.com/hackathon (fetched 2026-10-19).
> Competition material — history, not operational docs.

---

## The opportunity (at a glance)

| | |
|---|---|
| **Prize pool** | $25,000 in cash & prizes |
| **Format** | 4 categories, 3 prizes each |
| **Sponsor** | Clear Street |
| **Build with** | Sidekick AI (no-code) **or** your own JavaScript via the Custom Indicator API |
| **Deadline** | Extended to **October 26, 2026** |
| **Distribution** | Submissions are published as free, public indicators in the TrendSpider Store |

**Categories (verified on the live page):**

1. Best Buy/Sell Signal Indicator
2. Most Unique Options Indicator
3. Best Fundamental Analysis Indicator
4. Most Beautiful On-Chart Indicator

**Prizes per category (verified):** 1st $1,500 cash + TrendSpider Enhanced 12mo
($1,600) + SignalStack Premium 12mo ($1,000) · 2nd $750 + Premium 12mo ·
3rd $250 + Standard 12mo.

## Rules (verified on the live page)

- Publish the indicator to the TrendSpider Store with **#TSBuild26** in the
  description, then submit via the official competition form.
- Entries must be **newly published** — previously published work elsewhere is
  fine if republished fresh for this event.
- All indicators must be **public and free** to apply.
- **One script, one entry** — each script may be submitted once, to a single
  category. Up to 4 entries total (one per category).
- **Caveat:** the posted schedule says registration closed **Sept 16**. The
  deadline extension implies late entries are accepted, but confirm before
  building — this is step zero.

## Judging (verified)

Internal panel, aggregate score, ties → final internal vote. Four criteria:

| Criterion | What it means for us |
|---|---|
| **Visual Clarity** | The composite score + factor attribution must read at a glance |
| **Utility** | "Genuinely useful in a real-market scenario" — our differentiator |
| **Execution** | Must run smoothly on real charts, not just look right |
| **Presentation** | Marketplace description/documentation quality — our methodology docs help |

Note: **no profitability/backtest criterion.** The edge-vs-baseline story is a
*Utility + Presentation* argument, not a judged metric — invest accordingly.

## What the deliverable actually is

This is **not** a project-submission hackathon. You do not enter Early, Not Wrong.
You write a **new indicator** that renders on TrendSpider charts:

- **Custom Indicator API (JavaScript):** draw lines, generate signals, paint
  histograms over OHLCV.
- **Custom JS options API:** "options-derived metrics plotted on the underlying
  asset's chart" — so the options category is reachable from a script.
- **External data:** a custom script can call an HTTP API, and custom time series
  can be uploaded and plotted.

So the real question is: **does the project contain a defensible signal that can
be expressed as a chart indicator?** For Early, Not Wrong the answer is yes, and
it is the only project in the portfolio where that is true.

## Why this project fits

The agent is an **agentic harness** (`agent/lib/adapters/`) with the scoring
model decoupled from the data source. Three assets transfer:

### 1. The 6-factor conviction engine (crypto domain)

The deterministic signal, with published weights — a complete buy/sell model, not
a sketch:

| Factor | Weight | Reads |
|---|---|---|
| Contrarian | 30 | Rewards assets down 7d during fear |
| RSI timing | 10 | Synthesised RSI(14); bonus for oversold |
| Quality | 20 | Market cap × liquidity filter |
| Regime | 20 | Fear & Greed + funding-rate composite |
| Holder growth | 10 | On-chain holder-base expansion |
| Volatility penalty | − | Subtracted for erratic 7d price paths |

A 7th, non-deterministic factor (the LLM jury, ±15) is **not** portable to a
chart indicator and should be dropped.

### 2. The options conviction adapter — the ready-made indicator spec

`agent/lib/adapters/options-conviction.ts` already implements **"IV edge +
conviction overlay"** and has *done the equity-side translation for us* — the
crypto factors were mapped to options equivalents with new weights:

| Options factor | Weight | Reads |
|---|---|---|
| IV contrarian | 20 | High IV rank on strong underliers → sell premium; low IV rank on weak → buy |
| Underlier RSI + delta | 10 | Timing + directional exposure |
| Underlier liquidity / AUM | 15 | Quality filter |
| **VIX regime, market regime** | 15 | Regime input |
| Open-interest growth | 10 | Participation trend |
| Vanna / charm decay risk | 5 | Dealer-flow decay |
| **Gamma squeeze risk** | 10 | Positioning stress |
| **Earnings vol-crush timing** | 10 | Event-driven premium collapse |

This is the strongest single argument for entering: it is a specification for a
TrendSpider indicator that already exists as code, with the factor translation
resolved.

### 3. The edge report — why the signal isn't hand-waved TA

`agent/lib/backtest.ts` (`runEdgeReport()`, exposed at `GET /edge-report`) runs the
strategy against a **naive random-entry baseline** with the same risk rules and
attributes winning-exit P&L to the leading factor. `hasEdge` requires the signal
to beat the baseline on Sharpe **and** be non-negative in absolute return — a
strategy that merely loses less is not edge. Most hackathon indicators can't
answer "does this have edge?"; this one has a harness that can.

## Category mapping

| Category | Fit | Source |
|---|---|---|
| **Most Unique Options Indicator** | **Selected.** The options factor model, ported to the Custom JS options API (OPRA data confirmed scriptable) | `adapters/options-conviction.ts` |
| **Best Buy/Sell Signal Indicator** | Fallback only if the options accessors turn out to be too thin for the factor model | `conviction-signal.ts` + `adapters/crypto-conviction.ts` |

Pick **one**. They share almost no surface — the options model needs premium/greeks
inputs, the buy/sell model needs price + a regime input — and seven days is not
enough for both. Rules allow one script per category (up to 4 total); a bare-bones
buy/sell composite is a stretch goal only after the options entry is published.

## The gap (be honest about this)

- **TrendSpider is not a data source for the agent.** The agent's inputs are
  SoSoValue/CMC (crypto) and Alpaca (options). The deliverable is a **port of the
  scoring logic**, with inputs re-sourced from TrendSpider's chart series and its
  options API. It is not a submission of the repo.
- **The hard translation is already done.** The options adapter's factor table
  (VIX regime, AUM/liquidity, OI growth, gamma, earnings) is the equity/options
  mapping; only the plumbing changes.
- ~~**Open question:** does the Custom JS options API expose IV/OI/volume by
  expiry?~~ **Resolved 2026-10-19: yes.** TrendSpider shipped live OPRA chain
  data to custom indicators — per their blog, any user can "build their own
  options-powered indicator using live OPRA data" with greeks, IV, OI, and
  volume accessible per contract. The Options Map exposes ~24 metrics (IV,
  OI, OI change, delta, gamma, theta, vega, put/call ratios by OI and volume).
  Custom JS also supports HTTP GET to third-party data (CBOE, Benzinga,
  Binance, Google Sheets) for anything missing (e.g., earnings calendar).
  **Category: Most Unique Options Indicator.** Remaining build-time check: the
  exact JS function names for options access in the Custom Indicator sandbox.

## Pre-flight (before writing any indicator code)

1. **Confirm registration still accepted** (posted close was Sept 16 — the
   extension announcement implies late entries are fine; verify on the
   submission form).
2. Read the Custom Indicator API docs (data access, plotting, state) —
   `platform-docs.trendspider.com/scripting/docs/`.
3. Confirm the exact **options accessor functions** in the Custom JS sandbox
   (IV / OI / greeks / volume-by-expiry) — verified available, names TBD in
   the sandbox docs.

## Build plan (7 days)

| Step | Work | Effort |
|---|---|---|
| 1 | Pre-flight above; pick the category | 2–3 hrs |
| 2 | Port the chosen factor model to a single JS indicator — factors, weights, composite score, thresholds | 1 day |
| 3 | Wire inputs: TrendSpider series for the buy/sell model, or the options API for the options model | 1 day |
| 4 | Chart output: score line/histogram, threshold signal markers, factor attribution in a tooltip/label | 1 day |
| 5 | Backtest against a naive baseline on a handful of liquid symbols; report whether the ported signal still shows edge | 1 day |
| 6 | Write the submission copy: what it measures, why, and the baseline comparison | half day |
| 7 | Submit; publish the indicator | half day |

## Credibility angle

The pitch that separates this from the field: *the signal was backtested against a
naive baseline before it was drawn on a chart.* That is the same discipline the
agent runs on, and it is rare in a hackathon full of hand-tuned scripts.

## Not doing

- **Not** porting the agent — only the scoring logic.
- **Not** both categories — one entry, done well.
- **Not** the crypto-holder-growth factor — there is no TrendSpider equivalent,
  and the options mapping already replaced it with OI growth.
- **Not** shipping the LLM jury as part of the indicator — it is non-deterministic
  and can't live inside a chart script.

---

*Archived: 2026-10-19. Evaluated, not built.*
