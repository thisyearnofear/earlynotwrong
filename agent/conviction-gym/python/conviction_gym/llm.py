"""LLM-agent policies — run Beam (or any OpenAI-compatible model) as the
trading agent inside ConvictionGymEnv, and record trajectory traces.

Usage:
    export HF_TOKEN=hf_...          # $25 free credits via the hackathon coupon
    python -m conviction_gym.rollout --repo <hf-dataset-repo>

or programmatically:

    env = ConvictionGymEnv(episode)
    policy = BeamPolicy()           # env vars BEAM_API_BASE / BEAM_API_KEY
    rollout = run_rollout(env, policy)
"""

import json
import os
import urllib.request

OPS = ("hold", "enter", "exit_full", "exit_partial")
SIZES = ("small", "standard", "max")

SYSTEM_PROMPT = """You are an autonomous trading agent inside Conviction Gym, a replay of real
crypto market history. Each turn you see one market day and must pick ONE
action for that day. The strategy thesis is "early, not wrong": buy quality
assets that are DOWN during market fear (contrarian entries), hold through
ordinary drawdown, exit only to cap a broken thesis or to lock large
asymmetric gains — never sell winners early out of jitter.

Action space — reply with STRICT JSON only, no prose:
{"symbol_index": <int>, "op": "hold"|"enter"|"exit_full"|"exit_partial",
 "size": "small"|"standard"|"max", "reasoning": "<1-2 sentences>"}

symbol_index refers to the market list order shown each day (0 = first row).
- enter: open a new position (needs a free slot + bankroll).
- exit_full / exit_partial: close 100% / 33% of a held position.
- size applies to enter only: fraction of the max allowed entry.
- hold: take no action (symbol_index/size ignored).

Fees + slippage are real; pointless churn loses money. Long-horizon
thinking beats daily noise."""


def _extract_json(text: str):
    if "```" in text:
        parts = text.split("```")
        for p in parts:
            p = p.strip()
            if p.startswith("json"):
                p = p[4:].strip()
            if p.startswith("{"):
                text = p
                break
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None


