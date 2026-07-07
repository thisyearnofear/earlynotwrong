#!/usr/bin/env python3
"""Build the Casper Buildathon walkthrough demo video from captured clips.

Uses Pillow to render text cards/captions (ffmpeg on this machine lacks
the drawtext filter), then ffmpeg to encode and composite.
"""
import json
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent.resolve()
BROWSER = ROOT / "browser"
TERM = ROOT / "terminal"
FINAL = ROOT / "final"
FINAL.mkdir(exist_ok=True)

WIDTH, HEIGHT = 1280, 720
FPS = 30
BG = "#050505"
ACCENT = "#10b981"
TEXT = "#e2e8f0"
MUTED = "#94a3b8"


def run(cmd):
    print("$", " ".join(cmd))
    subprocess.run(cmd, check=True)


def find_font(size, bold=False):
    """Pick a readable monospace-ish font."""
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/SFNS.ttf",
        "/Library/Fonts/Arial.ttf",
    ]
    for f in candidates:
        p = Path(f)
        if p.exists():
            try:
                return ImageFont.truetype(str(p), size)
            except Exception:
                continue
    return ImageFont.load_default()


def make_text_frame(text, subtext, width=WIDTH, height=HEIGHT):
    """Render a title/info card frame."""
    img = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(img)
    title_font = find_font(52, bold=True)
    sub_font = find_font(24)
    accent_bar = Image.new("RGB", (width, 4), ACCENT)
    img.paste(accent_bar, (0, height // 2 - 60))

    bbox = draw.textbbox((0, 0), text, font=title_font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((width - tw) // 2, height // 2 - 50), text, font=title_font, fill=ACCENT)

    bbox = draw.textbbox((0, 0), subtext, font=sub_font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((width - tw) // 2, height // 2 + 30), subtext, font=sub_font, fill=TEXT)
    return img


def make_caption_frame(caption, width=WIDTH, height=80):
    """Render a bottom caption bar with left padding."""
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # translucent dark bar
    overlay = Image.new("RGBA", (width, height), (5, 5, 5, 200))
    img = Image.alpha_composite(img, overlay)
    draw = ImageDraw.Draw(img)
    font = find_font(22)
    # wrap if needed
    words = caption.split()
    lines = []
    line = ""
    for w in words:
        test = f"{line} {w}".strip()
        bbox = draw.textbbox((0, 0), test, font=font)
        if bbox[2] - bbox[0] <= width - 60:
            line = test
        else:
            if line:
                lines.append(line)
            line = w
    if line:
        lines.append(line)
    total_h = len(lines) * 28
    y = (height - total_h) // 2
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        tw = bbox[2] - bbox[0]
        draw.text(((width - tw) // 2, y), line, font=font, fill=ACCENT)
        y += 28
    return img.convert("RGB")


def card(text, subtext, duration, filename):
    """Generate a title/info card MP4 from a static frame."""
    out = FINAL / filename
    img = make_text_frame(text, subtext)
    png = FINAL / (filename.replace(".mp4", ".png"))
    img.save(png)
    run([
        "ffmpeg", "-y", "-loop", "1", "-i", str(png),
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-pix_fmt", "yuv420p", "-r", str(FPS), "-t", str(duration),
        str(out)
    ])
    return out


def caption_clip(input_path, caption, duration=None, filename=None):
    """Add a bottom caption overlay to an existing clip."""
    out = FINAL / (filename or (input_path.stem + "_captioned.mp4"))
    dur_args = ["-t", str(duration)] if duration else []
    caption_png = FINAL / (out.stem + "_caption.png")
    cap = make_caption_frame(caption)
    cap.save(caption_png)
    run([
        "ffmpeg", "-y", "-i", str(input_path), "-i", str(caption_png),
        *dur_args,
        "-filter_complex", f"[0:v]scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease,pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2[base];[1:v]format=rgba[cap];[base][cap]overlay=(W-w)/2:H-h",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-pix_fmt", "yuv420p", "-r", str(FPS), str(out)
    ])
    return out


def concat_segments(segments, output):
    """Concatenate MP4s directly."""
    list_file = FINAL / "concat_list.txt"
    with list_file.open("w") as f:
        for seg in segments:
            f.write(f"file '{seg.resolve()}'\n")
    run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", str(list_file), "-c", "copy", str(output)
    ])


def main():
    # Identify clips (hashed names vary)
    explorer = next(BROWSER.glob("*.mp4"))
    dashboard = sorted(BROWSER.glob("*.mp4"), key=lambda p: p.stat().st_size, reverse=True)[0]
    free_mcp = TERM / "free_mcp.mp4"
    paid_mcp = TERM / "paid_mcp.mp4"

    # Cards and captioned clips
    intro = card(
        "Early, Not Wrong",
        "Casper-native agent reputation marketplace  |  Casper Agentic Buildathon 2026",
        5, "01_intro.mp4"
    )
    hook = card(
        "The problem",
        "AI agents cannot trust each other's self-reported track records.",
        5, "02_hook.mp4"
    )
    exp_cap = caption_clip(
        explorer,
        "Deployed Odra ConvictionRegistry on Casper Testnet — every anchor is on-chain",
        duration=12, filename="03_explorer.mp4"
    )
    free_cap = caption_clip(
        free_mcp,
        "Free MCP tool: get_latest_conviction reads the contract's CES event log (no gas)",
        duration=6, filename="04_free_mcp.mp4"
    )
    paid_cap = caption_clip(
        paid_mcp,
        "Paid MCP tool: x402 returns HTTP 402 + PaymentRequirements for CEP-18 micropayment",
        duration=6, filename="05_paid_mcp.mp4"
    )
    dash_cap = caption_clip(
        dashboard,
        "Dashboard surfaces live MCP endpoint, query stats, and latest Casper anchor",
        duration=9, filename="06_dashboard.mp4"
    )
    why = card(
        "Why Casper",
        "x402 + MCP + cspr.cloud facilitator = HTTP-native paid agent reputation",
        5, "07_why_casper.mp4"
    )
    settle = card(
        "Full settlement",
        "Client signs CEP-18 transfer, re-POSTs X-PAYMENT, facilitator settles on-chain",
        5, "08_settle.mp4"
    )
    cta = card(
        "Live now",
        "github.com/thisyearnofear/earlynotwrong  |  earlynotwrong.vercel.app/agent",
        5, "09_cta.mp4"
    )

    segments = [intro, hook, exp_cap, free_cap, paid_cap, dash_cap, why, settle, cta]
    final_path = FINAL / "casper-buildathon-demo.mp4"
    concat_segments(segments, final_path)

    # Print metadata
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "json", str(final_path)],
        check=True, capture_output=True, text=True
    )
    duration = json.loads(probe.stdout)["format"]["duration"]
    print(f"Final video: {final_path}")
    print(f"Duration: {duration}s")


if __name__ == "__main__":
    main()
