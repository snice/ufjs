// The web gut: no __fjs, so createAudio() wraps an HTMLAudioElement. The
// Audio constructor is mocked with the slice of the DOM surface the wrapper
// touches — property mirrors, event listeners, and play() returning the
// promise the autoplay-policy path hangs on. Separate file from
// audio-native.test.ts because the gut choice is decided once, at module
// load.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class MockAudio {
  static instances: MockAudio[] = [];

  src = '';
  loop = false;
  volume = 1;
  currentTime = 0;
  duration = NaN;
  paused = true;

  readonly listeners = new Map<string, Array<(event?: unknown) => void>>();

  playCalls = 0;
  pauseCalls = 0;

  constructor() {
    MockAudio.instances.push(this);
  }

  play(): Promise<void> {
    this.playCalls++;
    return this.playResult ?? Promise.resolve();
  }

  pause(): void {
    this.pauseCalls++;
    this.paused = true;
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.src = '';
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  addEventListener(type: string, listener: (event?: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  playResult: Promise<void> | null = null;
}

(globalThis as Record<string, unknown>).Audio = MockAudio;

const { createAudio, resetAudioHandles } = await import('../index');

beforeEach(() => {
  MockAudio.instances.length = 0;
  resetAudioHandles();
});

describe('createAudio on the web', () => {
  it('wraps one Audio element and resolves the src the same way <image> does', () => {
    const audio = createAudio();
    audio.src = '/plane-war/audio/bgm.mp3';
    expect(MockAudio.instances).toHaveLength(1);
    expect(MockAudio.instances[0].src).toBe('/plane-war/audio/bgm.mp3');
    // the legacy asset:// spelling the bundler used to emit
    audio.src = 'asset://x.png';
    expect(MockAudio.instances[0].src).toBe('/x.png');
  });

  it('plays on src when autoplay is set first (wx order), with loop', () => {
    const audio = createAudio();
    audio.loop = true;
    audio.autoplay = true;
    const play = vi.fn();
    audio.onPlay = play;
    audio.src = '/bgm.mp3';
    expect(MockAudio.instances[0].loop).toBe(true);
    expect(MockAudio.instances[0].playCalls).toBe(1);
    expect(play).toHaveBeenCalledOnce();
  });

  it('play/pause/stop drive the element and fire the optimistic callbacks', () => {
    const audio = createAudio();
    audio.src = '/shot.mp3';
    const el = MockAudio.instances[0];
    const onPlay = vi.fn();
    const onPause = vi.fn();
    const onStop = vi.fn();
    audio.onPlay = onPlay;
    audio.onPause = onPause;
    audio.onStop = onStop;
    audio.play();
    expect(el.playCalls).toBe(1);
    expect(onPlay).toHaveBeenCalledOnce();
    audio.pause();
    expect(el.pauseCalls).toBe(1);
    expect(onPause).toHaveBeenCalledOnce();
    el.currentTime = 4.2;
    audio.stop();
    expect(el.currentTime).toBe(0);
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('ended arrives from the element event, error carries the source', () => {
    const audio = createAudio();
    audio.src = '/boom.mp3';
    const el = MockAudio.instances[0];
    const ended = vi.fn();
    const error = vi.fn();
    audio.onEnded = ended;
    audio.onError = error;
    el.emit('ended');
    expect(ended).toHaveBeenCalledOnce();
    el.emit('error');
    expect(error).toHaveBeenCalledWith('audio load failed: /boom.mp3');
  });

  it('a rejected play() (autoplay policy) is a warning, not a crash', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const audio = createAudio();
    MockAudio.instances[0].playResult = Promise.reject(new Error('not allowed'));
    audio.src = '/bgm.mp3';
    audio.autoplay = true; // triggers play on an src that is already set
    await Promise.resolve();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('autoplay policy');
    warn.mockRestore();
  });

  it('duration reads 0 while the element has no metadata', () => {
    const audio = createAudio();
    audio.src = '/a.mp3';
    expect(audio.duration).toBe(0);
    MockAudio.instances[0].duration = 3.5;
    expect(audio.duration).toBe(3.5);
  });

  it('destroy stops the element and detaches the callbacks', () => {
    const audio = createAudio();
    audio.src = '/bgm.mp3';
    const el = MockAudio.instances[0];
    const ended = vi.fn();
    audio.onEnded = ended;
    audio.destroy();
    expect(el.pauseCalls).toBe(1);
    expect(el.src).toBe('');
    el.emit('ended');
    expect(ended).not.toHaveBeenCalled();
  });

  it('a page-level wx SHIM does not hijack the gut into recursion', () => {
    // the plane-war adapter installs wx.createInnerAudioContext implemented
    // AS createAudio() — if the wx gut were preferred whenever that global
    // exists, the web page would recurse to oblivion on the first Music
    const seen: string[] = [];
    (globalThis as Record<string, unknown>).wx = {
      createInnerAudioContext: () => {
        seen.push('wx gut reached');
        throw new Error('recursion guard');
      },
    };
    try {
      const audio = createAudio();
      audio.src = '/bgm.mp3';
      expect(MockAudio.instances).toHaveLength(1);
      expect(seen).toEqual([]);
    } finally {
      delete (globalThis as Record<string, unknown>).wx;
    }
  });
});
