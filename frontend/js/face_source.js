/**
 * Subscribes to MediaPipe FaceMesh results and emits per-frame samples.
 *
 * Usage:
 *   const src = new FaceMeshSource(videoEl, (sample) => {...});
 *   await src.start();
 *
 * Each sample is { t_ms, mouth_open, jaw_drop, no_face }:
 *   - mouth_open: normalized vertical lip distance (upper_lip ↔ lower_lip) / face_width
 *   - jaw_drop:   normalized nose-to-chin distance / face_width  (rises when jaw drops)
 *   - no_face:    true when MediaPipe lost the face this frame
 *
 * Loads FaceMesh from CDN; expects window.FaceMesh and window.Camera to be available.
 */
const LM_UPPER_LIP_CENTER = 13;
const LM_LOWER_LIP_CENTER = 14;
const LM_LEFT_CHEEK = 234;
const LM_RIGHT_CHEEK = 454;
const LM_NOSE_TIP = 1;
const LM_CHIN_TIP = 152;

export class FaceMeshSource {
  constructor(videoEl, onSample, now = () => performance.now()) {
    this.videoEl = videoEl;
    this.onSample = onSample;
    this.now = now;
    this._faceMesh = null;
    this._camera = null;
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
      facingMode: 'user',
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
      this.onSample({ t_ms: t, mouth_open: 0, jaw_drop: 0, no_face: true });
      return;
    }
    const u = landmarks[LM_UPPER_LIP_CENTER];
    const l = landmarks[LM_LOWER_LIP_CENTER];
    const lc = landmarks[LM_LEFT_CHEEK];
    const rc = landmarks[LM_RIGHT_CHEEK];
    const n = landmarks[LM_NOSE_TIP];
    const c = landmarks[LM_CHIN_TIP];

    const lipDist = Math.hypot(u.x - l.x, u.y - l.y);
    const faceWidth = Math.hypot(lc.x - rc.x, lc.y - rc.y);
    const jawDist = Math.hypot(n.x - c.x, n.y - c.y);

    const mouth_open = faceWidth > 0 ? lipDist / faceWidth : 0;
    const jaw_drop = faceWidth > 0 ? jawDist / faceWidth : 0;

    this.onSample({ t_ms: t, mouth_open, jaw_drop, no_face: false });
  }
}
