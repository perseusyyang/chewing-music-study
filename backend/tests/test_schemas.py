import pytest
from pydantic import ValidationError

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
    "chew_freq_buckets_10s": [0.3, 0.5, 0.6],
    "bites": [
        {"start_ms": 4200, "end_ms": 13500, "chew_count": 18},
    ],
    "chew_events_ms": [4250, 4710, 5180],
    "bite_events_ms": [4100, 21000],
    "client_info": {"user_agent": "Mozilla", "viewport": "390x844", "fps_observed": 28.5},
}


def test_valid_payload_parses():
    s = SessionUpload(**VALID_PAYLOAD)
    assert s.session_id == "abc-123"
    assert s.bites[0].chew_count == 18
    assert s.total_bite_events == 30
    assert s.bite_events_ms == [4100, 21000]


def test_unknown_food_type_rejected():
    payload = dict(VALID_PAYLOAD, food_type="pasta")
    with pytest.raises(ValidationError):
        SessionUpload(**payload)


def test_unknown_music_genre_rejected():
    payload = dict(VALID_PAYLOAD, music_genre="jazz")
    with pytest.raises(ValidationError):
        SessionUpload(**payload)


def test_negative_duration_rejected():
    payload = dict(VALID_PAYLOAD, duration_sec=-1)
    with pytest.raises(ValidationError):
        SessionUpload(**payload)
