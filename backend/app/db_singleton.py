"""Lazy SQLite singleton so the FastAPI app uses one connection per process."""
from pathlib import Path

from app.db import Database


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = PROJECT_ROOT / "backend" / "data" / "sessions.db"

_db: Database | None = None


def get_db() -> Database:
    global _db
    if _db is None:
        _db = Database(DB_PATH)
    return _db
