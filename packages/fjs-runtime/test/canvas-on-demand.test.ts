// specs/185: the element layer does not import the 2d implementation; the
// canvas surface installs itself when something (the canvas component's
// registration) imports it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setOpSink } from '../src/host';
import { create } from '../src/ui/element';

beforeEach(() => setOpSink(() => {}));
afterEach(() => setOpSink(null));

describe('canvas surface on demand (specs/185)', () => {
  it('an inner-canvas without the surface loaded warns; once loaded, it gets getContext', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bare = create('inner-canvas') as unknown as Record<string, unknown>;
    expect(bare.getContext).toBeUndefined();
    expect(warn.mock.calls.some((c) => String(c[0]).includes('no canvas surface'))).toBe(true);
    warn.mockRestore();

    await import('../src/canvas/surface');
    const canvas = create('inner-canvas') as unknown as { getContext: (t: string) => unknown };
    expect(typeof canvas.getContext).toBe('function');
    expect(canvas.getContext('2d')).not.toBeNull();
  });
});
