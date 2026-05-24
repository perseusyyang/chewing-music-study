/**
 * Detects chewing events from a mouth-open time series.
 *
 * Caller pushes samples via addSample(t_ms, mouth_open, no_face).
 *   - t_ms: milliseconds from session start
 *   - mouth_open: normalized opening (e.g. lip distance / face width)
 *   - no_face: true if face was not detected this frame
 *
 * Produces: this.peaks (chronological [{t_ms}, ...]).
 *
 * Algorithm: a sample is a peak if it is a local max over ±confirmFrames
 * frames AND exceeds (mean + k·std) of valid (face-detected) samples in the
 * sliding window. Detection lags by confirmFrames frames so we can confirm
 * the local-max condition before declaring a peak.
 */
export class ChewDetector {
  constructor(options = {}) {
    this.windowSec = options.windowSec ?? 30;
    this.k = options.k ?? 1.5;
    this.confirmFrames = options.confirmFrames ?? 5;
    this.warmupMs = options.warmupMs ?? 10000;
    this.minValidForThreshold = options.minValidForThreshold ?? 10;
    this.minPeakIntervalMs = options.minPeakIntervalMs ?? 200;
    this.biteEndPauseMs = options.biteEndPauseMs ?? 1500;
    this.minBiteChews = options.minBiteChews ?? 2;

    this.bites = []; // {start_ms, end_ms, chew_count}
    this._currentBite = null; // {start_ms, chews: [t_ms, ...]}

    this._samples = [];
    this.peaks = [];
    this._lastEvaluatedIdx = -1;
  }

  addSample(t_ms, mouth_open, no_face = false) {
    this._samples.push({ t_ms, value: mouth_open, no_face });
    this._pruneOld(t_ms);
    this._tryDetectPeak(t_ms);
    this._checkBiteEnd(t_ms);
  }

  _pruneOld(now_ms) {
    const cutoff = now_ms - this.windowSec * 1000;
    while (this._samples.length && this._samples[0].t_ms < cutoff) {
      this._samples.shift();
      // Indices shift left, but _lastEvaluatedIdx is no longer used after pruning;
      // we re-derive candidate position from the buffer each call.
    }
  }

  _tryDetectPeak(now_ms) {
    if (now_ms < this.warmupMs) return;
    if (this._samples.length < this.confirmFrames * 2 + 1) return;

    const centerIdx = this._samples.length - this.confirmFrames - 1;
    const candidate = this._samples[centerIdx];
    if (candidate.no_face) return;

    // Local max over ±confirmFrames
    for (let i = centerIdx - this.confirmFrames; i <= centerIdx + this.confirmFrames; i++) {
      if (i === centerIdx) continue;
      if (this._samples[i].value >= candidate.value) return;
    }

    // Adaptive threshold over valid (face-detected) samples in window
    const valid = this._samples.filter((s) => !s.no_face);
    if (valid.length < this.minValidForThreshold) return;
    const mean = valid.reduce((a, s) => a + s.value, 0) / valid.length;
    const variance =
      valid.reduce((a, s) => a + (s.value - mean) ** 2, 0) / valid.length;
    const std = Math.sqrt(variance);
    if (candidate.value < mean + this.k * std) return;

    // Avoid duplicate peak for the same candidate timestamp
    if (this.peaks.length && this.peaks[this.peaks.length - 1].t_ms === candidate.t_ms) {
      return;
    }

    if (this.peaks.length) {
      const last = this.peaks[this.peaks.length - 1];
      if (candidate.t_ms - last.t_ms < this.minPeakIntervalMs) return;
    }

    this.peaks.push({ t_ms: candidate.t_ms });
    this._registerChew(candidate.t_ms);
  }

  _registerChew(t_ms) {
    if (!this._currentBite) {
      this._currentBite = { start_ms: t_ms, chews: [t_ms] };
    } else {
      this._currentBite.chews.push(t_ms);
    }
  }

  _checkBiteEnd(now_ms) {
    if (!this._currentBite) return;
    const chews = this._currentBite.chews;
    const lastChew = chews[chews.length - 1];
    if (now_ms - lastChew < this.biteEndPauseMs) return;

    if (chews.length >= this.minBiteChews) {
      this.bites.push({
        start_ms: this._currentBite.start_ms,
        end_ms: lastChew,
        chew_count: chews.length,
      });
    }
    this._currentBite = null;
  }
}
