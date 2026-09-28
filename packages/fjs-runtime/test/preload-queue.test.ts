// specs/143 — the idle-time page preload queue both routers share: one page
// at a time, each path once, a failure reported and skipped.
import { describe, expect, it, vi } from 'vitest';
import { startPreloadQueue } from '../src/router/preload-queue';

describe('startPreloadQueue', () => {
  it('loads each distinct path once, strictly one after the other', async () => {
    const log: string[] = [];
    let release: (() => void) | null = null;
    const queue = startPreloadQueue(['/a', '/b', '/a'], (p) => {
      log.push(`start ${p}`);
      return new Promise<void>((resolve) => {
        release = () => {
          log.push(`end ${p}`);
          resolve();
        };
      });
    });
    await Promise.resolve();
    expect(log).toEqual(['start /a']); // /b waits for /a
    release!();
    await new Promise((r) => setTimeout(r, 0));
    release!();
    await queue.done;
    expect(log).toEqual(['start /a', 'end /a', 'start /b', 'end /b']);
  });

  it('warns about a failed page and carries on with the rest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const done: string[] = [];
      const queue = startPreloadQueue(['/bad', '/good'], async (p) => {
        if (p === '/bad') throw new Error('chunk not found');
        done.push(p);
      });
      await queue.done;
      expect(done).toEqual(['/good']);
      expect(warn.mock.calls.some((c) => String(c[0]).includes('preload /bad failed: Error: chunk not found'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('stop() lets the page in flight finish and starts no other', async () => {
    const started: string[] = [];
    let release!: () => void;
    const queue = startPreloadQueue(['/a', '/b', '/c'], (p) => {
      started.push(p);
      return new Promise<void>((resolve) => (release = resolve));
    });
    queue.stop(); // while /a is in flight
    release();
    await queue.done;
    expect(started).toEqual(['/a']);
  });
});
