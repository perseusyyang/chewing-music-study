/**
 * AdaptiveAudioPlayer — wraps an HTMLAudioElement with smooth playback-rate
 * control for real-time intervention. Builds on the same sequential-playlist
 * pattern as PlaylistPlayer but adds:
 *
 *   - setTargetRate(rate): request a playback speed (clamped to [minRate, 1.0])
 *   - startSmoothing() / stopSmoothing(): rAF-based exponential easing toward
 *     targetRate so rate changes feel gradual, not jarring.
 *
 * Usage:
 *   const p = new AdaptiveAudioPlayer(new Audio(), tracks, '/music/classical/', {
 *     onTrack: (t) => updateTitle(t.title),
 *     minRate: 0.5,
 *     smoothingFactor: 0.12,
 *   });
 *   p.start();
 *   p.setTargetRate(0.7);   // request slowdown
 *   p.setTargetRate(1.0);   // resume normal speed
 *   p.stop();
 */
export class AdaptiveAudioPlayer {
  constructor(audio, tracks, urlPrefix, options = {}) {
    this.audio = audio;
    this.tracks = tracks;
    this.urlPrefix = urlPrefix;
    this.onTrack = options.onTrack || (() => {});
    this.playedIds = [];

    // Rate-control parameters
    this.minRate = options.minRate ?? 0.5;
    this.smoothingFactor = options.smoothingFactor ?? 0.04;

    // Internal state
    this._stopped = false;
    this._index = 0;
    this._targetRate = 1.0;
    this._currentRate = 1.0;
    this._activeSmoothing = this.smoothingFactor;
    this._smoothingRaf = null;

    this.audio.addEventListener('ended', () => this._handleEnded());
  }

  // ---- public API ----

  start() {
    this._index = 0;
    this._stopped = false;
    this._currentRate = 1.0;
    this._targetRate = 1.0;
    this.audio.playbackRate = 1.0;
    this.startSmoothing();
    this._loadAndPlay();
  }

  stop() {
    this._stopped = true;
    this.stopSmoothing();
    this.audio.pause();
  }

  /**
   * Request a target playback rate. Actual rate eases toward this value via rAF.
   * Clamped internally to [minRate, 1.0].
   *
   * Optional `smoothing` overrides the default smoothingFactor for this
   * transition only (e.g. slower recovery after an intervention ends).
   */
  setTargetRate(rate, smoothing) {
    this._targetRate = Math.max(this.minRate, Math.min(1.0, rate));
    if (smoothing !== undefined) {
      this._activeSmoothing = smoothing;
    } else {
      this._activeSmoothing = this.smoothingFactor;
    }
  }

  /** Returns the current (smoothed) playback rate. */
  get currentRate() {
    return this._currentRate;
  }

  /** Returns the target playback rate (before smoothing). */
  get targetRate() {
    return this._targetRate;
  }

  /**
   * Start the rAF smoothing loop. Called automatically by start(); call manually
   * only if you previously called stopSmoothing() and want to resume.
   */
  startSmoothing() {
    if (this._smoothingRaf) return;
    const loop = () => {
      if (this._stopped && this._currentRate === this._targetRate) {
        this.stopSmoothing();
        return;
      }
      const diff = this._targetRate - this._currentRate;
      if (Math.abs(diff) < 0.001) {
        this._currentRate = this._targetRate;
        this.audio.playbackRate = this._currentRate;
      } else {
        // Exponential ease: each frame closes _activeSmoothing of the gap
        this._currentRate += diff * this._activeSmoothing;
        this.audio.playbackRate = this._currentRate;
      }
      this._smoothingRaf = requestAnimationFrame(loop);
    };
    this._smoothingRaf = requestAnimationFrame(loop);
  }

  stopSmoothing() {
    if (this._smoothingRaf) {
      cancelAnimationFrame(this._smoothingRaf);
      this._smoothingRaf = null;
    }
  }

  // ---- internal ----

  _loadAndPlay() {
    if (this._stopped) return;
    const track = this.tracks[this._index];
    if (!track) return;
    this.audio.src = this.urlPrefix + track.filename;
    this.playedIds.push(track.id);
    this.onTrack(track);
    this.audio.play();
  }

  _handleEnded() {
    if (this._stopped) return;
    this._index = (this._index + 1) % this.tracks.length;
    this._loadAndPlay();
  }
}
