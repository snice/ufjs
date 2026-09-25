// Pins the `fjs lint` support table (src/css/support.ts) to what the CSS
// engine actually does, entry class by entry class, so the table cannot
// drift from the engine unnoticed. Where the JS side cannot observe the
// behavior (a dropped property passes through to the Dart renderer), the
// test asserts the structural sanity of the entry instead and says so —
// prose sync with docs/css-compat.md stays a human process, pointed at
// from both sides (css-compat §7).
//
// Also guards the other hand-maintained mirror: every tag in tags.json /
// component-tags.json must have a GlobalComponents entry in
// vue-global.d.ts (spec 087's "tags.json → 组件 d.ts" — the runtime's
// component types are hand-written, so only a test catches a tag added
// without its type).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseMediaCondition,
  parseSelector,
  parseStylesheet,
} from '../src/css/parser';
import {
  DROPPED_AT_RULES,
  DROPPED_PROPERTIES,
  KEYFRAMES_ANIMATABLE_ON_APP,
  SUPPORTED_ATTR_SELECTORS,
  SUPPORTED_NOT_ARGS,
  SUPPORTED_PSEUDO_CLASSES,
  SUPPORTED_PSEUDO_ELEMENTS,
  TRANSITIONABLE_ON_APP,
  UNSUPPORTED_DISPLAY_VALUES,
  UNSUPPORTED_SIZE_KEYWORDS,
  UNSUPPORTED_UNITS,
  VERTICAL_ALIGN_VALUES,
} from '../src/css/support';

describe('support table vs engine: selectors', () => {
  it('id selectors: bare #id is dead; with a descendant it silently WIDENS', () => {
    expect(parseSelector('#header')).toBeNull();
    // the dead compound is dropped and pending-parsing continues, so
    // `#header .title` degrades to matching ANY .title — worse than a
    // dead rule, and why lint reports id selectors drop-level.
    const widened = parseSelector('#header .title');
    expect(widened).not.toBeNull();
    expect(widened!.compounds).toHaveLength(1);
    expect(widened!.compounds[0]!.classes).toEqual(['title']);
  });

  it('~ combinator silently degrades to descendant — lint drops it', () => {
    const sel = parseSelector('.a ~ .b');
    expect(sel).not.toBeNull();
    // CSS `a ~ b` means "b preceded somewhere by a sibling a"; the engine
    // has no such combinator and falls back to plain descendant, which
    // matches MORE than CSS says. Never a nextSibling.
    expect(sel!.combinators).toEqual(['descendant']);
  });

  it(':nth-child drops the rule', () => {
    expect(parseSelector('.row:nth-child(2)')).toBeNull();
  });

  it(':not() accepts only the structural pair', () => {
    expect(parseSelector('.p:not(:first-child)')).not.toBeNull();
    expect(parseSelector('.p:not(:last-child)')).not.toBeNull();
    expect(parseSelector('.p:not(:nth-child(2))')).toBeNull();
    expect(parseSelector('.p:not(.x)')).toBeNull();
  });

  it('::placeholder parses as the placeholder pseudo; the rest still drop', () => {
    // specs/100: it styles the input's hint text (carried as the
    // placeholderStyle prop), so it joined the supported set
    expect(parseSelector('input::placeholder')?.pseudo).toBe('placeholder');
    expect(parseSelector('.a::before')?.pseudo).toBe('before');
    expect(parseSelector('.a::selection')).toBeNull();
    // -webkit-input-placeholder is NOT stripped: only ::placeholder is a
    // recognized tail, so the legacy spelling falls into the
    // unsupported-syntax branch and drops (web doesn't need the engine)
    expect(parseSelector('input::-webkit-input-placeholder')).toBeNull();
  });

  it('attribute selectors match only [class]', () => {
    expect(parseSelector('[type=search]')).toBeNull();
    expect(parseSelector('[class*="van-hairline"]')).not.toBeNull();
  });

  it('the supported sets name exactly what parseSelector accepts', () => {
    // over-listing in SUPPORTED_* would make lint under-report; these are
    // the names the parser is known to handle
    for (const name of SUPPORTED_PSEUDO_CLASSES) {
      if (name === 'active' || name === 'hover') continue; // subject-only, parser rejects them elsewhere by design
      expect(parseSelector(`.a:${name}`)).not.toBeNull();
    }
    for (const arg of SUPPORTED_NOT_ARGS) {
      expect(parseSelector(`.a:not(${arg})`)).not.toBeNull();
      // the parser slices '(' and ':' together — an argument without its
      // own colon is mangled, so the table stores the colon spelling
      expect(parseSelector(`.a:not(${arg.slice(1)})`)).toBeNull();
    }
    for (const el of SUPPORTED_PSEUDO_ELEMENTS) {
      expect(parseSelector(`.a::${el}`)).not.toBeNull();
    }
    for (const attr of SUPPORTED_ATTR_SELECTORS) {
      expect(parseSelector(`[${attr}*=x]`)).not.toBeNull();
    }
  });
});

