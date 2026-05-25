import pytest
from fastapi.testclient import TestClient


VALID_PAYLOAD = {
    "session_id": "abc-123",
    "started_at": "2026-05-24T18:30:00Z",
    "ended_at": "2026-05-24T18:45:23Z",
    "duration_sec": 923,
    "food_type": "steak",
    "music_genre": "hiphop",
    "tracks_played": ["hh_01", "hh_02"],
    "total_chews": 412,
    "total_bite_events": 30,
    "total_bites": 28,
    "avg_chew_freq_hz": 0.45,
    "avg_chews_per_bite": 14.7,
    "chew_freq_buckets_10s": [0.3, 0.5],
    "bites": [{"start_ms": 100, "end_ms": 5000, "chew_count": 12}],
    "chew_events_ms": [100, 500, 900],
    "bite_events_ms": [50, 6000],
    "client_info": {"user_agent": "x", "viewport": "1x1", "fps_observed": 30.0},
}


@pytest.fixture
def client(tmp_path, monkeypatch):
    from app import db_singleton
    monkeypatch.setattr(db_singleton, "DB_PATH", tmp_path / "test.db")
    db_singleton._db = None  # force re-init
    from app.main import app
    return TestClient(app)


def test_post_valid_session_returns_201(client):
    r = client.post("/api/sessions", json=VALID_PAYLOAD)
    assert r.status_code == 201
    assert r.json()["session_id"] == "abc-123"


def test_post_duplicate_session_is_idempotent(client):
    client.post("/api/sessions", json=VALID_PAYLOAD)
    r = client.post("/api/sessions", json=VALID_PAYLOAD)
    assert r.status_code == 200
    assert r.json()["status"] == "already_uploaded"


def test_post_invalid_food_type_returns_422(client):
    bad = dict(VALID_PAYLOAD, food_type="pasta")
    r = client.post("/api/sessions", json=bad)
    assert r.status_code == 422
