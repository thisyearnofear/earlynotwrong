# conviction-gym (Python)

Gymnasium port of the Conviction Gym RL environment — see
`../README.md` for the full spec, action space, reward, and Beam usage.

```bash
pip install -e .
python -m conviction_gym.rollout --episodes <path-to-episodes.json> --policy beam
```

Episodes load from a local `episodes.json` or a Hugging Face dataset repo:

```python
import conviction_gym as cg
eps = cg.load_episodes(hf_repo="<user>/conviction-gym-episodes")
env = cg.ConvictionGymEnv(eps[0], {"mode": "assisted"})
```
