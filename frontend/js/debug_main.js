import { ChewDetector } from './detector.js';
import { FaceMeshSource } from './face_source.js';

const videoEl = document.getElementById('cam');
const mEl = document.getElementById('m');
const jEl = document.getElementById('j');
const pEl = document.getElementById('p');
const beEl = document.getElementById('be');
const bEl = document.getElementById('b');
const nfEl = document.getElementById('nf');
const chart = document.getElementById('chart');
const ctx = chart.getContext('2d');

const t0 = performance.now();
const detector = new ChewDetector();
const history = []; // {t_ms, mouth_open, jaw_drop, no_face}
const HISTORY_MS = 20000;

function draw() {
  ctx.clearRect(0, 0, chart.width, chart.height);
  if (history.length < 2) return;
  const tNow = performance.now() - t0;
  const tMin = tNow - HISTORY_MS;
  const visible = history.filter((s) => s.t_ms >= tMin);
  if (visible.length < 2) return;
  const W = chart.width;
  const H = chart.height;

  // Two-track plot: top half = mouth_open (blue), bottom half = jaw_drop (orange).
  function plot(field, color, yTop, yBottom) {
    let mn = Infinity, mx = -Infinity;
    for (const s of visible) {
      const v = s[field];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (mx === mn) { mn -= 0.001; mx += 0.001; }
    ctx.beginPath();
    ctx.strokeStyle = color;
    visible.forEach((s, i) => {
      const x = ((s.t_ms - tMin) / HISTORY_MS) * W;
      const y = yBottom - ((s[field] - mn) / (mx - mn)) * (yBottom - yTop);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  plot('mouth_open', '#3b82f6', 0, H / 2 - 4);
  plot('jaw_drop', '#f97316', H / 2 + 4, H);

  // Chew markers (orange dots, bottom half)
  ctx.fillStyle = '#ef4444';
  for (const c of detector.chews) {
    if (c.t_ms < tMin) continue;
    const x = ((c.t_ms - tMin) / HISTORY_MS) * W;
    ctx.beginPath();
    ctx.arc(x, H - 10, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Bite-event markers (green triangles, top half)
  ctx.fillStyle = '#16a34a';
  for (const be of detector.biteEvents) {
    if (be.t_ms < tMin) continue;
    const x = ((be.t_ms - tMin) / HISTORY_MS) * W;
    ctx.beginPath();
    ctx.moveTo(x, 20);
    ctx.lineTo(x - 6, 30);
    ctx.lineTo(x + 6, 30);
    ctx.closePath();
    ctx.fill();
  }
}

function loop() {
  draw();
  requestAnimationFrame(loop);
}

const src = new FaceMeshSource(videoEl, (sample) => {
  const rel = { ...sample, t_ms: sample.t_ms - t0 };
  detector.addSample(rel);
  history.push(rel);
  while (history.length && history[0].t_ms < rel.t_ms - HISTORY_MS) history.shift();
  mEl.textContent = sample.mouth_open.toFixed(4);
  jEl.textContent = sample.jaw_drop.toFixed(4);
  pEl.textContent = detector.chews.length;
  beEl.textContent = detector.biteEvents.length;
  bEl.textContent = detector.bites.length;
  nfEl.textContent = sample.no_face ? 'yes' : 'no';
}, () => performance.now());

(async () => {
  await src.start();
  loop();
})();