describe('support table vs engine: at-rules and media', () => {
  it('@supports blocks produce no rules', () => {
    const rules = parseStylesheet(
      '@supports (display: grid) { .x { color: red; } }',
      null,
      0,
    );
    expect(rules).toHaveLength(0);
  });

  it('@import swallows the following rule with it', () => {
    const rules = parseStylesheet(
      "@import './other.css';\n.x { color: red; }",
      null,
      0,
    );
    // the parser treats `@import …; .x` as one at-rule selector and skips
    // its block — so an @import costs the NEXT rule too, not just itself.
    // That collateral damage is exactly why lint flags it drop-level.
    expect(rules).toHaveLength(0);
  });

  it('@media: only the documented feature set parses', () => {
    expect(parseMediaCondition('print')).toBeNull();
    expect(parseMediaCondition('(prefers-reduced-motion: reduce)')).toBeNull();
    expect(parseMediaCondition('(min-width: 600px)')).not.toBeNull();
    expect(parseMediaCondition('(orientation: landscape)')).not.toBeNull();
  });
});

describe('support table: entries the JS side cannot observe', () => {
  // DROPPED_PROPERTIES / display values / units are honored-or-dropped at
  // the Dart renderer (style.dart reads known keys; unknown ones fall out
  // of the widget config). Pin structure and the "does not list supported
  // keys" invariant instead — the drift that would actually hurt.
  it('dropped properties carry a hint and none of them is a core supported key', () => {
    const supported = new Set([
      'width', 'height', 'margin', 'padding', 'color', 'background-color',
      'opacity', 'transform', 'transition', 'animation', 'display',
      'position', 'top', 'left', 'z-index', 'flex-grow', 'gap',
      'font-size', 'line-height', 'text-align', 'border-radius',
      'overflow', 'vertical-align', 'box-shadow', 'white-space',
    ]);
    for (const [key, hint] of Object.entries(DROPPED_PROPERTIES)) {
      expect(key).toMatch(/^[a-z-]+$/);
      expect(hint.length).toBeGreaterThan(0);
      expect(supported.has(key)).toBe(false);
    }
  });

  it('value-level sets stay minimal and kebab/canonical', () => {
    expect(UNSUPPORTED_DISPLAY_VALUES.has('flex')).toBe(false);
    for (const unit of UNSUPPORTED_UNITS) expect(unit).toMatch(/^v[wh]?(min|max)?$/);
    expect(VERTICAL_ALIGN_VALUES.has('middle')).toBe(false);
    expect(VERTICAL_ALIGN_VALUES.has('sub')).toBe(true);
    // fit-content is supported (specs/138); only its siblings are dropped
    expect(UNSUPPORTED_SIZE_KEYWORDS.has('fit-content')).toBe(false);
    expect([...UNSUPPORTED_SIZE_KEYWORDS].sort()).toEqual(['max-content', 'min-content']);
  });

  it('animation sets cover the css-compat named properties', () => {
    for (const key of ['transform', 'opacity']) {
      expect(TRANSITIONABLE_ON_APP.has(key)).toBe(true);
      expect(KEYFRAMES_ANIMATABLE_ON_APP.has(key)).toBe(true);
    }
    // vant spinner keyframes animate stroke-dashoffset on a circle — the
    // svg family must stay exempt or lint false-positives on vant
    expect(KEYFRAMES_ANIMATABLE_ON_APP.has('stroke-dashoffset')).toBe(true);
  });

  it('dropped at-rules are the unsupported set only', () => {
    for (const name of Object.keys(DROPPED_AT_RULES)) {
      expect(['@media', '@font-face', '@keyframes']).not.toContain(name);
    }
  });
});

describe('tags.json / component-tags.json ↔ vue-global.d.ts', () => {
  const src = (p: string) =>
    fileURLToPath(new URL(`../src/${p}`, import.meta.url));

  const pascal = (tag: string) =>
    tag.replace(/(^|-)(\w)/g, (_, __: string, c: string) => c.toUpperCase());

  /** Keys of the `GlobalComponents` interface in the runtime's ambient
   * types — hand-written, so this is the guard. */
  function globalComponentKeys(): Set<string> {
    const text = readFileSync(src('vue-global.d.ts'), 'utf8');
    const start = text.indexOf("declare module 'vue' {");
    expect(start).toBeGreaterThan(0);
    const block = text.slice(start, text.indexOf('}', text.indexOf('{', start)));
    const keys = new Set<string>();
    // one entry per line: `  view: FjsComponent<...>;` / `  'x-y': ...`
    for (const m of block.matchAll(/^\s+('?)[\w-]+\1\s*:/gm)) {
      const line = m[0].trim().replace(/:$/, '');
      keys.add(line.replace(/^'|'$/g, ''));
    }
    return keys;
  }

  it('every tag has a GlobalComponents entry, in both spellings', () => {
    const tags: string[] = JSON.parse(readFileSync(src('tags.json'), 'utf8'));
    const components: string[] = JSON.parse(
      readFileSync(src('component-tags.json'), 'utf8'),
    );
    const keys = globalComponentKeys();
    // `inner-canvas` is the drawing surface `<canvas>` wraps — pages never
    // write it, so the d.ts deliberately declares only the kebab spelling.
    const NO_CAMEL = new Set(['inner-canvas']);
    for (const tag of [...tags, ...components]) {
      expect(keys.has(tag), `GlobalComponents misses "${tag}"`).toBe(true);
      if (NO_CAMEL.has(tag)) continue;
      // Vue resolves components as capitalize(camelize(tag)) — PascalCase
      expect(keys.has(pascal(tag)), `GlobalComponents misses "${pascal(tag)}"`).toBe(true);
    }
  });
});
