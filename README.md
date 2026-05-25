# Chewing-Music Study

A web app that measures chewing speed via phone camera while participants listen to AI-generated classical or hip-hop music. See [design spec](docs/superpowers/specs/2026-05-24-chewing-music-study-design.md).

The detection runs entirely in the browser via MediaPipe FaceMesh and a dual-signal peak detector (mouth-open spike → bite event; jaw-drop oscillation → chew). No video leaves the device. Only aggregate stats are uploaded, and only if the participant opts in.

## Requirements

- Python 3.11+ (the venv must use 3.11 or newer — `requires-python = ">=3.11"` in `backend/pyproject.toml`)
- Node 18+ (for vitest)
- `ffmpeg` for the placeholder music helper (`brew install ffmpeg` on macOS); optional, only needed if you don't have real AI music yet
- For real music generation: a CUDA or MPS GPU and the `audiocraft` package

## Quick start

### Backend

```bash
cd backend
python3.11 -m venv .venv          # or: python3 -m venv .venv if your python3 is 3.11+
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

Open `http://localhost:8000/` on the same machine for local testing.

For a phone, browsers require **HTTPS** to access the camera. Two easy paths:

```bash
# Path 1 — ngrok
ngrok http 8000
# then open the https://*.ngrok-free.app URL on your phone

# Path 2 — local mkcert cert
mkcert -install
mkcert localhost YOUR-LAN-IP
uvicorn app.main:app --port 8000 \
  --ssl-keyfile localhost+1-key.pem --ssl-certfile localhost+1.pem
```

### Frontend (tests only)

```bash
cd frontend
npm install
npm test
```

The frontend is no-bundle: HTML + ES modules served as static files. `npm test` only runs vitest unit tests.

### Tune the detector

`/debug.html` visualizes both signals (mouth_open + jaw_drop) and marks detected chew events (red dots) and bite events (green triangles). It accepts URL params to override any detector option live, e.g.:

```
http://localhost:8000/debug.html?k_chew=0.5&warmupMs=0&confirmFrames=3&minChewIntervalMs=175
```

These are the validated defaults; tweak per participant if needed. Active options show at the bottom of the page.

### Music

The repo ships with empty `backend/music/{classical,hiphop}/manifest.json` placeholders. To get audio working you need MP3 files in those folders. Two options:

```bash
# Real AI-generated music (requires GPU + audiocraft)
pip install -r scripts/requirements.txt
python scripts/generate_music.py --genre classical --count 10
python scripts/generate_music.py --genre hiphop --count 10

# Placeholder sine tones for plumbing tests (requires ffmpeg)
cd backend/music/classical
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=30" -ac 1 -b:a 64k cl_01.mp3
# (update manifest.json accordingly)
```

MP3 files are gitignored; manifests are committed.

### Export results to CSV

After participants have uploaded:

```bash
python scripts/export_csv.py
# writes sessions_summary.csv and bites_long.csv to the current directory
```

The DB lives at `backend/data/sessions.db`. The two CSVs cover both wide-format (one session per row) and long-format (one bite per row) for easy pandas/R loading.

## Project layout

```
backend/         FastAPI app + SQLite + tests
  app/           main.py, routes.py, schemas.py, db.py, playlist.py, db_singleton.py
  tests/         pytest suites
  music/         pre-generated mp3s + manifest.json (mp3 gitignored)
  data/          sessions.db (runtime, gitignored)
frontend/        Static HTML/CSS/JS — no bundler
  index.html     SPA entry (consent → setup → recording → results)
  debug.html     Standalone detector tuning view
  js/            detector.js, face_source.js, audio_player.js, api.js, router.js, views/
  tests/         vitest suites
scripts/         Offline tools (music generation, CSV export)
docs/superpowers/specs/  Design spec
docs/superpowers/plans/  Implementation plan (historical)
```
