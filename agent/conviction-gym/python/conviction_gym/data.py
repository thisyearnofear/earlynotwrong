"""Episode loading — local JSON or Hugging Face Hub.

Local:
    episodes = load_episodes("episodes.json")

From the Hub (published dataset repo):
    episodes = load_episodes(hf_repo="earlynotwrong/conviction-gym-episodes")
"""

import json
import os


def load_episodes(path: str | None = None, hf_repo: str | None = None,
                  hf_filename: str = "episodes.json") -> list[dict]:
    if path is None and hf_repo is None:
        path = os.environ.get("CONVICTION_GYM_EPISODES", "episodes.json")
    if hf_repo is not None:
        try:
            from huggingface_hub import hf_hub_download
        except ImportError as e:
            raise ImportError("pip install huggingface_hub to load episodes from the Hub") from e
        path = hf_hub_download(repo_id=hf_repo, filename=hf_filename, repo_type="dataset")
    with open(path) as f:
        return json.load(f)


def slice_episode(spec: dict, start: int, end: int, ep_id: str | None = None) -> dict:
    days = spec["days"][start:end]
    if not days:
        raise ValueError(f"empty slice [{start}, {end}) of {spec['id']}")
    return {**spec, "id": ep_id or f"{spec['id']}[{start}:{end})", "days": days}


def window_episodes(spec: dict, window_days: int, eval_windows: int = 1) -> list[dict]:
    """Contiguous windows; last `eval_windows` labeled split='eval'."""
    out = []
    n = len(spec["days"]) // window_days
    for i in range(n):
        ep = slice_episode(spec, i * window_days, (i + 1) * window_days,
                           f"{spec['id']}-w{i}")
        ep["split"] = "eval" if i >= n - eval_windows else "train"
        out.append(ep)
    return out
