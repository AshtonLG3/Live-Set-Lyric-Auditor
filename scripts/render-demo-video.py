from __future__ import annotations

import argparse
import json
import subprocess
import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
W, H = 1920, 1080
FPS = 30


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    font_path = Path("C:/Windows/Fonts") / name
    return ImageFont.truetype(str(font_path), size)


REGULAR = font("segoeui.ttf", 32)
SMALL = font("segoeui.ttf", 25)
BOLD = font("segoeuib.ttf", 42)
BIG = font("segoeuib.ttf", 76)
TITLE = font("segoeuib.ttf", 96)


def text_wrap(draw: ImageDraw.ImageDraw, text: str, font_obj: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current: list[str] = []
    for word in words:
        candidate = " ".join([*current, word])
        if draw.textbbox((0, 0), candidate, font=font_obj)[2] <= max_width:
            current.append(word)
        else:
            if current:
                lines.append(" ".join(current))
            current = [word]
    if current:
        lines.append(" ".join(current))
    return lines


def cover_background() -> Image.Image:
    cover = ROOT / "public" / "hero-concert-v2.png"
    if not cover.exists():
        cover = ROOT / "public" / "cover.png"
    image = Image.open(cover).convert("RGB")
    image = image.resize((W, H), Image.Resampling.LANCZOS)
    shade = Image.new("RGBA", (W, H), (5, 9, 18, 145))
    return Image.alpha_composite(image.convert("RGBA"), shade).convert("RGB")


def fit_image(path: Path, box: tuple[int, int, int, int]) -> Image.Image:
    source = Image.open(path).convert("RGB")
    box_w = box[2] - box[0]
    box_h = box[3] - box[1]
    source.thumbnail((box_w, box_h), Image.Resampling.LANCZOS)
    frame = Image.new("RGB", (box_w, box_h), (12, 18, 30))
    x = (box_w - source.width) // 2
    y = (box_h - source.height) // 2
    frame.paste(source, (x, y))
    return frame


def rounded_rect(draw: ImageDraw.ImageDraw, xy: tuple[int, int, int, int], fill: tuple[int, int, int, int], outline=None, width=1, radius=28):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def draw_multiline(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, font_obj: ImageFont.FreeTypeFont, fill, max_width: int, line_gap: int = 10):
    x, y = xy
    for line in text_wrap(draw, text, font_obj, max_width):
        draw.text((x, y), line, font=font_obj, fill=fill)
        y += font_obj.size + line_gap


def ui_slide(screenshot: Path, kicker: str, title: str, body: str, accent: tuple[int, int, int], footer: str) -> Image.Image:
    bg = Image.new("RGB", (W, H), (7, 12, 24))
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((-180, -160, 560, 480), fill=(*accent, 62))
    gd.ellipse((1390, 690, 2140, 1340), fill=(37, 196, 191, 44))
    bg = Image.alpha_composite(bg.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(70))).convert("RGB")
    draw = ImageDraw.Draw(bg, "RGBA")

    screenshot_box = (70, 108, 1288, 972)
    rounded_rect(draw, (50, 88, 1308, 992), (255, 255, 255, 24), outline=(255, 255, 255, 45), width=2, radius=30)
    bg.paste(fit_image(screenshot, screenshot_box), (screenshot_box[0], screenshot_box[1]))

    panel = (1344, 126, 1854, 930)
    rounded_rect(draw, panel, (11, 18, 32, 226), outline=(*accent, 130), width=2, radius=26)
    draw.text((1384, 170), kicker.upper(), font=SMALL, fill=(*accent, 255))
    draw_multiline(draw, (1384, 220), title, BOLD, (248, 250, 252, 255), 420, 10)
    draw.line((1384, 360, 1814, 360), fill=(255, 255, 255, 36), width=2)
    draw_multiline(draw, (1384, 398), body, REGULAR, (207, 215, 226, 255), 420, 13)
    draw.text((1384, 864), footer, font=SMALL, fill=(148, 163, 184, 255))
    return bg


def title_slide(version: str) -> Image.Image:
    image = cover_background().convert("RGBA")
    draw = ImageDraw.Draw(image, "RGBA")
    draw.text((118, 256), "Live-Set", font=TITLE, fill=(255, 255, 255, 255))
    draw.text((118, 360), "Lyric Auditor", font=TITLE, fill=(255, 255, 255, 255))
    draw_multiline(draw, (124, 506), "What did they actually sing live?", BOLD, (224, 242, 254, 255), 820, 8)
    rounded_rect(draw, (124, 654, 700, 724), (11, 18, 32, 214), outline=(37, 196, 191, 150), width=2, radius=20)
    draw.text((154, 672), f"Musicathon 2026 | Musixmatch Pro | v{version}", font=SMALL, fill=(226, 232, 240, 255))
    return image.convert("RGB")


def closing_slide(version: str) -> Image.Image:
    image = cover_background().filter(ImageFilter.GaussianBlur(3)).convert("RGBA")
    draw = ImageDraw.Draw(image, "RGBA")
    rounded_rect(draw, (260, 210, 1660, 850), (5, 9, 18, 218), outline=(37, 196, 191, 140), width=2, radius=34)
    draw.text((340, 318), "Live Variant Passport", font=TITLE, fill=(255, 255, 255, 255))
    draw_multiline(draw, (346, 450), "Canonical lyrics tell you what was written. Live-Set Lyric Auditor tells you what fans actually heard.", BOLD, (224, 242, 254, 255), 1180, 12)
    draw.text((346, 714), f"Export-ready demo video | v{version}", font=REGULAR, fill=(148, 163, 184, 255))
    return image.convert("RGB")


def wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as handle:
        return handle.getnframes() / float(handle.getframerate())


