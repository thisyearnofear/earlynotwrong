"""Simulator — Python port of agent/conviction-gym/simulator.ts physics.

Identical rules: cost-basis position tracking, slippage + gas on every fill,
bankroll-reserve entry constraints, auto-harvest, and the production risk
tiers for assisted mode (stop −35% / partial 33% at +50% / trail at +100%
peak with 30% give-back).
"""

from dataclasses import dataclass, field

STOP_LOSS_PERCENT = 35.0
PARTIAL_GAIN_PERCENT = 50.0
PARTIAL_FRACTION = 0.33
TRAILING_ACTIVATION_PERCENT = 100.0
TRAILING_STOP_PERCENT = 30.0


@dataclass
class Position:
    symbol: str
    entry_price: float
    amount_usd: float
    peak_price: float
    cycles_held: int = 0
    partial_taken: bool = False


@dataclass
class SimState:
    cash_usd: float
    bnb_usd: float
    positions: list = field(default_factory=list)
    gas_spent_usd: float = 0.0
    realized_pnl_usd: float = 0.0
    peak_value_usd: float = 0.0
    prev_value_usd: float = 0.0
    daily_values: list = field(default_factory=list)


def position_value_usd(p: Position, price: float) -> float:
    return p.amount_usd * (price / p.entry_price) if p.entry_price > 0 and price > 0 else p.amount_usd


def total_value(state: SimState, price_map: dict) -> float:
    return state.cash_usd + state.bnb_usd + sum(
        position_value_usd(p, price_map.get(p.symbol.upper(), 0.0)) for p in state.positions
    )


def max_entry_usd(state: SimState, cfg: dict, portfolio_value: float) -> float:
    tradeable = max(0.0, state.bnb_usd - cfg["minBnbReserveUsd"])
    return min(portfolio_value * cfg["maxPositionFraction"], tradeable * cfg["maxTradeFractionOfBnb"])


def execute_entry(state: SimState, cfg: dict, symbol: str, price: float,
                  size_usd: float, day: str, trades: list) -> bool:
    if price <= 0 or size_usd <= 0 or len(state.positions) >= cfg["maxOpenPositions"]:
        return False
    entry = min(size_usd, max(0.0, state.bnb_usd - cfg["minBnbReserveUsd"]))
    if entry < 2:
        return False
    state.positions.append(Position(symbol=symbol, entry_price=price,
                                    amount_usd=entry, peak_price=price))
    state.bnb_usd -= entry
    state.gas_spent_usd += cfg["gasUsd"]
    trades.append({"day": day, "symbol": symbol, "type": "entry",
                   "amountUsd": entry, "pnlUsd": 0.0, "priceUsd": price, "actor": "agent"})
    return True


def execute_exit(state: SimState, cfg: dict, p: Position, price: float,
                 day: str, ttype: str, fraction: float, actor: str, trades: list) -> float:
    sell_value = position_value_usd(p, price) * fraction * (1 - cfg["slippageBps"] / 10000)
    pnl = sell_value - p.amount_usd * fraction
    state.bnb_usd += sell_value
    state.realized_pnl_usd += pnl
    state.gas_spent_usd += cfg["gasUsd"]
    trades.append({"day": day, "symbol": p.symbol, "type": ttype,
                   "amountUsd": sell_value, "pnlUsd": pnl, "priceUsd": price, "actor": actor})
    p.amount_usd *= 1 - fraction
    if ttype == "exit_partial":
        p.partial_taken = True
    return pnl


def risk_verdict(p: Position, price: float) -> tuple[str, float]:
    """evaluatePosition port: returns (action, sell_fraction)."""
    if p.entry_price <= 0 or price <= 0:
        return "HOLD", 0.0
    pnl = (price - p.entry_price) / p.entry_price * 100
    dd_from_peak = (p.peak_price - price) / p.peak_price * 100 if p.peak_price > 0 else 0.0
    if pnl <= -STOP_LOSS_PERCENT:
        return "EXIT_STOP", 1.0
    peak_gain = (p.peak_price - p.entry_price) / p.entry_price * 100
    if not p.partial_taken and pnl >= PARTIAL_GAIN_PERCENT:
        return "EXIT_PARTIAL", PARTIAL_FRACTION
    if peak_gain >= TRAILING_ACTIVATION_PERCENT and dd_from_peak >= TRAILING_STOP_PERCENT:
        return "EXIT_TRAIL", 1.0
    return "HOLD", 0.0


def apply_risk_tiers(state: SimState, cfg: dict, price_map: dict, day: str, trades: list) -> None:
    for pos in list(state.positions):
        price = price_map.get(pos.symbol.upper(), 0.0)
        if price <= 0:
            continue
        action, fraction = risk_verdict(pos, price)
        if action == "HOLD":
            continue
        ttype = {"EXIT_STOP": "exit_stop", "EXIT_TRAIL": "exit_trail"}.get(action, "exit_partial")
        execute_exit(state, cfg, pos, price, day, ttype, fraction, "env", trades)
    state.positions = [p for p in state.positions if p.amount_usd > 0.01]


def accrue_all(state: SimState, price_map: dict) -> None:
    for p in state.positions:
        price = price_map.get(p.symbol.upper(), 0.0)
        if price > 0:
            p.peak_price = max(p.peak_price, price)
        p.cycles_held += 1


def auto_harvest(state: SimState, cfg: dict, price_map: dict, day: str, trades: list) -> None:
    low_bnb = state.bnb_usd < cfg["initialBnbUsd"] * cfg["harvestBelowFraction"]
    at_cap = len(state.positions) >= cfg["maxOpenPositions"]
    if (not low_bnb and not at_cap) or not state.positions:
        return
    victim = min(state.positions,
                 key=lambda p: position_value_usd(p, price_map.get(p.symbol.upper(), 0.0)))
    price = price_map.get(victim.symbol.upper(), 0.0)
    if price <= 0:
        return
    execute_exit(state, cfg, victim, price, day, "exit_harvest", 1.0, "env", trades)
    state.positions = [p for p in state.positions if p.symbol != victim.symbol]
