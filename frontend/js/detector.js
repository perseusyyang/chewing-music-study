/**
 * Detects chewing and bite events from face-tracking signals using
 * peak prominence (wave amplitude) rather than fixed value thresholds.
 *
 * Inputs (via addSample({t_ms, mouth_open, jaw_drop, no_face})):
 *   - mouth_open: normalized vertical lip distance — large spikes signal a bite event
 *   - jaw_drop:   normalized upper-lip-to-chin distance — oscillates with chewing
 *
 * Two independent prominence-based peak detectors run on these signals:
 *   - this.chews:      [{t_ms, prominence}] — chew events from jaw_drop peaks
 *   - this.biteEvents: [{t_ms, prominence}] — bite events from mouth_open peaks
 *
 * Prominence = how much a peak stands out from its surrounding troughs.
 * Small-amplitude waves → low prominence → chews (jaw_drop).
 * Large-amplitude waves → high prominence → bites (mouth_open).
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

    // Chew detection (on jaw_drop via prominence)
    this.minChewProminence = options.minChewProminence ?? 0.003;
    this.minChewIntervalMs = options.minChewIntervalMs ?? 175;

    // Bite-event detection (on mouth_open via prominence)
    this.minBiteProminence = options.minBiteProminence ?? 0.005;
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
    this._tryDetectChew();
    this._tryDetectBiteEvent();
    this._checkBiteEnd(sample.t_ms);
  }

  _pruneOld(now_ms) {
    const cutoff = now_ms - this.windowSec * 1000;
    while (this._samples.length && this._samples[0].t_ms < cutoff) {
      this._samples.shift();
    }
  }

  // ---- Prominence-based peak detection ----

  /**
   * Scans the sample buffer for a confirmed peak on `field`.
   * A peak is "confirmed" when confirmFrames samples have passed since
   * the candidate, with value strictly lower than the candidate.
   *
   * Prominence = candidate.value - max(left_trough.value, right_trough.value)
   * where troughs are the lowest points between consecutive peaks.
   *
   * Returns {t_ms, prominence} or null.
   */
  _detectPeak(field, minProminence, minIntervalMs, existingEvents) {
    if (this._samples.length < this.confirmFrames * 2 + 1) return null;

    const centerIdx = this._samples.length - this.confirmFrames - 1;
    const candidate = this._samples[centerIdx];
    if (candidate.no_face) return null;
    const cVal = candidate[field];

    // Must be a strict local maximum over ±confirmFrames
    for (let i = centerIdx - this.confirmFrames; i <= centerIdx + this.confirmFrames; i++) {
      if (i === centerIdx) continue;
      if (this._samples[i][field] >= cVal) return null;
    }

    // Minimum interval since last same-type event
    if (existingEvents.length) {
      const last = existingEvents[existingEvents.length - 1];
      if (candidate.t_ms - last.t_ms < minIntervalMs) return null;
    }

    // Calculate prominence: find the higher of the two enclosing troughs.
    // Left trough: lowest value between the previous peak (or buffer start) and this peak.
    // Right trough: lowest value between this peak and the buffer end (so far).
    const leftTrough = this._findTrough(field, 0, centerIdx);
    const rightTrough = this._findTrough(field, centerIdx, this._samples.length - 1);
    const prominence = cVal - Math.max(leftTrough, rightTrough);

    if (prominence < minProminence) return null;

    return { t_ms: candidate.t_ms, prominence };
  }

  /**
   * Finds the minimum value of `field` in samples[from..to] (inclusive).
   */
  _findTrough(field, fromIdx, toIdx) {
    let minVal = Infinity;
    for (let i = fromIdx; i <= toIdx; i++) {
      const s = this._samples[i];
      if (!s.no_face && s[field] < minVal) {
        minVal = s[field];
      }
    }
    return minVal === Infinity ? 0 : minVal;
  }

  // ---- Event detection ----

  _tryDetectChew() {
    const event = this._detectPeak('jaw_drop', this.minChewProminence,
      this.minChewIntervalMs, this.chews);
    if (event) {
      this.chews.push({ t_ms: event.t_ms, prominence: event.prominence });
      this._registerChew(event.t_ms);
    }
  }

  _tryDetectBiteEvent() {
    const event = this._detectPeak('mouth_open', this.minBiteProminence,
      this.minBiteEventIntervalMs, this.biteEvents);
    if (event) {
      this.biteEvents.push({ t_ms: event.t_ms, prominence: event.prominence });
      this._closeCurrentBite(event.t_ms);
      this._currentBite = { start_ms: event.t_ms, chew_count: 0, last_chew_t: event.t_ms };
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
