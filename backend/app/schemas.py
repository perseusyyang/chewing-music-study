"""Pydantic models for the session upload payload (dual-signal detector)."""
from typing import Literal

from pydantic import BaseModel, Field, NonNegativeInt


FoodType = Literal["chinese", "steak", "salad", "sushi", "western"]
MusicGenre = Literal["classical", "hiphop"]


class Bite(BaseModel):
    start_ms: NonNegativeInt
    end_ms: NonNegativeInt
    chew_count: NonNegativeInt


class ClientInfo(BaseModel):
    user_agent: str = ""
    viewport: str = ""
    fps_observed: float = 0.0


class SessionUpload(BaseModel):
    session_id: str = Field(min_length=1)
    started_at: str
    ended_at: str
    duration_sec: NonNegativeInt
    food_type: FoodType
    music_genre: MusicGenre
    tracks_played: list[str] = []
    total_chews: NonNegativeInt
    total_bite_events: NonNegativeInt
    total_bites: NonNegativeInt
    avg_chew_freq_hz: float = Field(ge=0)
    avg_chews_per_bite: float = Field(ge=0)
    chew_freq_buckets_10s: list[float] = []
    bites: list[Bite] = []
    chew_events_ms: list[NonNegativeInt] = []
    bite_events_ms: list[NonNegativeInt] = []
    client_info: ClientInfo = ClientInfo()
