/**
 * Detects chewing and bite events from face-tracking signals.
 *
 * Inputs (via addSample({t_ms, mouth_open, jaw_drop, no_face})):
 *   - mouth_open: normalized vertical lip distance — large spikes signal a bite event
 *                 (the participant opening wide to take food in).
 *   - jaw_drop:   normalized nose-to-chin distance — oscillates with chewing, even
 *                 when lips stay closed. Local maxima signal chew events.
 *
 * Two independent adaptive-threshold peak detectors run on these signals:
 *   - this.chews:      [{t_ms}] chronological list of chew events
 *   - this.biteEvents: [{t_ms}] chronological list of big-mouth-open events
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
    this.warmupMs = options.warmupMs ?? 3000;
    this.minValidForThreshold = options.minValidForThreshold ?? 10;

    // Chew detection (on jaw_drop)
    this.k_chew = options.k_chew ?? 0.8;
    this.minChewIntervalMs = options.minChewIntervalMs ?? 200;

    // Bite-event detection (on mouth_open)
    this.k_bite = options.k_bite ?? 3.0;
    this.minBiteEventIntervalMs = options.minBiteEventIntervalMs ?? 1000;

    // Bite session lifecycle
    this.biteEndPauseMs = options.biteEndPauseMs ?? 3000;
    this.minBiteChews = options.minBiteChews ?? 1;

    // State
    this._samples = [];   // {t_ms, mouth_open, jaw_drop, no_face}
    this.chews = [];      // [{t_ms}]
    this.biteEvents = []; // [{t_ms}]
    this.bites = [];      // [{start_ms, end_ms, chew_count}]
    this._currentBite = null; // {start_ms, chew_count, last_chew_t}
  }

  addSample(sample) {
    this._samples.push(sample);
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

  _tryDetectChew() {
    const event = this._detectPeak('jaw_drop', this.k_chew, this.minChewIntervalMs, this.chews);
    if (event) {
      this.chews.push({ t_ms: event.t_ms });
      this._registerChew(event.t_ms);
    }
  }

  _tryDetectBiteEvent() {
    const event = this._detectPeak('mouth_open', this.k_bite, this.minBiteEventIntervalMs, this.biteEvents);
    if (event) {
      this.biteEvents.push({ t_ms: event.t_ms });
      this._closeCurrentBite(event.t_ms);
      this._currentBite = { start_ms: event.t_ms, chew_count: 0, last_chew_t: event.t_ms };
    }
  }

  // Returns {t_ms} if the candidate sample at (samples.length - confirmFrames - 1)
  // qualifies as a peak on the given field, else null.
  _detectPeak(field, k, minIntervalMs, existingEvents) {
    if (this._samples.length < this.confirmFrames * 2 + 1) return null;
    const centerIdx = this._samples.length - this.confirmFrames - 1;
    const candidate = this._samples[centerIdx];
    if (candidate.no_face) return null;
    const cVal = candidate[field];

    // Local max over ±confirmFrames (strict)
    for (let i = centerIdx - this.confirmFrames; i <= centerIdx + this.confirmFrames; i++) {
      if (i === centerIdx) continue;
      if (this._samples[i][field] >= cVal) return null;
    }

    // Adaptive threshold over valid samples
    const valid = this._samples.filter((s) => !s.no_face);
    if (valid.length < this.minValidForThreshold) return null;
    const mean = valid.reduce((a, s) => a + s[field], 0) / valid.length;
    const variance =
      valid.reduce((a, s) => a + (s[field] - mean) ** 2, 0) / valid.length;
    const std = Math.sqrt(variance);
    if (cVal < mean + k * std) return null;

    // Min interval between same-type events
    if (existingEvents.length) {
      const last = existingEvents[existingEvents.length - 1];
      if (candidate.t_ms - last.t_ms < minIntervalMs) return null;
    }

    return { t_ms: candidate.t_ms };
  }

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
