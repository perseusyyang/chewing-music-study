# Chewing-Music Study

A web app that measures chewing speed via phone camera while participants listen to AI-generated classical or hip-hop music. See [design spec](docs/superpowers/specs/2026-05-24-chewing-music-study-design.md).

## Quick start

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

Open https://YOUR-IP:8000 from your phone (HTTPS required for camera — use ngrok or mkcert for a real cert).

### Frontend dev (tests only)

```bash
cd frontend
npm install
npm test
```

### Generate music (offline, requires GPU)

```bash
python scripts/generate_music.py --genre classical --count 10
python scripts/generate_music.py --genre hiphop --count 10
```

### Export results to CSV

```bash
python scripts/export_csv.py
# writes sessions_summary.csv and bites_long.csv
```
