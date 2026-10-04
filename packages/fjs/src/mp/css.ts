import { warn } from '../terminal/colors.js';
// SFC <style> blocks -> WXSS. WXSS is real CSS, so blocks pass through
// compileStyle (scoped rewriting, ::v-deep, v-bind()) and then get one mp
// specific fix: the scoped attribute selector becomes a class, because
// skyline does not match attribute selectors and we stamp the scope id as a
// class on every element in the template instead.
import { compileStyle, type SFCStyleBlock } from '@vue/compiler-sfc';
import { rewriteFjsCssLengths } from '../../../fjs-runtime/src/web/css-compat.js';

/** Styles for the downcast tags' builtin classes (see wxml.ts TAG_DOWNCAST).
 * Values match the web adapter's base-css.ts — the two ends take the same
 * numbers, per the constitution's WeUI/两端同源 rule. */
export const FJS_CLASS_CSS: Record<string, string> = {
  // <button loading> spinner (wxml.ts buttonSpinner). Here, not in app.wxss:
  // skyline does not run an @keyframes animation declared in app.wxss on a
  // page's nodes — the spinner stood still — while the same rule in the
  // component's own stylesheet spins.
  'fjs-button-spinner': `
.fjs-button-spinner {
  position: relative;
  width: 14px;
  height: 14px;
  margin-right: 8px;
  flex-shrink: 0;
  animation: fjs-button-spin 0.8s linear infinite;
}
.fjs-button-spinner-half {
  position: absolute;
  left: 0;
  top: 0;
  width: 7px;
  height: 14px;
  overflow: hidden;
}
.fjs-button-spinner-corner {
  position: absolute;
  left: 7px;
  top: 7px;
  width: 7px;
  height: 7px;
  overflow: hidden;
}
.fjs-button-spinner-ring {
  width: 14px;
  height: 14px;
  border-width: 2px;
  border-style: solid;
  border-radius: 7px;
  box-sizing: border-box;
}
.fjs-button-spinner-ring--corner {
  margin-left: -7px;
  margin-top: -7px;
}
.fjs-button-spinner-ring--light { border-color: #ffffff; }
.fjs-button-spinner-ring--accent { border-color: #007aff; }
.fjs-button-spinner-ring--warn { border-color: #ff3b30; }
@keyframes fjs-button-spin {
  to { transform: rotate(360deg); }
}`,
  'fjs-safe-area': `
.fjs-safe-area {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  padding-left: env(safe-area-inset-left, 0px);
  padding-right: env(safe-area-inset-right, 0px);
}`,
  'fjs-divider': `
.fjs-divider {
  display: block;
  height: 16px;
  border: 0;
  background: linear-gradient(currentColor, currentColor) center / 100% 1px no-repeat;
  color: #e0e0e0;
}`,
  'fjs-stack': `
.fjs-stack {
  position: relative;
  display: grid;
  grid-template-rows: 1fr;
  grid-template-columns: 1fr;
}
.fjs-stack > view {
  grid-row: 1;
  grid-column: 1;
}`,
  'fjs-position': `
.fjs-position {
  position: relative;
}`,
  // skyline wraps a text only when it is stretched — wxml.ts textFillClass
  'fjs-text--center': `
.fjs-text--center {
  align-self: stretch;
  text-align: center;
}`,
  'fjs-text--end': `
.fjs-text--end {
  align-self: stretch;
  text-align: right;
}`,
  // content wrapper of every scroll-view (wxml.ts): skyline's type=list
  // container ignores flex settings on its direct children, so the wrapper
  // is the flex container — the scroll-view's own layout arrives inline
  'fjs-scroll-inner': `
.fjs-scroll-inner {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  box-sizing: border-box;
}`,
  // specs/052: the webview downcast of the sticky pair (wxml.ts
  // STICKY_DOWNCAST — skyline uses the native components). position: sticky
  // pins within the PARENT box, which is the same substrate the web side
  // runs on; the z-index is the component's own default (later content
  // would otherwise paint over the pinned header), not the user-level
  // property.
  'fjs-sticky-header': `
.fjs-sticky-header {
  position: sticky;
  top: 0px;
  z-index: 1;
}`,
  'fjs-sticky-section': `
.fjs-sticky-section {
  display: block;
}`,
};

