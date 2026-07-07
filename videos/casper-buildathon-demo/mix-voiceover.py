#!/usr/bin/env python3
"""Mix ElevenLabs voiceover clips with the Casper demo video segments."""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).parent.resolve()
FINAL = ROOT / "final"
AUDIO = ROOT / "audio"
OUT = ROOT / "final"
OUT.mkdir(exist_ok=True)

SEGMENT_DURATIONS = {
    "01_intro": 5.0,
    "02_hook": 5.0,
    "03_explorer": 12.0,
    "04_free_mcp": 6.0,
    "05_paid_mcp": 6.0,
    "06_dashboard": 9.0,
    "07_why_casper": 5.0,
    "08_settle": 5.0,
    "09_cta": 5.0,
}


def run(cmd):
    print("$", " ".join(cmd))
    subprocess.run(cmd, check=True)


def get_duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(path)],
        check=True, capture_output=True, text=True
    )
    return float(out.stdout.strip())


def mix_segment(name, duration):
    video = FINAL / f"{name}.mp4"
    audio = AUDIO / f"{name}.mp3"
    out = FINAL / f"{name}_narrated.mp4"

    # Pad or trim audio to match segment duration
    # Fade out over last 0.5s to avoid abrupt cut
    filter_audio = (
        f"[1:a]afade=t=out:st={max(0, duration - 0.5)}:d=0.5,apad=pad_dur={duration},"
        f"atrim=start=0:end={duration}[a]"
    )
    run([
        "ffmpeg", "-y", "-i", str(video), "-i", str(audio),
        "-filter_complex", filter_audio,
        "-map", "0:v", "-map", "[a]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-shortest", str(out)
    ])
    return out


def concat_segments(segments, output):
    list_file = FINAL / "concat_list_narrated.txt"
    with list_file.open("w") as f:
        for seg in segments:
            f.write(f"file '{seg.resolve()}'\n")
    run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", str(list_file), "-c", "copy", str(output)
    ])


def main():
    narrated = []
    for name, duration in SEGMENT_DURATIONS.items():
        seg = mix_segment(name, duration)
        narrated.append(seg)

    final_path = OUT / "casper-buildathon-demo-narrated.mp4"
    concat_segments(narrated, final_path)

    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "json", str(final_path)],
        check=True, capture_output=True, text=True
    )
    duration = json.loads(probe.stdout)["format"]["duration"]
    print(f"Final narrated video: {final_path}")
    print(f"Duration: {duration}s")


if __name__ == "__main__":
    main()
