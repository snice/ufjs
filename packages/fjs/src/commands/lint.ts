// fjs lint — report CSS a page writes that the fjs engine will not honor.
//
// The engine is not a browser. `#id` selectors, `word-break`, `vw` units,
// `@import` and friends are dropped at RUNTIME today — a warnOnce the user
// only sees on a visited page, or a browser-side invalid declaration that
// vanishes without a sound. The support boundary this command checks
// against lives in fjs-runtime/src/css/support.ts, the machine-readable
// mirror of docs/css-compat.md, so lint and the engine read one table.
//
// Scope, and why (specs/087): `<style>` blocks, plain .css files and
// static `style="…"` attributes are pure text — parseable with zero
// ambiguity. `:style="{ filter: x }"` object literals hold arbitrary
// expressions; a static judgment there would fire on correct code and
// train people to ignore the channel (same reasoning as
// bundler/asset-check.ts, which only checks literal src attributes).
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@vue/compiler-sfc';
import { colorByLevel } from '../terminal/colors.js';
import {
  DROPPED_AT_RULES,
  DROPPED_PROPERTIES,
  FONT_FACE_UNSUPPORTED,
  KEYFRAMES_ANIMATABLE_ON_APP,
  SUPPORTED_ATTR_SELECTORS,
  SUPPORTED_MEDIA_FEATURES,
  SUPPORTED_MEDIA_TYPES,
  SUPPORTED_NOT_ARGS,
  SUPPORTED_PSEUDO_CLASSES,
  SUPPORTED_PSEUDO_ELEMENTS,
  TRANSITIONABLE_ON_APP,
  SIZE_PROPERTIES,
  UNSUPPORTED_DISPLAY_VALUES,
  UNSUPPORTED_SIZE_KEYWORDS,
  UNSUPPORTED_UNITS,
  VERTICAL_ALIGN_VALUES,
  type LintLevel,
} from '../../../fjs-runtime/src/css/support.js';

export interface LintFinding {
  /** Path relative to the project root. */
  file: string;
  line: number;
  column: number;
  level: LintLevel;
  /** The offending source text, trimmed — what the report shows. */
  code: string;
  message: string;
}

/** A position inside the snippet being scanned; the reporter turns it
 * into a file position via the snippet's base. */
interface At {
  offset: number;
}

interface Reporter {
  (at: At, level: LintLevel, code: string, message: string): void;
}

// ---- text scanning ----------------------------------------------------------

/** Replaces /*…*&#47; comments with spaces of the same total length, so every
 * offset in the returned string still points at the same place in the
 * original. Strings are respected: a `/*` inside a quoted value must not
 * eat the rest of the sheet. */
function maskComments(css: string): string {
  const out = css.split('');
  let i = 0;
  let quote: string | null = null;
  while (i < css.length) {
    const ch = css[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const stop = end < 0 ? css.length : end + 2;
      for (let j = i; j < stop; j++) if (out[j] !== '\n') out[j] = ' ';
      i = stop;
      continue;
    }
    i++;
  }
  return out.join('');
}

/** Index of the `}` matching the `{` at [open], skipping strings. */
function matchBrace(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}

/** True when position [i] of [text] sits inside (), [] or a string — used
 * to keep combinators inside `:not(...)` or `[class~=x]` from reading as
 * top-level selector syntax. */
function insideNesting(text: string, i: number): boolean {
  let paren = 0;
  let bracket = 0;
  let quote: string | null = null;
  for (let j = 0; j < i; j++) {
    const ch = text[j];
    if (quote) {
      if (ch === '\\') j++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') paren++;
    else if (ch === ')') paren--;
    else if (ch === '[') bracket++;
    else if (ch === ']') bracket--;
  }
  return paren > 0 || bracket > 0 || quote !== null;
}

/** Turns snippet positions into findings with real file positions:
 * [base] is where the snippet starts in its file (from the SFC loc). */
function makeReporter(
  file: string,
  css: string,
  base: { offset: number; line: number; column: number },
  findings: LintFinding[],
): Reporter {
  return (at, level, code, message) => {
    const before = css.slice(0, at.offset);
    const lines = before.split('\n');
    const line = base.line + lines.length - 1;
    const column = lines.length === 1 ? base.column + at.offset : at.offset - before.lastIndexOf('\n');
    findings.push({
      file,
      line,
      column,
      level,
      code: code.length > 72 ? code.slice(0, 69) + '…' : code,
      message,
    });
  };
}

/** Index of the next `;` at nesting depth 0 from [from], or -1. */
function nextTopLevelSemicolon(text: string, from: number): number {
  let paren = 0;
  let quote: string | null = null;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') paren++;
    else if (ch === ')') paren--;
    else if (ch === ';' && paren === 0) return i;
  }
  return -1;
}

