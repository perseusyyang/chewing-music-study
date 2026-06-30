"""Pydantic models for the session upload payload (dual-signal detector)."""
from typing import Literal, Optional

from pydantic import BaseModel, Field, NonNegativeInt


FoodType = Literal["chinese", "steak", "salad", "sushi", "western", "baozi", "bread", "intervention"]
MusicGenre = Literal["classical", "hiphop", "tempo_slow", "tempo_fast"]


class Bite(BaseModel):
    start_ms: NonNegativeInt
    end_ms: NonNegativeInt
    chew_count: NonNegativeInt


class ClientInfo(BaseModel):
    user_agent: str = ""
    viewport: str = ""
    fps_observed: float = 0.0


class InterventionEvent(BaseModel):
    start_ms: NonNegativeInt
    end_ms: Optional[NonNegativeInt] = None
    target_rate: float


class PlaybackRateSnapshot(BaseModel):
    t_ms: NonNegativeInt
    rate: float


class InterventionConfig(BaseModel):
    windowSec: float = 10
    warmupSec: float = 30
    thresholdFactor: float = 1.5
    minPlaybackRate: float = 0.5
    smoothingFactor: float = 0.12
    interventionDelayMs: float = 2000
    defaultBaselineHz: float = 1.5


class InterventionData(BaseModel):
    baseline_hz: Optional[float] = None
    events: list[InterventionEvent] = []
    playback_rate_snapshots: list[PlaybackRateSnapshot] = []
    config: Optional[InterventionConfig] = None


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
    intervention: Optional[InterventionData] = None
