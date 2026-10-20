/**
 * Options Conviction Score — TrendSpider Custom Indicator
 * ========================================================
 *
 * "Is this a good time to BUY premium on this underlier — and which side?"
 *
 * Two readouts sharing one factor model (ported from an autonomous trading
 * agent's conviction engine — see docs):
 *
 *   1. CONVICTION LINE (per bar, 0–100) — the underlier's setup score, an
 *      equity port of the 6-factor contrarian engine:
 *        contrarian 30 · RSI timing 10 · quality 20 · regime 20 ·
 *        volume growth 10 · − vol-path penalty 15
 *      It needs only OHLCV (+ optional VIX history), so it paints history.
 *
 *   2. OPTIONS EDGE PANEL (live OPRA snapshot) — the full 8-factor options
 *      model evaluated on a target expiry:
 *        IV contrarian 20 · RSI+delta 10 · options depth 20 · VIX regime 15 ·
 *        open interest 10 · − theta decay 5 · − gamma pin 10 · ± earnings 10
 *
 * Zones: ≥60 (green) historically favorable premium-buying conditions,
 * 40–60 neutral, ≤40 avoid. Contrarian by design — deep-but-orderly weakness
 * scores high; chasing strength scores low.
 *
 * Notes:
 *  - Options panel requires an OPRA data subscription; on tickers without
 *    options (or without the add-on) the line still works and the panel
 *    reports "no options chain".
 *  - Daily chart recommended. Other resolutions work; RV annualization
 *    auto-scales (252 trading days, 390-min session).
 *  - paint() call count is constant per run (TrendSpider rule): hidden
 *    series are painted via constants.empty_series where needed.
 */

describe_indicator('Options Conviction Score', 'lower');

// ────────────────────────────── Inputs ──────────────────────────────────────

const minDte       = input.number('Min DTE',        14, { min: 0, max: 180 });
const maxDte       = input.number('Max DTE',        45, { min: 1, max: 365 });
const rvLen        = input.number('RV Lookback',    20, { min: 5, max: 120 });
const earnWindow   = input.number('Earnings Window (d)', 7, { min: 1, max: 30 });
const vixSymbol    = input.symbol('VIX symbol',     'VIX');
const showPanel    = input.boolean('Show options panel', true);
const buyZone      = input.number('Favorable zone ≥',   60, { min: 1, max: 99 });
const avoidZone    = input.number('Avoid zone ≤',       40, { min: 0, max: 98 });
const greenColor   = '#2ebd85';
const amberColor   = '#f0b90b';
const redColor     = '#f6465d';

// ───────────────────────── Factor helpers (ported) ──────────────────────────

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Contrarian fraction: the "early" sweet spot is −15%…−50% over 7 bars.
 *  Chasing strength scores ~0; capitulation past −70% scores 0.15, not 0. */
function contrarianFraction(pct7) {
    const floor = -70;
    if (pct7 <= floor) return 0.15;
    if (pct7 <= -50) return 0.15 + ((pct7 - floor) / (-50 - floor)) * 0.85;
    if (pct7 <= -15) return 1.0;
    if (pct7 < 0)    return 0.4 + ((-pct7) / 15) * 0.6;
    if (pct7 <= 25)  return Math.max(0, 0.4 * (1 - pct7 / 25));
    return 0;
}

/** RSI timing fraction (calls side — oversold is good timing). */
function rsiTimingFraction(r) {
    if (r == null) return 0.5;
    if (r <= 25) return 1.0;
    if (r <= 35) return 0.85;
    if (r <= 50) return 0.5;
    if (r <= 65) return 0.25;
    return 0;
}

/** Vol-path penalty: how far the last bar deviates from the smooth 7-bar
 *  drift. A smooth dip scores 0 (that's the "early" trade); a choppy,
 *  bouncing path is a falling knife — penalized. Max at 20pp deviation. */