/** Scans one stylesheet snippet positioned at [base] in its file.
 * Recurses into @media bodies; @keyframes frames and @font-face
 * descriptors get their own checks. */
function scanStylesheet(
  file: string,
  css: string,
  base: { offset: number; line: number; column: number },
  findings: LintFinding[],
): void {
  const text = maskComments(css);
  const report = makeReporter(file, css, base, findings);
  const shift = (offset: number): At => ({ offset });

  let i = 0;
  for (;;) {
    const brace = text.indexOf('{', i);
    // Semicolon at-rules (@import/@charset/@namespace) END at the `;`. If
    // one precedes the next `{`, judge it alone — the runtime parser
    // swallows the following rule into the skipped block, and lint should
    // show both facts, not merge them into one finding.
    const semi = nextTopLevelSemicolon(text, i);
    if (semi >= 0 && (brace < 0 || semi < brace)) {
      const prelude = text.slice(i, semi).trim();
      if (prelude.startsWith('@')) {
        lintAtRule(prelude, '', shift(i + (text.slice(i, semi).length - prelude.length)), report);
      }
      i = semi + 1;
      continue;
    }
    if (brace < 0) break;
    const rawPrelude = text.slice(i, brace);
    const prelude = rawPrelude.trim();
    const close = matchBrace(text, brace);
    const block = text.slice(brace + 1, close < 0 ? text.length : close);
    const preludeAt = shift(i + rawPrelude.length - rawPrelude.trimStart().length);
    if (prelude.startsWith('@')) {
      lintAtRule(prelude, block, preludeAt, report);
      if (/^@media\b/i.test(prelude)) {
        // rules nested in the media block go through the same checks; the
        // condition itself was judged by lintAtRule. The snippet base moves
        // to the block's own start so positions stay file-true.
        scanStylesheet(file, block, {
          offset: base.offset + brace + 1,
          line: base.line + text.slice(0, brace + 1).split('\n').length - 1,
          column: 1,
        }, findings);
      }
    } else if (prelude) {
      lintPrelude(prelude, preludeAt, report);
      lintDeclarationBlock(block, shift(brace + 1), report, {
        rootBlock: /^:(?:root|host)$/.test(prelude),
      });
    }
    if (close < 0) break;
    i = close + 1;
  }
}

function lintAtRule(prelude: string, block: string, at: At, report: Reporter): void {
  const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? '';
  if (name === 'media') {
    lintMediaCondition(prelude.slice('@media'.length).trim(), at, report);
    return;
  }
  if (name === 'keyframes' || name === '-webkit-keyframes') {
    lintKeyframes(block, at, report);
    return;
  }
  if (name === 'font-face') {
    lintFontFace(block, at, report);
    return;
  }
  const hint = DROPPED_AT_RULES[`@${name}`];
  report(at, 'drop', prelude, hint ?? 'at-rule is not supported — the whole block is skipped');
}

function lintMediaCondition(condition: string, at: At, report: Reporter): void {
  // comma branches are ORed — one healthy branch keeps the block alive,
  // so report only when EVERY branch is hopeless
  const branches = condition.split(',').map((b) => b.trim()).filter(Boolean);
  const problems = branches.map((b) => mediaBranchProblem(b)).filter((p): p is string => p !== null);
  if (branches.length > 0 && problems.length === branches.length) {
    report(at, 'drop', `@media ${condition}`, problems[0]!);
  }
}

