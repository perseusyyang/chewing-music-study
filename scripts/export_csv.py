"""Export sessions from SQLite into two CSVs for analysis.

Outputs to the current working directory:
- sessions_summary.csv: one row per session, with aggregate fields
- bites_long.csv: one row per bite (long format), suitable for pandas / R

Usage:
    python scripts/export_csv.py
    python scripts/export_csv.py --db backend/data/sessions.db --out-dir ./
"""
from __future__ import annotations

import argparse
import csv
import json
import sqlite3
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = PROJECT_ROOT / "backend" / "data" / "sessions.db"


SUMMARY_COLUMNS = [
    "session_id", "uploaded_at", "started_at", "ended_at", "duration_sec",
    "food_type", "music_genre", "tracks_played",
    "total_chews", "total_bite_events", "total_bites",
    "avg_chew_freq_hz", "avg_chews_per_bite",
]


def export(db_path: Path, out_dir: Path) -> None:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
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

        for row in conn.execute("SELECT * FROM sessions ORDER BY uploaded_at"):
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
    conn.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--out-dir", type=Path, default=Path("."))
    args = parser.parse_args()
    if not args.db.exists():
        raise SystemExit(f"DB not found: {args.db}")
    export(args.db, args.out_dir)


if __name__ == "__main__":
    main()
