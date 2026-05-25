/**
 * Single in-memory app state for the current session.
 * Reset by calling resetSession().
 *
 * Why in-memory: session is one-shot from consent through results;
 * no persistence needed across page reloads. A reload starts fresh.
 *
 * Note: 'chew_events_ms' captures the chew event timestamps from the
 * dual-signal detector (jaw_drop peaks). 'bite_events_ms' captures the
 * bite event timestamps (mouth_open peaks). 'bites' is the segmented
 * per-bite summary.
 */
export const session = {
  consented: false,
  food_type: null,
  music_genre: null,
  session_id: null,
  started_at: null,
  ended_at: null,
  duration_sec: 0,
  tracks_played: [],
  stats: null, // filled by detector
  bites: [], // [{start_ms, end_ms, chew_count}]
  chew_events_ms: [], // [t_ms]
  bite_events_ms: [], // [t_ms]
  // Pre-fetched on setup page so recording.js doesn't need to await the network
  // (which would break iOS Safari's user-gesture window before audio.play()).
  playlist: null,
  // Audio element pre-unlocked synchronously inside the Start-button click, so
  // subsequent .play() calls work on iOS Safari without re-entering a gesture.
  audioEl: null,
};

export function resetSession() {
  session.consented = false;
  session.food_type = null;
  session.music_genre = null;
  session.session_id = null;
  session.started_at = null;
  session.ended_at = null;
  session.duration_sec = 0;
  session.tracks_played = [];
  session.stats = null;
  session.bites = [];
  session.chew_events_ms = [];
  session.bite_events_ms = [];
  session.playlist = null;
  session.audioEl = null;
}
