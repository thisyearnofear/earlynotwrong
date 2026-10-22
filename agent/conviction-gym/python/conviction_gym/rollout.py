"""Rollout CLI — run a policy over eval episodes, print metrics, dump traces.

    python -m conviction_gym.rollout \
        --episodes episodes.json --window 30 --mode assisted \
        --policy beam --traces beam-traces.jsonl

    python -m conviction_gym.rollout --policy conviction --episodes episodes.json
"""

import argparse
import json

from .baselines import POLICIES
from .data import load_episodes, window_episodes
from .env import ConvictionGymEnv
from .llm import BeamPolicy, run_rollout


def main():
    ap = argparse.ArgumentParser(prog="conviction_gym.rollout")
    ap.add_argument("--episodes", default=None, help="path to episodes.json")
    ap.add_argument("--hf-repo", default=None,
                    help="HF dataset repo id to pull episodes from")
    ap.add_argument("--window", type=int, default=30)
    ap.add_argument("--mode", default="assisted", choices=["assisted", "full-control"])
    ap.add_argument("--policy", default="beam",
                    choices=["beam", *POLICIES.keys()])
    ap.add_argument("--effort", default=None,
                    help="reasoning_effort for beam: minimal|low|medium|high|xhigh|max")
    ap.add_argument("--episode", default=None, help="episode id suffix filter")
    ap.add_argument("--traces", default=None, help="write trajectory JSONL here")
    args = ap.parse_args()

    specs = load_episodes(path=args.episodes, hf_repo=args.hf_repo)
    episodes = window_episodes(specs[0], args.window)
    if args.episode:
        episodes = [e for e in episodes if e["id"].endswith(args.episode)]
    else:
        episodes = [e for e in episodes if e["split"] == "eval"] or episodes

    trace_file = open(args.traces, "w") if args.traces else None
    for ep in episodes:
        env = ConvictionGymEnv(ep, {"mode": args.mode})
        policy = (BeamPolicy(reasoning_effort=args.effort)
                  if args.policy == "beam" else POLICIES[args.policy]())
        rollout = run_rollout(env, policy)
        m = rollout["metrics"]
        print(f"{m['policy']:>14} @ {m['episode_id']}: "
              f"return {m['total_return_percent']:+.1f}%, "
              f"reward {m['cumulative_reward']:+.2f}, "
              f"{m['trades']} trades, {m['invalid_actions']} invalid")
        if trace_file:
            for step in rollout["trajectory"]:
                trace_file.write(json.dumps(
                    {"episode_id": m["episode_id"], "policy": m["policy"], **step}
                ) + "\n")
    if trace_file:
        trace_file.close()
        print(f"traces → {args.traces}")


if __name__ == "__main__":
    main()
