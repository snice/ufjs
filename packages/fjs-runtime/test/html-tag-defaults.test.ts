// specs/073: HTML block containers map to fjs views with the CSS initial
// `flex-shrink: 1` restored as an element default. The Dart side keys its
// no-shrink pin off the MAPPED tag (_noShrinkTags), so without the default a
// vant `.van-skeleton__content { width: 100% }` held its full width beside a
// fixed avatar and pushed the row past the edge — web never had the bug,
// because there the div stays a real DOM node with the CSS initial.
//
// specs/100 pins the other direction: the label element must NOT get
// element-declared defaults (margin / color / font-size). They beat
// inheritance, so vant's `.van-field__label { color: … }` styled the
// wrapper while the inner text kept the default grey, and the margin
// pushed the label off the input's line — on both platforms.
import { describe, expect, it } from 'vitest';
import { resolveHtmlTag } from '../src/vue/renderer';
import { BASE_CSS } from '../src/web/base-css';

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

  it('label carries no style defaults on the compat-table side', () => {
    // maps to itself (it is an fjs tag), but declares nothing: a
    // margin/color/font-size here would beat every stylesheet's
    // inheritance into the element (specs/100)
    const resolved = resolveHtmlTag('label');
    expect(resolved?.tag).toBe('label');
    const style = resolved?.defaults.style ?? {};
    expect('margin' in style).toBe(false);
    expect('color' in style).toBe(false);
    expect('fontSize' in style).toBe(false);
  });

  it('the web label rule keeps only its container behavior', () => {
    const m = /(?:^|\n)label \{([^}]*)\}/.exec(BASE_CSS);
    expect(m).not.toBeNull();
    const body = m![1]!;
    expect(body).toContain('display: flex');
    expect(body).not.toMatch(/margin/);
    expect(body).not.toMatch(/color/);
    expect(body).not.toMatch(/font-size/);
  });
});
