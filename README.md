# Chewing-Music Study

A web app that measures chewing speed via phone camera while participants listen to AI-generated classical or hip-hop music. See [design spec](docs/superpowers/specs/2026-05-24-chewing-music-study-design.md).

The detection runs entirely in the browser via MediaPipe FaceMesh and a dual-signal peak detector (mouth-open spike → bite event; jaw-drop oscillation → chew). No video leaves the device. Only aggregate stats are uploaded, and only if the participant opts in.

## Requirements

- Python 3.11+ (the venv must use 3.11 or newer — `requires-python = ">=3.11"` in `backend/pyproject.toml`)
- Node 18+ (for vitest)
- `ffmpeg` for the placeholder music helper (`brew install ffmpeg` on macOS); optional, only needed if you don't have real AI music yet
- For regenerating music: a CUDA or MPS GPU plus `scripts/requirements.txt` (torch + transformers — runs MusicGen). The 20 generated MP3s are committed to the repo so you don't need this just to run the app.

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

The repo ships with 10 classical + 10 hip-hop MP3s already committed under `backend/music/`. They were produced by `scripts/generate_music.py` with the prompts checked into that file. To regenerate (e.g. after tweaking a prompt):

```bash
# Real AI-generated music (requires GPU; MPS on Apple Silicon, CUDA on NVIDIA)
pip install -r scripts/requirements.txt
python scripts/generate_music.py --genre classical --count 10 --duration 30
python scripts/generate_music.py --genre hiphop --count 10 --duration 30

# Or, iterate on just a few tracks while keeping the rest:
python scripts/generate_music.py --genre hiphop --count 5 --only 2,4 --duration 30
```

`--only N1,N2,...` regenerates just those 1-based indices and leaves `manifest.json` untouched so existing approved tracks aren't lost during prompt iteration.

### Export results to CSV

After participants have uploaded:

```bash
python scripts/export_csv.py
# writes sessions_summary.csv and bites_long.csv to the current directory
```

The DB lives at `backend/data/sessions.db`. The two CSVs cover both wide-format (one session per row) and long-format (one bite per row) for easy pandas/R loading.

## Deploy (Render + Neon)

Free-tier deploy: Render hosts the FastAPI app, Neon hosts a persistent Postgres for session uploads. The committed MP3s travel with the repo, so the deploy host doesn't need torch/transformers. Free Render web services sleep after 15 min of inactivity (~30s cold start) and the Neon free tier holds 0.5 GB of data with no time limit — enough for this study.

1. **Create a Neon project** at https://neon.tech, then copy the connection string from the dashboard. It looks like `postgresql://USER:PASS@HOST/DBNAME?sslmode=require`.
2. **Push this repo to GitHub.** No remote is configured yet; create an empty GitHub repo and `git remote add origin <url> && git push -u origin main`.
3. **Create the Render service.** In the Render dashboard pick "New + → Blueprint" and point it at the GitHub repo. Render detects [`render.yaml`](render.yaml) and provisions a free web service named `chewing-music-study` with `pip install -e ./backend` as the build and `uvicorn app.main:app --host 0.0.0.0 --port $PORT` as the start command.
4. **Set `DATABASE_URL`** in the Render service's Environment tab to the Neon string. The app reads it via [`backend/app/db_singleton.py`](backend/app/db_singleton.py) and falls back to local SQLite when the env var is absent, so dev/tests are unaffected.
5. **Open the HTTPS URL** Render assigns (`<service>.onrender.com`). Camera works because the URL is HTTPS. Sessions are written to Neon and survive cold starts.

To pull session data, point [`scripts/export_csv.py`](scripts/export_csv.py) at the Neon connection string (set the same `DATABASE_URL` env var locally and run the script — the SQLite vs Postgres dispatch in `db.py` handles it).

## Project layout

```
backend/         FastAPI app + DB layer + tests
  app/           main.py, routes.py, schemas.py, db.py (SQLite + Postgres),
                 playlist.py, db_singleton.py
  tests/         pytest suites
  music/         20 generated mp3s + manifest.json (mp3s committed)
  data/          sessions.db (local-only, gitignored)
frontend/        Static HTML/CSS/JS — no bundler
  index.html     SPA entry (consent → setup → recording → results)
  debug.html     Standalone detector tuning view
  js/            detector.js, face_source.js, audio_player.js, api.js, router.js, views/
  tests/         vitest suites
scripts/         Offline tools (music generation, CSV export)
render.yaml      Render free-tier deploy blueprint
docs/superpowers/specs/  Design spec
docs/superpowers/plans/  Implementation plan (historical)
```
