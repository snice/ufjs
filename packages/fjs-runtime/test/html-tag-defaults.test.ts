// specs/073: HTML block containers map to fjs views with the CSS initial
// `flex-shrink: 1` restored as an element default. The Dart side keys its
// no-shrink pin off the MAPPED tag (_noShrinkTags), so without the default a
// vant `.van-skeleton__content { width: 100% }` held its full width beside a
// fixed avatar and pushed the row past the edge — web never had the bug,
// because there the div stays a real DOM node with the CSS initial.
import { describe, expect, it } from 'vitest';
import { resolveHtmlTag } from '../src/vue/renderer';

describe('html tag defaults carry the CSS flex-shrink initial', () => {
  it('block containers default to shrinkable', () => {
    for (const tag of [
      'div', 'section', 'main', 'article', 'aside', 'nav', 'header', 'footer',
      'ul', 'ol', 'li', 'table', 'td', 'th',
    ]) {
      expect(resolveHtmlTag(tag)?.defaults.style, tag).toMatchObject({ flexShrink: 1 });
    }
  });

  it('tr keeps its row direction alongside the default', () => {
    expect(resolveHtmlTag('tr')?.defaults.style).toEqual({
      flexDirection: 'row',
      flexShrink: 1,
    });
  });

  it('mapped text tags keep the view behavior (no shrink default)', () => {
    expect(resolveHtmlTag('span')?.defaults.style).toBeUndefined();
    expect('flexShrink' in (resolveHtmlTag('h3')?.defaults.style ?? {})).toBe(false);
  });

  it('unknown tags stay unmapped', () => {
    expect(resolveHtmlTag('fancy-widget')).toBeNull();
  });
});