function volPenaltyFraction(pct7, pct1) {
    return clamp01(Math.abs(pct1 - pct7 / 7) / 20);
}

/** Equity quality: 20-bar dollar volume + underlier price scale
 *  (mega-caps have institutionally deep option markets by construction). */
function equityQualityFraction(avgDollarVol, price) {
    const v = avgDollarVol ?? 0;
    let frac = 0.1;
    if (v >= 5e8) frac = 1.0;
    else if (v >= 1e8) frac = 0.85;
    else if (v >= 2.5e7) frac = 0.7;
    else if (v >= 5e6) frac = 0.5;
    else if (v >= 1e6) frac = 0.3;
    const priceFrac = price >= 200 ? 1.0 : price >= 100 ? 0.75 : price >= 50 ? 0.5 : 0.25;
    return Math.max(frac, priceFrac * 0.6);
}

/** Volume-growth fraction (equity stand-in for on-chain holder growth):
 *  growth % of 20-bar vs 60-bar average dollar volume. */
function volumeGrowthFraction(growthPct) {
    const g = growthPct;
    if (g == null || !isFinite(g)) return 0.4;
    if (g <= -5) return 0;
    if (g <= 0)  return 0.4 * (1 + g / 5);
    if (g <= 10) return 0.4 + (g / 10) * 0.6;
    return 1.0;
}

/** VIX regime fraction — fear is the contrarian's opportunity. */
function vixFraction(vix) {
    if (vix == null || !isFinite(vix)) return 0.5;
    if (vix >= 35) return 1.0;
    if (vix >= 25) return 0.7;
    if (vix >= 15) return 0.5;
    return 0.3;
}

/** IV contrarian fraction, premium-BUYER perspective. IV/RV < 1 = premium
 *  cheaper than the underlier's own realized vol → buy edge. Rich IV/RV is
 *  crush-prone → avoid. Degenerate IV (<5% annualized) is a stale quote,
 *  not "cheap" — neutral. */
function ivContrarianFraction(iv, ivToRv) {
    if (iv == null || iv <= 0 || iv < 0.05) return 0.5;
    if (ivToRv > 0) {
        if (ivToRv >= 2.0) return 0.1;
        if (ivToRv >= 1.4) return 0.25;
        if (ivToRv >= 1.1) return 0.4;
        if (ivToRv >= 0.9) return 0.5;
        if (ivToRv >= 0.6) return 0.7;
        if (ivToRv >= 0.4) return 0.9;
        return 1.0;
    }
    if (iv >= 1.0) return 0.1;
    if (iv >= 0.6) return 0.25;
    if (iv >= 0.3) return 0.5;
    if (iv >= 0.15) return 0.75;
    return 0.5;
}

/** Delta quality — reward 0.25–0.55 (a real option), penalize lotto tickets
 *  and stock substitutes. */
function deltaQualityFraction(absDelta) {
    if (absDelta < 0.15) return 0.1;
    if (absDelta < 0.25) return 0.35;
    if (absDelta <= 0.55) return 1.0;
    if (absDelta <= 0.7) return 0.55;
    return 0.25;
}

/** Theta decay fraction (penalty) on decay-per-day as % of premium. */
function thetaDecayFraction(thetaPct) {
    if (thetaPct == null) return 0.4;
    if (thetaPct >= 0.08) return 1.0;
    if (thetaPct >= 0.03) return 0.7;
    if (thetaPct >= 0.012) return 0.4;
    return 0.1;
}

/** Gamma squeeze/pin fraction (penalty) on normalized gamma:
 *  Δdelta points per 1% underlier move (gamma × spot / 100).
 *  Typical ATM: ~0.03 for a 45d expiry, ~0.06 for 14d, ≥0.15 near-dated. */
function gammaPinFraction(gammaPerPct) {
    if (gammaPerPct == null) return 0.4;
    if (gammaPerPct >= 0.15) return 1.0;
    if (gammaPerPct >= 0.07) return 0.7;
    if (gammaPerPct >= 0.03) return 0.4;
    return 0.1;
}

