/**
 * Intervention recording view — extends the standard recording flow with
 * real-time chewing-speed monitoring and adaptive audio playback.
 *
 * Algorithm:
 *   warmup (0–30 s):  collect baseline chew rate, no intervention
 *   active (30 s+):   if rolling 10 s chew rate > baseline × 1.5 for ≥ 2 s,
 *                     slow playback proportionally: rate = baseline×1.5 / chewRate
 *                     (clamped to [0.5, 1.0]), with exponential smoothing.
 *
 * Configurable via URL params: windowSec, warmupSec, thresholdFactor,
 *   minPlaybackRate, smoothingFactor, interventionDelayMs, defaultBaselineHz.
 */
import { session } from '../state.js';
import { ChewDetector } from '../detector.js';
import { FaceMeshSource } from '../face_source.js';
import { AdaptiveAudioPlayer } from '../adaptive_audio.js';
import { fetchPlaylist } from '../api.js';

// ---- tunable constants (overridable via ?key=value on the page URL) ----
const params = new URLSearchParams(window.location.search);
const CONFIG = {
  windowSec: parseFloat(params.get('windowSec')) || 10,
  warmupSec: parseFloat(params.get('warmupSec')) || 30,
  thresholdFactor: parseFloat(params.get('thresholdFactor')) || 1.5,
  minPlaybackRate: parseFloat(params.get('minPlaybackRate')) || 0.5,
  interventionDelayMs: parseFloat(params.get('interventionDelayMs')) || 2000,
  defaultBaselineHz: parseFloat(params.get('defaultBaselineHz')) || 1.5,
  // Smoothing speeds for different phases (lower = gentler / slower transition)
  smoothingDown: parseFloat(params.get('smoothingDown')) || 0.04,
  smoothingUpFast: parseFloat(params.get('smoothingUpFast')) || 0.04,
  smoothingUpSlow: parseFloat(params.get('smoothingUpSlow')) || 0.01,
  // Two-phase recovery: first recover to this fraction, then creep to 1.0
  recoveryThreshold: parseFloat(params.get('recoveryThreshold')) || 0.9,
};

// ---- internal state ----
let timerInterval = null;
let startMs = null;
let detector = null;
let faceSrc = null;
let player = null;
let noFaceTimer = null;
let lastChewCount = 0;
let chewTimestamps = []; // t_ms of chews in the rolling window
let overThresholdSince = null;
let interventionActive = false;
let recoveryPhase = null; // null | 'fast' (→0.9) | 'slow' (→1.0)

// baseline + intervention log
let baselineHz = null;
let interventionEvents = []; // [{start_ms, end_ms, target_rate}]
let playbackRateSnapshots = []; // [{t_ms, rate}] — sampled every ~500 ms

