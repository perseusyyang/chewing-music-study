"""Persistence for session uploads — SQLite locally, PostgreSQL in production.

The same `Database` class handles both backends. Pass a filesystem path (or
anything that doesn't start with `postgres://` / `postgresql://`) to get
SQLite; pass a Postgres connection string to get PostgreSQL via psycopg2.

Tests construct `Database(tmp_path / "test.db")` and stay on SQLite; the
production deploy reads `DATABASE_URL` from the environment and gets PG.
"""
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

INSERT_COLUMNS = (
    "session_id, uploaded_at, started_at, ended_at, duration_sec, "
    "food_type, music_genre, tracks_played_json, "
    "total_chews, total_bite_events, total_bites, "
    "avg_chew_freq_hz, avg_chews_per_bite, "
    "chew_freq_buckets_json, bites_json, "
    "chew_events_json, bite_events_json, client_info_json"
)
_N_COLS = 18


def _session_to_row(session: SessionUpload) -> tuple:
    return (
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
    )


class Database:
    def __init__(self, conn: str | Path):
        s = str(conn)
        if s.startswith(("postgres://", "postgresql://")):
            self._init_postgres(s)
        else:
            self._init_sqlite(Path(s))

    def _init_sqlite(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.kind = "sqlite"
        self.conn = sqlite3.connect(path)
        self.conn.row_factory = sqlite3.Row
        self.placeholder = "?"
        self._integrity_error: type[BaseException] = sqlite3.IntegrityError
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def _init_postgres(self, url: str) -> None:
        import psycopg2

        # Render/Heroku-style "postgres://" needs to become "postgresql://"
        # for some psycopg2 versions and to satisfy SQLAlchemy-compatible tools.
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql://", 1)
        self.kind = "pg"
        self.conn = psycopg2.connect(url)
        self.placeholder = "%s"
        self._integrity_error = psycopg2.IntegrityError
        with self.conn.cursor() as cur:
            cur.execute(SCHEMA)
        self.conn.commit()

    def insert(self, session: SessionUpload) -> bool:
        placeholders = ", ".join([self.placeholder] * _N_COLS)
        sql = f"INSERT INTO sessions ({INSERT_COLUMNS}) VALUES ({placeholders})"
        try:
            with self.conn:
                cur = self.conn.cursor()
                cur.execute(sql, _session_to_row(session))
                cur.close()
            return True
        except self._integrity_error:
            return False

    def all(self) -> list[dict]:
        if self.kind == "sqlite":
            rows = self.conn.execute(
                "SELECT * FROM sessions ORDER BY uploaded_at"
            ).fetchall()
            return [dict(r) for r in rows]
        import psycopg2.extras

        with self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM sessions ORDER BY uploaded_at")
            return [dict(r) for r in cur.fetchall()]

    def close(self) -> None:
        self.conn.close()
