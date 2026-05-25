import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def tmp_music_dir(tmp_path, monkeypatch):
    music_root = tmp_path / "music"
    classical = music_root / "classical"
    hiphop = music_root / "hiphop"
    classical.mkdir(parents=True)
    hiphop.mkdir(parents=True)
    (classical / "cl_01.mp3").write_bytes(b"")
    (classical / "cl_02.mp3").write_bytes(b"")
    (classical / "manifest.json").write_text(json.dumps([
        {"id": "cl_01", "filename": "cl_01.mp3", "title": "Calm 1", "duration_sec": 45},
        {"id": "cl_02", "filename": "cl_02.mp3", "title": "Calm 2", "duration_sec": 50},
    ]))
    (hiphop / "hh_01.mp3").write_bytes(b"")
    (hiphop / "manifest.json").write_text(json.dumps([
        {"id": "hh_01", "filename": "hh_01.mp3", "title": "Beat 1", "duration_sec": 40},
    ]))
    from app import playlist
    monkeypatch.setattr(playlist, "MUSIC_DIR", music_root)
    return music_root


def test_playlist_returns_tracks_from_manifest(tmp_music_dir):
    from app.main import app
    client = TestClient(app)
    r = client.get("/api/playlist?genre=classical")
    assert r.status_code == 200
    data = r.json()
    assert data["genre"] == "classical"
    assert len(data["tracks"]) == 2
    ids = {t["id"] for t in data["tracks"]}
    assert ids == {"cl_01", "cl_02"}


def test_playlist_unknown_genre_returns_400(tmp_music_dir):
    from app.main import app
    client = TestClient(app)
    r = client.get("/api/playlist?genre=jazz")
    assert r.status_code == 400


def test_playlist_missing_manifest_returns_empty(tmp_music_dir, tmp_path):
    # Remove classical manifest
    (tmp_music_dir / "classical" / "manifest.json").unlink()
    from app.main import app
    client = TestClient(app)
    r = client.get("/api/playlist?genre=classical")
    assert r.status_code == 200
    assert r.json()["tracks"] == []