export async function mountInterventionRecording(router) {
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

  // Intervention UI elements
  const chewRateEl = document.getElementById('intv-chew-rate');
  const baselineEl = document.getElementById('intv-baseline');
  const playbackRateEl = document.getElementById('intv-playback-rate');
  const intvStatusEl = document.getElementById('intv-status');
  const intvPanel = document.getElementById('intervention-panel');

  // ---- music ----
  let playlist = session.playlist;
  if (!playlist) {
    try {
      const data = await fetchPlaylist(session.music_genre);
      playlist = data.tracks;
    } catch (e) {
      statusText.textContent = 'Failed to load music: ' + e.message;
      statusDot.classList.add('red');
      return;
    }
  }
  if (!playlist.length) {
    statusText.textContent = 'No music available.';
    statusDot.classList.add('red');
    return;
  }

  // ---- session init ----
  session.session_id = crypto.randomUUID();
  session.started_at = new Date().toISOString();
  startMs = performance.now();
  detector = new ChewDetector();
  lastChewCount = 0;
  chewTimestamps = [];
  overThresholdSince = null;
  interventionActive = false;
  recoveryPhase = null;
  baselineHz = null;
  interventionEvents = [];
  playbackRateSnapshots = [];

  statusDot.classList.remove('red');
  statusDot.classList.add('green');
  statusText.textContent = 'Warming up…';
  intvPanel.classList.remove('hidden');

  // ---- audio ----
  const audio = session.audioEl || new Audio();
  const urlPrefix = session.url_prefix || `/music/${session.music_genre}/`;
  player = new AdaptiveAudioPlayer(audio, playlist, urlPrefix, {
    onTrack: (track) => { trackTitleEl.textContent = track.title; },
    minRate: CONFIG.minPlaybackRate,
    smoothingFactor: CONFIG.smoothingDown,
  });
  player.start();

  // ---- last-snapshot clock for periodic rate logging ----
  let lastSnapshotMs = 0;

  // ---- camera + detection + intervention loop ----
  faceSrc = new FaceMeshSource(
    videoEl,
    (sample) => {
      const relMs = sample.t_ms - startMs;
      detector.addSample({ ...sample, t_ms: relMs });

      // --- rolling chew rate ---
      const newChews = detector.chews.slice(lastChewCount);
      for (const c of newChews) chewTimestamps.push(c.t_ms);
      lastChewCount = detector.chews.length;

      const cutoff = relMs - CONFIG.windowSec * 1000;
      while (chewTimestamps.length && chewTimestamps[0] <= cutoff) {
        chewTimestamps.shift();
      }
      const currentRateHz = chewTimestamps.length / CONFIG.windowSec;

      // --- baseline ---
      if (relMs < CONFIG.warmupSec * 1000) {
        // still warming up — no intervention
        if (intvPanel) {
          chewRateEl.textContent = currentRateHz.toFixed(2) + ' Hz';
          baselineEl.textContent = 'collecting…';
          playbackRateEl.textContent = '1.00×';
          intvStatusEl.textContent = 'Warming up';
          intvStatusEl.className = 'intv-monitoring';
        }
      } else {
        // finalize baseline on first frame after warmup
        if (baselineHz === null) {
          const warmupChews = detector.chews.filter(
            (c) => c.t_ms < CONFIG.warmupSec * 1000
          ).length;
          baselineHz = warmupChews > 3
            ? warmupChews / CONFIG.warmupSec
            : CONFIG.defaultBaselineHz;
        }

        // --- intervention logic ---
        const threshold = baselineHz * CONFIG.thresholdFactor;

        // If we're in recovery, keep driving toward the recovery target
        // (don't re-trigger intervention until recovery completes).
        if (recoveryPhase) {
          if (recoveryPhase === 'fast' && player.currentRate >= CONFIG.recoveryThreshold - 0.01) {
            // Phase 1 complete → start ultra-slow creep to 1.0
            recoveryPhase = 'slow';
            player.setTargetRate(1.0, CONFIG.smoothingUpSlow);
          }
          // Stay in recovery — don't evaluate intervention triggers
        } else if (currentRateHz > threshold) {
          // --- above threshold: trigger or sustain intervention ---
          if (overThresholdSince === null) {
            overThresholdSince = relMs;
          }
          if (relMs - overThresholdSince >= CONFIG.interventionDelayMs) {
            const targetRate = Math.max(
              CONFIG.minPlaybackRate,
              Math.min(1.0, threshold / currentRateHz),
            );
            player.setTargetRate(targetRate, CONFIG.smoothingDown);
            if (!interventionActive) {
              interventionActive = true;
              interventionEvents.push({
                start_ms: Math.round(relMs),
                end_ms: null,
                target_rate: targetRate,
              });
            }
          }
        } else {
          // --- below threshold: release intervention ---
          if (overThresholdSince !== null) {
            overThresholdSince = null;
            if (interventionActive) {
              // close current intervention event
              const cur = interventionEvents[interventionEvents.length - 1];
              if (cur && cur.end_ms === null) {
                cur.end_ms = Math.round(relMs);
              }
              interventionActive = false;
            }
            // Start two-phase recovery: first to recoveryThreshold…
            recoveryPhase = 'fast';
            player.setTargetRate(CONFIG.recoveryThreshold, CONFIG.smoothingUpFast);
          }
        }

        // --- check recovery completion ---
        if (recoveryPhase === 'slow' && player.currentRate >= 0.995) {
          recoveryPhase = null; // fully recovered
        }

        // --- UI update ---
        if (intvPanel) {
          chewRateEl.textContent = currentRateHz.toFixed(2) + ' Hz';
          baselineEl.textContent = baselineHz.toFixed(2) + ' Hz';
          playbackRateEl.textContent = player.currentRate.toFixed(2) + '×';
          if (interventionActive) {
            intvStatusEl.textContent = 'Intervening';
            intvStatusEl.className = 'intv-intervening';
          } else if (recoveryPhase) {
            intvStatusEl.textContent = recoveryPhase === 'fast' ? 'Recovering' : 'Stabilizing';
            intvStatusEl.className = 'intv-monitoring';
          } else {
            intvStatusEl.textContent = 'Monitoring';
            intvStatusEl.className = 'intv-monitoring';
          }
        }
      }

      // --- periodic rate snapshot (~every 500 ms) ---
      if (relMs - lastSnapshotMs >= 500) {
        lastSnapshotMs = relMs;
        playbackRateSnapshots.push({
          t_ms: Math.round(relMs),
          rate: player ? player.currentRate : 1.0,
        });
      }

      // --- face-status dot ---
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
        statusText.textContent = interventionActive
          ? 'Detecting… (intervening)'
          : 'Detecting…';
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

  // ---- timer ----
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((performance.now() - startMs) / 1000);
    const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const ss = String(elapsed % 60).padStart(2, '0');
    timerEl.textContent = `${mm}:${ss}`;
  }, 250);

  // ---- stop ----
  stopBtn.addEventListener('click', () => {
    clearInterval(timerInterval);
    timerInterval = null;
    if (faceSrc) { faceSrc.stop(); faceSrc = null; }
    if (player) { player.stop(); }
    if (noFaceTimer) { clearTimeout(noFaceTimer); noFaceTimer = null; }

    const totalMs = performance.now() - startMs;

    // close any open intervention event
    if (interventionActive) {
      const cur = interventionEvents[interventionEvents.length - 1];
      if (cur && cur.end_ms === null) {
        cur.end_ms = Math.round(totalMs);
      }
      interventionActive = false;
    }

    detector.finalize();
    session.ended_at = new Date().toISOString();
    session.duration_sec = Math.round(totalMs / 1000);
    session.stats = detector.getStats(totalMs);
    session.bites = detector.bites.slice();
    session.chew_events_ms = detector.chews.map((c) => c.t_ms);
    session.bite_events_ms = detector.biteEvents.map((e) => e.t_ms);
    session.tracks_played = player ? player.playedIds.slice() : [];

    // Intervention-specific data
    session.intervention_baseline_hz = baselineHz;
    session.intervention_events = interventionEvents;
    session.playback_rate_snapshots = playbackRateSnapshots;
    session.intervention_config = { ...CONFIG };

    router.navigate('/results');
  });
}
