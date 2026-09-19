// specs/071: the `font` shorthand and `@font-face` on the App path. The
// renderer-level check (private-use glyphs pass only for a declared font)
// lives with the other pseudo-element tests in vue_overlay_pseudo.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fontFamilyList, parseFontShorthand } from '../src/css/font-shorthand';
import { registerFontFace, setFontLoaderForTest, usesDeclaredFont } from '../src/css/font-face';
import { parseStylesheet } from '../src/css/parser';
import { StyleEngine } from '../src/css/style';

async function styleTick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('font shorthand', () => {
  it('splits style, weight, size, line-height and family', () => {
    expect(parseFontShorthand('italic bold 14px/1.5 "vant-icon", Arial')).toEqual({
      fontStyle: 'italic',
      fontWeight: 'bold',
      fontSize: '14px',
      lineHeight: '1.5',
      fontFamily: '"vant-icon", Arial',
    });
    // vant's spelling: variant/stretch `normal`s, no spaces around the slash
    expect(parseFontShorthand('normal normal normal 14px/1 "vant-icon"')).toMatchObject({
      fontStyle: 'normal',
      fontWeight: 'normal',
      fontSize: '14px',
      lineHeight: '1',
      fontFamily: '"vant-icon"',
    });
    // omitted parts reset to normal; spaced slash
    expect(parseFontShorthand('12px / 20px serif')).toMatchObject({ fontSize: '12px', lineHeight: '20px', fontWeight: 'normal' });
    expect(parseFontShorthand('600 1.2em sans-serif')).toMatchObject({ fontWeight: '600', fontSize: '1.2em' });
  });

  it('rejects what is not a size + family shorthand', () => {
    expect(parseFontShorthand('caption')).toBeNull();
    expect(parseFontShorthand('bold 14px')).toBeNull();
    expect(parseFontShorthand('"vant-icon"')).toBeNull();
  });

  it('expands at parse time so later longhands in the rule win', () => {
    const [rule] = parseStylesheet('.i { font: bold 14px/1 "my-icons"; font-size: 20px }', null, 0);
    expect(rule.decls).toEqual({
      fontStyle: 'normal',
      fontWeight: 'bold',
      fontSize: 20,
      lineHeight: '1',
      fontFamily: '"my-icons"',
    });
  });

  it('defers the split until var() is substituted (vant .van-icon)', async () => {
    const parentOf = new Map<number, number | null>([[1, null], [2, 1]]);
    const childrenOf = new Map<number, number[]>([[1, [2]], [2, []]]);
    const applied = new Map<number, Record<string, unknown>>();
    const engine = new StyleEngine(parentOf, childrenOf, (id, style) => applied.set(id, style));
    engine.register(
      null,
      `.box { font-size: 22px }
       .van-icon { font: normal normal normal 14px/1 var(--van-icon-font-family, "vant-icon"); font-size: inherit }`,
    );
    engine.ensure(1, 'view');
    engine.ensure(2, 'view');
    engine.setClasses(1, 'box');
    engine.setClasses(2, 'van-icon');
    await styleTick();
    expect(applied.get(2)).toMatchObject({
      fontFamily: '"vant-icon"',
      lineHeight: '1',
      fontSize: 22, // `font-size: inherit` after the shorthand wins
      fontWeight: 'normal',
    });
  });

  it('expands the CSS-wide keywords', () => {
    const [rule] = parseStylesheet('.b { font: inherit }', null, 0);
    expect(rule.decls).toEqual({
      fontStyle: 'inherit',
      fontWeight: 'inherit',
      fontSize: 'inherit',
      lineHeight: 'inherit',
      fontFamily: 'inherit',
    });
  });

  it('reads a font-family stack', () => {
    expect(fontFamilyList(`"vant-icon", 'Helvetica Neue', arial`)).toEqual(['vant-icon', 'Helvetica Neue', 'arial']);
    expect(fontFamilyList(undefined)).toEqual([]);
  });
});

describe('@font-face registry', () => {
  const loads: [string, string][] = [];
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    loads.length = 0;
    setFontLoaderForTest((family, url) => loads.push([family, url]));
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    setFontLoaderForTest(null);
    warn.mockRestore();
  });

  it('collects @font-face instead of warning it away', () => {
    const faces: { family: string; src: string }[] = [];
    const rules = parseStylesheet(
      '@font-face{font-family:"my";src:url(data:font/ttf;charset=utf-8;base64,AAEAAA==) format("truetype")}.a{color:red}',
      null,
      0,
      faces,
    );
    expect(rules).toHaveLength(1);
    expect(faces).toEqual([{ family: '"my"', src: 'url(data:font/ttf;charset=utf-8;base64,AAEAAA==) format("truetype")' }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('loads the first TrueType data URL, skipping remote sources', () => {
    registerFontFace({
      family: '"vant-icon"',
      src: 'url(//at.alicdn.com/x.woff) format("woff"),url(data:font/ttf;base64,AAEAAA==) format("truetype")',
    });
    expect(loads).toEqual([['vant-icon', 'data:font/ttf;base64,AAEAAA==']]);
    expect(usesDeclaredFont('"Vant-Icon", sans-serif')).toBe(true);
    expect(usesDeclaredFont('sans-serif')).toBe(false);
  });

  it('loads a font once across re-registrations (dev hot reload)', () => {
    const face = { family: 'a', src: 'url(data:font/otf;base64,T1RUTw==)' };
    registerFontFace(face);
    registerFontFace(face);
    expect(loads).toHaveLength(1);
  });

  it('warns, naming the family, when nothing is loadable', () => {
    registerFontFace({ family: 'remote-only', src: 'url(https://x.test/a.woff2) format("woff2"), local("A")' });
    expect(loads).toHaveLength(0);
    expect(String(warn.mock.calls[0][0])).toContain('"remote-only"');
    // nothing to load: its glyphs stay out (empty box, like a failed web font)
    expect(usesDeclaredFont('remote-only')).toBe(false);
  });

  it('warns about unicode-range and loads the whole font', () => {
    registerFontFace({ family: 'sub', src: 'url(data:font/ttf;base64,AAEAAA==)', unicodeRange: 'U+E000-E0FF' });
    expect(loads).toHaveLength(1);
    expect(String(warn.mock.calls[0][0])).toContain('unicode-range');
  });
});
