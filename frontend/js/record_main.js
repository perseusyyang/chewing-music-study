/**
 * Recording tool: captures face landmark data during a chewing session
 * and exports as JSON for later labeling.
 */
import { FaceMeshSource } from './face_source.js';

const videoEl = document.getElementById('cam');
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const statusEl = document.getElementById('status');
const moEl = document.getElementById('mo');
const jdEl = document.getElementById('jd');
const framesEl = document.getElementById('frames');
const chartEl = document.getElementById('chart');
const ctx = chartEl.getContext('2d');

let src = null;
let recording = false;
let startTime = 0;
const frames = []; // [{t_ms, mouth_open, jaw_drop, landmarks}]
const history = []; // for live chart (same data, trimmed)
const HISTORY_MS = 20000;

function draw() {
  const w = chartEl.width, h = chartEl.height;
  ctx.clearRect(0, 0, w, h);
  if (history.length < 2) return;

  const tNow = performance.now() - startTime;
  const tMin = Math.max(0, tNow - HISTORY_MS);

  const pad = { top: 20, right: 20, bottom: 25, left: 45 };
  const pw = w - pad.left - pad.right;
  const ph = h - pad.top - pad.bottom;

  function toX(t) { return pad.left + ((t - tMin) / HISTORY_MS) * pw; }

  let mn = Infinity, mx = -Infinity;
  for (const s of history) {
    if (s.mouth_open < mn) mn = s.mouth_open;
    if (s.mouth_open > mx) mx = s.mouth_open;
    if (s.jaw_drop < mn) mn = s.jaw_drop;
    if (s.jaw_drop > mx) mx = s.jaw_drop;
  }
  if (mx === mn) { mn -= 0.001; mx += 0.001; }
  const range = mx - mn;
  mn -= range * 0.1; mx += range * 0.1;
  function toY(v) { return pad.top + ph - ((v - mn) / (mx - mn)) * ph; }

  // Grid
  ctx.strokeStyle = '#f0f0f0';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (ph * i) / 4;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
    ctx.fillStyle = '#999'; ctx.font = '9px monospace'; ctx.textAlign = 'right';
    ctx.fillText((mx - ((mx - mn) * i) / 4).toFixed(4), pad.left - 4, y + 3);
  }
  ctx.textAlign = 'start';

  // mouth_open (blue)
  ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1.5; ctx.beginPath();
  let started = false;
  for (const s of history) {
    const x = toX(s.t_ms), y = toY(s.mouth_open);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // jaw_drop (orange)
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 1.5; ctx.beginPath();
  started = false;
  for (const s of history) {
    const x = toX(s.t_ms), y = toY(s.jaw_drop);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function loop() {
  if (recording) draw();
  requestAnimationFrame(loop);
}

async function startRecording() {
  frames.length = 0;
  history.length = 0;
  startTime = performance.now();
  recording = true;

  btnStart.disabled = true;
  btnStop.disabled = false;
  statusEl.textContent = '🔴 Recording… chew naturally!';

  src = new FaceMeshSource(videoEl, (sample) => {
    if (!recording) return;
    const t = sample.t_ms - startTime;
    const frame = {
      t_ms: Math.round(t * 100) / 100,
      mouth_open: sample.mouth_open,
      jaw_drop: sample.jaw_drop,
      no_face: sample.no_face,
    };
    frames.push(frame);
    history.push({ ...frame, t_ms: t });
    while (history.length && history[0].t_ms < t - HISTORY_MS) history.shift();

    moEl.textContent = sample.mouth_open.toFixed(4);
    jdEl.textContent = sample.jaw_drop.toFixed(4);
    framesEl.textContent = frames.length;
  }, () => performance.now());

  await src.start();
}

function stopRecording() {
  recording = false;
  if (src) { src.stop(); src = null; }

  btnStart.disabled = false;
  btnStop.disabled = true;
  statusEl.textContent = `✅ Recorded ${frames.length} frames. Downloading JSON…`;

  // Build export
  const exportData = {
    version: 1,
    recorded_at: new Date().toISOString(),
    duration_ms: frames.length ? frames[frames.length - 1].t_ms : 0,
    frame_count: frames.length,
    fps_approx: frames.length > 1
      ? Math.round(frames.length / (frames[frames.length - 1].t_ms / 1000))
      : 0,
    frames,
    // Placeholder for labels (to be filled by labeling tool)
    labels: { chews_ms: [], bites_ms: [] },
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href = url;
  a.download = `chewing-session-${ts}.json`;
  a.click();
  URL.revokeObjectURL(url);

  statusEl.textContent = `✅ Downloaded! ${frames.length} frames saved. You can record another session.`;
}

btnStart.addEventListener('click', startRecording);
btnStop.addEventListener('click', stopRecording);

loop();
