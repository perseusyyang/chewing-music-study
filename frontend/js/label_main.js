/**
 * Labeling tool: load recorded chewing data, mark chew & bite events
 * by clicking on the waveform, then export labeled data for ML training.
 */

const chartEl = document.getElementById('chart');
const ctx = chartEl.getContext('2d');
const fileInput = document.getElementById('file-input');

// State
let data = null;         // loaded recording
let chewsMs = [];        // [t_ms] labeled chew times
let bitesMs = [];        // [t_ms] labeled bite times
let mode = 'chew';       // 'chew' | 'bite'
let viewStartMs = 0;     // pan offset
let viewWindowMs = 30000; // visible window

// DOM refs
const btnLoad = document.getElementById('btn-load');
const btnExport = document.getElementById('btn-export');
const btnUndo = document.getElementById('btn-undo');
const btnChew = document.getElementById('btn-mode-chew');
const btnBite = document.getElementById('btn-mode-bite');
const fileInfo = document.getElementById('file-info');
const countChew = document.getElementById('count-chew');
const countBite = document.getElementById('count-bite');
const countFrames = document.getElementById('count-frames');
const countDur = document.getElementById('count-dur');

// --- File loading ---
btnLoad.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      data = JSON.parse(reader.result);
      // Load existing labels if present
      chewsMs = (data.labels && data.labels.chews_ms) ? [...data.labels.chews_ms] : [];
      bitesMs = (data.labels && data.labels.bites_ms) ? [...data.labels.bites_ms] : [];
      viewStartMs = 0;
      viewWindowMs = Math.min(30000, data.duration_ms || 30000);
      updateUI();
      fileInfo.textContent = file.name;
      btnExport.disabled = false;
      draw();
    } catch (err) {
      alert('Invalid JSON file: ' + err.message);
    }
  };
  reader.readAsText(file);
});

// --- Mode switching ---
btnChew.addEventListener('click', () => {
  mode = 'chew';
  btnChew.classList.add('active-chew');
  btnBite.classList.remove('active-bite');
});
btnBite.addEventListener('click', () => {
  mode = 'bite';
  btnBite.classList.add('active-bite');
  btnChew.classList.remove('active-chew');
});

// --- Undo ---
btnUndo.addEventListener('click', () => {
  if (mode === 'chew' && chewsMs.length) { chewsMs.pop(); }
  if (mode === 'bite' && bitesMs.length) { bitesMs.pop(); }
  updateUI();
  draw();
});

