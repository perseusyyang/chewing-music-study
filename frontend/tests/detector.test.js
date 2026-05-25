import { describe, it, expect } from 'vitest';
import { ChewDetector } from '../js/detector.js';

// Helpers --------------------------------------------------------------------

function makeSample(t_ms, mouth_open, jaw_drop, no_face = false) {
  return { t_ms, mouth_open, jaw_drop, no_face };
}

// Feed warmup with a flat baseline + tiny noise on both signals.
function warmup(d, jawBase = 0.60, mouthBase = 0.02, durationMs = 12000, fps = 30) {
  const dt = 1000 / fps;
  for (let t = 0; t < durationMs; t += dt) {
    d.addSample(makeSample(
      t,
      mouthBase + 0.001 * Math.sin(t / 100),
      jawBase + 0.001 * Math.cos(t / 100),
    ));
  }
  return durationMs;
}

// Inject a gaussian bump on the JAW signal (chew). Mouth stays flat at baseline.
function injectChew(d, centerT, amp = 0.08, jawBase = 0.60, mouthBase = 0.02) {
  const dt = 1000 / 30;
  for (let i = -5; i <= 5; i++) {
    const ts = centerT + i * dt;
    const jaw = jawBase + amp * Math.exp(-(i * i) / 2);
    d.addSample(makeSample(ts, mouthBase, jaw));
  }
  // Tail for confirmFrames lookahead
  for (let i = 1; i <= 6; i++) {
    const ts = centerT + (5 + i) * dt;
    d.addSample(makeSample(ts, mouthBase, jawBase));
  }
}

// Inject a gaussian bump on the MOUTH signal (bite event). Jaw stays flat.
function injectBiteEvent(d, centerT, amp = 0.30, jawBase = 0.60, mouthBase = 0.02) {
  const dt = 1000 / 30;
  for (let i = -5; i <= 5; i++) {
    const ts = centerT + i * dt;
    const mouth = mouthBase + amp * Math.exp(-(i * i) / 2);
    d.addSample(makeSample(ts, mouth, jawBase));
  }
  for (let i = 1; i <= 6; i++) {
    const ts = centerT + (5 + i) * dt;
    d.addSample(makeSample(ts, mouthBase, jawBase));
  }
}

// Tests ----------------------------------------------------------------------

describe('ChewDetector: sample buffer', () => {
  it('stores samples and prunes old ones', () => {
    const d = new ChewDetector({ windowSec: 5 });
    d.addSample(makeSample(0, 0.02, 0.60));
    d.addSample(makeSample(2000, 0.02, 0.60));
    d.addSample(makeSample(8000, 0.02, 0.60));
    expect(d._samples.length).toBe(1);
    expect(d._samples[0].t_ms).toBe(8000);
  });
});

describe('ChewDetector: chew detection (jaw_drop)', () => {
  it('does not register chews during warmup', () => {
    const d = new ChewDetector({ warmupMs: 10000, confirmFrames: 5, k_chew: 1.0 });
    d.addSample(makeSample(0, 0.02, 0.60));
    d.addSample(makeSample(33, 0.02, 0.90)); // big spike during warmup
    d.addSample(makeSample(66, 0.02, 0.60));
    expect(d.chews.length).toBe(0);
  });

  it('detects a clear chew peak above threshold after warmup', () => {
    const d = new ChewDetector({ warmupMs: 10000, confirmFrames: 5, k_chew: 1.5 });
    const t = warmup(d);
    injectChew(d, t + 500, 0.08);
    expect(d.chews.length).toBe(1);
  });

  it('does not register a chew when jaw bump is small (sub-threshold)', () => {
    const d = new ChewDetector({ warmupMs: 10000, confirmFrames: 5, k_chew: 5 });
    const t = warmup(d);
    injectChew(d, t + 500, 0.002); // tiny — below k=5 threshold
    expect(d.chews.length).toBe(0);
  });

  it('drops a chew within minChewIntervalMs of the previous chew', () => {
    const d = new ChewDetector({
      warmupMs: 10000,
      confirmFrames: 5,
      k_chew: 1.5,
      minChewIntervalMs: 200,
    });
    const t = warmup(d);
    injectChew(d, t + 500, 0.08);
    injectChew(d, t + 600, 0.08); // 100ms after the first — dropped
    expect(d.chews.length).toBe(1);
  });

  it('ignores no_face samples when computing chew threshold', () => {
    const d = new ChewDetector({ warmupMs: 10000, confirmFrames: 5, k_chew: 1.5 });
    const t = warmup(d);
    const dt = 1000 / 30;
    // Huge jaw spike but flagged no_face — must not register
    for (let i = -5; i <= 5; i++) {
      const ts = t + 500 + i * dt;
      d.addSample(makeSample(ts, 0.02, i === 0 ? 0.95 : 0.60, true));
    }
    for (let i = 1; i <= 6; i++) {
      d.addSample(makeSample(t + 500 + (5 + i) * dt, 0.02, 0.60));
    }
    expect(d.chews.length).toBe(0);
  });
});

