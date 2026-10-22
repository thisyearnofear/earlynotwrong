"""ConvictionGymEnv — Gymnasium environment over packaged market episodes.

Action space: MultiDiscrete([K, 4, 3])
    a[0] = symbol index (0..K-1, universe order)
    a[1] = op: 0 hold · 1 enter · 2 exit_full · 3 exit_partial
    a[2] = size: 0 small (25%) · 1 standard (50%) · 2 max (100%) — enter only

Observation: Dict
    "regime":    [regime_score, fgi]                       Box(2,)
    "portfolio": [cash, bnb, total, drawdown, slots, max_entry]  Box(6,)
    "positions": (max_positions, 6) padded rows
                 [held?, pnl%, dd_from_peak%, cycles, basis_frac, partial_taken]
    "tokens":    (K, 11)
                 [log_price, chg1h, chg24h, chg7d, log_mcap, log_vol,
                  rsi, score, contrarian, quality, regime_component]

Reward: 100·ln(V_t / V_{t-1}) − λ·(drawdown from running peak, %)
        −0.05 invalid-action penalty, +0.02 per profitable exit when
        thesis_bonus is on ("early, not wrong" shaping).

mode="assisted"     env applies the production risk tiers each step
mode="full-control" the agent owns every exit decision
"""

import math

import numpy as np
import gymnasium as gym
from gymnasium import spaces

from . import simulator as sim
from .scoring import compute_rsi14, score_token_conviction

SIZE_FRACTIONS = (0.25, 0.5, 1.0)

DEFAULT_CONFIG = {
    "mode": "assisted",
    "initialBnbUsd": 1000.0,
    "initialCashUsd": 0.0,
    "slippageBps": 100.0,
    "gasUsd": 1.5,
    "maxOpenPositions": 5,
    "maxPositionFraction": 0.15,
    "maxTradeFractionOfBnb": 0.5,
    "minBnbReserveUsd": 20.0,
    "harvestBelowFraction": 0.25,
    "drawdownPenaltyLambda": 0.1,
    "thesisBonus": False,
}