const WARN_PATTERNS: Array<[RegExp, string]> = [
  [/position\s*:\s*fixed/, 'position: fixed is restricted under skyline'],
];

/** Pseudo-classes skyline rejects outright ("Invalid Selectors" warnings in
 * DevTools). Selectors carrying them are STRIPPED from the output — keeping
 * them only pollutes the console, the engine ignores them either way — with
 * one exception: `:active` is the press state, which the mini program has
 * natively as hover-class. `X:active` becomes `X.fjs-pressed`, and wxml.ts
 * gives the elements carrying X's classes `hover-class="fjs-pressed"`.
 * `:hover` has no touch counterpart and stays dropped. */
const STRIP_PSEUDO = /:(hover|focus|focus-within|visited)\b/;
export const PRESSED_CLASS = 'fjs-pressed';

export function stripUnsupportedPseudo(css: string, filename: string): string {
  return css.replace(/([^{}]+)\{([^{}]*)\}/g, (rule, selector: string, body: string) => {
    if (!STRIP_PSEUDO.test(selector) && !selector.includes(':active')) return rule;
    const kept: string[] = [];
    for (const part of selector.split(',')) {
      if (STRIP_PSEUDO.test(part)) {
        warn(
          `[fjs/mp] ${filename}: dropped "${part.trim()}" — pseudo-classes are not supported by skyline`,
        );
        continue;
      }
      kept.push(part.replace(/:active\b/g, `.${PRESSED_CLASS}`));
    }
    return kept.length ? `${kept.join(',')}{${body}}` : '';
  });
}

// ---- @media -----------------------------------------------------------------
//
// Skyline does not evaluate @media conditions: every block applies, so a
// narrow portrait phone gets the wide-screen and landscape rules at once.
// The conditions therefore move into the runtime. Each @media block N is
// unwrapped, and every rule inside it gets `.fjs-mq-N` on its subject
// compound; the template puts `{{ __fjsMq[N] }}` into the class of the
// elements carrying that subject's classes (wxml.ts), and the runtime fills
// __fjsMq from the window size with the same evaluator the App's CSS engine
// uses (css/parser.ts mediaMatches, wx/instance.ts). The extra class raises
// those rules' specificity by one class — a base rule written after a
// matching @media block no longer overrides it.

export interface MediaExtraction {
  /** the style blocks with every @media block unwrapped and tagged */
  styles: SFCStyleBlock[];
  /** condition text of block N (after `@media`) */
  conditions: string[];
  /** subject class -> the block indexes that target it */
  classes: Map<string, number[]>;
}

export function extractMedia(styles: SFCStyleBlock[], filename: string): MediaExtraction {
  const conditions: string[] = [];
  const classes = new Map<string, number[]>();
  const out = styles.map((block) => {
    const src = block.content ?? '';
    let result = '';
    let i = 0;
    for (;;) {
      const at = src.indexOf('@media', i);
      if (at < 0) break;
      const open = src.indexOf('{', at);
      if (open < 0) break;
      let depth = 1;
      let j = open + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') depth--;
        j++;
      }
      const index = conditions.length;
      conditions.push(src.slice(at + 6, open).trim());
      const inner = src.slice(open + 1, j - 1).replace(/\/\*[\s\S]*?\*\//g, '');
      const rules = inner.replace(/([^{}]+)\{([^{}]*)\}/g, (_m, selector: string, body: string) => {
        const tagged = selector
          .split(',')
          .map((part) => {
            const trimmed = part.trim();
            const subject = /([^\s>+~]+)$/.exec(trimmed);
            const subjectClasses = subject ? [...subject[1].matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]) : [];
            if (!subjectClasses.length) {
              warn(`[fjs/mp] ${filename}: @media rule "${trimmed}" has no class on its subject — dropped`);
              return null;
            }
            for (const c of subjectClasses) {
              const list = classes.get(c) ?? [];
              if (!list.includes(index)) list.push(index);
              classes.set(c, list);
            }
            // before any pseudo-class of the subject compound
            return trimmed.replace(/([^\s>+~:]+)((?::[^\s>+~]*)?)$/, `$1.fjs-mq-${index}$2`);
          })
          .filter((x): x is string => x !== null);
        return tagged.length ? `\n${tagged.join(', ')} {${body}}` : '';
      });
      result += src.slice(i, at) + rules;
      i = j;
    }
    result += src.slice(i);
    return { ...block, content: result } as SFCStyleBlock;
  });
  return { styles: out, conditions, classes };
}