/** Open-interest fraction (depth/activity proxy). */
function oiFraction(totalOi) {
    if (totalOi >= 10000) return 1.0;
    if (totalOi >= 1000) return 0.6;
    if (totalOi >= 100) return 0.3;
    return 0.1;
}

// ─────────────────────── Chart-native per-bar scoring ───────────────────────

const n = close.length;
const rsi14 = rsi(close, 14);
const sma50 = sma(close, 50);

const dvol = series_of(null);
for (let i = 0; i < n; i++) dvol[i] = (close[i] ?? 0) * (volume[i] ?? 0);
const dvol20 = sma(dvol, 20);
const dvol60 = sma(dvol, 60);

// VIX history (optional — regime factor degrades to neutral without it).
let vixLanded = series_of(null);
try {
    if (vixSymbol) {
        const vixData = await request.history(vixSymbol, current.resolution);
        if (vixData && !vixData.error && vixData.time && vixData.time.length) {
            vixLanded = interpolate_sparse_series(
                land_points_onto_series(vixData.time, vixData.close, time),
                'constant'
            );
        }
    }
} catch (e) { vixLanded = series_of(null); }

const conviction = series_of(null);
for (let i = 0; i < n; i++) {
    if (i < 61) continue;                       // need 60-bar vol + 50 SMA
    const r7 = (close[i] / close[i - 7] - 1) * 100;
    const r1 = (close[i] / close[i - 1] - 1) * 100;
    const growthPct = dvol60[i] > 0 ? (dvol20[i] / dvol60[i] - 1) * 100 : null;
    const score =
        contrarianFraction(r7)          * 30 +
        rsiTimingFraction(rsi14[i])     * 10 +
        equityQualityFraction(dvol20[i], close[i]) * 20 +
        vixFraction(vixLanded[i])       * 20 +
        volumeGrowthFraction(growthPct) * 10 -
        volPenaltyFraction(r7, r1)      * 15;
    conviction[i] = Math.round(Math.max(0, Math.min(100, score)));
}

// ─────────────────── Live options surface (OPRA snapshot) ───────────────────

// Periods/year for RV annualization — daily default; intraday ≈ 390-min
// sessions; weekly/monthly mapped.
const resNum = Number(constants.resolution);
const periodsPerYear = Number.isFinite(resNum)
    ? Math.round(252 * 390 / resNum)
    : ({ D: 252, W: 52, M: 12 }[constants.resolution] ?? 252);

function realizedVol(klines, lookback, ppy) {
    const m = klines.length;
    if (m < lookback + 1) return null;
    const rets = [];
    for (let i = m - lookback; i < m; i++) {
        if (klines[i - 1] > 0 && klines[i] > 0) rets.push(Math.log(klines[i] / klines[i - 1]));
    }
    if (rets.length < 2) return null;
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const varSum = rets.reduce((a, r) => a + (r - mean) * (r - mean), 0) / (rets.length - 1);
    return Math.sqrt(varSum) * Math.sqrt(ppy);
}

const mid = (q) => {
    if (!q) return null;
    if (q.l && q.l > 0) return q.l;
    if (q.b > 0 && q.a > 0) return (q.b + q.a) / 2;
    if (q.b > 0) return q.b;
    if (q.a > 0) return q.a;
    return null;
};