function mediaBranchProblem(branch: string): string | null {
  let rest = branch.trim();
  if (/^not\b/.test(rest)) {
    return `'not' media queries are not supported — the whole block is skipped`;
  }
  // optional leading media type (screen / all; the parser tolerates `only`)
  rest = rest.replace(/^only\b/i, '');
  const typeMatch = /^([a-zA-Z-]+)\s*/.exec(rest);
  if (typeMatch && !rest.startsWith('(')) {
    if (!SUPPORTED_MEDIA_TYPES.has(typeMatch[1]!.toLowerCase())) {
      return `media type "${typeMatch[1]}" is not supported — the whole block is skipped`;
    }
    rest = rest.slice(typeMatch[0].length);
  }
  for (const m of rest.matchAll(/\(([^()]*)\)/g)) {
    const body = m[1]!.trim();
    const colon = body.indexOf(':');
    const feature = (colon < 0 ? body : body.slice(0, colon)).trim().toLowerCase();
    if (!SUPPORTED_MEDIA_FEATURES.has(feature)) {
      return `media feature "(${body})" is not supported — the whole block is skipped`;
    }
    if (feature === 'orientation') {
      const value = body.slice(colon + 1).trim().toLowerCase();
      if (value !== 'portrait' && value !== 'landscape') {
        return `orientation "${value}" is not supported — the whole block is skipped`;
      }
    }
  }
  // anything left after features and `and` keywords is syntax the engine
  // rejects (level-4 range syntax, `or`, dangling operators)
  if (/\S/.test(rest.replace(/\([^()]*\)/g, '').replace(/\band\b/gi, ''))) {
    return 'unsupported media syntax — the whole block is skipped';
  }
  return null;
}

function lintKeyframes(block: string, at: At, report: Reporter): void {
  // one warning per property across the whole animation: the same
  // background-color in five frames is one finding, not five
  const seen = new Set<string>();
  let i = 0;
  for (;;) {
    const brace = block.indexOf('{', i);
    if (brace < 0) break;
    const close = matchBrace(block, brace);
    const frameBlock = block.slice(brace + 1, close < 0 ? block.length : close);
    for (const [prop] of splitDeclarations(frameBlock)) {
      const key = prop.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (!KEYFRAMES_ANIMATABLE_ON_APP.has(key)) {
        report(
          at,
          'warn',
          `${prop}: …`,
          `keyframes animate "${prop}", which does not move on the App (only transform/opacity and the svg stroke/fill family animate there); web plays it natively`,
        );
      }
    }
    if (close < 0) break;
    i = close + 1;
  }
}

function lintFontFace(block: string, at: At, report: Reporter): void {
  for (const [prop, value] of splitDeclarations(block)) {
    const key = prop.toLowerCase();
    if (key === 'src') {
      for (const bad of FONT_FACE_UNSUPPORTED.src) {
        if (value.toLowerCase().includes(bad)) {
          report(at, 'warn', `src: ${value}`, `@font-face src containing "${bad}" cannot register on the App — inline the font (WOFF2/WOFF/TTF becomes a data: URL at build time)`);
          break;
        }
      }
    } else if (FONT_FACE_UNSUPPORTED.descriptors.has(key)) {
      report(at, 'warn', `${prop}: ${value}`, `@font-face descriptor "${prop}" is ignored`);
    }
  }
}

// ---- selectors ---------------------------------------------------------------

/** Pseudo-classes/elements with their optional argument, at selector
 * top level (the regex is applied to compounds; nesting is respected by
 * the surrounding scans). */
const PSEUDO_RE = /(::?)([\w-]+)(\([^()]*\))?/g;

/** Vue language tools wrappers the engine unwraps before parsing —
 * selector syntax INSIDE the parens is judged by the engine at runtime,
 * not re-judged here (v1 accepted gap: no recursion into :deep args). */
const WRAPPER_PSEUDOS = new Set(['deep', 'global', 'v-deep', 'v-global']);

function lintPrelude(prelude: string, at: At, report: Reporter): void {
  for (const raw of prelude.split(',')) {
    const selector = raw.trim();
    if (!selector) continue;
    const problem = selectorProblem(selector);
    if (problem) {
      // position on the offending selector within the list, not the list
      const rel = prelude.indexOf(selector);
      report({ offset: at.offset + (rel < 0 ? 0 : rel) }, 'drop', selector, problem);
    }
  }
}

