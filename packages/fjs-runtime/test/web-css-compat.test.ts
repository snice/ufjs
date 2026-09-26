// rewriteFjsCss：无单位长度补 px（spec 041 对拍修出）。
//
// JS 引擎把裸数字读成逻辑像素，`padding: 10 12` 是正常页面写法；浏览器
// 视其为非法声明整条丢弃——盒子在 App 有内边距、在 web 没有，差出来的
// 高度曾被当成「Dart 侧多了默认高度」。补 px 在构建期做，dev（vite
// transform）与 build（injectStyle）共用这一份。
import { describe, expect, it } from 'vitest';
import { expandFlexDefault, rewriteFjsCss } from '../src/web/css-compat';
import { BASE_CSS } from '../src/web/base-css';

describe('unitless lengths get px (web == app layout)', () => {
  it('suffixes multi-value padding / margin / border-radius', () => {
    expect(rewriteFjsCss('.a { padding: 10 12 }'))
      .toBe('.a { padding: 10px 12px }');
    expect(rewriteFjsCss('.a { margin: 16 12 0 12 }'))
      .toBe('.a { margin: 16px 12px 0 12px }');
    expect(rewriteFjsCss('.a { border-radius: 8 10 }'))
      .toBe('.a { border-radius: 8px 10px }');
  });

  it('covers every length property the engine reads as px', () => {
    const out = rewriteFjsCss(
      '.a { width: 100; min-height: 40; gap: 8; top: 4; border-bottom-width: 2; font-size: 13; letter-spacing: 1 }',
    );
    expect(out).toContain('width: 100px');
    expect(out).toContain('min-height: 40px');
    expect(out).toContain('gap: 8px');
    expect(out).toContain('top: 4px');
    expect(out).toContain('border-bottom-width: 2px');
    expect(out).toContain('font-size: 13px');
    expect(out).toContain('letter-spacing: 1px');
  });

  it('leaves non-length tokens and non-length properties alone', () => {
    expect(rewriteFjsCss('.a { margin: 0 auto }')).toBe('.a { margin: 0 auto }');
    expect(rewriteFjsCss('.a { width: calc(100% - 32px) }'))
      .toBe('.a { width: calc(100% - 32px) }');
    expect(rewriteFjsCss('.a { width: 50% }')).toBe('.a { width: 50% }');
    expect(rewriteFjsCss('.a { line-height: 1.4 }'))
      .toBe('.a { line-height: 1.4 }'); // a bare number is a multiplier on both ends
    expect(rewriteFjsCss('.a { flex-grow: 2; z-index: 3; font-weight: 500 }'))
      .toBe('.a { flex: 2 1 0%; z-index: 3; font-weight: 500 }');
    expect(rewriteFjsCss('.a { color: #333 }')).toBe('.a { color: #333 }');
  });

  it('keeps already-unit values and !important intact, and is idempotent', () => {
    expect(rewriteFjsCss('.a { padding: 10px 12px !important }'))
      .toBe('.a { padding: 10px 12px !important }');
    const once = rewriteFjsCss('.a { padding: 10 12 }');
    expect(rewriteFjsCss(once)).toBe(once);
  });

  it('does not rewrite lengths inside longer property names', () => {
    // border-width is a length prop; border-bottom-color is not — the
    // boundary is "not part of a longer property name", same as the
    // flex-grow rewriter above it
    expect(rewriteFjsCss('.a { border-bottom-color: 333 }'))
      .toBe('.a { border-bottom-color: 333 }');
  });
});

// @media 块（spec 043）：web 端 @media 由浏览器原生求值，fjs 的三个改写
// 都是全文正则，块内天然覆盖——这里的用例是把它钉住的回归测试，防止将来
// 有人把改写改成「逐顶层块」的处理方式后，media 块内的 fjs 键静默漏改。
describe('@media blocks survive the rewrite', () => {
  it('rewrites fjs keys inside a media block', () => {
    const out = rewriteFjsCss(
      '@media (min-width: 600px) { .a { flex-grow: 1; padding: 10 12 } }',
    );
    expect(out).toContain('@media (min-width: 600px)');
    expect(out).toContain('flex: 1 1 0%');
    expect(out).toContain('padding: 10px 12px');
  });

  it('leaves the condition itself alone (px values, keywords)', () => {
    const css = '@media screen and (min-width: 600px), (orientation: portrait) { .a { color: red } }';
    expect(rewriteFjsCss(css)).toBe(css);
  });

  it('benignly makes a unitless condition value valid CSS', () => {
    // `(min-width: 600)` 是浏览器眼里的非法条件（长度必须带单位，0 除外）；
    // 补上 px 后条件变合法，与 App 端引擎对无单位值的读法一致
    expect(rewriteFjsCss('@media (min-width: 600) { .a { color: red } }'))
      .toBe('@media (min-width: 600px) { .a { color: red } }');
  });
});