let opt = null;
try {
    const schedule = await request.options_schedule(current.ticker);
    if (schedule && !schedule.error && schedule.length) {
        const inRange = schedule.filter(e =>
            e?.expiration?.dte != null && e.expiration.dte >= minDte && e.expiration.dte <= maxDte
        );
        const pick = inRange.find(e => e.expiration.schedule === 'M') ?? inRange[0];
        if (pick) {
            const chain = await request.options_data_for_expiration(
                current.ticker,
                pick.expiration.code.toString(),
                ['l', 'b', 'a', 'iv', 'oi', 'gd', 'gg', 'gt', 'dvol']
            );
            if (chain && !chain.error && chain.resultByStrike) {
                const spot = chain.underlyingSymbolQuote?.lastPrice ?? close[n - 1];
                const strikes = Object.keys(chain.resultByStrike).map(Number).sort((a, b) => a - b);
                if (strikes.length) {
                    // ATM bracket interpolation (same method as the reference impl)
                    let lo = 0;
                    for (let i = 0; i < strikes.length; i++) {
                        if (strikes[i] <= spot) lo = i; else break;
                    }
                    const hi = Math.min(lo + 1, strikes.length - 1);
                    const kLo = strikes[lo], kHi = strikes[hi];
                    const t = kHi !== kLo ? (spot - kLo) / (kHi - kLo) : 0;
                    const lerp = (a, b) => (a != null && b != null) ? a + t * (b - a) : (a ?? b);

                    // Directional lean: trend vs 50-bar SMA picks the side.
                    const trendUp = close[n - 1] >= (sma50[n - 1] ?? close[n - 1]);
                    const side = trendUp ? 'C' : 'P';
                    const dLo = chain.resultByStrike[kLo], dHi = chain.resultByStrike[kHi];
                    const sLo = dLo?.[side], sHi = dHi?.[side];

                    // OPRA 'iv' arrives percent-scale (39.16 = 39.16% IV);
                    // normalize to decimal like the delta field below.
                    const rawIv     = lerp(dLo?.C?.iv ?? dLo?.P?.iv, dHi?.C?.iv ?? dHi?.P?.iv);
                    const atmIv     = rawIv != null && rawIv > 5 ? rawIv / 100 : rawIv;
                    const atmDelta  = Math.abs(lerp(sLo?.gd, sHi?.gd) ?? 0.5);
                    const normDelta = atmDelta > 1 ? atmDelta / 100 : atmDelta;
                    const atmMid    = lerp(mid(sLo), mid(sHi));
                    const atmTheta  = lerp(sLo?.gt, sHi?.gt);
                    const atmGamma  = Math.max(lerp(dLo?.C?.gg ?? 0, dHi?.C?.gg ?? 0) ?? 0,
                                               lerp(dLo?.P?.gg ?? 0, dHi?.P?.gg ?? 0) ?? 0);

                    // Surface totals across the whole expiry.
                    let callOi = 0, putOi = 0, dollarOi = 0;
                    for (const k of strikes) {
                        const d = chain.resultByStrike[k];
                        callOi += d?.C?.oi ?? 0;
                        putOi  += d?.P?.oi ?? 0;
                        if (Math.abs(k / spot - 1) <= 0.10) {
                            const cMid = mid(d?.C), pMid = mid(d?.P);
                            dollarOi += ((cMid ?? 0) * (d?.C?.oi ?? 0) +
                                         (pMid ?? 0) * (d?.P?.oi ?? 0)) * 100;
                        }
                    }
                    const totalOi = callOi + putOi;
                    const pcOi = callOi > 0 ? putOi / callOi : null;

                    const rv = realizedVol(close, rvLen, periodsPerYear);
                    const ivToRv = (atmIv > 0 && rv > 0) ? atmIv / rv : 0;
                    const thetaPct = (atmTheta != null && atmMid > 0) ? Math.abs(atmTheta) / atmMid : null;
                    const gammaPerPct = spot > 0 ? (atmGamma * spot) / 100 : null;

                    opt = {
                        score: null,
                        spot, dte: pick.expiration.dte, expiry: pick.expiration,
                        atmIv, ivToRv, rv, atmDelta: normDelta, atmMid,
                        callOi, putOi, totalOi, pcOi, dollarOi,
                        thetaPct, gammaPerPct, side, trendUp,
                    };
                }
            }
        }
    }
} catch (e) { opt = null; }

