"""SQLite persistence for session uploads."""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from app.schemas import SessionUpload


SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    uploaded_at TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    duration_sec INTEGER NOT NULL,
    food_type TEXT NOT NULL,
    music_genre TEXT NOT NULL,
    tracks_played_json TEXT NOT NULL,
    total_chews INTEGER NOT NULL,
    total_bite_events INTEGER NOT NULL,
    total_bites INTEGER NOT NULL,
    avg_chew_freq_hz REAL NOT NULL,
    avg_chews_per_bite REAL NOT NULL,
    chew_freq_buckets_json TEXT NOT NULL,
    bites_json TEXT NOT NULL,
    chew_events_json TEXT NOT NULL,
    bite_events_json TEXT NOT NULL,
    client_info_json TEXT NOT NULL
);
"""


class Database:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def insert(self, session: SessionUpload) -> bool:
        try:
            self.conn.execute(
                """
                INSERT INTO sessions (
                    session_id, uploaded_at, started_at, ended_at, duration_sec,
                    food_type, music_genre, tracks_played_json,
                    total_chews, total_bite_events, total_bites,
                    avg_chew_freq_hz, avg_chews_per_bite,
                    chew_freq_buckets_json, bites_json,
                    chew_events_json, bite_events_json, client_info_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session.session_id,
                    datetime.now(timezone.utc).isoformat(),
                    session.started_at,
                    session.ended_at,
                    session.duration_sec,
                    session.food_type,
                    session.music_genre,
                    json.dumps(session.tracks_played),
                    session.total_chews,
                    session.total_bite_events,
                    session.total_bites,
                    session.avg_chew_freq_hz,
                    session.avg_chews_per_bite,
                    json.dumps(session.chew_freq_buckets_10s),
                    json.dumps([b.model_dump() for b in session.bites]),
                    json.dumps(session.chew_events_ms),
                    json.dumps(session.bite_events_ms),
                    json.dumps(session.client_info.model_dump()),
                ),
            )
            self.conn.commit()
            return True
        except sqlite3.IntegrityError:
            return False

    def all(self) -> list[dict]:
        rows = self.conn.execute("SELECT * FROM sessions ORDER BY uploaded_at").fetchall()
        return [dict(r) for r in rows]

    def close(self) -> None:
        self.conn.close()