def pick(path: str, fallback: str) -> Path:
    candidate = ROOT / path
    if candidate.exists():
        return candidate
    fallback_path = ROOT / fallback
    if fallback_path.exists():
        return fallback_path
    return ROOT / "public" / "cover.png"


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, cwd=ROOT, check=True)


def render_video(version: str, voiceover: Path, output: Path) -> None:
    slides_dir = ROOT / "demo" / "slides"
    tmp_dir = ROOT / "demo" / "tmp"
    slides_dir.mkdir(parents=True, exist_ok=True)
    tmp_dir.mkdir(parents=True, exist_ok=True)
    output.parent.mkdir(parents=True, exist_ok=True)

    definitions = [
        ("01-title", title_slide(version), 10),
        ("02-dashboard", ui_slide(
            pick("demo/captures/01-dashboard.png", ".codex-qa/v050-nav-cleanup-dashboard-desktop-dark.png"),
            "Problem",
            "From noisy clip to Live Variant Passport",
            "The dashboard shows API mode, dark/light theme control, clip intake, Recall Rescue, track anchoring, event anchoring, and one-click Passport export.",
            (249, 115, 22),
            "Originality + craft"
        ), 15),
        ("03-musixmatch", ui_slide(
            pick("demo/captures/02-musixmatch-search.png", ".codex-qa/session-desktop-light.png"),
            "Musixmatch",
            "Exact recording identity",
            "Track search resolves Musixmatch track IDs, common-track IDs, ISRC, lyric availability, subtitles, and RichSync signals before any comparison is trusted.",
            (37, 196, 191),
            "track.search | RichSync | ISRC"
        ), 17),
        ("04-recall", ui_slide(
            pick("demo/captures/03-recall-rescue.png", ".codex-qa/clarified-controls.png"),
            "Recall Rescue",
            "A fragment can still become evidence",
            "When a reviewer only remembers a line, the app can use a typed, spoken, or sung fragment to recover a catalog anchor and continue the same analysis flow.",
            (124, 58, 237),
            "fragment in | track anchor out"
        ), 15),
        ("05-timeline", ui_slide(
            pick("demo/captures/04-analysis-timeline.png", ".codex-qa/v050-analysis-desktop-dark.png"),
            "Pipeline",
            "Source, vocal, transcript, match, compare",
            "The analysis flow validates the source, isolates vocals, profiles the arrangement, transcribes the performance, matches the recording, and assembles the Passport.",
            (37, 196, 191),
            "LALAL.AI | ASR | Musixmatch"
        ), 17),
        ("06-diff", ui_slide(
            pick("demo/captures/05-diff-view.png", ".codex-qa/v050-comparison-focus-desktop.png"),
            "Centerpiece",
            "Live vs Studio, line by line",
            "Reviewers see changed lines, skipped studio lines, live-only moments, timing drift, word-level additions and removals, and approve or reject decisions.",
            (249, 115, 22),
            "word-level diff | review actions"
        ), 20),
        ("07-context", ui_slide(
            pick("demo/captures/07-evidence-context.png", ".codex-qa/v050-combined-passport-comparison.png"),
            "Evidence",
            "Tie the lyric change to the real show",
            "JamBase supplies event, venue, lineup, and setlist context. Cyanite adds energy, tempo, mood, and instrumentation for the live arrangement.",
            (37, 196, 191),
            "JamBase + Cyanite"
        ), 16),
        ("08-export", ui_slide(
            pick("demo/captures/08-export-summary.png", ".codex-qa/v050-variants-active-desktop.png"),
            "Impact",
            "Portable review data for teams",
            "Exported JSON carries variants, timestamps, confidence, source mode, rights notes, and review decisions for captions, archives, QA, and catalog improvement.",
            (124, 58, 237),
            "Passport JSON | narration summary"
        ), 15),
        ("09-close", closing_slide(version), 10),
    ]

    duration = wav_duration(voiceover)
    base_total = sum(weight for *_slide, weight in definitions)
    scaled = [max(4.0, duration * weight / base_total) for *_slide, weight in definitions]
    scale_total = sum(scaled)
    if scale_total < duration:
        scaled[-1] += duration - scale_total + 0.4

    segment_paths = []
    for index, ((name, image, _weight), seconds) in enumerate(zip(definitions, scaled), start=1):
        slide_path = slides_dir / f"{index:02d}-{name}.png"
        image.save(slide_path)
        segment = tmp_dir / f"segment-{index:02d}.mp4"
        run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-loop", "1", "-t", f"{seconds:.3f}", "-i", str(slide_path),
            "-vf", f"fps={FPS},format=yuv420p",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
            "-pix_fmt", "yuv420p", str(segment)
        ])
        segment_paths.append(segment)

    concat_file = tmp_dir / "concat.txt"
    concat_file.write_text("".join(f"file '{path.as_posix()}'\n" for path in segment_paths), encoding="utf-8")
    video_only = tmp_dir / "video-only.mp4"
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(concat_file), "-c", "copy", str(video_only)])
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(video_only), "-i", str(voiceover),
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-shortest", str(output)
    ])

    try:
        manifest_output = str(output.relative_to(ROOT))
    except ValueError:
        manifest_output = str(output)

    manifest = {
        "version": version,
        "output": manifest_output,
        "voiceoverSeconds": round(duration, 2),
        "slides": [
            {"name": name, "seconds": round(seconds, 2)}
            for (name, _image, _weight), seconds in zip(definitions, scaled)
        ],
    }
    (ROOT / "demo" / "video-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    parser.add_argument("--voiceover", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    render_video(args.version, args.voiceover.resolve(), (ROOT / args.output).resolve() if not args.output.is_absolute() else args.output.resolve())


if __name__ == "__main__":
    main()