function selectorProblem(selector: string): string | null {
  // `#` anywhere: a bare #id is a dead rule, `#id .x` silently widens to
  // `.x` (test/css-support.test.ts pins both shapes) — either way the
  // rule the author wrote does not exist
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (!insideNesting(selector, i)) {
      if (ch === '#') {
        return 'id selectors are not supported — the rule never matches (or silently widens)';
      }
      if (ch === '~' && selector[i + 1] !== '=') {
        return 'the ~ sibling combinator is not supported (it silently degrades to a descendant combinator)';
      }
    }
  }

  // compound boundaries: whitespace / > / + at nesting depth 0. The LAST
  // compound is the subject — :active/:hover and pseudo-elements work
  // only there.
  let lastStart = 0;
  let start = -1;
  for (let i = 0; i <= selector.length; i++) {
    const atEnd = i === selector.length;
    const ch = atEnd ? ' ' : selector[i]!;
    const boundary = atEnd || (!insideNesting(selector, i) && (ch === '>' || ch === '+' || /\s/.test(ch)));
    if (boundary) {
      if (start >= 0 && selector.slice(start, i).trim()) lastStart = start;
      start = -1;
    } else if (start < 0) {
      start = i;
    }
  }

  for (const m of selector.matchAll(PSEUDO_RE)) {
    const name = m[2]!.toLowerCase();
    const isElement = m[1] === '::' || name === 'before' || name === 'after';
    if (WRAPPER_PSEUDOS.has(name)) continue;
    if (isElement) {
      if (!SUPPORTED_PSEUDO_ELEMENTS.has(name)) {
        return `pseudo-element ::${name} is not supported — the rule is skipped`;
      }
      if (m.index! < lastStart) {
        return `::${name} is only supported on the last compound selector — the rule is skipped`;
      }
      continue;
    }
    if (name === 'not') {
      const arg = m[3]?.slice(1, -1).trim() ?? '';
      if (!SUPPORTED_NOT_ARGS.has(arg)) {
        return `:not(${arg}) is not supported — only :not(:first-child) / :not(:last-child) are`;
      }
      continue;
    }
    if (name === 'root' || name === 'host') continue; // custom-property blocks, judged at declaration level
    if (!SUPPORTED_PSEUDO_CLASSES.has(name)) {
      return `:${name} is not supported — the whole rule is skipped`;
    }
    if ((name === 'active' || name === 'hover') && m.index! < lastStart) {
      return `:${name} is only supported on the last compound selector — the rule is skipped`;
    }
  }

  for (const m of selector.matchAll(/\[([^\]]*)\]/g)) {
    const attr = m[1]!.trim().split(/[~^$*|]?=/)[0]!.trim();
    if (!SUPPORTED_ATTR_SELECTORS.has(attr)) {
      return `attribute selector [${m[1]}] is not supported — only [class…] works, the rule is skipped`;
    }
  }
  return null;
}

// ---- declarations --------------------------------------------------------------

interface DeclOptions {
  /** `:root` / `:host` block: only custom properties survive (css-compat
   * §1) — anything else is a warn, the engine skips it with a warnOnce. */
  rootBlock?: boolean;
}

/** Splits a declaration block into `[prop, value, offset]` at top-level
 * `;`, respecting parens (`calc(…)`) and strings; nested `{…}` spans (CSS
 * nesting is not engine syntax) are skipped wholesale. Offsets are
 * relative to [block]. */
function splitDeclarations(block: string): [string, string, number][] {
  const out: [string, string, number][] = [];
  const text = maskComments(block);
  let depth = 0;
  let quote: string | null = null;
  let segStart = 0;
  const push = (end: number) => {
    const seg = text.slice(segStart, end);
    const colon = seg.indexOf(':');
    if (colon < 0 || !/\S/.test(seg.slice(0, colon))) return;
    const prop = seg.slice(0, colon).trim();
    const value = seg.slice(colon + 1).trim();
    if (prop && value) {
      out.push([prop, value, segStart + (seg.length - seg.trimStart().length)]);
    }
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === '{') depth += 10;
    else if (ch === '}') depth -= 10;
    else if (ch === ';' && depth === 0) {
      push(i);
      segStart = i + 1;
    }
  }
  push(text.length);
  return out;
}

