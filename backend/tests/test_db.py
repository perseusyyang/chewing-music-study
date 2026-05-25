import json

import pytest

from app.db import Database
from app.schemas import SessionUpload


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
def db(tmp_path):
    return Database(tmp_path / "test.db")


def test_insert_and_fetch_one(db):
    session = SessionUpload(**VALID_PAYLOAD)
    db.insert(session)
    rows = db.all()
    assert len(rows) == 1
    row = rows[0]
    assert row["session_id"] == "abc-123"
    assert row["food_type"] == "steak"
    assert json.loads(row["bites_json"])[0]["chew_count"] == 12
    assert json.loads(row["bite_events_json"]) == [50, 6000]
    assert row["total_bite_events"] == 30


def test_duplicate_session_id_is_ignored(db):
    session = SessionUpload(**VALID_PAYLOAD)
    db.insert(session)
    assert db.insert(session) is False
    assert len(db.all()) == 1


def test_db_persists_across_instances(tmp_path):
    path = tmp_path / "x.db"
    db1 = Database(path)
    db1.insert(SessionUpload(**VALID_PAYLOAD))
    db1.close()
    db2 = Database(path)
    assert len(db2.all()) == 1
