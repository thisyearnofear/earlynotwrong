# Conviction Gym

An RL environment for **conviction-based crypto trading**, built from the
production [Early, Not Wrong](https://github.com/udingethe/earlynotwrong)
autonomous trading agent — and designed for LLM agents like
[Reflection's Beam](https://huggingface.co/reflection/Beam-1.0-501B-A23B).

**Published artifacts:** [huggingface.co/datasets/Papajams/conviction-gym](https://huggingface.co/datasets/Papajams/conviction-gym)
(episodes + all Beam trace files + this code).

Unlike a backtest (where the strategy is baked into the loop), the
environment here owns **only the physics** — mark-to-market, slippage, gas,
bankroll constraints. Every decision is an agent action.

## Why it's different

- **Real episodes, not synthetic noise.** Packaged daily market data for a
  26-token BSC universe (CoinGecko prices/mcap/volume + alternative.me
  Fear & Greed regime), replayed day by day.
- **Conviction-native observations.** Each step exposes the production
  6-factor conviction score per token (contrarian / RSI / quality / regime /
  holders / volatility-penalty) — the same features a live trading agent
  uses, available to RL policies as structured arrays and to LLM agents as
  a text render.
- **Two difficulty modes.** `assisted` applies the production risk tiers
  (stop −35% · partial 33% at +50% · trail at +100% peak / 30% give-back) as
  env physics; `full-control` makes the agent own every exit.
- **LLM-native.** `render()` produces a compact text observation per step;
  Beam's 1M context can hold an entire episode of history if you want it to.

## Action space

`MultiDiscrete([K, 4, 3])` — K tokens (26 in the shipped universe):

| index | meaning |
|-------|---------|
| `a[0]` | symbol index (universe order) |
| `a[1]` | op: `0` hold · `1` enter · `2` exit_full · `3` exit_partial (33%) |
| `a[2]` | size: `0` small (25%) · `1` standard (50%) · `2` max (100%) — enter only |

Entry sizing is bankroll-constrained: `min(portfolio × 15%, (BNB − reserve) × 50%)`,
with a $20 BNB reserve, 1% slippage and $1.50 gas per fill — the same
frictions the live agent pays.

## Reward

```
reward = 100·ln(V_t / V_{t−1})                       # daily log return
       − λ · (drawdown from running peak, %)        # λ = 0.1 default
       − 0.05 · invalid_action                      # format penalty
       + 0.02 · profitable exits (thesisBonus on)   # "early, not wrong" shaping
```

## Quickstart (Python / Gymnasium)

```bash
pip install -e agent/conviction-gym/python
python -m conviction_gym.rollout --episodes agent/data/episodes.json \
    --policy conviction --window 30
```

```python
import conviction_gym as cg

episodes = cg.load_episodes("agent/data/episodes.json")   # or hf_repo="…"
env = cg.ConvictionGymEnv(episodes[0], {"mode": "assisted"})

obs, _ = env.reset()
done = False
while not done:
    obs, reward, done, _, info = env.step(env.action_space.sample())
```

## Quickstart (TypeScript — the reference implementation)

```bash
# regenerate the dataset (CoinGecko + FGI; COINGECKO_API_KEY optional)
npx tsx agent/conviction-gym/export-episodes.ts --days 150

# run the reference baselines
npx tsx agent/conviction-gym/run-eval.ts --mode assisted --window 30 --all
```

## Beam as the agent

Beam plays the env directly: each step it sees the text-rendered
observation and returns a JSON action — a genuine LLM-agent benchmark on
long-horizon decision-making under transaction costs.

```bash
# $25 free HF credits: https://huggingface.co/coupons/claim/HuggingFacexReflection-MiniHack
export HF_TOKEN=hf_...
npx tsx agent/conviction-gym/run-beam.ts --mode assisted --window 30

# or in Python
python -m conviction_gym.rollout --policy beam \
    --episodes agent/data/episodes.json --traces beam-traces.jsonl
```

Every step records `observation_text + reasoning + action + reward +
token usage` to a JSONL trace — ready to publish as an expert-trajectory
dataset for imitation learning. Set `BEAM_REASONING_EFFORT`
(`minimal`…`max`) to trade latency for deliberation; any OpenAI-compatible
endpoint works via `BEAM_API_BASE` / `BEAM_API_KEY` / `BEAM_MODEL`.

### The effort sweep — does more thinking buy better trades?

Single-turn studies (BeamDial, Effort Atlas) found Beam's
`reasoning_effort` dial mostly doesn't pay on QA tasks — and at tight
budgets it produces *empty answers*. Nobody has tested it on sequential
decisions. This is the sweep:

```bash
npx tsx agent/conviction-gym/run-beam.ts --sweep minimal,low,medium,high,max
```

One rollout per level on the same episode → a dial table with return,
Sharpe, trade/hold counts, truncations (the `finish_reason="length"`
budget trap, detected per step), and mean reasoning tokens per decision.
Traces land in `beam-traces-<level>.jsonl` — the dataset ships all levels
so anyone can study how effort changes trading behavior, not just scores.

## Baseline results

150 real market days (2026-05-26 → 2026-10-22), five 30-day windows,
assisted mode, $1,000 BNB bankroll:

| policy | avg return | avg Sharpe | trades/ep |
|--------|-----------:|-----------:|----------:|
| conviction (production) | **+1.0%** | 3.04 | 25 |
| buy & hold | +0.7% | −5.01 | 1 |
| random | +0.4% | −12.57 | 20 |

(Baselines are reproducible: `run-eval.ts --all` and the Python
`ConvictionPolicy` reproduce identical numbers — the ports are
cross-validated.)

## Beam in the gym — measured results

`reflection/Beam-1.0-501B-A23B` via HF Inference Providers, one 30-day
rollout per level, temperature 0.2.

### The budget trap is real on sequential decisions

`max_tokens=1024` — the same trap the single-turn studies found, now in
an agentic loop where it silently turns "think hard" into "do nothing":

| effort | return | trades | truncated steps | reason tok/step |
|--------|-------:|-------:|----------------:|----------------:|
| minimal | −5.2% | 18 | 0/30 | 194 |
| low | −3.0% | 6 | **10/30** | 707 |
| medium | −0.8% | 3 | **17/30** | 834 |
| high | 0.0% | 0 | **23/30** | 914 |
| max | −0.2% | 1 | **24/30** | 947 |

At `high`/`max` Beam's reasoning consumed the entire completion budget on
most days — `finish_reason=length`, empty answer, forced hold. Ironically
that *helped* its score: doing nothing beat its own trading.

### With a fair budget, the dial is non-monotonic

`max_tokens=8192` — every level free to finish thinking:

| effort | return | trades | holds | reason tok/step | ms/step |
|--------|-------:|-------:|------:|----------------:|--------:|
| minimal | −4.9% | 24 | 16 | 201 | 836 |
| low | −4.1% | 12 | 22 | 680 | 1,932 |
| medium | **−6.5%** | 34 | 10 | 1,589 | 3,698 |
| high | −5.0% | 26 | 15 | 2,395 | 4,998 |
| max | −4.2% | 28 | 14 | 2,883 | 5,968 |

More thinking → more churn, not more return: `medium` (worst) paid 8× the
reasoning tokens of `minimal` and lost more. Every level underperformed
the conviction heuristic (−1.7%), random (−1.9%), and buy & hold (−1.9%)
on this choppy window — Beam overtrades into fees.

### …but in a trending window it beats the heuristic

Spot-check on `w3` (the window where conviction hit +9.6%):

| effort | return | trades | reason tok/step |
|--------|-------:|-------:|----------------:|
| low | +9.7% | 23 | 936 |
| max | **+12.9%** | 17 | 2,543 |

Beam at `max` *beat the production strategy* — it held longer and traded
less. The honest picture: Beam's trading skill is regime-dependent
(choppy → churn, trending → patient), and its effort dial doesn't reliably
buy better decisions — it buys *different* ones.

**Caveats:** single 30-day window per cell, one rollout per level
(temperature 0.2, no repeats), assisted mode. All 150+ trace steps with
per-step token usage ship in `data/beam-traces-*.jsonl` — rerun any cell
with `run-beam.ts --sweep <level> --episode <w>`.

## Layout

```
conviction-gym/
  types.ts            # Observation / Action / EpisodeSpec / EnvConfig
  simulator.ts        # physics core (no policy)
  env.ts              # ConvictionGymEnv — reset/step/observe/render
  policies.ts         # conviction / random / buy-and-hold baselines
  beam.ts             # Beam-as-policy (OpenAI-compatible)
  episodes.ts         # episode loading + windowing
  evaluate.ts         # rollout → metrics (Sharpe, maxDD, win rate, PF)
  export-episodes.ts  # CoinGecko + FGI → data/episodes.json
  run-eval.ts         # baseline comparison CLI
  run-beam.ts         # Beam rollout + trace recorder
  python/             # Gymnasium port (cross-validated against TS)
    conviction_gym/
      env.py  simulator.py  scoring.py  data.py  baselines.py  llm.py  rollout.py
```

## Publishing (Build with Beam submission)

1. `huggingface-cli upload <user>/conviction-gym-episodes agent/data/episodes.json` —
   the environment dataset
2. `huggingface-cli upload <user>/conviction-gym-traces agent/data/beam-traces.jsonl` —
   Beam's expert trajectories
3. Package `python/` as the env repo / Space
4. Comment the repo link on the
   [model's discussion page](https://huggingface.co/reflection/Beam-1.0-501B-A23B/discussions/5)
