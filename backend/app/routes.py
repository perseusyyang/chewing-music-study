from fastapi import APIRouter, HTTPException

from app import playlist

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
