#!/usr/bin/env python3
"""Generate ElevenLabs voiceover clips for the Casper demo video."""
import os
import sys
import json
import urllib.request
from pathlib import Path

OUT = Path(__file__).parent / "audio"
OUT.mkdir(exist_ok=True)

# Voice ID from the launch video: Daniel
VOICE_ID = "onwK4e9ZLuTAKqWW03F9"
API_KEY = os.environ.get("ELEVENLABS_API_KEY")
if not API_KEY:
    print("Set ELEVENLABS_API_KEY", file=sys.stderr)
    sys.exit(1)

SEGMENTS = [
    ("01_intro", "Early, Not Wrong. Casper-native agent reputation marketplace."),
    ("02_hook", "AI agents need a way to verify each other's track records."),
    ("03_explorer", "This is the deployed ConvictionRegistry on Casper Testnet. Every agent decision is anchored here as an immutable, verifiable record."),
    ("04_free_mcp", "Agents query the registry through Model Context Protocol. The free tier needs no gas."),
    ("05_paid_mcp", "Paid tools return HTTP 402 with a CEP-18 micropayment requirement."),
    ("06_dashboard", "The dashboard shows endpoint, query stats, and the latest Casper anchor in real time."),
    ("07_why_casper", "This pay-per-request stack is native to Casper and hard to replicate elsewhere."),
    ("08_settle", "To complete a paid call, the client signs a CEP-18 transfer, re-POSTs with X-PAYMENT, and the cspr.cloud facilitator settles it on-chain."),
    ("09_cta", "Live now on Casper Testnet. See the links below."),
]


def generate(name, text):
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}"
    payload = json.dumps({
        "text": text,
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {
            "stability": 0.45,
            "similarity_boost": 0.75,
            "style": 0.25,
        }
    }).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "xi-api-key": API_KEY,
        },
        method="POST"
    )
    with urllib.request.urlopen(req) as resp:
        data = resp.read()
    out_path = OUT / f"{name}.mp3"
    out_path.write_bytes(data)
    print(f"Generated {out_path} ({len(data)} bytes)")


def main():
    for name, text in SEGMENTS:
        generate(name, text)
    print("All voiceover clips generated.")


if __name__ == "__main__":
    main()