describe('ChewDetector: bite event detection (mouth_open)', () => {
  it('detects a large mouth-open as a bite event', () => {
    const d = new ChewDetector({ warmupMs: 10000, confirmFrames: 5, k_bite: 3.0 });
    const t = warmup(d);
    injectBiteEvent(d, t + 500, 0.30);
    expect(d.biteEvents.length).toBe(1);
  });

  it('does not flag small mouth motion as a bite event', () => {
    const d = new ChewDetector({ warmupMs: 10000, confirmFrames: 5, k_bite: 3.0 });
    const t = warmup(d);
    injectBiteEvent(d, t + 500, 0.002); // tiny — well below k=3.0 threshold
    expect(d.biteEvents.length).toBe(0);
  });
});

describe('ChewDetector: bite session lifecycle', () => {
  it('groups chews between two bite events into one bite', () => {
    const d = new ChewDetector({
      warmupMs: 10000,
      confirmFrames: 5,
      k_chew: 1.5,
      k_bite: 3.0,
      biteEndPauseMs: 10000, // long, so pause-closing doesn't interfere
      minBiteChews: 1,
    });
    const t = warmup(d);
    injectBiteEvent(d, t + 500, 0.30);
    injectChew(d, t + 1500, 0.08);
    injectChew(d, t + 2000, 0.08);
    injectChew(d, t + 2500, 0.08);
    injectBiteEvent(d, t + 4000, 0.30); // closes first bite
    injectChew(d, t + 5000, 0.08);
    // No closing — needs finalize or another bite event
    d.finalize();
    expect(d.bites.length).toBe(2);
    expect(d.bites[0].chew_count).toBe(3);
    expect(d.bites[1].chew_count).toBe(1);
  });

  it('closes a bite when there are no chews for biteEndPauseMs', () => {
    const d = new ChewDetector({
      warmupMs: 10000,
      confirmFrames: 5,
      k_chew: 1.5,
      k_bite: 3.0,
      biteEndPauseMs: 1500,
      minBiteChews: 1,
    });
    const t = warmup(d);
    injectBiteEvent(d, t + 500, 0.30);
    injectChew(d, t + 1500, 0.08);
    injectChew(d, t + 2000, 0.08);
    // Long pause feeding flat baseline samples
    const dt = 1000 / 30;
    for (let ts = t + 2200; ts < t + 5000; ts += dt) {
      d.addSample(makeSample(ts, 0.02, 0.60));
    }
    expect(d.bites.length).toBe(1);
    expect(d.bites[0].chew_count).toBe(2);
  });

  it('discards a bite with fewer than minBiteChews chews', () => {
    const d = new ChewDetector({
      warmupMs: 10000,
      confirmFrames: 5,
      k_chew: 1.5,
      k_bite: 3.0,
      biteEndPauseMs: 1500,
      minBiteChews: 3,
    });
    const t = warmup(d);
    injectBiteEvent(d, t + 500, 0.30);
    injectChew(d, t + 1500, 0.08);
    injectChew(d, t + 2000, 0.08);
    // Only 2 chews, then pause
    const dt = 1000 / 30;
    for (let ts = t + 2200; ts < t + 5000; ts += dt) {
      d.addSample(makeSample(ts, 0.02, 0.60));
    }
    expect(d.bites.length).toBe(0);
  });

  it('finalize() closes a still-open bite', () => {
    const d = new ChewDetector({
      warmupMs: 10000,
      confirmFrames: 5,
      k_chew: 1.5,
      k_bite: 3.0,
      biteEndPauseMs: 99999,
      minBiteChews: 1,
    });
    const t = warmup(d);
    injectBiteEvent(d, t + 500, 0.30);
    injectChew(d, t + 1500, 0.08);
    injectChew(d, t + 2000, 0.08);
    expect(d.bites.length).toBe(0);
    d.finalize();
    expect(d.bites.length).toBe(1);
    expect(d.bites[0].chew_count).toBe(2);
  });
});

describe('ChewDetector: getStats', () => {
  it('returns counts, frequency, and 10s buckets', () => {
    const d = new ChewDetector({
      warmupMs: 0,
      confirmFrames: 5,
      k_chew: 1.0,
      k_bite: 3.0,
      biteEndPauseMs: 1500,
      minBiteChews: 1,
    });
    // Skip warmup gate; feed a brief flat baseline so minValidForThreshold is met
    const dt = 1000 / 30;
    for (let ts = 0; ts < 500; ts += dt) d.addSample(makeSample(ts, 0.02, 0.60));
    injectChew(d, 1000, 0.08);
    injectChew(d, 2000, 0.08);
    injectChew(d, 3000, 0.08);
    for (let ts = 3500; ts < 11000; ts += dt) d.addSample(makeSample(ts, 0.02, 0.60));
    injectChew(d, 11500, 0.08);
    injectChew(d, 12500, 0.08);
    for (let ts = 13000; ts < 25000; ts += dt) d.addSample(makeSample(ts, 0.02, 0.60));

    d.finalize();
    const stats = d.getStats(25000);
    expect(stats.totalChews).toBe(5);
    expect(stats.avgChewFreqHz).toBeCloseTo(5 / 25, 3);
    expect(stats.chewFreqBuckets10s.length).toBe(3);
    expect(stats.chewFreqBuckets10s[0]).toBeCloseTo(0.3, 3);
    expect(stats.chewFreqBuckets10s[1]).toBeCloseTo(0.2, 3);
  });
});
