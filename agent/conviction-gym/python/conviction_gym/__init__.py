"""conviction-gym — an RL environment for conviction-based crypto trading.

Built from the Early, Not Wrong production trading harness. Episodes replay
real daily market data; the environment owns only physics — every decision
is an agent action. Designed for RL policies AND LLM agents (render() emits
a text observation tuned for models like Reflection's Beam).
"""

from gymnasium.envs.registration import register

from .data import load_episodes, slice_episode, window_episodes
from .env import ConvictionGymEnv

register(
    id="ConvictionGym-v0",
    entry_point="conviction_gym.env:ConvictionGymEnv",
)

__all__ = ["ConvictionGymEnv", "load_episodes", "slice_episode", "window_episodes"]
__version__ = "0.1.0"