// Next earnings (vol-crush timing). request.earnings returns {timestamp,…}
// in seconds; the nearest future record is the risk window.
let earnDays = null;
try {
    const earnings = await request.earnings(current.ticker);
    if (Array.isArray(earnings) && earnings.length) {
        const nowSec = Math.max(Date.now() / 1000, time[n - 1] ?? 0);
        const future = earnings
            .map(e => e.timestamp)
            .filter(ts => ts != null && ts > nowSec)
            .sort((a, b) => a - b);
        if (future.length) earnDays = Math.round((future[0] - nowSec) / 86400);
    }
} catch (e) { earnDays = null; }

// ─────────────────────── Options conviction (8 factors) ─────────────────────

if (opt) {
    const rsiNow = rsi14[n - 1];
    const rsiT = rsiTimingFraction(opt.side === 'C' ? rsiNow : (rsiNow == null ? null : 100 - rsiNow));
    const f = {
        iv:      { pts: ivContrarianFraction(opt.atmIv, opt.ivToRv) * 20, max: 20,
                   detail: opt.atmIv != null
                       ? `IV ${(opt.atmIv * 100).toFixed(0)}% / RV ${opt.rv ? (opt.rv * 100).toFixed(0) + '%' : 'n/a'}`
                       : 'IV n/a' },
        timing:  { pts: (rsiT * 0.6 + deltaQualityFraction(opt.atmDelta) * 0.4) * 10, max: 10,
                   detail: `RSI ${rsiNow == null ? 'n/a' : Math.round(rsiNow)} · Δ ${opt.atmDelta.toFixed(2)}` },
        depth:   { pts: equityQualityFraction(opt.dollarOi, opt.spot) * 20, max: 20,
                   detail: `$OI $${opt.dollarOi >= 1e6 ? (opt.dollarOi / 1e6).toFixed(1) + 'M' : Math.round(opt.dollarOi / 1e3) + 'k'} ±10%` },
        regime:  { pts: vixFraction(vixLanded[n - 1]) * 15, max: 15,
                   detail: vixLanded[n - 1] != null ? `VIX ${vixLanded[n - 1].toFixed(1)}` : 'VIX n/a' },
        oi:      { pts: oiFraction(opt.totalOi) * 10, max: 10,
                   detail: `OI ${opt.totalOi.toLocaleString()} · P/C ${opt.pcOi != null ? opt.pcOi.toFixed(2) : 'n/a'}` },
        theta:   { pts: -thetaDecayFraction(opt.thetaPct) * 5, max: 5,
                   detail: opt.thetaPct != null ? `−${(opt.thetaPct * 100).toFixed(1)}%/day` : 'n/a' },
        gamma:   { pts: -gammaPinFraction(opt.gammaPerPct) * 10, max: 10,
                   detail: opt.gammaPerPct != null ? `${opt.gammaPerPct.toFixed(3)} Δ/1%` : 'n/a' },
        earn:    { pts: (earnDays != null && earnDays <= earnWindow) ? -10 : 3, max: 10,
                   detail: earnDays != null ? `in ${earnDays}d` : 'none ahead' },
    };
    const raw = Object.values(f).reduce((s, x) => s + x.pts, 0);
    opt.score = Math.round(Math.max(0, Math.min(100, raw)));
    opt.factors = f;
}

// ─────────────────────────────── Paints ─────────────────────────────────────
// Constant paint() count per run (platform rule).

const zoneColors = for_every(conviction, s =>
    s == null ? null : s >= buyZone ? greenColor : s > avoidZone ? amberColor : redColor
);

paint(conviction, {
    name: 'Conviction',
    color: zoneColors,
    style: 'line',
    thickness: 2,
});

