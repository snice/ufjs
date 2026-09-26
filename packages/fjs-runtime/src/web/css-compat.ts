// The two fjs style keys a browser would not understand on its own,
// rewritten to the CSS that means the same thing Flutter reads.
//
// Pure string work, no DOM: the esbuild web build calls this through
// `injectStyle`, and the CLI's Vite plugin calls it from Node on every SFC
// <style> block, so a Vite-served page lays out like a `fjs build --web` one.
//
// The boundary these match is "not part of a longer property name" rather
// than the start of a declaration: compileStyle leaves comments in, so a
// declaration does not always follow a `;` or a `{`.

// `flex-grow: n` becomes an Expanded on Flutter: the child gets its share of
// what is left over, not its natural size plus a share. CSS keeps the
// natural size in flex-basis, so a tall scrolling page would push the rest
// of the column (a bottom tabBar, say) off-screen or squash it. Rewriting to
// the `n 1 0` shorthand is the same declaration Flutter reads.
const FLEX_GROW_DECL =
  /(^|[^-\w])flex-grow\s*:\s*([0-9.]+)\s*(!important)?(?=\s*[;}]|\s*$)/g;

// `direction: horizontal` is scroll-view's own style key — it picks the axis
// of the Flutter scrollable. The CSS property of that name means something
// else (ltr / rtl), so a browser drops the declaration as invalid and the
// scroll-view never scrolls sideways. Rewrite it to the overflow pair it
// stands for; a real `direction: ltr | rtl` passes through untouched.
const DIRECTION_DECL =
  /(^|[^-\w])direction\s*:\s*(horizontal|vertical)\s*(!important)?(?=\s*[;}]|\s*$)/g;

// The JS style engine reads a bare number as logical pixels on every length
// property (css-compat "数字不带单位 = 逻辑像素"), so `padding: 10 12` is
// normal page syntax. To a BROWSER that declaration is invalid and is
// dropped whole — the box loses its padding on web while the App lays out
// fine, a divergence that only shows up side by side (spec 041 对拍).
// Suffix px onto unitless numbers, per property, matching what the engine
// would compute. `line-height` is deliberately absent: a bare number is a
// multiplier on BOTH ends (the engine keeps its string for exactly that
// reason), and suffixing it would break every page. `z-index` /
// `font-weight` / `opacity` are unitless in real CSS too — not lengths.
const LENGTH_PROPS = new Set([
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'top', 'right', 'bottom', 'left',
  'gap', 'row-gap', 'column-gap',
  'border-radius',
  'border-width', 'border-top-width', 'border-right-width',
  'border-bottom-width', 'border-left-width',
  'font-size', 'letter-spacing',
]);

// One declaration's value: everything up to `;` or `}` (or end). Values with
// !important survive — the suffix pass runs before the bang is re-attached.
const LENGTH_DECL =
  /(^|[^-\w])([a-z-]+)\s*:\s*([^;}]*)/g;

function expandUnitlessLengths(css: string): string {
  return css.replace(LENGTH_DECL, (m, before: string, prop: string, value: string) => {
    if (!LENGTH_PROPS.has(prop)) return m;
    const rewritten = value.replace(/[^\s,]+/g, (token) => {
      // calc(...) / var(...) / percentages / already-unit lengths stay as-is
      if (!/^-?\d+(\.\d+)?$/.test(token)) return token;
      if (token === '0') return token; // unitless zero is valid CSS
      return `${token}px`;
    });
    return `${before}${prop}: ${rewritten}`;
  });
}

function expandFlexGrow(css: string): string {
  return css.replace(
    FLEX_GROW_DECL,
    (_m, before: string, grow: string, bang = '') =>
      `${before}flex: ${grow} 1 0%${bang ? ' ' + bang : ''}`,
  );
}

function expandDirection(css: string): string {
  return css.replace(
    DIRECTION_DECL,
    (_m, before: string, axis: string, bang = '') => {
      const b = bang ? ' ' + bang : '';
      return axis === 'horizontal'
        ? `${before}overflow-x: auto${b}; overflow-y: hidden${b}`
        : `${before}overflow-x: hidden${b}; overflow-y: auto${b}`;
    },
  );
}

/** @media conditions get their own unitless pass, BEFORE the main ones
 * mask conditions away: `(min-width: 600)` is an invalid condition to a
 * browser (lengths need units) and the block would be dropped whole, while
 * the App engine reads the unitless value fine — the same two-end
 * divergence the declaration pass exists for. */
function expandUnitlessMediaConditions(css: string): string {
  return css.replace(/@media([^{}]*)\{/g, (m, cond: string) =>
    m.replace(
      cond,
      cond.replace(
        /((?:min-|max-)?(?:width|height))\s*:\s*(\d+(?:\.\d+)?)(?=[\s,)])/g,
        (_mm, prop: string, num: string) => `${prop}: ${num}px`,
      ),
    ),
  );
}

/** Masks the conditions out of the way of the main passes. They must not
 * see `@media (min-width: 600px)`: LENGTH_DECL's `([^;}]*)` value capture
 * has no idea where the condition's `(` closes, so it swallows text up to
 * the next `}` — and its token loop then suffixes px onto an inner rule's
 * `flex-grow: 1` before expandFlexGrow can match, leaving `flex-grow: 1px`
 * (unknown property to a browser, declaration dropped, layout diverges).
 * Conditions carry no fjs-only keys, so masking them out is safe. */
