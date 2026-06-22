import { ChewDetector } from './detector.js';
import { FaceMeshSource } from './face_source.js';

// --- Parameter handling ---
const defaults = {
  minChewProminence: 0.003,
  minBiteProminence: 0.008,
  minChewIntervalMs: 175,
  minBiteEventIntervalMs: 1000,
  biteEndPauseMs: 3000,
  minBiteChews: 1,
  warmupMs: 0,
};

function getParams() {
  const p = {};
  for (const [k, dv] of Object.entries(defaults)) {
    const el = document.getElementById('t-' + k);
    p[k] = el ? Number(el.value) : dv;
  }
  return p;
}

function setParams(params) {
  for (const [k, v] of Object.entries(params)) {
    const el = document.getElementById('t-' + k);
    if (el) el.value = v;
  }
}

(() => {
  const urlParams = new URLSearchParams(window.location.search);
  const fromUrl = {};
  for (const k of Object.keys(defaults)) {
    const v = urlParams.get(k);
    if (v !== null && !Number.isNaN(Number(v))) fromUrl[k] = Number(v);
  }
  if (Object.keys(fromUrl).length) setParams(fromUrl);
})();

// --- DOM ---
const videoEl = document.getElementById('cam');
const moEl = document.getElementById('mo');
const jdEl = document.getElementById('jd');
const chewsEl = document.getElementById('chews');
const bitesEl = document.getElementById('bites');
const sessionsEl = document.getElementById('sessions');
const nfEl = document.getElementById('nf');
const applyBtn = document.getElementById('apply-btn');

const chartEl = document.getElementById('chart-main');
const ctx = chartEl.getContext('2d');

// --- State ---
const t0 = performance.now();
let detector = new ChewDetector(getParams());
const history = [];
const HISTORY_MS = 30000;

// --- Rendering ---
function draw() {
  const tNow = performance.now() - t0;
  const tMin = Math.max(0, tNow - HISTORY_MS);
  const tMax = tNow + 1000;
  const visible = history.filter((s) => s.t_ms >= tMin);
  if (visible.length < 2) return;

  const w = chartEl.width;
  const h = chartEl.height;

  ctx.clearRect(0, 0, w, h);

  const pad = { top: 25, right: 20, bottom: 30, left: 55 };
  const pw = w - pad.left - pad.right;
  const ph = h - pad.top - pad.bottom;

  function toX(t) { return pad.left + ((t - tMin) / (tMax - tMin)) * pw; }

  let mn = Infinity, mx = -Infinity;
  for (const s of visible) {
    if (s.mouth_open < mn) mn = s.mouth_open;
    if (s.mouth_open > mx) mx = s.mouth_open;
  }
  if (mx === mn) { mn -= 0.001; mx += 0.001; }
  const range = mx - mn;
  mn -= range * 0.1;
  mx += range * 0.1;

  function toY(v) { return pad.top + ph - ((v - mn) / (mx - mn)) * ph; }

  // Bite session shading
  for (const b of detector.bites) {
    if (b.end_ms < tMin || b.start_ms > tMax) continue;
    const x1 = Math.max(pad.left, toX(Math.max(b.start_ms, tMin)));
    const x2 = Math.min(w - pad.right, toX(Math.min(b.end_ms, tMax)));
    ctx.fillStyle = 'rgba(22,163,74,0.08)';
    ctx.fillRect(x1, pad.top, x2 - x1, ph);
    ctx.fillStyle = 'rgba(22,163,74,0.5)';
    ctx.font = '10px system-ui';
    ctx.fillText(`${b.chew_count}c`, x1 + 2, pad.top + 10);
  }

  // Grid lines
  ctx.strokeStyle = '#f0f0f0';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (ph * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    const val = mx - ((mx - mn) * i) / 4;
    ctx.fillStyle = '#999';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(val.toFixed(4), pad.left - 4, y + 3);
  }
  ctx.textAlign = 'start';

  // Time axis
  ctx.fillStyle = '#999';
  ctx.font = '9px monospace';
  for (let s = Math.ceil(tMin / 5000) * 5; s <= tMax; s += 5) {
    const x = toX(s * 1000);
    ctx.fillText(`${s}s`, x, h - pad.bottom + 14);
  }

  // Signal line
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let started = false;
  for (const s of visible) {
    const x = toX(s.t_ms);
    const y = toY(s.mouth_open);
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Chew events (red dots) — small waves
  for (const ev of detector.chews) {
    if (ev.t_ms < tMin || ev.t_ms > tMax) continue;
    const x = toX(ev.t_ms);
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(x, pad.top + ph - 8, 4, 0, Math.PI * 2);
    ctx.fill();
    if (ev.prominence !== undefined) {
      ctx.fillStyle = '#ef4444';
      ctx.font = '8px monospace';
      ctx.fillText(ev.prominence.toFixed(4), x + 6, pad.top + ph - 4);
    }
  }

  // Bite events (green triangles) — large waves
  for (const ev of detector.biteEvents) {
    if (ev.t_ms < tMin || ev.t_ms > tMax) continue;
    const x = toX(ev.t_ms);
    ctx.fillStyle = '#16a34a';
    ctx.beginPath();
    ctx.moveTo(x, pad.top + 6);
    ctx.lineTo(x - 8, pad.top + 18);
    ctx.lineTo(x + 8, pad.top + 18);
    ctx.closePath();
    ctx.fill();
    if (ev.prominence !== undefined) {
      ctx.fillStyle = '#16a34a';
      ctx.font = '9px monospace';
      ctx.fillText(ev.prominence.toFixed(4), x + 8, pad.top + 16);
    }
  }
}

function loop() {
  draw();
  requestAnimationFrame(loop);
}

// --- FaceMesh ---
const src = new FaceMeshSource(videoEl, (sample) => {
  const rel = { ...sample, t_ms: sample.t_ms - t0 };
  detector.addSample(rel);
  history.push(rel);
  while (history.length && history[0].t_ms < rel.t_ms - HISTORY_MS) history.shift();

  moEl.textContent = sample.mouth_open.toFixed(4);
  jdEl.textContent = sample.jaw_drop.toFixed(4);
  chewsEl.textContent = detector.chews.length;
  bitesEl.textContent = detector.biteEvents.length;
  sessionsEl.textContent = detector.bites.length;
  nfEl.textContent = sample.no_face ? '⚠️ YES' : 'no';
  nfEl.style.color = sample.no_face ? 'var(--red)' : '';
}, () => performance.now());

// --- Apply button ---
applyBtn.addEventListener('click', () => {
  src.stop();
  detector = new ChewDetector(getParams());
  history.length = 0;
  (async () => { await src.start(); })();
});

// --- Start ---
(async () => {
  await src.start();
  loop();
})();
