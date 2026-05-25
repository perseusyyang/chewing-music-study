import { session } from '../state.js';
import { ChewDetector } from '../detector.js';
import { FaceMeshSource } from '../face_source.js';
import { PlaylistPlayer } from '../audio_player.js';
import { fetchPlaylist } from '../api.js';

let timerInterval = null;
let startMs = null;
let detector = null;
let faceSrc = null;
let player = null;
let noFaceTimer = null;

export async function mountRecording(router) {
  if (!session.food_type || !session.music_genre) {
    router.navigate('/setup');
    return;
  }

  const videoEl = document.getElementById('cam');
  const timerEl = document.getElementById('timer');
  const stopBtn = document.getElementById('recording-stop');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const trackTitleEl = document.getElementById('track-title');

  // Fetch playlist first so we don't start the camera before audio is ready
  let playlist;
  try {
    const data = await fetchPlaylist(session.music_genre);
    playlist = data.tracks;
  } catch (e) {
    statusText.textContent = 'Failed to load music: ' + e.message;
    statusDot.classList.add('red');
    return;
  }
  if (!playlist.length) {
    statusText.textContent = 'No music available for this genre.';
    statusDot.classList.add('red');
    return;
  }

  session.session_id = crypto.randomUUID();
  session.started_at = new Date().toISOString();
  startMs = performance.now();
  detector = new ChewDetector();

  statusDot.classList.remove('red');
  statusDot.classList.add('green');
  statusText.textContent = 'Detecting…';

  // Start audio
  const audio = new Audio();
  player = new PlaylistPlayer(audio, playlist, `/music/${session.music_genre}/`, {
    onTrack: (track) => { trackTitleEl.textContent = track.title; },
  });
  player.start();

  // Start camera + dual-signal detection
  faceSrc = new FaceMeshSource(
    videoEl,
    (sample) => {
      const rel = { ...sample, t_ms: sample.t_ms - startMs };
      detector.addSample(rel);

      if (sample.no_face) {
        if (!noFaceTimer) {
          noFaceTimer = setTimeout(() => {
            statusDot.classList.remove('green');
            statusDot.classList.add('red');
            statusText.textContent = 'Face not detected';
          }, 1000);
        }
      } else if (noFaceTimer) {
        clearTimeout(noFaceTimer);
        noFaceTimer = null;
        statusDot.classList.remove('red');
        statusDot.classList.add('green');
        statusText.textContent = 'Detecting…';
      }
    },
    () => performance.now(),
  );

  try {
    await faceSrc.start();
  } catch (e) {
    if (player) player.stop();
    statusText.textContent = 'Camera error: ' + e.message;
    statusDot.classList.remove('green');
    statusDot.classList.add('red');
    return;
  }

  timerInterval = setInterval(() => {
    const elapsed = Math.floor((performance.now() - startMs) / 1000);
    const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const ss = String(elapsed % 60).padStart(2, '0');
    timerEl.textContent = `${mm}:${ss}`;
  }, 250);

  stopBtn.addEventListener('click', () => {
    clearInterval(timerInterval);
    timerInterval = null;
    if (faceSrc) { faceSrc.stop(); faceSrc = null; }
    if (player) { player.stop(); }
    if (noFaceTimer) { clearTimeout(noFaceTimer); noFaceTimer = null; }

    const totalMs = performance.now() - startMs;
    detector.finalize();
    session.ended_at = new Date().toISOString();
    session.duration_sec = Math.round(totalMs / 1000);
    session.stats = detector.getStats(totalMs);
    session.bites = detector.bites.slice();
    session.chew_events_ms = detector.chews.map((c) => c.t_ms);
    session.bite_events_ms = detector.biteEvents.map((e) => e.t_ms);
    session.tracks_played = player ? player.playedIds.slice() : [];

    router.navigate('/results');
  });
}
