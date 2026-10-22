"""Conviction scoring — Python port of agent/lib/conviction-signal.ts.

Faithful re-implementation of the deterministic 6-factor engine so the
observation's conviction features are identical to the production agent's.
LLM-jury / news / holders components are 0 in the env (no live feeds).
"""

import math

# AGENT_CONFIG.signal (agent/lib/config.ts)
W_CONTRARIAN = 30
W_RSI = 10
W_QUALITY = 20
W_REGIME = 20
W_HOLDERS = 10
W_VOL_PENALTY_MAX = 15
W_NEWS_MAX = 10
CAPITULATION_FLOOR = -70.0


def score_market_regime(fgi: float | None) -> dict:
    """Contrarian regime score (0–100). Higher = more fear = better to enter."""
    if fgi is None:
        fgi_contrarian = 50
        fear_level = "unknown"
    else:
        fgi_contrarian = 100 if fgi <= 20 else 75 if fgi <= 40 else 50 if fgi <= 60 else 25 if fgi <= 80 else 10
        fear_level = (
            "extreme-fear" if fgi <= 20 else
            "fear" if fgi <= 40 else
            "neutral" if fgi <= 60 else
            "greed" if fgi <= 80 else
            "extreme-greed"
        )
    funding_contrarian = 50  # no derivatives feed in the env
    score = round(fgi_contrarian * 0.7 + funding_contrarian * 0.3)
    label = (
        "DEEP FEAR — PRIME CONTRARIAN" if score >= 80 else
        "FEAR — FAVORABLE ENTRY" if score >= 60 else
        "NEUTRAL — SELECTIVE" if score >= 45 else
        "GREED — CAUTION" if score >= 30 else
        "EUPHORIA — DEFENSIVE"
    )
    return {"score": score, "label": label, "fearGreedIndex": fgi, "fearLevel": fear_level}


def adaptive_weights(regime_score: int) -> dict:
    adj = {}
    if regime_score >= 80:
        adj = {"contrarian": 5, "regime": 5, "quality": -3, "holders": 2, "volatilityPenaltyMax": 3}
    elif regime_score >= 60:
        adj = {"contrarian": 3, "regime": 3, "quality": -2}
    elif regime_score >= 45:
        adj = {"quality": 3, "contrarian": -2, "rsi": -1}
    elif regime_score >= 30:
        adj = {"quality": 5, "contrarian": -5, "holders": -2, "volatilityPenaltyMax": 5}
    else:
        adj = {"contrarian": -10, "quality": 8, "regime": -5, "holders": -3, "newsMax": -3}
    return {
        "contrarian": max(0, W_CONTRARIAN + adj.get("contrarian", 0)),
        "rsi": max(0, W_RSI + adj.get("rsi", 0)),
        "quality": max(0, W_QUALITY + adj.get("quality", 0)),
        "regime": max(0, W_REGIME + adj.get("regime", 0)),
        "holders": max(0, W_HOLDERS + adj.get("holders", 0)),
        "volatilityPenaltyMax": max(0, W_VOL_PENALTY_MAX + adj.get("volatilityPenaltyMax", 0)),
        "newsMax": max(0, W_NEWS_MAX + adj.get("newsMax", 0)),
    }


def _contrarian_fraction(d: float) -> float:
    if d <= CAPITULATION_FLOOR:
        return 0.15
    if d <= -50:
        return 0.15 + ((d - CAPITULATION_FLOOR) / (-50 - CAPITULATION_FLOOR)) * (1.0 - 0.15)
    if d <= -15:
        return 1.0
    if d < 0:
        return 0.4 + ((-d) / 15) * (1.0 - 0.4)
    if d <= 25:
        return max(0, 0.4 * (1 - d / 25))
    return 0.0


def _rsi_timing_fraction(rsi: float) -> float:
    if rsi <= 25: return 1.0
    if rsi <= 35: return 0.85
    if rsi <= 50: return 0.5
    if rsi <= 65: return 0.25
    return 0.0


def _quality_fraction(mcap: float, vol: float) -> float:
    if mcap <= 0:
        return 0.0
    turnover = max(0, vol) / mcap
    turnover_score = max(0.0, min(1.0, turnover / 0.15))
    size_score = max(0.0, min(1.0, (math.log10(mcap) - 7) / (10 - 7)))
    return turnover_score * 0.5 + size_score * 0.5


def _volatility_penalty_fraction(chg7d: float, chg24h: float) -> float:
    erraticism = abs(chg24h - chg7d / 7) / 20
    return max(0.0, min(1.0, erraticism))


def compute_rsi14(klines: list[dict]) -> float:
    """RSI(14) over kline closes — faithful port of computeRSI14 in
    agent/lib/data-providers.ts (Wilder smoothing, 50 for short series)."""
    closes = [k["close"] for k in sorted(klines, key=lambda k: k["timestamp"])]
    if len(closes) < 15:
        return 50.0
    gains, losses = 0.0, 0.0
    for i in range(1, 15):
        diff = closes[i] - closes[i - 1]
        if diff >= 0: gains += diff
        else: losses -= diff
    avg_gain, avg_loss = gains / 14, losses / 14
    for i in range(15, len(closes)):
        diff = closes[i] - closes[i - 1]
        avg_gain = (avg_gain * 13 + max(diff, 0)) / 14
        avg_loss = (avg_loss * 13 + max(-diff, 0)) / 14
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return max(0.0, min(100.0, 100 - 100 / (1 + rs)))


def score_token_conviction(quote: dict, regime: dict, rsi14: float | None) -> dict:
    """Returns {"score": int, "breakdown": {...}} — same shape as the TS engine."""
    w = adaptive_weights(regime["score"])
    contrarian = _contrarian_fraction(quote["percentChange7d"]) * w["contrarian"]
    rsi_bonus = _rsi_timing_fraction(rsi14) * w["rsi"] if rsi14 is not None else 0.0
    quality = _quality_fraction(quote["marketCap"], quote["volume24h"]) * w["quality"]
    regime_c = (regime["score"] / 100) * w["regime"]
    vol_pen = _volatility_penalty_fraction(
        quote["percentChange7d"], quote["percentChange24h"]) * w["volatilityPenaltyMax"]
    raw = contrarian + rsi_bonus + quality + regime_c - vol_pen
    score = round(max(0, min(100, raw)))
    return {
        "score": score,
        "breakdown": {
            "contrarian": round(contrarian),
            "rsi": round(rsi_bonus),
            "quality": round(quality),
            "regime": round(regime_c),
            "holders": 0,
            "volatilityPenalty": round(vol_pen),
            "news": 0,
        },
    }
