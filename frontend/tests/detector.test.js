import { describe, it, expect } from 'vitest';
import { ChewDetector } from '../js/detector.js';

describe('ChewDetector: sample buffer', () => {
  it('stores samples added to it', () => {
    const d = new ChewDetector({ windowSec: 5 });
    d.addSample(0, 0.10);
    d.addSample(100, 0.12);
    expect(d._samples.length).toBe(2);
  });

  it('prunes samples older than windowSec', () => {
    const d = new ChewDetector({ windowSec: 5 });
    d.addSample(0, 0.10);
    d.addSample(2000, 0.11);
    d.addSample(8000, 0.12); // window cutoff = 8000 - 5000 = 3000, drops t=0 and t=2000
    expect(d._samples.length).toBe(1);
    expect(d._samples[0].t_ms).toBe(8000);
  });
});

describe('ChewDetector: peak detection', () => {
  // Helper: feed N seconds of low-baseline samples at 30fps so window stats are warm
  function warmup(d, baseline = 0.10, durationMs = 12000, fps = 30) {
    const dt = 1000 / fps;
    for (let t = 0; t < durationMs; t += dt) {
      d.addSample(t, baseline + 0.001 * Math.sin(t / 100)); // tiny noise, no peaks
    }
    return durationMs;
  }

  it('does not register peaks during warmup window', () => {
    const d = new ChewDetector({ warmupMs: 10000, confirmFrames: 5, k: 1.0 });
    d.addSample(0, 0.10);
    d.addSample(33, 0.50);   // big spike, but in warmup
    d.addSample(66, 0.10);
    expect(d.peaks.length).toBe(0);
  });

  it('registers a clear local-max peak above adaptive threshold after warmup', () => {
    const d = new ChewDetector({ warmupMs: 10000, confirmFrames: 5, k: 1.5 });
    let t = warmup(d);
    const dt = 1000 / 30;
    // Inject a sharp peak: baseline ... rise ... peak ... fall ... baseline
    const peakT = t + 5 * dt;
    for (let i = -5; i <= 5; i++) {
      const ts = t + (i + 5) * dt;
      const value = 0.10 + 0.30 * Math.exp(-(i * i) / 2); // gaussian-ish, max at i=0
      d.addSample(ts, value);
    }
    // Add more baseline frames so the peak (at center) has ≥confirmFrames after it
    for (let i = 1; i <= 6; i++) {
      d.addSample(t + (5 + 5 + i) * dt, 0.10);
    }
    expect(d.peaks.length).toBe(1);
    expect(d.peaks[0].t_ms).toBeCloseTo(peakT, 0);
  });

  it('does not register a peak when value is only slightly above mean', () => {
    const d = new ChewDetector({ warmupMs: 10000, confirmFrames: 5, k: 5 });
    let t = warmup(d, 0.10);
    const dt = 1000 / 30;
    // Tiny bump
    for (let i = -5; i <= 5; i++) {
      d.addSample(t + (i + 5) * dt, 0.10 + 0.002 * Math.exp(-(i * i) / 2));
    }
    for (let i = 1; i <= 6; i++) {
      d.addSample(t + (5 + 5 + i) * dt, 0.10);
    }
    expect(d.peaks.length).toBe(0);
  });

  it('ignores samples flagged no_face when computing threshold and peaks', () => {
    const d = new ChewDetector({ warmupMs: 10000, confirmFrames: 5, k: 1.5 });
    let t = warmup(d, 0.10);
    const dt = 1000 / 30;
    // Inject a huge value but flagged no_face — must not become a peak
    for (let i = -5; i <= 5; i++) {
      d.addSample(t + (i + 5) * dt, i === 0 ? 0.90 : 0.10, true);
    }
    for (let i = 1; i <= 6; i++) {
      d.addSample(t + (5 + 5 + i) * dt, 0.10);
    }
    expect(d.peaks.length).toBe(0);
  });
});

describe('ChewDetector: min peak interval', () => {
  function warmup(d, baseline = 0.10, durationMs = 12000, fps = 30) {
    const dt = 1000 / fps;
    for (let t = 0; t < durationMs; t += dt) {
      d.addSample(t, baseline + 0.001 * Math.sin(t / 100));
    }
    return durationMs;
  }

  it('drops a peak that occurs within minPeakIntervalMs of the previous peak', () => {
    const d = new ChewDetector({
      warmupMs: 10000,
      confirmFrames: 5,
      k: 1.5,
      minPeakIntervalMs: 200,
    });
    let t = warmup(d);
    const dt = 1000 / 30; // ~33ms

    // Inject two peaks 100ms apart (well under 200ms threshold)
    function injectPeak(centerT) {
      for (let i = -5; i <= 5; i++) {
        d.addSample(centerT + i * dt, 0.10 + 0.30 * Math.exp(-(i * i) / 2));
      }
      for (let i = 1; i <= 6; i++) {
        d.addSample(centerT + (5 + i) * dt, 0.10);
      }
    }

    injectPeak(t + 5 * dt);
    injectPeak(t + 5 * dt + 100); // 100ms later — should be dropped
    expect(d.peaks.length).toBe(1);
  });
});
