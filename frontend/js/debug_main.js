import { ChewDetector } from './detector.js';
import { FaceMeshSource } from './face_source.js';

const videoEl = document.getElementById('cam');
const mEl = document.getElementById('m');
const pEl = document.getElementById('p');
const bEl = document.getElementById('b');
const nfEl = document.getElementById('nf');
const chart = document.getElementById('chart');
const ctx = chart.getContext('2d');

const t0 = performance.now();
const detector = new ChewDetector();
const history = []; // {t_ms, value, no_face}
const HISTORY_MS = 20000;

function draw() {
  ctx.clearRect(0, 0, chart.width, chart.height);
  if (history.length < 2) return;
  const tNow = performance.now() - t0;
  const tMin = tNow - HISTORY_MS;
  const visible = history.filter((s) => s.t_ms >= tMin);
  if (visible.length < 2) return;

  // Find min/max of mouth_open
  let mn = Infinity, mx = -Infinity;
  for (const s of visible) { if (s.value < mn) mn = s.value; if (s.value > mx) mx = s.value; }
  if (mx === mn) { mn -= 0.01; mx += 0.01; }
  const W = chart.width;
  const H = chart.height;

  // mouth_open line
  ctx.beginPath();
  ctx.strokeStyle = '#3b82f6';
  visible.forEach((s, i) => {
    const x = ((s.t_ms - tMin) / HISTORY_MS) * W;
    const y = H - ((s.value - mn) / (mx - mn)) * H;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Peak markers
  ctx.fillStyle = '#ef4444';
  for (const peak of detector.peaks) {
    if (peak.t_ms < tMin) continue;
    const x = ((peak.t_ms - tMin) / HISTORY_MS) * W;
    ctx.beginPath();
    ctx.arc(x, H - 10, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function loop() {
  draw();
  requestAnimationFrame(loop);
}

const src = new FaceMeshSource(videoEl, (t_ms, mouth_open, no_face) => {
  const rel = t_ms - t0;
  detector.addSample(rel, mouth_open, no_face);
  history.push({ t_ms: rel, value: mouth_open, no_face });
  while (history.length && history[0].t_ms < rel - HISTORY_MS) history.shift();
  mEl.textContent = mouth_open.toFixed(4);
  pEl.textContent = detector.peaks.length;
  bEl.textContent = detector.bites.length;
  nfEl.textContent = no_face ? 'yes' : 'no';
}, () => performance.now());

(async () => {
  await src.start();
  loop();
})();
