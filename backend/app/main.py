from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.routes import router

PROJECT_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = PROJECT_ROOT / "frontend"
MUSIC_DIR = PROJECT_ROOT / "backend" / "music"

app = FastAPI(title="Chewing-Music Study")
app.include_router(router, prefix="/api")
app.mount("/music", StaticFiles(directory=MUSIC_DIR), name="music")
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
