#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then
  echo "Error: .env not found. Copy .env.example to .env and fill in DATABASE_URL." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Error: DATABASE_URL is empty in .env" >&2
  exit 1
fi

VENV="$ROOT/backend/.venv"
if [ ! -d "$VENV" ]; then
  echo "Error: backend venv not found at $VENV" >&2
  echo "Run: cd backend && python3.11 -m venv .venv && source .venv/bin/activate && pip install -e \".[dev]\"" >&2
  exit 1
fi

# shellcheck disable=SC1091
source "$VENV/bin/activate"

python scripts/export_csv.py "$@"
