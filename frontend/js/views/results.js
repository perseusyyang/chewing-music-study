import { session, resetSession } from '../state.js';
import { uploadSession } from '../api.js';

const FOOD_LABELS = {
  chinese: 'Chinese',
  steak: 'Steak',
  salad: 'Salad / light',
  sushi: 'Sushi',
  western: 'Western',
};
const MUSIC_LABELS = {
  classical: 'Classical',
  hiphop: 'Hip-hop',
};

export function mountResults(router) {
  if (!session.stats) {
    router.navigate('/consent');
    return;
  }

  const cardsEl = document.getElementById('result-cards');
  const s = session.stats;

  const cards = [
    { l: 'Duration', v: formatDuration(session.duration_sec) },
    { l: 'Total chews', v: s.totalChews },
    { l: 'Bite events', v: s.totalBiteEvents },
    { l: 'Total bites', v: s.totalBites },
    { l: 'Avg chews / bite', v: s.avgChewsPerBite.toFixed(1) },
    { l: 'Avg freq', v: `${(s.avgChewFreqHz * 60).toFixed(1)} / min` },
    { l: 'Food', v: FOOD_LABELS[session.food_type] || session.food_type },
    { l: 'Music', v: MUSIC_LABELS[session.music_genre] || session.music_genre },
    { l: 'Tracks played', v: session.tracks_played.length },
  ];
  cardsEl.innerHTML = cards
    .map((c) => `<div class="card"><div class="v">${c.v}</div><div class="l">${c.l}</div></div>`)
    .join('');

  renderFreqChart(s.chewFreqBuckets10s);
  renderBitesChart(session.bites);

  const uploadBtn = document.getElementById('upload-btn');
  const uploadStatus = document.getElementById('upload-status');
  uploadBtn.addEventListener('click', async () => {
    uploadBtn.disabled = true;
    uploadStatus.textContent = 'Uploading…';
    try {
      const payload = buildPayload();
      const result = await uploadSession(payload);
      uploadStatus.textContent =
        result.status === 'already_uploaded'
          ? 'Already uploaded earlier. Thank you!'
          : 'Uploaded — thank you for participating!';
    } catch (e) {
      uploadStatus.textContent = 'Upload failed: ' + e.message;
      uploadBtn.disabled = false;
    }
  });

  const againBtn = document.getElementById('again-btn');
  againBtn.addEventListener('click', () => {
    resetSession();
    router.navigate('/setup');
  });
}

function buildPayload() {
  const s = session.stats;
  return {
    session_id: session.session_id,
    started_at: session.started_at,
    ended_at: session.ended_at,
    duration_sec: session.duration_sec,
    food_type: session.food_type,
    music_genre: session.music_genre,
    tracks_played: session.tracks_played,
    total_chews: s.totalChews,
    total_bite_events: s.totalBiteEvents,
    total_bites: s.totalBites,
    avg_chew_freq_hz: s.avgChewFreqHz,
    avg_chews_per_bite: s.avgChewsPerBite,
    chew_freq_buckets_10s: s.chewFreqBuckets10s,
    bites: session.bites,
    chew_events_ms: session.chew_events_ms.map((t) => Math.round(t)),
    bite_events_ms: session.bite_events_ms.map((t) => Math.round(t)),
    client_info: {
      user_agent: navigator.userAgent,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      fps_observed: 0,
    },
  };
}

function formatDuration(sec) {
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

function renderFreqChart(buckets10s) {
  const ctx = document.getElementById('freq-chart').getContext('2d');
  const labels = buckets10s.map((_, i) => `${i * 10}s`);
  const dataPerMin = buckets10s.map((hz) => hz * 60);
  // eslint-disable-next-line no-undef
  new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{ label: 'Chews / min', data: dataPerMin, borderColor: '#2563eb', tension: 0.2 }],
    },
    options: { responsive: true, scales: { y: { beginAtZero: true } } },
  });
}

function renderBitesChart(bites) {
  const ctx = document.getElementById('bites-chart').getContext('2d');
  // eslint-disable-next-line no-undef
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: bites.map((_, i) => `#${i + 1}`),
      datasets: [{ label: 'Chews', data: bites.map((b) => b.chew_count), backgroundColor: '#16a34a' }],
    },
    options: { responsive: true, scales: { y: { beginAtZero: true } } },
  });
}