// specs/140：display:flex 不写方向，App 端引擎补 row + stretch（层叠级判定）；
// web 把补值放进 @layer fjs-flex，输给任何未分层的作者声明。
describe('flex-direction default (web == engine)', () => {
  const ORDER = '@layer fjs-base, fjs-flex;';
  const FILL = 'flex-direction:row;align-items:stretch';

  it('adds a layered row after a rule that sets display:flex only', () => {
    expect(expandFlexDefault('.a { display: flex; color: red }'))
      .toBe(`${ORDER}.a { display: flex; color: red }@layer fjs-flex{.a{${FILL}}}`);
  });

  it('covers inline-flex, -webkit-flex and !important', () => {
    for (const d of ['inline-flex', '-webkit-flex', 'flex !important']) {
      expect(expandFlexDefault(`.a{display:${d}}`)).toContain(`@layer fjs-flex{.a{${FILL}}}`);
    }
  });

  it('leaves rules that name a direction, or no flex display, alone', () => {
    for (const css of [
      '.a{display:flex;flex-direction:column}',
      '.a{display:flex;flex-flow:column wrap}',
      '.a{display:flex;-webkit-flex-direction:column}',
      '.a{display:block}',
      '.a{display:flexbox-ish}',
      '.a{justify-content:flex-start}',
    ]) {
      expect(expandFlexDefault(css)).toBe(css);
    }
  });

  it('keeps the fill inside @media / @supports, skips @keyframes', () => {
    expect(expandFlexDefault('@media (min-width: 1px) { .a, .b { display: flex } }'))
      .toBe(`${ORDER}@media (min-width: 1px) { .a, .b { display: flex }@layer fjs-flex{.a, .b{${FILL}}} }`);
    expect(expandFlexDefault('@supports (display: flex) { .a { display: flex } }'))
      .toContain(`@layer fjs-flex{.a{${FILL}}}`);
    const kf = '@keyframes k { from { display: flex } }';
    expect(expandFlexDefault(kf)).toBe(kf);
  });

  it('is not fooled by comments or strings', () => {
    expect(expandFlexDefault('/* .x { */ .a { /* display: flex */ display: block }')).not.toContain('@layer');
    expect(expandFlexDefault('.a { content: "}"; display: flex }'))
      .toContain(`@layer fjs-flex{.a{${FILL}}}`);
    expect(expandFlexDefault('/* note */\n.a { display: flex }'))
      .toContain(`@layer fjs-flex{.a{${FILL}}}`);
  });

  it('states the layer order first, after @charset', () => {
    expect(expandFlexDefault('@charset "utf-8";.a{display:flex}'))
      .toBe(`@charset "utf-8";${ORDER}.a{display:flex}@layer fjs-flex{.a{${FILL}}}`);
  });

  it('is idempotent, and part of rewriteFjsCss unless turned off', () => {
    const once = rewriteFjsCss('.a { display: flex; padding: 4 }');
    expect(once).toContain(`@layer fjs-flex{.a{${FILL}}}`);
    expect(rewriteFjsCss(once)).toBe(once);
    expect(rewriteFjsCss('.a { display: flex }', { flexDefault: false })).toBe('.a { display: flex }');
  });

  it('base-css layers the fjs tags\' column under fjs-flex', () => {
    const css = BASE_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toContain(ORDER);
    const base = /@layer fjs-base \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(base).toMatch(/\bview\b[\s\S]*flex-direction: column/);
    // the unlayered tag rule must not name a direction, or it would beat fjs-flex
    const tagRule = /\nview, scroll-view[^{]*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(tagRule).toContain('display: flex');
    expect(tagRule).not.toContain('flex-direction');
    expect(css).toMatch(/@layer fjs-flex \{[\s\S]*\[style\*="display: flex"\][\s\S]*flex-direction: row/);
  });
});
