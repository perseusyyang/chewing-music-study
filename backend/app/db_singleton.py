"""Lazy DB singleton — SQLite locally, PostgreSQL in production via DATABASE_URL."""
import os
from pathlib import Path

from app.db import Database


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = PROJECT_ROOT / "backend" / "data" / "sessions.db"

_db: Database | None = None


def get_db() -> Database:
    global _db
    if _db is None:
        # DATABASE_URL takes precedence — used in production (Render + Neon).
        # Falls back to local SQLite at DB_PATH so dev/tests need no env setup.
        conn: str | Path = os.environ.get("DATABASE_URL") or DB_PATH
        _db = Database(conn)
    return _db
