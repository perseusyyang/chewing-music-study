"""Generate background music tracks using MusicGen and save as MP3 + manifest.

Usage:
    python scripts/generate_music.py --genre classical --count 10 --duration 30
    python scripts/generate_music.py --genre hiphop --count 10 --duration 30

Uses Hugging Face transformers for MusicGen — works on Apple Silicon (MPS),
NVIDIA (CUDA), or CPU (slow). Output goes to backend/music/<genre>/<id>.mp3
along with manifest.json.

This script is intentionally separate from the web service; run on the
researcher's workstation, then commit/copy the resulting MP3s.
"""
from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

import soundfile as sf
import torch
from pydub import AudioSegment
from transformers import AutoProcessor, MusicgenForConditionalGeneration


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MUSIC_DIR = PROJECT_ROOT / "backend" / "music"

GENRE_CONFIG = {
    "classical": {
        "prefix": "cl",
        "prompts": [
            "Solo piano in the style of Erik Satie — sparse, simple, melancholic but peaceful. Slow tempo around 70 BPM. Single melodic line with gentle pauses and breathing space between phrases. Soft left-hand bass notes underneath, light mid-range chords. No sustained pads, no strings, no other instruments, no background noise or hum. Mid-low register, intimate, contemplative. Clean studio recording, dry acoustic piano sound.",
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


def pick_device() -> str:
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def generate(genre: str, count: int, duration: int, model_name: str) -> None:
    if genre not in GENRE_CONFIG:
        raise SystemExit(f"Unknown genre {genre!r}; use one of {list(GENRE_CONFIG)}")

    cfg = GENRE_CONFIG[genre]
    out_dir = MUSIC_DIR / genre
    out_dir.mkdir(parents=True, exist_ok=True)

    device = pick_device()
    print(f"Loading MusicGen ({model_name}) on {device}")
    processor = AutoProcessor.from_pretrained(model_name)
    model = MusicgenForConditionalGeneration.from_pretrained(model_name).to(device)
    sample_rate = model.config.audio_encoder.sampling_rate  # 32000

    # MusicGen generates ~50 audio tokens per second.
    max_new_tokens = duration * 50

    manifest = []
    for i in range(1, count + 1):
        prompt = cfg["prompts"][(i - 1) % len(cfg["prompts"])]
        track_id = f"{cfg['prefix']}_{i:02d}"
        print(f"[{i}/{count}] {track_id}: {prompt[:60]}...")

        inputs = processor(text=[prompt], padding=True, return_tensors="pt").to(device)
        with torch.no_grad():
            audio_values = model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                do_sample=True,
                guidance_scale=3.0,
            )

        # audio_values: [batch=1, channels=1, samples] — flatten to 1-D mono samples
        wav = audio_values[0].cpu().numpy()
        if wav.ndim == 2:
            wav = wav.mean(axis=0)  # mix to mono if MusicGen ever returns multi-channel

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_path = tmp.name
        sf.write(tmp_path, wav, sample_rate)

        AudioSegment.from_wav(tmp_path).export(
            str(out_dir / f"{track_id}.mp3"),
            format="mp3",
            bitrate="192k",
        )
        Path(tmp_path).unlink()

        manifest.append({
            "id": track_id,
            "filename": f"{track_id}.mp3",
            "title": cfg["title_fmt"].format(n=i),
            "duration_sec": duration,
        })

    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"Wrote {len(manifest)} tracks and manifest to {out_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate music with MusicGen (transformers)")
    parser.add_argument("--genre", required=True, choices=list(GENRE_CONFIG))
    parser.add_argument("--count", type=int, default=10)
    parser.add_argument("--duration", type=int, default=30, help="Seconds per track")
    parser.add_argument(
        "--model",
        default="facebook/musicgen-small",
        help="HF model id (facebook/musicgen-small|medium|large)",
    )
    args = parser.parse_args()
    generate(args.genre, args.count, args.duration, args.model)


if __name__ == "__main__":
    main()
