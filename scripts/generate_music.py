"""Generate background music tracks using MusicGen and save as MP3 + manifest.

Usage:
    python scripts/generate_music.py --genre classical --count 10 --duration 45
    python scripts/generate_music.py --genre hiphop --count 10 --duration 45

Requires a GPU (or be patient on CPU). Output goes to
backend/music/<genre>/cl_NN.mp3 (or hh_NN.mp3) along with manifest.json.

This script is intentionally separate from the web service.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MUSIC_DIR = PROJECT_ROOT / "backend" / "music"

GENRE_CONFIG = {
    "classical": {
        "prefix": "cl",
        "prompts": [
            "Slow, gentle classical chamber music. Soft piano with light strings. Low volume, peaceful, relaxing, no percussion. Around 60 BPM.",
            "Calm baroque cello and harpsichord. Slow tempo, contemplative mood, very quiet dynamics.",
            "Tender solo piano nocturne, gentle melody, slow flowing rhythm, low energy.",
            "Soft string quartet adagio. Sustained notes, peaceful, dreamy, low volume.",
            "Quiet acoustic guitar and flute duet. Folk-influenced classical style, gentle slow tempo.",
        ],
        "title_fmt": "Classical #{n}",
    },
    "hiphop": {
        "prefix": "hh",
        "prompts": [
            "Upbeat instrumental hip-hop with crisp drums, deep bass groove, head-nodding beat. 90 BPM, no vocals, energetic.",
            "Boom-bap hip-hop instrumental with vinyl crackle, jazzy sample, tight snare, rhythmic bass.",
            "Modern trap beat with rolling hi-hats, 808 bass, punchy kick. Mid-tempo, rhythmic, no vocals.",
            "Funky hip-hop groove with electric piano stabs, syncopated drums, walking bass.",
            "Lo-fi hip-hop with mellow Rhodes piano, soft snare, warm bass. Mid-tempo, head-nod groove.",
        ],
        "title_fmt": "Hip-hop #{n}",
    },
}


def generate(genre: str, count: int, duration: int, model_name: str) -> None:
    if genre not in GENRE_CONFIG:
        raise SystemExit(f"Unknown genre {genre!r}; use one of {list(GENRE_CONFIG)}")

    try:
        from audiocraft.models import MusicGen
        from audiocraft.data.audio import audio_write
    except ImportError as e:
        raise SystemExit(
            "audiocraft is not installed. Run: pip install -r scripts/requirements.txt"
        ) from e

    cfg = GENRE_CONFIG[genre]
    out_dir = MUSIC_DIR / genre
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading MusicGen model: {model_name}")
    model = MusicGen.get_pretrained(model_name)
    model.set_generation_params(duration=duration)

    manifest = []
    for i in range(1, count + 1):
        prompt = cfg["prompts"][(i - 1) % len(cfg["prompts"])]
        filename = f"{cfg['prefix']}_{i:02d}"
        out_path = out_dir / filename
        print(f"[{i}/{count}] {filename}: {prompt[:60]}...")
        wav = model.generate([prompt])
        audio_write(
            str(out_path),
            wav[0].cpu(),
            model.sample_rate,
            strategy="loudness",
            format="mp3",
        )
        manifest.append({
            "id": filename,
            "filename": f"{filename}.mp3",
            "title": cfg["title_fmt"].format(n=i),
            "duration_sec": duration,
        })

    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"Wrote {len(manifest)} tracks and manifest to {out_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate music with MusicGen")
    parser.add_argument("--genre", required=True, choices=list(GENRE_CONFIG))
    parser.add_argument("--count", type=int, default=10)
    parser.add_argument("--duration", type=int, default=45,
                        help="Seconds per track (MusicGen max ~30; longer may be chunked)")
    parser.add_argument("--model", default="facebook/musicgen-small",
                        help="MusicGen model name (small/medium/large)")
    args = parser.parse_args()
    generate(args.genre, args.count, args.duration, args.model)


if __name__ == "__main__":
    main()
