"""Export sessions from SQLite or PostgreSQL into two CSVs for analysis.

Outputs to the current working directory:
- sessions_summary.csv: one row per session, with aggregate fields
- bites_long.csv: one row per bite (long format), suitable for pandas / R

Usage:
    # Local SQLite (default path)
    python scripts/export_csv.py

    # Explicit SQLite path
    python scripts/export_csv.py --db backend/data/sessions.db --out-dir ./

    # Production Postgres (Neon) — via flag or DATABASE_URL env var
    python scripts/export_csv.py --db postgresql://user:pass@host/db
    DATABASE_URL=postgresql://... python scripts/export_csv.py
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sqlite3
from pathlib import Path
from typing import Iterator


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = PROJECT_ROOT / "backend" / "data" / "sessions.db"


SUMMARY_COLUMNS = [
    "session_id", "uploaded_at", "started_at", "ended_at", "duration_sec",
    "food_type", "music_genre", "tracks_played",
    "total_chews", "total_bite_events", "total_bites",
    "avg_chew_freq_hz", "avg_chews_per_bite",
]


def _iter_rows(conn_arg: str | Path) -> Iterator[dict]:
    """Yield session rows as dicts; dispatch on Postgres URL vs filesystem path."""
    s = str(conn_arg)
    if s.startswith(("postgres://", "postgresql://")):
        import psycopg2
        import psycopg2.extras

        if s.startswith("postgres://"):
            s = s.replace("postgres://", "postgresql://", 1)
        conn = psycopg2.connect(s)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("SELECT * FROM sessions ORDER BY uploaded_at")
                for row in cur:
                    yield dict(row)
        finally:
            conn.close()
    else:
        conn = sqlite3.connect(conn_arg)
        conn.row_factory = sqlite3.Row
        try:
            for row in conn.execute("SELECT * FROM sessions ORDER BY uploaded_at"):
                yield dict(row)
        finally:
            conn.close()


def export(conn_arg: str | Path, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    summary_path = out_dir / "sessions_summary.csv"
    bites_path = out_dir / "bites_long.csv"

    with summary_path.open("w", newline="") as sf, bites_path.open("w", newline="") as bf:
        s_writer = csv.writer(sf)
        s_writer.writerow(SUMMARY_COLUMNS)
        b_writer = csv.writer(bf)
        b_writer.writerow([
            "session_id", "food_type", "music_genre", "bite_index",
            "start_ms", "end_ms", "chew_count",
        ])

        for row in _iter_rows(conn_arg):
            tracks_played = json.loads(row["tracks_played_json"])
            s_writer.writerow([
                row["session_id"], row["uploaded_at"], row["started_at"], row["ended_at"],
                row["duration_sec"], row["food_type"], row["music_genre"],
                ";".join(tracks_played),
                row["total_chews"], row["total_bite_events"], row["total_bites"],
                row["avg_chew_freq_hz"], row["avg_chews_per_bite"],
            ])
            bites = json.loads(row["bites_json"])
            for i, b in enumerate(bites):
                b_writer.writerow([
                    row["session_id"], row["food_type"], row["music_genre"], i,
                    b["start_ms"], b["end_ms"], b["chew_count"],
                ])

    print(f"Wrote {summary_path}")
    print(f"Wrote {bites_path}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--db",
        default=os.environ.get("DATABASE_URL"),
        help="SQLite filesystem path or PostgreSQL URL. "
             "Defaults to $DATABASE_URL if set, otherwise local SQLite.",
    )
    parser.add_argument("--out-dir", type=Path, default=Path("."))
    args = parser.parse_args()

    conn_arg: str | Path = args.db or DEFAULT_DB
    if not str(conn_arg).startswith(("postgres://", "postgresql://")):
        path = Path(conn_arg)
        if not path.exists():
            raise SystemExit(f"DB not found: {path}")
        conn_arg = path

    export(conn_arg, args.out_dir)


if __name__ == "__main__":
    main()
