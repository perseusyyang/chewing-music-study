import { Router } from './router.js';
import { session } from './state.js';
import { fetchPlaylist } from './api.js';
import { mountResults } from './views/results.js';
import { mountInterventionRecording } from './views/intervention_recording.js';

const app = document.getElementById('app');

function renderTemplate(id) {
  const tpl = document.getElementById(id);
  app.innerHTML = '';
  app.appendChild(tpl.content.cloneNode(true));
}

// ~0.1s of silent WAV inlined as a data URI — unlocks Audio on iOS Safari
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

/* ---- consent ---- */
function mountConsent(router) {
  const check = document.getElementById('consent-check');
  const btn = document.getElementById('consent-continue');
  check.addEventListener('change', () => {
    session.consented = check.checked;
    btn.disabled = !check.checked;
  });
  btn.addEventListener('click', () => router.navigate('/setup'));
}

/* ---- setup (auto-configured) ---- */
function mountSetup(router) {
  const startBtn = document.getElementById('setup-start');

  // Auto-configure: fixed food type, random slow-tempo track.
  session.food_type = 'intervention';
  session.music_genre = 'tempo_slow';

  // Fetch the slow-tempo playlist and pick one random track.
  fetchPlaylist('tempo_slow')
    .then((data) => {
      const tracks = data.tracks;
      if (tracks.length) {
        const pick = tracks[Math.floor(Math.random() * tracks.length)];
        session.playlist = [pick];
        session.url_prefix = data.url_prefix;
      }
    })
    .catch(() => { /* recording view will retry */ });

  startBtn.addEventListener('click', () => {
    const audio = new Audio();
    audio.src = SILENT_WAV;
    audio.play().catch(() => {});
    session.audioEl = audio;
    router.navigate('/recording');
  });
}

/* ---- router ---- */
const router = new Router(
  {
    '/consent': () => { renderTemplate('view-consent'); mountConsent(router); },
    '/setup': () => { renderTemplate('view-setup'); mountSetup(router); },
    '/recording': () => { renderTemplate('view-recording'); mountInterventionRecording(router); },
    '/results': () => { renderTemplate('view-results'); mountResults(router); },
  },
  '/consent',
);

router.start();
