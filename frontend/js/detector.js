/**
 * Detects chewing and bite events from the mouth_open signal using
 * peak prominence (wave amplitude) rather than fixed value thresholds.
 *
 * Inputs (via addSample({t_ms, mouth_open, jaw_drop, no_face})):
 *   - mouth_open: normalized vertical lip distance (upper_lip ↔ lower_lip) / face_width
 *
 * A single prominence-based peak detector runs on mouth_open:
 *   - this.chews:      [{t_ms, prominence}] — chew events (small amplitude)
 *   - this.biteEvents: [{t_ms, prominence}] — bite events (large amplitude)
 *
 * Prominence = how much a peak stands out from its surrounding troughs.
 * Small-amplitude waves → low prominence → chews.
 * Large-amplitude waves → high prominence → bites.
 *
 * Bite session lifecycle:
 *   - A bite is the chew run between consecutive bite events (or session boundaries).
 *   - Each new bite event closes the previous bite (if any) and starts a new one.
 *   - A bite also closes if no chew has occurred for biteEndPauseMs.
 *   - Bites with fewer than minBiteChews chews are discarded as noise.
 *   - finalize() closes any still-open bite at session end.
 */
export class ChewDetector {
  constructor(options = {}) {
    // Time windows / detection lag
    this.windowSec = options.windowSec ?? 30;
    this.confirmFrames = options.confirmFrames ?? 3;
    this.warmupMs = options.warmupMs ?? 0;
    this.minValidForThreshold = options.minValidForThreshold ?? 10;

    // Chew detection (small-amplitude peaks on mouth_open)
    this.minChewProminence = options.minChewProminence ?? 0.003;
    this.minChewIntervalMs = options.minChewIntervalMs ?? 175;

    // Bite-event detection (large-amplitude peaks on mouth_open)
    this.minBiteProminence = options.minBiteProminence ?? 0.008;
    this.minBiteEventIntervalMs = options.minBiteEventIntervalMs ?? 1000;

    // Bite session lifecycle
    this.biteEndPauseMs = options.biteEndPauseMs ?? 3000;
    this.minBiteChews = options.minBiteChews ?? 1;

    // State
    this._samples = [];   // {t_ms, mouth_open, jaw_drop, no_face}
    this.chews = [];      // [{t_ms, prominence}]
    this.biteEvents = []; // [{t_ms, prominence}]
    this.bites = [];      // [{start_ms, end_ms, chew_count}]
    this._currentBite = null; // {start_ms, chew_count, last_chew_t}
    this._lastSampleT = 0;
  }

  addSample(sample) {
    this._samples.push(sample);
    this._lastSampleT = sample.t_ms;
    this._pruneOld(sample.t_ms);
    if (sample.t_ms < this.warmupMs) return;
    this._tryDetectPeak();
    this._checkBiteEnd(sample.t_ms);
  }

  _pruneOld(now_ms) {
    const cutoff = now_ms - this.windowSec * 1000;
    while (this._samples.length && this._samples[0].t_ms < cutoff) {
      this._samples.shift();
    }
  }

  // ---- Prominence-based peak detection (single signal) ----

  /**
   * Scans the mouth_open sample buffer for a confirmed peak.
   * A peak is "confirmed" when confirmFrames samples have passed since
   * the candidate, with value strictly lower than the candidate.
   *
   * Prominence = candidate.value - max(left_trough.value, right_trough.value)
   * where troughs are the lowest points between consecutive peaks.
   *
   * Classification:
   *   prominence >= minBiteProminence  → bite event
   *   prominence >= minChewProminence  → chew event
   */
  _detectPeak(minProminence, minIntervalMs, existingEvents) {
    if (this._samples.length < this.confirmFrames * 2 + 1) return null;

    const centerIdx = this._samples.length - this.confirmFrames - 1;
    const candidate = this._samples[centerIdx];
    if (candidate.no_face) return null;
    const cVal = candidate.mouth_open;

    // Must be a strict local maximum over ±confirmFrames
    for (let i = centerIdx - this.confirmFrames; i <= centerIdx + this.confirmFrames; i++) {
      if (i === centerIdx) continue;
      if (this._samples[i].mouth_open >= cVal) return null;
    }

    // Minimum interval since last same-type event
    if (existingEvents.length) {
      const last = existingEvents[existingEvents.length - 1];
      if (candidate.t_ms - last.t_ms < minIntervalMs) return null;
    }

    // Calculate prominence
    const leftTrough = this._findTrough(0, centerIdx);
    const rightTrough = this._findTrough(centerIdx, this._samples.length - 1);
    const prominence = cVal - Math.max(leftTrough, rightTrough);

    if (prominence < minProminence) return null;

    return { t_ms: candidate.t_ms, prominence };
  }

