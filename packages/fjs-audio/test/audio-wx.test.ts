// The wx gut: no __fjs and no Audio, but a wx global with
// createInnerAudioContext — the mini-program target. WeChat is the most
// complete audio end, so the gut forwards and re-shapes; this file pins the
// reshape (property surface, callback re-assignment, errMsg unwrapping).
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface WxPlayback {
  src: string;
  loop: boolean;
  autoplay: boolean;
  volume: number;
  duration: number;
  currentTime: number;
  destroyed: boolean;
  playCalls: number;
  seeks: number[];
}

const playback = new Map<number, WxPlayback>();
let nextWxId = 1;
const wxEnded = new Map<number, () => void>();
const wxErrors = new Map<number, (err: { errMsg?: string }) => void>();

function fakeWx(): unknown {
  return {
    createInnerAudioContext: () => {
      const id = nextWxId++;
      const ctx: WxPlayback = {
        src: '',
        loop: false,
        autoplay: false,
        volume: 1,
        duration: 0,
        currentTime: 0,
        destroyed: false,
        playCalls: 0,
        seeks: [],
      };
      playback.set(id, ctx);
      return {
        get src() {
          return ctx.src;
        },
        set src(v: string) {
          ctx.src = v;
        },
        get loop() {
          return ctx.loop;
        },
        set loop(v: boolean) {
          ctx.loop = v;
        },
        get autoplay() {
          return ctx.autoplay;
        },
        set autoplay(v: boolean) {
          ctx.autoplay = v;
        },
        get volume() {
          return ctx.volume;
        },
        set volume(v: number) {
          ctx.volume = v;
        },
        get duration() {
          return ctx.duration;
        },
        get currentTime() {
          return ctx.currentTime;
        },
        play() {
          ctx.playCalls++;
        },
        pause() {},
        stop() {
          ctx.currentTime = 0;
        },
        seek(position: number) {
          ctx.seeks.push(position);
        },
        destroy() {
          ctx.destroyed = true;
        },
        onPlay(cb: () => void) {},
        onPause(cb: () => void) {},
        onStop(cb: () => void) {},
        onEnded(cb: () => void) {
          wxEnded.set(id, cb);
        },
        onError(cb: (err: { errMsg?: string }) => void) {
          wxErrors.set(id, cb);
        },
        offPlay(cb: () => void) {},
        offPause(cb: () => void) {},
        offStop(cb: () => void) {},
        offEnded(cb: () => void) {},
      };
    },
  };
}

(globalThis as Record<string, unknown>).wx = fakeWx();

const { createAudio, resetAudioHandles } = await import('../index');

beforeEach(() => {
  playback.clear();
  wxEnded.clear();
  wxErrors.clear();
  resetAudioHandles();
});

describe('createAudio on wx (mp target)', () => {
  it('forwards the whole property surface to the real context', () => {
    const audio = createAudio();
    audio.loop = true;
    audio.autoplay = true;
    audio.src = 'audio/bgm.mp3';
    audio.volume = 0.5;
    const ctx = [...playback.values()][0];
    expect(ctx.loop).toBe(true);
    expect(ctx.autoplay).toBe(true);
    expect(ctx.src).toBe('audio/bgm.mp3');
    expect(ctx.volume).toBe(0.5);
  });

  it('play/pause/stop/seek/currentTime hit the context', () => {
    const audio = createAudio();
    const ctx = [...playback.values()][0];
    audio.play();
    expect(ctx.playCalls).toBe(1);
    audio.currentTime = 2;
    expect(ctx.seeks).toEqual([2]);
    audio.stop();
    expect(ctx.currentTime).toBe(0);
  });

  it('ended and error (errMsg unwrapped) arrive from wx callbacks', () => {
    const audio = createAudio();
    const ended = vi.fn();
    const error = vi.fn();
    audio.onEnded = ended;
    audio.onError = error;
    const id = [...playback.keys()][0];
    wxEnded.get(id)!();
    wxErrors.get(id)!({ errMsg: 'decode failed' });
    expect(ended).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith('decode failed');
  });

  it('reassigning onEnded swaps the wx registration (off/on)', () => {
    const audio = createAudio();
    const first = vi.fn();
    const second = vi.fn();
    audio.onEnded = first;
    audio.onEnded = second;
    const id = [...playback.keys()][0];
    wxEnded.get(id)!();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('destroy releases the context', () => {
    const audio = createAudio();
    const ctx = [...playback.values()][0];
    audio.destroy();
    expect(ctx.destroyed).toBe(true);
  });
});
