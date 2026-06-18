import { session } from '../state.js';
import { fetchPlaylist } from '../api.js';

// ~0.1s of silent WAV inlined as a data URI. Playing this on the Start click
// unlocks the AudioElement on iOS Safari so the recording view can swap in
// real music without re-entering a user gesture.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

export function mountSetup(router) {
  const startBtn = document.getElementById('setup-start');
  const foodChoices = document.getElementById('food-choices');
  const musicChoices = document.getElementById('music-choices');

  function checkReady() {
    startBtn.disabled = !(session.food_type && session.music_genre);
  }

  foodChoices.addEventListener('change', (e) => {
    if (e.target.name === 'food') {
      session.food_type = e.target.value;
      checkReady();
    }
  });
  musicChoices.addEventListener('change', (e) => {
    if (e.target.name === 'music') {
      session.music_genre = e.target.value;
      checkReady();
      // Pre-fetch playlist so recording.js doesn't need to await it.
      fetchPlaylist(session.music_genre)
        .then((data) => { session.playlist = data.tracks; session.url_prefix = data.url_prefix; })
        .catch(() => { /* recording.js will retry */ });
    }
  });

  startBtn.addEventListener('click', () => {
    // Unlock the Audio element inside the user gesture. Both ops are synchronous
    // up to the play() call; the play promise can resolve/reject async without
    // affecting the unlock.
    const audio = new Audio();
    audio.src = SILENT_WAV;
    audio.play().catch(() => { /* a rejected play() still spends the gesture, which is fine */ });
    session.audioEl = audio;

    router.navigate('/recording');
  });
}