class ConvictionGymEnv(gym.Env):
    metadata = {"render_modes": ["text"]}

    def __init__(self, episode: dict, config: dict | None = None):
        super().__init__()
        self.cfg = {**DEFAULT_CONFIG, **(config or {})}
        self.episode = episode
        self.symbols = episode["symbols"]
        self.K = len(self.symbols)
        self.max_pos = self.cfg["maxOpenPositions"]

        self.action_space = spaces.MultiDiscrete([self.K, 4, 3])
        self.observation_space = spaces.Dict({
            "regime": spaces.Box(low=-np.inf, high=np.inf, shape=(2,), dtype=np.float32),
            "portfolio": spaces.Box(low=-np.inf, high=np.inf, shape=(6,), dtype=np.float32),
            "positions": spaces.Box(low=-np.inf, high=np.inf,
                                    shape=(self.max_pos, 6), dtype=np.float32),
            "tokens": spaces.Box(low=-np.inf, high=np.inf,
                                 shape=(self.K, 11), dtype=np.float32),
        })
        self._state = None
        self._step_idx = 0

    # ------------------------------------------------------------------
    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        v = self.cfg["initialCashUsd"] + self.cfg["initialBnbUsd"]
        self._state = sim.SimState(
            cash_usd=self.cfg["initialCashUsd"],
            bnb_usd=self.cfg["initialBnbUsd"],
            peak_value_usd=v,
            prev_value_usd=v,
        )
        self._step_idx = 0
        return self._obs(), {}

    def step(self, action):
        day = self.episode["days"][self._step_idx]
        price_map = {q["symbol"].upper(): q["price"] for q in day["quotes"]}
        trades: list = []

        sim.accrue_all(self._state, price_map)
        if self.cfg["mode"] == "assisted":
            sim.apply_risk_tiers(self._state, self.cfg, price_map, day["date"], trades)

        invalid = self._apply_action(action, price_map, day["date"], trades)
        sim.auto_harvest(self._state, self.cfg, price_map, day["date"], trades)

        value = sim.total_value(self._state, price_map)
        prev = self._state.prev_value_usd
        daily_return = math.log(value / prev) * 100 if prev > 0 else 0.0
        self._state.daily_values.append(value)
        if value > self._state.peak_value_usd:
            self._state.peak_value_usd = value
        self._state.prev_value_usd = value

        drawdown = (self._state.peak_value_usd - value) / self._state.peak_value_usd
        reward = daily_return - self.cfg["drawdownPenaltyLambda"] * drawdown * 100
        if self.cfg["thesisBonus"]:
            reward += 0.02 * sum(1 for t in trades if t["type"] != "entry" and t["pnlUsd"] > 0)
        if invalid:
            reward -= 0.05

        self._step_idx += 1
        terminated = self._step_idx >= len(self.episode["days"])
        info = {
            "trades": trades,
            "invalid_action": invalid,
            "total_value_usd": value,
            "daily_return_percent": daily_return,
        }
        return self._obs(), float(reward), terminated, False, info

    # ------------------------------------------------------------------
    def _apply_action(self, action, price_map, day, trades):
        symbol_idx, op, size = int(action[0]), int(action[1]), int(action[2])
        if symbol_idx < 0 or symbol_idx >= self.K:
            return f"symbol_index {symbol_idx} out of range"
        symbol = self.symbols[symbol_idx].upper()
        price = price_map.get(symbol, 0.0)
        pos = next((p for p in self._state.positions if p.symbol.upper() == symbol), None)

        if op == 0:
            return None
        if op == 1:
            if pos:
                return f"{symbol} already held"
            if price <= 0:
                return f"no price for {symbol}"
            portfolio_value = sim.total_value(self._state, price_map)
            cap = sim.max_entry_usd(self._state, self.cfg, portfolio_value)
            ok = sim.execute_entry(self._state, self.cfg, symbol, price,
                                   cap * SIZE_FRACTIONS[size], day, trades)
            return None if ok else f"entry rejected (bankroll cap {cap:.2f})"
        if op in (2, 3):
            if not pos:
                return f"no open position in {symbol}"
            if price <= 0:
                return f"no price for {symbol}"
            fraction = 1.0 if op == 2 else 0.33
            ttype = "exit_agent" if op == 2 else "exit_partial"
            sim.execute_exit(self._state, self.cfg, pos, price, day,
                             ttype, fraction, "agent", trades)
            self._state.positions = [p for p in self._state.positions if p.amount_usd > 0.01]
            return None
        return f"unknown op {op}"

    # ------------------------------------------------------------------
    def _obs(self):
        day = self.episode["days"][min(self._step_idx, len(self.episode["days"]) - 1)]
        price_map = {q["symbol"].upper(): q["price"] for q in day["quotes"]}
        quotes = {q["symbol"].upper(): q for q in day["quotes"]}
        regime = day["regime"]

        tokens = np.zeros((self.K, 11), dtype=np.float32)
        for i, sym_name in enumerate(self.symbols):
            q = quotes.get(sym_name.upper())
            if not q:
                continue
            kl = day.get("klines", {}).get(sym_name.upper(), [])
            rsi = compute_rsi14(kl) if len(kl) >= 15 else None
            conv = score_token_conviction(q, regime, rsi)
            b = conv["breakdown"]
            tokens[i] = [
                math.log(q["price"]) if q["price"] > 0 else 0,
                q["percentChange1h"] / 100,
                q["percentChange24h"] / 100,
                q["percentChange7d"] / 100,
                math.log10(q["marketCap"]) if q["marketCap"] > 0 else 0,
                math.log10(q["volume24h"]) if q["volume24h"] > 0 else 0,
                (rsi if rsi is not None else 50) / 100,
                conv["score"] / 100,
                b["contrarian"] / 100,
                b["quality"] / 100,
                b["regime"] / 100,
            ]

        positions = np.zeros((self.max_pos, 6), dtype=np.float32)
        for i, p in enumerate(self._state.positions[: self.max_pos]):
            price = price_map.get(p.symbol.upper(), 0.0)
            pnl = (price - p.entry_price) / p.entry_price if p.entry_price > 0 else 0
            dd = (p.peak_price - price) / p.peak_price if p.peak_price > 0 else 0
            positions[i] = [1, pnl, dd, p.cycles_held / 100, p.amount_usd / 1000,
                            1 if p.partial_taken else 0]

        value = sim.total_value(self._state, price_map)
        dd_total = (self._state.peak_value_usd - value) / self._state.peak_value_usd
        portfolio = np.array([
            self._state.cash_usd / 1000,
            self._state.bnb_usd / 1000,
            value / 1000,
            dd_total,
            self.cfg["maxOpenPositions"] - len(self._state.positions),
            sim.max_entry_usd(self._state, self.cfg, value) / 1000,
        ], dtype=np.float32)

        return {
            "regime": np.array([regime["score"] / 100,
                                (regime.get("fearGreedIndex") or 50) / 100],
                               dtype=np.float32),
            "portfolio": portfolio,
            "positions": positions,
            "tokens": tokens,
        }

    def current_date(self) -> str:
        day = self.episode["days"][min(self._step_idx, len(self.episode["days"]) - 1)]
        return day["date"]

    def _scored_tokens(self):
        """Tokens scored and sorted by conviction — the rendered market list."""
        day = self.episode["days"][min(self._step_idx, len(self.episode["days"]) - 1)]
        quotes = {q["symbol"].upper(): q for q in day["quotes"]}
        regime = day["regime"]
        scored = []
        for sym_name in self.symbols:
            q = quotes.get(sym_name.upper())
            if not q:
                continue
            kl = day.get("klines", {}).get(sym_name.upper(), [])
            rsi = compute_rsi14(kl) if len(kl) >= 15 else None
            conv = score_token_conviction(q, regime, rsi)
            scored.append((conv["score"], sym_name, q, rsi, conv))
        return sorted(scored, key=lambda x: -x[0])

    def rendered_symbols(self) -> list[str]:
        """Symbol order as shown in render() — for LLM symbol_index mapping."""
        return [s for _, s, *_ in self._scored_tokens()]

    def render(self):
        """Text observation — the LLM-agent interface (same layout as TS)."""
        day = self.episode["days"][min(self._step_idx, len(self.episode["days"]) - 1)]
        price_map = {q["symbol"].upper(): q["price"] for q in day["quotes"]}
        regime = day["regime"]
        value = sim.total_value(self._state, price_map)
        lines = [
            f"Day {self._step_idx + 1} ({day['date']}) | regime: {regime['fearLevel']}"
            f" (score {regime['score']}/100, FGI {regime.get('fearGreedIndex')})",
            f"Portfolio: ${value:.2f} (BNB ${self._state.bnb_usd:.2f},"
            f" slots {self.cfg['maxOpenPositions'] - len(self._state.positions)})",
        ]
        for p in self._state.positions:
            price = price_map.get(p.symbol.upper(), 0.0)
            pnl = (price - p.entry_price) / p.entry_price * 100 if p.entry_price > 0 else 0
            lines.append(f"  {p.symbol}: {pnl:+.1f}% (basis ${p.amount_usd:.2f}, held {p.cycles_held}d)")
        lines.append("Market (ranked by conviction):")
        for score, sym_name, q, rsi, conv in self._scored_tokens():
            rsi_text = f" RSI {rsi:.0f}" if rsi is not None else ""
            lines.append(
                f"  {sym_name} ${q['price']:.4g} | 7d {q['percentChange7d']:+.1f}%"
                f"{rsi_text} | score {score}"
            )
        return "\n".join(lines)
