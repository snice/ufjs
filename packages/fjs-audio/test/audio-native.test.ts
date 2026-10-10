// The native gut: a __fjs host is present, so createAudio() talks the
// fjs.audio.* modules — create with a config snapshot, scalar commands, and
// ended/error coming back through the audio event (45). Separate files per
// environment because the gut choice is decided once, at module load.
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Call {
  name: string;
  args: unknown[];
}

const calls: Call[] = [];

(globalThis as Record<string, unknown>).__fjs = {
  engine: { engineId: 'test-engine', abiVersion: 3 },
  fns: {
    invokeHost: (name: string, ...args: unknown[]) => {
      calls.push({ name, args });
      return 0;
    },
  },
};

// the module reads the door as a global; installing the runtime dispatcher
// publishes it (this is exactly what an app's boot does)
const runtime = await import('@ufjs/runtime');
runtime.installEventDispatcher();

const { createAudio, resetAudioHandles } = await import('../index');

function dispatchAudio(handle: number, payload: string): void {
  (globalThis as { __fjsDispatchEvent?: (id: number, type: number, p: string) => void })
    .__fjsDispatchEvent!(handle, 45, payload);
}

beforeEach(() => {
  calls.length = 0;
  resetAudioHandles();
});

describe('createAudio on the native host', () => {
  it('sends ONE create carrying the config set before src (wx order)', () => {
    const audio = createAudio();
    audio.loop = true;
    audio.autoplay = true;
    audio.src = '/audio/bgm.mp3';
    expect(calls).toEqual([
      {
        name: 'fjs.audio.create',
        args: [
          1,
          '/audio/bgm.mp3',
          JSON.stringify({ loop: true, autoplay: true, volume: 1 }),
        ],
      },
    ]);
  });

  it('reassigning src re-enters create with the same handle and fresh config', () => {
    const audio = createAudio();
    audio.src = '/a.mp3';
    audio.loop = true; // while alive this is a cmd; the NEXT create snapshots it
    audio.src = '/b.mp3';
    expect(calls.map((c) => c.name)).toEqual([
      'fjs.audio.create',
      'fjs.audio.cmd',
      'fjs.audio.create',
    ]);
    expect(calls[2].args[0]).toBe(1);
    expect(calls[2].args[1]).toBe('/b.mp3');
    // the loop set between the two creates carries over
    expect(JSON.parse(calls[2].args[2] as string)).toEqual({
      loop: true,
      autoplay: false,
      volume: 1,
    });
  });

  it('routes play/pause/stop/seek/loop/volume as scalar commands', () => {
    const audio = createAudio();
    audio.src = '/a.mp3';
    calls.length = 0;
    audio.play();
    audio.currentTime = 3.5;
    audio.volume = 0.5;
    audio.loop = false;
    audio.pause();
    audio.stop();
    expect(calls.map((c) => [c.name, c.args])).toEqual([
      ['fjs.audio.cmd', [1, 'play']],
      ['fjs.audio.cmd', [1, 'seek', 3.5]],
      ['fjs.audio.cmd', [1, 'volume', 0.5]],
      ['fjs.audio.cmd', [1, 'loop', false]],
      ['fjs.audio.cmd', [1, 'pause']],
      ['fjs.audio.cmd', [1, 'stop']],
    ]);
    // stop rewinds the JS-side position, wx-style
    expect(audio.currentTime).toBe(0);
  });

  it('dispose on destroy', () => {
    const audio = createAudio();
    audio.src = '/a.mp3';
    calls.length = 0;
    audio.destroy();
    expect(calls).toEqual([{ name: 'fjs.audio.dispose', args: [1] }]);
  });

  it('delivers ended from the host and rewinds', () => {
    const audio = createAudio();
    audio.src = '/a.mp3';
    const ended = vi.fn();
    audio.onEnded = ended;
    audio.currentTime = 7;
    dispatchAudio(1, '{"t":"ended"}');
    expect(ended).toHaveBeenCalledOnce();
    expect(audio.currentTime).toBe(0);
  });

  it('delivers error from the host', () => {
    const audio = createAudio();
    audio.src = '/a.mp3';
    const error = vi.fn();
    audio.onError = error;
    dispatchAudio(1, '{"t":"error","err":"audio load failed: /a.mp3"}');
    expect(error).toHaveBeenCalledWith('audio load failed: /a.mp3');
  });

  it('drops events for destroyed handles', () => {
    const audio = createAudio();
    audio.src = '/a.mp3';
    const ended = vi.fn();
    audio.onEnded = ended;
    audio.destroy();
    dispatchAudio(1, '{"t":"ended"}');
    expect(ended).not.toHaveBeenCalled();
  });

  it('warns once and goes inert when the host has no audio module', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.fn();
    const realInvoke = (globalThis as { __fjs: { fns: { invokeHost: () => void } } }).__fjs
      .fns.invokeHost;
    (globalThis as { __fjs: { fns: { invokeHost: () => void } } }).__fjs.fns.invokeHost =
      () => {
        throw new Error('no such module: fjs.audio.create');
      };
    const first = createAudio();
    first.onError = error;
    first.src = '/a.mp3';
    first.play();
    expect(error).toHaveBeenCalledWith('audio unavailable on this host');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('no fjs.audio module');
    // a SECOND context degrades silently into the same warn
    const second = createAudio();
    second.src = '/b.mp3';
    expect(warn).toHaveBeenCalledTimes(1);
    (
      globalThis as { __fjs: { fns: { invokeHost: () => void } } }
    ).__fjs.fns.invokeHost = realInvoke;
    warn.mockRestore();
  });

  it('refuses to command a context with no src yet, with one warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const audio = createAudio();
    audio.play();
    expect(calls).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('warns once when the runtime predates the dispatcher global', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const real = (globalThis as Record<string, unknown>).__fjsRegisterSystemHandler;
    delete (globalThis as Record<string, unknown>).__fjsRegisterSystemHandler;
    resetAudioHandles();
    const audio = createAudio();
    audio.src = '/a.mp3';
    // commands still went out — only the completion events are lost
    expect(calls[0]?.name).toBe('fjs.audio.create');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('__fjsRegisterSystemHandler');
    (globalThis as Record<string, unknown>).__fjsRegisterSystemHandler = real;
    warn.mockRestore();
  });
});