const gFav = paint(horizontal_line(buyZone), {
    name: 'Favorable ≥',
    color: series_of(greenColor),
    style: 'dotted',
    ignoreWhenScaling: true,
});
const gAvoid = paint(horizontal_line(avoidZone), {
    name: 'Avoid ≤',
    color: series_of(redColor),
    style: 'dotted',
    ignoreWhenScaling: true,
});
fill(gFav, gAvoid, '#888888', 0.05);

// Zone-cross markers (green = entering favorable, red = falling into avoid).
// Debounced: a marker only fires when the score has spent ≥5 bars on the
// other side first, so choppy oscillation around a threshold doesn't spam.
const cross = series_of(null);
const crossColors = series_of(null);
let lastCross = -10;
for (let i = 1; i < n; i++) {
    const a = conviction[i - 1], b = conviction[i];
    if (a == null || b == null) continue;
    const up   = a < buyZone && b >= buyZone;
    const down = a > avoidZone && b <= avoidZone;
    if ((up || down) && i - lastCross >= 5) {
        cross[i] = { y: b, z: 2 };
        crossColors[i] = up ? greenColor : redColor;
        lastCross = i;
    }
}
paint(cross, { name: 'Zone cross', style: 'bubble', color: crossColors, ignoreWhenScaling: true });

// ────────────────────────────── Overlay panel ───────────────────────────────

const convNow = conviction[n - 1];
const scoreColor = (s) => s == null ? '#888' : s >= buyZone ? greenColor : s > avoidZone ? amberColor : redColor;
const fmtPts = (p) => (p >= 0 ? '+' : '−') + Math.abs(Math.round(p));

const rows = [];
rows.push({ cells: [{
    colspan: 3,
    text: `⚖ ${current.ticker} — Conviction ${convNow ?? 'n/a'}` +
          (opt?.score != null ? ` · Options ${opt.score}` : ''),
    fontWeight: 'bold',
    color: opt?.score != null ? scoreColor(opt.score) : scoreColor(convNow),
    textAlign: 'center',
    padding: '8px 12px',
    border: '1px solid #444',
}]});

if (opt) {
    const lean = opt.trendUp
        ? (rsi14[n - 1] != null && rsi14[n - 1] <= 45 ? 'CALL (dip in uptrend)' : 'CALL (uptrend)')
        : (rsi14[n - 1] != null && rsi14[n - 1] >= 60 ? 'PUT (rally in downtrend)' : 'PUT (downtrend)');
    const expLabel = [opt.expiry?.month, opt.expiry?.day].filter(x => x != null).join('/');
    rows.push({ cells: [{
        colspan: 3,
        text: `Lean: ${lean} · Exp ${expLabel || '?'} (${opt.dte}d)`,
        color: '#bbb', textAlign: 'center', padding: '2px 12px 6px',
    }]});

    const order = [
        ['iv',    'IV edge'],
        ['timing','Timing'],
        ['depth', 'Opt depth'],
        ['regime','Regime'],
        ['oi',    'Open int.'],
        ['theta', 'Θ decay'],
        ['gamma', 'Γ pin'],
        ['earn',  'Earnings'],
    ];
    for (const [key, label] of order) {
        const x = opt.factors[key];
        rows.push({ cells: [
            { text: label, color: '#ccc', padding: '2px 6px 2px 12px' },
            { text: `${fmtPts(x.pts)}/${x.max}`, color: x.pts >= 0 ? greenColor : redColor,
              fontWeight: 'bold', padding: '2px 6px' },
            { text: x.detail, color: '#999', padding: '2px 12px 2px 6px' },
        ]});
    }
} else {
    rows.push({ cells: [{
        colspan: 3,
        text: 'No options chain on this ticker (or OPRA add-on inactive)',
        color: '#888', textAlign: 'center', padding: '2px 12px 8px',
    }]});
}

paint_overlay('OptionsConviction', { position: 'top_right', offset_x: 20, offset_y: 20 }, {
    fontSize: 12,
    background: '#000000cc',
    borderRadius: '8px',
    rows,
    hidden: !showPanel,
});