/** `flex-grow: n` is an Expanded to fjs: the share of what is LEFT, not
 * natural size plus a share (web css-compat rewrites it to `n 1 0%`). The
 * mp side only adds the 0% basis next to the declaration — a percent basis
 * against an indefinite container still falls back to content size, so an
 * item growing inside a scrolling column keeps its height. An explicit
 * flex-basis in the same rule wins. */
export function expandFlexGrowBasis(css: string): string {
  return css.replace(/([^{}]*)\{([^{}]*)\}/g, (rule, selector: string, body: string) => {
    if (!/(^|[^-\w])flex-grow\s*:\s*[1-9]/.test(body) && !/(^|[^-\w])flex-grow\s*:\s*0?\.\d*[1-9]/.test(body)) return rule;
    if (/(^|[^-\w])flex(-basis)?\s*:/.test(body)) return rule;
    // The basis is spliced before a TRAILING COMMENT RUN, not at the rule's
    // very end: WXSS rejects `*/;` (a declaration separator after a comment
    // reads as an empty statement) where a browser shrugs — found by the
    // DevTools compiling hello-fjs's list-view page, whose .fill ends in two.
    const tail = body.match(/(?:\s*\/\*[\s\S]*?\*\/)+\s*$/);
    const comments = tail ? tail[0] : '';
    const head = (tail ? body.slice(0, tail.index) : body).replace(/;?\s*$/, '');
    return `${selector}{${head ? `${head}; ` : ''}flex-basis: 0%;${comments}}`;
  });
}

export interface StyleGenOptions {
  styles: SFCStyleBlock[];
  /** scope id ('data-v-xxxxxxxx') — same value compileStyle was given. */
  id: string;
  filename: string;
  fjsClasses?: string[];
}

export function genWxss(options: StyleGenOptions): string {
  const { styles, id, filename } = options;
  const chunks: string[] = [];
  for (const s of styles) {
    if (s.lang && s.lang !== 'css' && s.lang !== 'postcss') {
      warn(`[fjs/mp] ${filename}: <style lang="${s.lang}"> needs a preprocessor — skipped`);
      continue;
    }
    const compiled = compileStyle({
      // `height: 28` is px to fjs and invalid to WXSS — same pass as the web
      source: expandFlexGrowBasis(rewriteFjsCssLengths(s.content ?? '')),
      filename,
      id,
      scoped: s.scoped === true,
    });
    if (compiled.errors.length) {
      for (const e of compiled.errors) warn(`[fjs/mp] ${filename}: ${String(e)}`);
      continue;
    }
    chunks.push(replaceScopeAttr(compiled.code, id));
  }
  for (const cls of options.fjsClasses ?? []) {
    const css = FJS_CLASS_CSS[cls];
    if (css) chunks.push(css);
  }
  let out = chunks.join('\n\n');
  out = stripUnsupportedPseudo(out, filename);
  warnUnsupported(out, filename);
  return out + (out.trim() ? '\n' : '');
}

/** `[data-v-x]` selectors -> `.data-v-x` (the template stamps that class).
 * `id` already carries the data-v- prefix, matching compileStyle's output. */
export function replaceScopeAttr(css: string, id: string): string {
  return css.split(`[${id}]`).join(`.${id}`);
}

function warnUnsupported(css: string, filename: string): void {
  for (const [re, msg] of WARN_PATTERNS) {
    if (re.test(css)) warn(`[fjs/mp] ${filename}: ${msg}`);
  }
}
