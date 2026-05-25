/**
 * Sequentially plays a list of tracks from a music URL prefix, recording
 * which tracks were played for later upload. Loops to track 0 after the last.
 *
 * Usage:
 *   const p = new PlaylistPlayer(new Audio(), tracks, '/music/classical/', {
 *     onTrack: (track) => updateTitle(track.title),
 *   });
 *   p.start();   // begins playing first track
 *   p.stop();    // pauses and stops advancing
 *   p.playedIds; // ['cl_03', 'cl_07', ...]  (entries appended on each play, including loops)
 */
export class PlaylistPlayer {
  constructor(audio, tracks, urlPrefix, options = {}) {
    this.audio = audio;
    this.tracks = tracks;
    this.urlPrefix = urlPrefix;
    this.onTrack = options.onTrack || (() => {});
    this.playedIds = [];
    this._stopped = false;
    this._index = 0;
    this.audio.addEventListener('ended', () => this._handleEnded());
  }

  start() {
    this._index = 0;
    this._stopped = false;
    this._loadAndPlay();
  }

  stop() {
    this._stopped = true;
    this.audio.pause();
  }

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
