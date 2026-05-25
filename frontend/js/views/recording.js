import { session } from '../state.js';

let timerInterval = null;
let startMs = null;

export function mountRecording(router) {
  if (!session.food_type || !session.music_genre) {
    router.navigate('/setup');
    return;
  }

  session.session_id = crypto.randomUUID();
  session.started_at = new Date().toISOString();
  startMs = performance.now();

  const timerEl = document.getElementById('timer');
  const stopBtn = document.getElementById('recording-stop');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');

  // Placeholder: green dot, "Detecting…". Real detection is wired in Task 15.
  statusDot.classList.add('green');
  statusText.textContent = 'Detecting…';

  timerInterval = setInterval(() => {
    const elapsed = Math.floor((performance.now() - startMs) / 1000);
    const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const ss = String(elapsed % 60).padStart(2, '0');
    timerEl.textContent = `${mm}:${ss}`;
  }, 250);

  stopBtn.addEventListener('click', () => {
    clearInterval(timerInterval);
    timerInterval = null;
    session.ended_at = new Date().toISOString();
    session.duration_sec = Math.floor((performance.now() - startMs) / 1000);
    router.navigate('/results');
  });
}
