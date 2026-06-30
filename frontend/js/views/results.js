import { session, resetSession } from '../state.js';
import { uploadSession } from '../api.js';

const FOOD_LABELS = {
  chinese: 'Chinese',
  steak: 'Steak',
  salad: 'Salad / light',
  sushi: 'Sushi',
  western: 'Western',
  baozi: 'Chinese bun (包子)',
  bread: 'Western bread (面包)',
  intervention: 'Intervention study',
};
const MUSIC_LABELS = {
  classical: 'Classical',
  hiphop: 'Hip-hop',
  tempo_slow: 'Slow (85 BPM)',
  tempo_fast: 'Fast (145 BPM)',
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

  // ---- intervention-specific results ----
  if (session.intervention_baseline_hz != null) {
    const intvSummary = document.getElementById('intervention-summary');
    const intvCards = document.getElementById('intv-cards');
    if (intvSummary && intvCards) {
      intvSummary.classList.remove('hidden');

      const totalIntvTime = (session.intervention_events || [])
        .reduce((sum, e) => sum + ((e.end_ms || session.duration_sec * 1000) - e.start_ms), 0);
      const intvCount = (session.intervention_events || []).length;

      const intvStatCards = [
        { l: 'Baseline', v: (session.intervention_baseline_hz * 60).toFixed(1) + ' / min' },
        { l: 'Interventions', v: intvCount },
        { l: 'Total intervention time', v: formatMs(totalIntvTime) },
        { l: 'Min playback rate', v: minPlaybackRate(session.playback_rate_snapshots).toFixed(2) + '×' },
      ];
      intvCards.innerHTML = intvStatCards
        .map((c) => `<div class="card"><div class="v">${c.v}</div><div class="l">${c.l}</div></div>`)
        .join('');

      renderPlaybackChart(session.playback_rate_snapshots || []);
    }
  }

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

  const homeBtn = document.getElementById('home-btn');
  if (homeBtn) {
    homeBtn.addEventListener('click', () => {
      resetSession();
      window.location.href = '/';
    });
  }
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
    bites: session.bites.map((b) => ({
      start_ms: Math.round(b.start_ms),
      end_ms: Math.round(b.end_ms),
      chew_count: b.chew_count,
    })),
    chew_events_ms: session.chew_events_ms.map((t) => Math.round(t)),
    bite_events_ms: session.bite_events_ms.map((t) => Math.round(t)),
    client_info: {
      user_agent: navigator.userAgent,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      fps_observed: 0,
    },
    // Intervention data (null for non-intervention studies)
    intervention: session.intervention_baseline_hz != null ? {
      baseline_hz: session.intervention_baseline_hz,
      events: session.intervention_events,
      playback_rate_snapshots: session.playback_rate_snapshots,
      config: session.intervention_config,
    } : null,
  };
}

function formatDuration(sec) {
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

function formatMs(ms) {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return totalSec + 's';
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s}s`;
}

function minPlaybackRate(snapshots) {
  if (!snapshots || snapshots.length === 0) return 1.0;
  return snapshots.reduce((min, p) => Math.min(min, p.rate), 1.0);
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

function renderPlaybackChart(snapshots) {
  const canvas = document.getElementById('playback-chart');
  if (!canvas || !snapshots.length) return;
  const ctx = canvas.getContext('2d');
  // eslint-disable-next-line no-undef
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: snapshots.map((p) => formatMs(p.t_ms)),
      datasets: [{
        label: 'Playback rate',
        data: snapshots.map((p) => p.rate),
        borderColor: '#dc2626',
        backgroundColor: 'rgba(220,38,38,0.08)',
        fill: true,
        tension: 0.3,
      }],
    },
    options: {
      responsive: true,
      scales: {
        y: { min: 0.4, max: 1.1, ticks: { callback: (v) => v.toFixed(1) + '×' } },
      },
    },
  });
}