class BeamPolicy:
    """Reflection Beam (or any OpenAI-compatible endpoint) as the policy.

    Env vars:
        BEAM_API_BASE  default https://router.huggingface.co/v1
        BEAM_API_KEY   or HF_TOKEN
        BEAM_MODEL     default reflection/Beam-1.0-501B-A23B
        BEAM_REASONING_EFFORT  optional (minimal|low|medium|high|…)
    """

    name = "beam"

    def __init__(self, api_base=None, api_key=None, model=None,
                 reasoning_effort=None, temperature=0.2, timeout=120):
        self.api_base = (api_base or os.environ.get(
            "BEAM_API_BASE", "https://router.huggingface.co/v1")).rstrip("/")
        self.api_key = api_key or os.environ.get(
            "BEAM_API_KEY") or os.environ.get("HF_TOKEN", "")
        self.model = model or os.environ.get(
            "BEAM_MODEL", "reflection/Beam-1.0-501B-A23B")
        self.reasoning_effort = reasoning_effort or os.environ.get(
            "BEAM_REASONING_EFFORT")
        self.temperature = temperature
        self.timeout = timeout
        self.history: list[str] = []
        self.last_reasoning: str | None = None
        self.last_usage: dict | None = None

    def act(self, env) -> tuple[int, int, int]:
        """Returns a MultiDiscrete action (symbol_index, op, size)."""
        self.last_reasoning = None
        self.last_usage = None
        if not self.api_key:
            self.last_reasoning = "BEAM_API_KEY/HF_TOKEN unset — forced hold"
            return (0, 0, 1)

        obs_text = env.render()
        recent = self.history[-5:]
        user_msg = obs_text
        if recent:
            user_msg += f"\n\nYour last {len(recent)} action(s):\n" + "\n".join(
                f"  {h}" for h in recent)
        user_msg += "\n\nReply with the JSON action only."

        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            "temperature": self.temperature,
            "max_tokens": 1024,
        }
        if self.reasoning_effort:
            body["reasoning_effort"] = self.reasoning_effort

        try:
            req = urllib.request.Request(
                f"{self.api_base}/chat/completions",
                data=json.dumps(body).encode(),
                headers={"content-type": "application/json",
                         "authorization": f"Bearer {self.api_key}"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read())
        except Exception as e:  # noqa: BLE001 — degrade to hold, record why
            self.last_reasoning = f"Beam call failed: {e}"
            return (0, 0, 1)

        usage = data.get("usage") or {}
        self.last_usage = {
            "prompt_tokens": usage.get("prompt_tokens"),
            "completion_tokens": usage.get("completion_tokens"),
            "reasoning_tokens": (usage.get("completion_tokens_details") or {}).get(
                "reasoning_tokens") or usage.get("reasoning_tokens"),
        }
        choice = (data.get("choices") or [{}])[0]
        text = choice.get("message", {}).get("content", "")
        parsed = _extract_json(text)
        if not parsed:
            # finish_reason="length" + empty content = Beam's documented
            # budget trap: reasoning consumed the completion budget.
            self.last_reasoning = (
                "TRUNCATED: finish_reason=length (reasoning consumed the completion budget)"
                if choice.get("finish_reason") == "length"
                else f"unparseable response: {text[:200]}"
            )
            return (0, 0, 1)

        self.last_reasoning = parsed.get("reasoning", text[:300])
        op = parsed.get("op") if parsed.get("op") in OPS else "hold"
        size = parsed.get("size") if parsed.get("size") in SIZES else "standard"
        # symbol_index refers to the rendered (conviction-sorted) list; map it
        # back to the universe index used by the action space.
        if op != "hold":
            try:
                rendered_idx = int(parsed.get("symbol_index", 0))
            except (TypeError, ValueError):
                rendered_idx = 0
            rendered_idx = max(0, min(len(env.symbols) - 1, rendered_idx))
            sym = env.rendered_symbols()[rendered_idx]
            canonical = env.symbols.index(sym)
        else:
            canonical, rendered_idx = 0, 0

        self.history.append(
            f"{env.current_date()}: {op}"
            + ("" if op == "hold" else f" {env.rendered_symbols()[rendered_idx]}"))
        return (canonical, OPS.index(op), SIZES.index(size))


def run_rollout(env, policy, record_text: bool = True) -> dict:
    """Run one episode; returns metrics + the trajectory trace."""
    obs, _ = env.reset()
    trajectory = []
    cumulative = 0.0
    invalid = 0
    trades = []
    value0 = float(obs["portfolio"][2]) * 1000
    done = False
    step = 0
    while not done:
        text = env.render() if record_text else ""
        action = policy.act(env)
        obs, reward, done, _, info = env.step(action)
        cumulative += reward
        invalid += 1 if info.get("invalid_action") else 0
        trades.extend(info["trades"])
        trajectory.append({
            "step": step,
            "date": env.episode["days"][min(step, len(env.episode["days"]) - 1)]["date"],
            "observation_text": text,
            "reasoning": getattr(policy, "last_reasoning", None),
            "usage": getattr(policy, "last_usage", None),
            "action": {"symbol_index": int(action[0]), "op": OPS[int(action[1])],
                       "size": SIZES[int(action[2])]},
            "reward": reward,
            "portfolio_value_usd": info["total_value_usd"],
        })
        step += 1
    final = trajectory[-1]["portfolio_value_usd"]
    return {
        "metrics": {
            "policy": getattr(policy, "name", "policy"),
            "episode_id": env.episode["id"],
            "initial_value_usd": value0,
            "final_value_usd": final,
            "total_return_percent": (final - value0) / value0 * 100,
            "cumulative_reward": cumulative,
            "trades": len(trades),
            "invalid_actions": invalid,
            "steps": step,
        },
        "trajectory": trajectory,
    }