function maskMediaConditions(css: string): { text: string; restore: (s: string) => string } {
  const conditions: string[] = [];
  const text = css.replace(/@media[^{}]*\{/g, (m) => {
    conditions.push(m);
    return `\u0000${conditions.length - 1}\u0000{`;
  });
  return {
    text,
    restore: (s) => s.replace(/\u0000(\d+)\u0000\{/g, (_, i) => conditions[Number(i)] ?? ''),
  };
}

/** Only the bare-number-to-px passes (declarations and @media conditions).
 * The mini-program compiler takes this part alone: WXSS rejects a unitless
 * length the same way a browser does, while its flex-grow / direction keys
 * are handled by the mp compiler itself. Idempotent. */
export function rewriteFjsCssLengths(css: string): string {
  const { text, restore } = maskMediaConditions(expandUnitlessMediaConditions(css));
  return restore(expandUnitlessLengths(text));
}

/** Rewrites the fjs-only style keys in one CSS source. Idempotent.
 * `flexDefault: false` skips [expandFlexDefault] — for sources that are not
 * plain CSS yet (a raw `lang="scss"` block), whose nesting the rule scanner
 * would misread. */
export function rewriteFjsCss(css: string, options: { flexDefault?: boolean } = {}): string {
  const { text, restore } = maskMediaConditions(expandUnitlessMediaConditions(css));
  const out = restore(expandDirection(expandFlexGrow(expandUnitlessLengths(text))));
  return options.flexDefault === false ? out : expandFlexDefault(out);
}

// `display: flex` with no direction anywhere in the cascade is a ROW on the
// App: the style engine pins CSS's initial value there (css/style.ts, the
// FLEX_DISPLAYS branch). On web, base-css gives the fjs tags (view, ...) a
// column, so a rule that only says `display: flex` — NutUI's .nut-cell on
// the <view> it renders for Taro — stayed a column (specs/140).
//
// The engine's test is cascade-level: ANY author declaration of a direction
// wins, whatever its specificity or order. Appending `flex-direction: row`
// to the rule itself would not match that — `.a{flex-direction:column}` +
// `.a.b{display:flex}` is a column on the App and would turn into a row. So
// the filled value goes into a cascade layer instead: base-css puts the
// tags' column in `fjs-base`, this puts the row in `fjs-flex`, and every
// unlayered author rule beats both. align-items: stretch is filled the same
// way (the engine fills it when unset). On a <div> both are CSS's initial
// values, so library CSS written for real elements is unaffected.
const FLEX_LAYER_ORDER = '@layer fjs-base, fjs-flex;';
const FLEX_FILL = 'flex-direction:row;align-items:stretch';
const FLEX_DISPLAY_DECL =
  /(?:^|[;\s])display\s*:\s*(?:flex|inline-flex|-webkit-flex)\s*(?:!important\s*)?(?:;|$)/i;
const FLEX_DIRECTION_DECL = /(?:^|[;\s])(?:-webkit-)?flex-(?:direction|flow)\s*:/i;
// at-rules whose blocks hold style rules; anything else (@keyframes,
// @font-face, @page) holds declarations or keyframe selectors
const RULE_CONTAINERS = /^@(?:media|supports|container|layer|scope|document|-moz-document|starting-style)\b/i;

type Block = { kind: 'container' | 'opaque' | 'rule'; prelude: string; start: number; nested: boolean };

/** Adds the `fjs-flex` layer rule after every style rule that sets a flex
 * display without a direction (see above). A small brace scanner rather
 * than a regex: selectors and bodies must be paired exactly, and rules nest
 * inside @media / @supports. Idempotent: output carrying the layer order
 * statement is returned as-is. */
export function expandFlexDefault(css: string): string {
  if (css.includes(FLEX_LAYER_ORDER)) return css;
  const stack: Block[] = [];
  const inserts: Array<[number, string]> = [];
  let preludeStart = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 1;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c) j += css[j] === '\\' ? 2 : 1;
      i = j;
    } else if (c === '{') {
      const prelude = stripComments(css.slice(preludeStart, i)).trim();
      const parent = stack[stack.length - 1];
      if (parent) parent.nested = true;
      const kind = prelude.startsWith('@')
        ? RULE_CONTAINERS.test(prelude) ? 'container' : 'opaque'
        : 'rule';
      stack.push({ kind, prelude, start: i + 1, nested: false });
      preludeStart = i + 1;
    } else if (c === '}') {
      const block = stack.pop();
      const parent = stack[stack.length - 1];
      if (
        block?.kind === 'rule' &&
        !block.nested &&
        (!parent || parent.kind === 'container') &&
        block.prelude
      ) {
        const body = stripComments(css.slice(block.start, i));
        if (FLEX_DISPLAY_DECL.test(body) && !FLEX_DIRECTION_DECL.test(body)) {
          inserts.push([i + 1, `@layer fjs-flex{${block.prelude}{${FLEX_FILL}}}`]);
        }
      }
      preludeStart = i + 1;
    } else if (c === ';' && (stack.length === 0 || stack[stack.length - 1].kind === 'container')) {
      preludeStart = i + 1; // a statement at-rule (@import, @layer a, b;)
    }
  }
  if (!inserts.length) return css;
  let out = '';
  let last = 0;
  for (const [pos, text] of inserts) {
    out += css.slice(last, pos) + text;
    last = pos;
  }
  out += css.slice(last);
  // Layer order is fixed by first appearance, and base-css is injected at
  // run time — possibly after a page's stylesheet. Every rewritten sheet
  // states the same order, so whichever comes first gets it right.
  const charset = /^\s*@charset\s+[^;]*;/i.exec(out);
  const at = charset ? charset[0].length : 0;
  return out.slice(0, at) + FLEX_LAYER_ORDER + out.slice(at);
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '');
}
