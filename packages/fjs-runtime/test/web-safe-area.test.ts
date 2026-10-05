// @vitest-environment happy-dom
// <safe-area scale> (specs/210 §8): the attribute becomes the CSS variable
// the base stylesheet multiplies each inset by, and the author's own style
// still rides along (an inline padding-* beats the stylesheet rule — that is
// the "declared padding replaces the inset" contract).
import { describe, expect, it } from 'vitest';
import { createApp, h } from 'vue';
import { FjsSafeArea } from '../src/web/components/basic';

function mount(props: Record<string, unknown>): HTMLElement {
  const el = document.createElement('div');
  createApp({ render: () => h(FjsSafeArea, props, { default: () => 'x' }) }).mount(el);
  return el.querySelector('safe-area') as HTMLElement;
}

describe('web safe-area scale', () => {
  it('maps scale to --fjs-safe-scale, clamped to 0..1', () => {
    expect(mount({ scale: 0.5 }).style.getPropertyValue('--fjs-safe-scale')).toBe('0.5');
    expect(mount({ scale: 3 }).style.getPropertyValue('--fjs-safe-scale')).toBe('1');
  });
  it('leaves the variable unset without scale, and keeps the author style', () => {
    const plain = mount({ edges: 'bottom' });
    expect(plain.style.getPropertyValue('--fjs-safe-scale')).toBe('');
    const el = mount({ scale: 0.5, style: { paddingBottom: 6 } });
    expect(el.style.paddingBottom).toBe('6px');
    expect(el.hasAttribute('scale')).toBe(false);
  });
});
