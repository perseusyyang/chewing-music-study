import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaylistPlayer } from '../js/audio_player.js';

// Mock HTMLAudioElement: tracks src, supports play(), pause(), and a manual "ended" event trigger.
class MockAudio {
  constructor() {
    this.src = '';
    this.paused = true;
    this._handlers = {};
    this.playCalls = 0;
  }
  play() { this.paused = false; this.playCalls++; return Promise.resolve(); }
  pause() { this.paused = true; }
  addEventListener(name, fn) { this._handlers[name] = fn; }
  fireEnded() { if (this._handlers.ended) this._handlers.ended(); }
}

describe('PlaylistPlayer', () => {
  let audio;
  beforeEach(() => { audio = new MockAudio(); });

  it('starts with the first track', () => {
    const tracks = [
      { id: 'a', filename: 'a.mp3', title: 'A', duration_sec: 30 },
      { id: 'b', filename: 'b.mp3', title: 'B', duration_sec: 30 },
    ];
    const onTrack = vi.fn();
    const p = new PlaylistPlayer(audio, tracks, '/music/classical/', { onTrack });
    p.start();
    expect(audio.src).toContain('a.mp3');
    expect(audio.paused).toBe(false);
    expect(onTrack).toHaveBeenCalledWith(tracks[0]);
  });

  it('advances to next track on ended', () => {
    const tracks = [
      { id: 'a', filename: 'a.mp3', title: 'A', duration_sec: 30 },
      { id: 'b', filename: 'b.mp3', title: 'B', duration_sec: 30 },
    ];
    const onTrack = vi.fn();
    const p = new PlaylistPlayer(audio, tracks, '/music/classical/', { onTrack });
    p.start();
    audio.fireEnded();
    expect(audio.src).toContain('b.mp3');
    expect(onTrack).toHaveBeenLastCalledWith(tracks[1]);
  });

  it('loops back to first track after last ends', () => {
    const tracks = [
      { id: 'a', filename: 'a.mp3', title: 'A', duration_sec: 30 },
      { id: 'b', filename: 'b.mp3', title: 'B', duration_sec: 30 },
    ];
    const p = new PlaylistPlayer(audio, tracks, '/music/classical/');
    p.start();
    audio.fireEnded();
    audio.fireEnded();
    expect(audio.src).toContain('a.mp3');
  });

  it('records played track IDs (including re-plays on loop)', () => {
    const tracks = [
      { id: 'a', filename: 'a.mp3', title: 'A', duration_sec: 30 },
      { id: 'b', filename: 'b.mp3', title: 'B', duration_sec: 30 },
    ];
    const p = new PlaylistPlayer(audio, tracks, '/music/classical/');
    p.start();
    audio.fireEnded();
    p.stop();
    expect(p.playedIds).toEqual(['a', 'b']);
  });

  it('stop pauses and prevents further advance', () => {
    const tracks = [
      { id: 'a', filename: 'a.mp3', title: 'A', duration_sec: 30 },
      { id: 'b', filename: 'b.mp3', title: 'B', duration_sec: 30 },
    ];
    const p = new PlaylistPlayer(audio, tracks, '/music/classical/');
    p.start();
    p.stop();
    expect(audio.paused).toBe(true);
    audio.fireEnded();
    expect(p.playedIds).toEqual(['a']);
  });
});