// --- Export ---
btnExport.addEventListener('click', () => {
  if (!data) return;
  data.labels = {
    chews_ms: chewsMs.slice().sort((a, b) => a - b),
    bites_ms: bitesMs.slice().sort((a, b) => a - b),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'labeled-' + (fileInfo.textContent || 'session.json');
  a.click();
  URL.revokeObjectURL(url);
});

// --- Click on chart ---
chartEl.addEventListener('click', (e) => {
  if (!data) return;
  const rect = chartEl.getBoundingClientRect();
  const scaleX = chartEl.width / rect.width;
  const x = (e.clientX - rect.left) * scaleX;

  const { pad } = getLayout();
  const pw = chartEl.width - pad.left - pad.right;
  const tMin = viewStartMs;
  const tMax = viewStartMs + viewWindowMs;
  const clickedMs = tMin + ((x - pad.left) / pw) * (tMax - tMin);

  if (clickedMs < 0 || clickedMs > data.duration_ms) return;

  // Check if clicking near an existing marker to remove it
  const REMOVE_RADIUS_MS = 300;
  if (mode === 'chew') {
    const idx = chewsMs.findIndex(t => Math.abs(t - clickedMs) < REMOVE_RADIUS_MS);
    if (idx >= 0) { chewsMs.splice(idx, 1); updateUI(); draw(); return; }
    chewsMs.push(Math.round(clickedMs));
  } else {
    const idx = bitesMs.findIndex(t => Math.abs(t - clickedMs) < REMOVE_RADIUS_MS);
    if (idx >= 0) { bitesMs.splice(idx, 1); updateUI(); draw(); return; }
    bitesMs.push(Math.round(clickedMs));
  }
  updateUI();
  draw();
});

// --- Scroll/zoom ---
chartEl.addEventListener('wheel', (e) => {
  if (!data) return;
  e.preventDefault();
  const zoomFactor = e.deltaY > 0 ? 1.3 : 0.7;
  const rect = chartEl.getBoundingClientRect();
  const scaleX = chartEl.width / rect.width;
  const x = (e.clientX - rect.left) * scaleX;
  const { pad } = getLayout();
  const pw = chartEl.width - pad.left - pad.right;
  const tMin = viewStartMs;
  const tMax = viewStartMs + viewWindowMs;
  const mouseMs = tMin + ((x - pad.left) / pw) * (tMax - tMin);

  viewWindowMs = Math.max(2000, Math.min(data.duration_ms, viewWindowMs * zoomFactor));
  viewStartMs = Math.max(0, Math.min(data.duration_ms - viewWindowMs, mouseMs - viewWindowMs * ((x - pad.left) / pw)));
  draw();
});

let dragging = false;
let dragStartX = 0;
let dragStartView = 0;
chartEl.addEventListener('mousedown', (e) => {
  if (e.shiftKey) { dragging = true; dragStartX = e.clientX; dragStartView = viewStartMs; }
});
window.addEventListener('mousemove', (e) => {
  if (!dragging || !data) return;
  const dx = e.clientX - dragStartX;
  const rect = chartEl.getBoundingClientRect();
  const scaleX = chartEl.width / rect.width;
  const { pad } = getLayout();
  const pw = chartEl.width - pad.left - pad.right;
  const msPerPx = viewWindowMs / pw;
  viewStartMs = Math.max(0, Math.min(data.duration_ms - viewWindowMs, dragStartView - dx * scaleX * msPerPx));
  draw();
});
window.addEventListener('mouseup', () => { dragging = false; });

// --- Drawing ---
function getLayout() {
  return {
    pad: { top: 20, right: 15, bottom: 30, left: 50 },
    w: chartEl.width, h: chartEl.height,
  };
}

function draw() {
  if (!data || !data.frames) return;
  const { pad, w, h } = getLayout();
  const pw = w - pad.left - pad.right;
  const ph = h - pad.top - pad.bottom;
  const tMin = viewStartMs;
  const tMax = viewStartMs + viewWindowMs;

  ctx.clearRect(0, 0, w, h);

  const visible = data.frames.filter(s => s.t_ms >= tMin && s.t_ms <= tMax);
  if (visible.length < 2) return;

  function toX(t) { return pad.left + ((t - tMin) / (tMax - tMin)) * pw; }

  let mn = Infinity, mx = -Infinity;
  for (const s of visible) {
    if (s.mouth_open < mn) mn = s.mouth_open;
    if (s.mouth_open > mx) mx = s.mouth_open;
    if (s.jaw_drop < mn) mn = s.jaw_drop;
    if (s.jaw_drop > mx) mx = s.jaw_drop;
  }
  if (mx === mn) { mn -= 0.001; mx += 0.001; }
  const range = mx - mn;
  mn -= range * 0.15; mx += range * 0.15;
  function toY(v) { return pad.top + ph - ((v - mn) / (mx - mn)) * ph; }

  // Grid
  ctx.strokeStyle = '#f5f5f5'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (ph * i) / 4;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
  }
  // Time labels
  ctx.fillStyle = '#999'; ctx.font = '9px monospace';
  for (let s = Math.ceil(tMin / 5000) * 5; s <= tMax; s += 5) {
    const x = toX(s * 1000);
    ctx.fillText(`${s}s`, x, h - pad.bottom + 14);
  }

  // Signals
  function drawSignal(field, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
    let started = false;
    for (const s of visible) {
      const x = toX(s.t_ms), y = toY(s[field]);
      if (!started || s.no_face) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  drawSignal('mouth_open', '#3b82f6');
  drawSignal('jaw_drop', '#f97316');

  // Chew markers (red dots)
  for (const t of chewsMs) {
    if (t < tMin || t > tMax) continue;
    const x = toX(t);
    ctx.fillStyle = '#ef4444'; ctx.beginPath();
    ctx.arc(x, pad.top + ph - 15, 6, 0, Math.PI * 2); ctx.fill();
  }

  // Bite markers (green triangles)
  for (const t of bitesMs) {
    if (t < tMin || t > tMax) continue;
    const x = toX(t);
    ctx.fillStyle = '#16a34a'; ctx.beginPath();
    ctx.moveTo(x, pad.top + 8);
    ctx.lineTo(x - 8, pad.top + ph);
    ctx.lineTo(x + 8, pad.top + ph);
    ctx.closePath(); ctx.fill();
  }
}

function updateUI() {
  countChew.textContent = chewsMs.length;
  countBite.textContent = bitesMs.length;
  countFrames.textContent = data ? data.frame_count : 0;
  countDur.textContent = data ? Math.round(data.duration_ms / 1000) + 's' : '0s';
}
