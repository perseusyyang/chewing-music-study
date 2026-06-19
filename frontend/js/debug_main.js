import { ChewDetector } from './detector.js';
import { FaceMeshSource } from './face_source.js';

// --- Parameter handling ---
const defaults = {
  k_chew: 0.5, k_bite: 3.0,
  minChewIntervalMs: 175, minBiteEventIntervalMs: 1000,
  biteEndPauseMs: 3000, minBiteChews: 1, warmupMs: 0,
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

// Also read from URL params on load
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

const chartBite = document.getElementById('chart-bite');
const chartChew = document.getElementById('chart-chew');
const ctxBite = chartBite.getContext('2d');
const ctxChew = chartChew.getContext('2d');

// --- State ---
const t0 = performance.now();
let detector = new ChewDetector(getParams());
const history = []; // {t_ms, mouth_open, jaw_drop, no_face}
const HISTORY_MS = 30000;

// --- Compute current thresholds (mirrors detector._detectPeak logic) ---
function computeThresholds() {
  const valid = history.filter((s) => !s.no_face);
  if (valid.length < 10) return { chewThresh: 0, biteThresh: 0, meanMO: 0, stdMO: 0, meanJD: 0, stdJD: 0 };

  const meanMO = valid.reduce((a, s) => a + s.mouth_open, 0) / valid.length;
  const varMO = valid.reduce((a, s) => a + (s.mouth_open - meanMO) ** 2, 0) / valid.length;
  const stdMO = Math.sqrt(varMO);

  const meanJD = valid.reduce((a, s) => a + s.jaw_drop, 0) / valid.length;
  const varJD = valid.reduce((a, s) => a + (s.jaw_drop - meanJD) ** 2, 0) / valid.length;
  const stdJD = Math.sqrt(varJD);

  const p = getParams();
  return {
    chewThresh: meanJD + p.k_chew * stdJD,
    biteThresh: meanMO + p.k_bite * stdMO,
    meanMO, stdMO, meanJD, stdJD,
  };
}

// --- Rendering ---
function drawChart(ctx, w, h, tMin, tMax, visible,
  signalField, signalColor,
  threshold, thresholdColor,
  events, eventColor, eventShape, // 'dot' or 'tri'
  bites) {

  ctx.clearRect(0, 0, w, h);

  const pad = { top: 20, right: 20, bottom: 30, left: 50 };
  const pw = w - pad.left - pad.right;
  const ph = h - pad.top - pad.bottom;

  function toX(t) { return pad.left + ((t - tMin) / (tMax - tMin)) * pw; }

  // Find signal range
  let mn = Infinity, mx = -Infinity;
  for (const s of visible) {
    const v = s[signalField];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  if (threshold > mx) mx = threshold;
  if (threshold < mn) mn = threshold;
  if (mx === mn) { mn -= 0.001; mx += 0.001; }

  function toY(v) { return pad.top + ph - ((v - mn) / (mx - mn)) * ph; }

  // Bite session shading
  for (const b of bites) {
    if (b.end_ms < tMin || b.start_ms > tMax) continue;
    const x1 = Math.max(pad.left, toX(Math.max(b.start_ms, tMin)));
    const x2 = Math.min(w - pad.right, toX(Math.min(b.end_ms, tMax)));
    ctx.fillStyle = 'rgba(22,163,74,0.08)';
    ctx.fillRect(x1, pad.top, x2 - x1, ph);
    // label
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

    // Y-axis labels
    const val = mx - ((mx - mn) * i) / 4;
    ctx.fillStyle = '#999';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(val.toFixed(4), pad.left - 4, y + 3);
  }
  ctx.textAlign = 'start';

  // Time labels
  ctx.fillStyle = '#999';
  ctx.font = '9px monospace';
  for (let s = Math.ceil(tMin / 5000) * 5; s <= tMax; s += 5) {
    const x = toX(s * 1000);
    ctx.fillText(`${s}s`, x, h - pad.bottom + 14);
  }

  // Threshold line (dashed)
  const threshY = toY(threshold);
  ctx.strokeStyle = thresholdColor;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([8, 4]);
  ctx.beginPath();
  ctx.moveTo(pad.left, threshY);
  ctx.lineTo(w - pad.right, threshY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Signal line
  ctx.strokeStyle = signalColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let started = false;
  for (const s of visible) {
    const x = toX(s.t_ms);
    const y = toY(s[signalField]);
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Event markers
  for (const ev of events) {
    if (ev.t_ms < tMin || ev.t_ms > tMax) continue;
    const x = toX(ev.t_ms);
    if (eventShape === 'dot') {
      ctx.fillStyle = eventColor;
      ctx.beginPath();
      ctx.arc(x, pad.top + ph - 8, 5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = eventColor;
      ctx.beginPath();
      ctx.moveTo(x, pad.top + 6);
      ctx.lineTo(x - 7, pad.top + ph - 6);
      ctx.lineTo(x + 7, pad.top + ph - 6);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function draw() {
  const tNow = performance.now() - t0;
  const tMin = Math.max(0, tNow - HISTORY_MS);
  const tMax = tNow + 1000;
  const visible = history.filter((s) => s.t_ms >= tMin);

  if (visible.length < 2) return;

  const thresh = computeThresholds();

  drawChart(ctxBite, chartBite.width, chartBite.height, tMin, tMax, visible,
    'mouth_open', '#3b82f6',
    thresh.biteThresh, '#8b5cf6',
    detector.biteEvents, '#16a34a', 'tri',
    detector.bites);

  drawChart(ctxChew, chartChew.width, chartChew.height, tMin, tMax, visible,
    'jaw_drop', '#f97316',
    thresh.chewThresh, '#ef4444',
    detector.chews, '#ef4444', 'dot',
    detector.bites);
}

// --- Main loop ---
function loop() {
  draw();
  requestAnimationFrame(loop);
}

// --- FaceMesh callbacks ---
const src = new FaceMeshSource(videoEl, (sample) => {
  const rel = { ...sample, t_ms: sample.t_ms - t0 };
  detector.addSample(rel);
  history.push(rel);
  while (history.length && history[0].t_ms < rel.t_ms - HISTORY_MS) history.shift();

  // Update stats
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
  detector.chews = [];
  detector.biteEvents = [];
  detector.bites = [];
  detector._currentBite = null;
  detector._samples = [];
  (async () => { await src.start(); })();
});

// --- Start ---
(async () => {
  await src.start();
  loop();
})();
