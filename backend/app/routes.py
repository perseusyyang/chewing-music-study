from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from app import db_singleton, playlist
from app.schemas import SessionUpload

router = APIRouter()


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/playlist")
def get_playlist(genre: str):
    try:
        tracks = playlist.load_playlist(genre)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"genre": genre, "tracks": tracks}


@router.post("/sessions")
def post_session(session: SessionUpload):
    db = db_singleton.get_db()
    inserted = db.insert(session)
    if not inserted:
        return JSONResponse(
            status_code=200,
            content={"session_id": session.session_id, "status": "already_uploaded"},
        )
    return JSONResponse(
        status_code=201,
        content={"session_id": session.session_id, "status": "stored"},
    )
