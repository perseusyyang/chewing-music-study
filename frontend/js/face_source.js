/**
 * Subscribes to MediaPipe FaceMesh results and emits normalized mouth_open
 * samples to a callback.
 *
 * Usage:
 *   const src = new FaceMeshSource(videoEl, (t_ms, mouth_open, no_face) => {...});
 *   await src.start();
 *   // ... later:
 *   src.stop();
 *
 * Loads FaceMesh from CDN; expects window.FaceMesh and window.Camera
 * (the legacy MediaPipe FaceMesh API) to be available — see index.html
 * for the script tags.
 */
const LM_UPPER_LIP_CENTER = 13;
const LM_LOWER_LIP_CENTER = 14;
const LM_LEFT_CHEEK = 234;
const LM_RIGHT_CHEEK = 454;

export class FaceMeshSource {
  /**
   * @param {HTMLVideoElement} videoEl
   * @param {(t_ms:number, mouth_open:number, no_face:boolean) => void} onSample
   * @param {() => number} now Optional, returns ms since session start
   */
  constructor(videoEl, onSample, now = () => performance.now()) {
    this.videoEl = videoEl;
    this.onSample = onSample;
    this.now = now;
    this._faceMesh = null;
    this._camera = null;
    this._lastFaceMs = null;
    this._noFaceTimeoutMs = 1000;
  }

  async start() {
    if (typeof window.FaceMesh === 'undefined') {
      throw new Error('MediaPipe FaceMesh script not loaded');
    }
    this._faceMesh = new window.FaceMesh({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });
    this._faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    this._faceMesh.onResults((res) => this._handleResults(res));

    this._camera = new window.Camera(this.videoEl, {
      onFrame: async () => {
        await this._faceMesh.send({ image: this.videoEl });
      },
      width: 640,
      height: 480,
    });
    await this._camera.start();
  }

  stop() {
    if (this._camera) this._camera.stop();
    if (this._faceMesh) this._faceMesh.close();
    this._camera = null;
    this._faceMesh = null;
  }

  _handleResults(res) {
    const t = this.now();
    const landmarks = res.multiFaceLandmarks && res.multiFaceLandmarks[0];
    if (!landmarks) {
      this.onSample(t, 0, true);
      return;
    }
    const u = landmarks[LM_UPPER_LIP_CENTER];
    const l = landmarks[LM_LOWER_LIP_CENTER];
    const lc = landmarks[LM_LEFT_CHEEK];
    const rc = landmarks[LM_RIGHT_CHEEK];
    const lipDist = Math.hypot(u.x - l.x, u.y - l.y);
    const faceWidth = Math.hypot(lc.x - rc.x, lc.y - rc.y);
    const mouth_open = faceWidth > 0 ? lipDist / faceWidth : 0;
    this._lastFaceMs = t;
    this.onSample(t, mouth_open, false);
  }
}