  _findTrough(fromIdx, toIdx) {
    let minVal = Infinity;
    for (let i = fromIdx; i <= toIdx; i++) {
      const s = this._samples[i];
      if (!s.no_face && s.mouth_open < minVal) {
        minVal = s.mouth_open;
      }
    }
    return minVal === Infinity ? 0 : minVal;
  }

  // ---- Event detection (single signal, dual threshold) ----

  _tryDetectPeak() {
    // Check for bite first (higher prominence threshold), then chew.
    // If it qualifies as a bite, it should NOT also be counted as a chew.
    const biteEvent = this._detectPeak(this.minBiteProminence,
      this.minBiteEventIntervalMs, this.biteEvents);
    if (biteEvent) {
      this.biteEvents.push({ t_ms: biteEvent.t_ms, prominence: biteEvent.prominence });
      this._closeCurrentBite(biteEvent.t_ms);
      this._currentBite = { start_ms: biteEvent.t_ms, chew_count: 0, last_chew_t: biteEvent.t_ms };
      return; // don't double-count as chew
    }

    const chewEvent = this._detectPeak(this.minChewProminence,
      this.minChewIntervalMs, this.chews);
    if (chewEvent) {
      this.chews.push({ t_ms: chewEvent.t_ms, prominence: chewEvent.prominence });
      this._registerChew(chewEvent.t_ms);
    }
  }

  // ---- Bite lifecycle ----

  _registerChew(t_ms) {
    if (!this._currentBite) {
      this._currentBite = { start_ms: t_ms, chew_count: 1, last_chew_t: t_ms };
    } else {
      this._currentBite.chew_count += 1;
      this._currentBite.last_chew_t = t_ms;
    }
  }

  _checkBiteEnd(now_ms) {
    if (!this._currentBite) return;
    if (now_ms - this._currentBite.last_chew_t < this.biteEndPauseMs) return;
    this._closeCurrentBite(this._currentBite.last_chew_t);
  }

  _closeCurrentBite(end_ms) {
    if (this._currentBite && this._currentBite.chew_count >= this.minBiteChews) {
      this.bites.push({
        start_ms: this._currentBite.start_ms,
        end_ms,
        chew_count: this._currentBite.chew_count,
      });
    }
    this._currentBite = null;
  }

  finalize() {
    if (!this._currentBite) return;
    this._closeCurrentBite(this._currentBite.last_chew_t);
  }

  // ---- Stats ----

  getStats(totalDurationMs) {
    const totalChews = this.chews.length;
    const totalBiteEvents = this.biteEvents.length;
    const totalBites = this.bites.length;
    const durationSec = totalDurationMs / 1000;
    const avgChewFreqHz = durationSec > 0 ? totalChews / durationSec : 0;
    const avgChewsPerBite = totalBites > 0 ? totalChews / totalBites : 0;
    const chewFreqBuckets10s = this._freqBuckets(totalDurationMs);
    return {
      totalChews,
      totalBiteEvents,
      totalBites,
      avgChewFreqHz,
      avgChewsPerBite,
      chewFreqBuckets10s,
    };
  }

  _freqBuckets(totalDurationMs) {
    const bucketMs = 10000;
    const n = Math.max(1, Math.ceil(totalDurationMs / bucketMs));
    const counts = new Array(n).fill(0);
    for (const p of this.chews) {
      const i = Math.min(n - 1, Math.floor(p.t_ms / bucketMs));
      if (i >= 0) counts[i] += 1;
    }
    return counts.map((c) => c / 10); // Hz
  }
}
