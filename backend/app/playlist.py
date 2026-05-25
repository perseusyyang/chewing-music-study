"""Music playlist: reads pre-generated manifests, shuffles for serving."""
import json
import random
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MUSIC_DIR = PROJECT_ROOT / "backend" / "music"

ALLOWED_GENRES = {"classical", "hiphop"}


def load_playlist(genre: str) -> list[dict]:
    if genre not in ALLOWED_GENRES:
        raise ValueError(f"Unknown genre: {genre}")
    manifest = MUSIC_DIR / genre / "manifest.json"
    if not manifest.exists():
        return []
    tracks = json.loads(manifest.read_text())
    random.shuffle(tracks)
    return tracks
