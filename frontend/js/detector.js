/**
 * Detects chewing events from a mouth-open time series.
 *
 * Input model: caller pushes samples via addSample(t_ms, mouth_open, no_face).
 *   - t_ms: milliseconds from session start
 *   - mouth_open: normalized opening (e.g. lip distance / face width)
 *   - no_face: true if face was not detected this frame
 *
 * Output: peak events, bite groupings, and aggregate stats.
 */
export class ChewDetector {
  constructor(options = {}) {
    this.windowSec = options.windowSec ?? 30;

    this._samples = []; // {t_ms, value, no_face}
  }

  addSample(t_ms, mouth_open, no_face = false) {
    this._samples.push({ t_ms, value: mouth_open, no_face });
    this._pruneOld(t_ms);
  }

  _pruneOld(now_ms) {
    const cutoff = now_ms - this.windowSec * 1000;
    while (this._samples.length && this._samples[0].t_ms < cutoff) {
      this._samples.shift();
    }
  }
}
