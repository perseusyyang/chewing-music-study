import { session } from '../state.js';

// ~0.1s of silent WAV inlined as a data URI. Playing this on the Start click
// unlocks the AudioElement on iOS Safari so the recording view can swap in
// real music without re-entering a user gesture.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

export function mountSetup(router) {
  const startBtn = document.getElementById('setup-start');
  const foodChoices = document.getElementById('food-choices');

  function checkReady() {
    startBtn.disabled = !session.food_type;
  }

  foodChoices.addEventListener('change', (e) => {
    if (e.target.name === 'food') {
      session.food_type = e.target.value;
      checkReady();
    }
  });

  startBtn.addEventListener('click', () => {
    // Randomly assign tempo group: slow (85 BPM) or fast (145 BPM)
    const groups = ['tempo_slow', 'tempo_fast'];
    session.tempo_group = groups[Math.floor(Math.random() * groups.length)];
    session.music_genre = session.tempo_group; // reuse music_genre for compatibility

    // Unlock the Audio element inside the user gesture.
    const audio = new Audio();
    audio.src = SILENT_WAV;
    audio.play().catch(() => { /* a rejected play() still spends the gesture */ });
    session.audioEl = audio;

    router.navigate('/recording');
  });
}