function lintDeclarationBlock(
  block: string,
  at: At,
  report: Reporter,
  options: DeclOptions = {},
): void {
  for (const [prop, value, offset] of splitDeclarations(block)) {
    const key = prop.toLowerCase();
    if (key.startsWith('--')) continue;
    const pos = { offset: at.offset + offset };
    if (options.rootBlock) {
      report(pos, 'warn', `${prop}: ${value}`, ':root/:host only collects custom properties (--x) — this declaration is skipped');
      continue;
    }
    lintDeclaration(prop, value, pos, report);
  }
}

function lintDeclaration(prop: string, value: string, at: At, report: Reporter): void {
  const key = prop.toLowerCase();

  const dropped = DROPPED_PROPERTIES[key];
  if (dropped) {
    report(at, 'drop', `${prop}: ${value}`, dropped);
    return;
  }
  if (key === 'display' && UNSUPPORTED_DISPLAY_VALUES.has(value.toLowerCase())) {
    report(at, 'drop', `${prop}: ${value}`, `display: ${value.toLowerCase()} is not supported — the declaration is skipped`);
    return;
  }
  if (SIZE_PROPERTIES.has(key)) {
    const v = value.trim().toLowerCase().replace(/^-webkit-/, '');
    const keyword =
      UNSUPPORTED_SIZE_KEYWORDS.has(v) ||
      v.startsWith('fit-content(') ||
      (v === 'fit-content' && key !== 'width' && key !== 'height');
    if (keyword) {
      report(at, 'drop', `${prop}: ${value}`, `${key}: ${v} is laid out as auto on the App — only width: fit-content is supported`);
      return;
    }
  }
  for (const m of value.matchAll(/-?\d*\.?\d+(vmin|vmax|vw|vh)\b/g)) {
    report(at, 'drop', `${prop}: ${value}`, `the ${m[1]} unit is not supported — the declaration is skipped`);
    return;
  }
  if (key === 'vertical-align' && !VERTICAL_ALIGN_VALUES.has(value.toLowerCase())) {
    report(at, 'drop', `${prop}: ${value}`, 'vertical-align only supports sub / super (nested text fragments) — the declaration is skipped');
    return;
  }
  if ((key === 'transition' || key === 'transition-property') && !value.toLowerCase().includes('var(')) {
    const unanimated = value
      .split(',')
      .map((t) => t.trim().split(/\s+/)[0]!.toLowerCase())
      .filter(
        (t) =>
          t &&
          t !== 'all' &&
          t !== 'none' &&
          !t.startsWith('--') &&
          !TRANSITIONABLE_ON_APP.has(t),
      );
    if (unanimated.length) {
      report(at, 'warn', `${prop}: ${value}`, `${unanimated.join(', ')} transition(s) do not animate on the App (web does) — animatable: ${[...TRANSITIONABLE_ON_APP].join(', ')}`);
    }
    return;
  }
  if ((key === 'background' || key === 'background-image') && /url\(/i.test(value)) {
    report(at, 'warn', `${prop}: ${value}`, 'bitmap backgrounds do not render — only linear/radial-gradient; use an <image> tag');
    return;
  }
  if (key === 'content') {
    const v = value.toLowerCase();
    if (/^(attr|counter)\(/.test(v)) {
      report(at, 'warn', `${prop}: ${value}`, `content: ${v.startsWith('attr') ? 'attr()' : 'counter()'} is not supported — the pseudo-element box gets no text`);
    } else if (!v.startsWith('"') && !v.startsWith("'") && v !== 'none' && v !== 'normal' && !v.includes('var(')) {
      report(at, 'warn', `${prop}: ${value}`, 'content only supports quoted strings (none/normal make no box)');
    }
  }
}

// ---- inline style attributes ---------------------------------------------------

/** A static `style="…"` attribute is one declaration list, no blocks.
 * [base] points at the attribute value's first character. */
function scanInlineStyle(file: string, css: string, base: { offset: number; line: number; column: number }, findings: LintFinding[]): void {
  const report = makeReporter(file, css, base, findings);
  for (const [prop, value, offset] of splitDeclarations(css)) {
    lintDeclaration(prop, value, { offset }, report);
  }
}

// ---- sources --------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', 'dist', '.fjs']);

function walkSources(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkSources(path.join(dir, entry.name), out);
    } else if (entry.isFile() && /\.(vue|css)$/.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
}

/** Extracts every CSS snippet from one file and runs the scanner over
 * each, at its true file position. */
function lintFile(abs: string, root: string, findings: LintFinding[]): void {
  const rel = path.relative(root, abs).replace(/\\/g, '/');
  const source = fs.readFileSync(abs, 'utf8');

  if (abs.endsWith('.css')) {
    scanStylesheet(rel, source, { offset: 0, line: 1, column: 1 }, findings);
    return;
  }

  const { descriptor, errors } = parse(source, { filename: abs });
  if (errors.length) {
    // a broken SFC is typecheck/build's job; lint just says why it skipped
    findings.push({
      file: rel,
      line: 1,
      column: 1,
      level: 'warn',
      code: rel,
      message: `could not parse SFC (${String((errors[0] as { message?: string }).message ?? errors[0])}) — style blocks not checked`,
    });
    return;
  }
  for (const style of descriptor.styles) {
    if (style.lang && style.lang !== 'css' && style.lang !== 'postcss') {
      findings.push({
        file: rel,
        line: style.loc.start.line,
        column: style.loc.start.column,
        level: 'warn',
        code: `<style lang="${style.lang}">`,
        message: 'needs a preprocessor — the build skips it, so nothing here reaches the page',
      });
      continue;
    }
    scanStylesheet(
      rel,
      style.content,
      { offset: style.loc.start.offset, line: style.loc.start.line, column: style.loc.start.column },
      findings,
    );
  }
  const walk = (node: unknown): void => {
    const n = node as
      | {
          children?: unknown[];
          props?: {
            type: number;
            name: string;
            value?: { content?: string; loc?: { start: { offset: number; line: number; column: number } } };
          }[];
        }
      | undefined;
    if (!n) return;
    for (const prop of n.props ?? []) {
      if (prop.type === 6 && prop.name === 'style' && prop.value?.content && prop.value.loc) {
        scanInlineStyle(rel, prop.value.content, prop.value.loc.start, findings);
      }
    }
    for (const child of n.children ?? []) walk(child);
  };
  walk(descriptor.template?.ast);
}

// ---- command --------------------------------------------------------------------

export interface LintResult {
  findings: LintFinding[];
  fileCount: number;
}

/** Lints [targets] (files and/or directories; a project's `src` when
 * empty). Exposed for tests — the CLI wrapper adds reporting and the
 * exit code. */
export function lintTargets(root: string, targets: string[]): LintResult {
  const files: string[] = [];
  const list = targets.length ? targets : [path.join(root, 'src')];
  for (const target of list) {
    const abs = path.resolve(root, target);
    if (!fs.existsSync(abs)) {
      throw new Error(`fjs lint: no such file or directory: ${target}`);
    }
    if (fs.statSync(abs).isDirectory()) walkSources(abs, files);
    else files.push(abs);
  }
  const findings: LintFinding[] = [];
  for (const file of files) lintFile(file, root, findings);
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
  return { findings, fileCount: files.length };
}

export function lintCommand(argv: string[]): void {
  const root = process.cwd();
  const targets: string[] = [];
  let strict = false;
  for (const arg of argv) {
    if (arg === '--strict') strict = true;
    else if (arg.startsWith('--')) throw new Error(`fjs lint: unknown option ${arg}`);
    else targets.push(arg);
  }

  const { findings, fileCount } = lintTargets(root, targets);
  if (fileCount === 0) {
    console.log('fjs lint: nothing to scan (no .vue/.css under src)');
    return;
  }
  for (const f of findings) {
    const label = colorByLevel(f.level === 'drop' ? 'error' : 'warn', `[${f.level}]`);
    console.log(`${f.file}:${f.line}:${f.column}  ${label}  ${f.code}  —  ${f.message}`);
  }
  const drops = findings.filter((f) => f.level === 'drop').length;
  const warns = findings.length - drops;
  if (findings.length === 0) {
    console.log(`fjs lint: clean — ${fileCount} file${fileCount === 1 ? '' : 's'} within the supported CSS subset`);
  } else {
    console.log(`fjs lint: ${drops} drop / ${warns} warn in ${fileCount} file${fileCount === 1 ? '' : 's'}`);
  }
  if (drops > 0 || (strict && findings.length > 0)) {
    // non-strict warns stay exit-0: a warn is "works somewhere /
    // partially"; CI opts into failing on those with --strict
    process.exitCode = 1;
  }
}
