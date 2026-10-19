# TrendSpider Hackathon — Options Conviction Score

Deliverable: `options-conviction-score.js` — a single TrendSpider Custom
Indicator. Category: **Most Unique Options Indicator**. Deadline **2026-10-26**;
winners 2026-11-04. Tag `#TSBuild26` in the store description.

Strategy doc: `docs/archive/TRENDSPIDER_HACKATHON.md`.

## What it is

"Is this a good time to buy premium on this underlier — and which side?"
Two readouts from one factor model, ported from the live agent:

- **Conviction line** (per bar, 0–100) — equity port of the 6-factor
  contrarian engine (`agent/lib/conviction-signal.ts`): contrarian 30 ·
  RSI timing 10 · quality 20 · regime 20 · volume-growth 10 − vol-path
  penalty 15. Needs only OHLCV + optional VIX, so it paints history.
- **Options Edge panel** (live OPRA snapshot) — the 8-factor options model
  (`agent/lib/adapters/options-conviction.ts`) on the nearest monthly in the
  DTE window: IV contrarian 20 · RSI+delta 10 · options depth 20 · VIX
  regime 15 · OI 10 − theta decay 5 − gamma pin 10 ± earnings 10.

Zones: ≥60 favorable premium-buying conditions · 40–60 neutral · ≤40 avoid.

## Platform API notes (verified 2026-10-19)

- `request.options_schedule(ticker)` → `[{expiration:{dte,code,month,day,schedule}}]`
- `request.options_data_for_expiration(ticker, code, fields)` →
  `{resultByStrike:{[strike]:{C,P}}, underlyingSymbolQuote:{lastPrice}}`;
  fields: `l b a iv oi gd gg gt gv dvol`
- `request.history(symbol, current.resolution)` → alt-symbol series (VIX)
- `request.earnings(ticker)` → `[{timestamp,…}]` seconds; future rows = next event
- `rsi()`, `sma()`, `series_of`, `horizontal_line`, `for_every`,
  `land_points_onto_series`, `interpolate_sparse_series`, `fill`
- `paint()` count must be constant per run — all paints are unconditional
- `paint_overlay` cells support colspan/fontWeight/color/padding/border

## Verify in the sandbox before publishing (~15 min)

1. `paint_overlay` renders from a `'lower'` indicator — if not, flip
   `describe_indicator` to overlay (panel still works; move the line behind).
2. `request.history('VIX', …)` resolves — else set VIX symbol input blank
   (regime falls back to neutral 0.5).
3. Options fields `gg`/`gt`/`dvol` return non-null on a liquid name (SPY).
4. `input.symbol` blank clears VIX without erroring.
5. A no-options ticker (e.g., a low-cap) shows the honest "no options chain"
   state — not an exception.

## Store description (paste, then append #TSBuild26)

> **Options Conviction Score** — a 0–100 composite that answers "is now a
> good time to buy premium on this stock, and which side?"
>
> The lower line scores the underlier's setup every bar: contrarian dip
> quality, RSI timing, liquidity, VIX regime, dollar-volume growth, minus a
> chaos penalty for falling-knife paths. Green ≥60, amber 40–60, red ≤40.
>
> The options panel evaluates the live chain on your chosen expiry window:
> implied-vs-realized vol edge, RSI + delta quality, option-market depth,
> VIX regime, open interest and put/call positioning, theta decay rate,
> gamma pin risk, and earnings vol-crush timing — each factor itemized so
> you see exactly what moved the score.
>
> The model is ported from a live autonomous trading agent's conviction
> engine — the same weighted-factor discipline used to gate real entries,
> not a hand-tuned mashup. Daily charts recommended.
>
> #TSBuild26

## Submission checklist

- [ ] Confirm registration still accepted (posted close Sept 16 — extension implies yes)
- [ ] Sandbox-verify the 5 items above; fix and iterate
- [ ] Screenshot on 2–3 names: one mega-cap (AAPL/NVDA), one mid, one no-options
- [ ] Publish indicator → Store, public + free, description incl. `#TSBuild26`
- [ ] Submit official competition form → category: **Most Unique Options Indicator**
- [ ] Optional stretch: bare-bones buy/sell entry in a second script (same engine)

## Not doing

- No LLM jury (non-deterministic, can't live in a chart script)
- No both-categories split — one entry, done well
- No fabricated empty states — missing data degrades to neutral, visibly
