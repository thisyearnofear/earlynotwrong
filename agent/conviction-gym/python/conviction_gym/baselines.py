"""Reference baseline policies — Python ports of conviction-gym/policies.ts.

- ConvictionPolicy: production Early, Not Wrong strategy (entries via top
  conviction ≥ threshold; exits via env tiers in assisted mode, or the same
  tiers emitted as actions in full-control).
- RandomPolicy: uniform-random action (naive baseline).
- BuyHoldPolicy: largest-mcap token on day 1, never sell.
"""

import random

from .simulator import risk_verdict

MIN_CONVICTION_SCORE = 55


class ConvictionPolicy:
    name = "conviction"

    def __init__(self):
        self.last_reasoning = None

    def act(self, env):
        # Full-control: emit the production tiered exits as actions.
        if env.cfg["mode"] == "full-control":
            for i, p in enumerate(env._state.positions):
                day = env.episode["days"][env._step_idx]
                price = {q["symbol"].upper(): q["price"] for q in day["quotes"]}.get(
                    p.symbol.upper(), 0.0)
                action, _ = risk_verdict(p, price)
                if action != "HOLD":
                    try:
                        idx = env.symbols.index(p.symbol)
                    except ValueError:
                        continue
                    return (idx, 3 if action == "EXIT_PARTIAL" else 2, 1)
        # Entries: top conviction above the gate.
        if (env.cfg["maxOpenPositions"] - len(env._state.positions) > 0):
            held = {p.symbol.upper() for p in env._state.positions}
            for score, sym_name, q, rsi, conv in env._scored_tokens():
                if score >= MIN_CONVICTION_SCORE and sym_name.upper() not in held:
                    try:
                        return (env.symbols.index(sym_name), 1, 1)
                    except ValueError:
                        continue
        return (0, 0, 1)


class RandomPolicy:
    name = "random"

    def __init__(self, seed=7):
        self._rng = random.Random(seed)
        self.last_reasoning = None

    def act(self, env):
        r = self._rng.random()
        if r < 0.4:
            return (0, 0, 1)
        if r < 0.7 and len(env._state.positions) < env.cfg["maxOpenPositions"]:
            return (self._rng.randrange(env.K), 1, 1)
        if env._state.positions:
            p = self._rng.choice(env._state.positions)
            try:
                idx = env.symbols.index(p.symbol)
            except ValueError:
                return (0, 0, 1)
            return (idx, 2 if self._rng.random() < 0.5 else 3, 1)
        return (0, 0, 1)


class BuyHoldPolicy:
    name = "buy_and_hold"

    def __init__(self):
        self._entered = False
        self.last_reasoning = None

    def act(self, env):
        if self._entered:
            return (0, 0, 1)
        self._entered = True
        scored = env._scored_tokens()
        top = max(scored, key=lambda x: x[2]["marketCap"], default=None)
        if top:
            try:
                return (env.symbols.index(top[1]), 1, 2)
            except ValueError:
                pass
        return (0, 0, 1)


POLICIES = {
    "conviction": ConvictionPolicy,
    "random": RandomPolicy,
    "buy_and_hold": BuyHoldPolicy,
}
