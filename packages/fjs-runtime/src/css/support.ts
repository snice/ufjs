// Machine-readable mirror of the CSS support matrix in docs/css-compat.md.
//
// The prose tables in css-compat.md are the single source of truth for
// humans; this file is the same boundary in a form tooling can read. Its
// only consumer today is `fjs lint` (packages/fjs/src/commands/lint.ts),
// which reports rules a page writes that the engine — or the browser, on
// web — will silently drop or only partially honor. The runtime engine
// itself does NOT consult this file: unknown properties flow through to
// the Dart side untouched, and flagging them per element per page is
// runtime cost for a table that is not authoritative enough to judge
// (HTML alias tags accept a wider set). Static detection is the fix;
// if that ever changes, the drift tests in test/css-support.test.ts pin
// each ❌ entry here to the engine's actual behavior.
//
// Keep entries conservative — css-compat must explicitly mark a feature
// ❌ (or register an App-side divergence) before it earns a line here. A
// false "unsupported" trains people to ignore the channel, which is
// worse than missing a case (same reasoning as bundler/asset-check.ts).
// When you add CSS support per css-compat.md §7, delete the matching
// entries here in the same change.

/** Severity of a lint finding.
 *
 * `drop`: the declaration/rule/at-rule does not take effect AT ALL — on
 * the App the engine skips it, and on web the browser drops it just as
 * hard. `warn`: it works somewhere or partially — a value subset, an
 * App-side animation gap — reported so nobody ships a page that only
 * looks right in the browser. */
export type LintLevel = 'drop' | 'warn';

/** Properties the engine (and/or the browser) drops whole. Key:
 * kebab-case property name. Value: what to use instead — this text goes
 * straight into the lint output. */
export const DROPPED_PROPERTIES: Record<string, string> = {
  'word-break': 'not supported; truncate with max-lines + overflow: ellipsis',
  'text-overflow': 'not supported; truncate with max-lines + overflow: ellipsis',
  filter: 'not supported',
  'backdrop-filter': 'not supported',
};

/** `display` values the engine rejects (the rule still applies, this one
 * declaration is skipped). */
export const UNSUPPORTED_DISPLAY_VALUES = new Set(['grid', 'inline-grid']);

/** Size keywords the App lays out as auto (specs/138): the Dart side warns
 * once per value, and lint reports them. `fit-content` is supported on
 * `width` only (positioned boxes and column children); `fit-content()` is
 * the grid-track function. */
export const UNSUPPORTED_SIZE_KEYWORDS = new Set(['min-content', 'max-content']);
export const SIZE_PROPERTIES = new Set(['width', 'height', 'min-width', 'max-width', 'min-height', 'max-height']);

/** Length units nothing resolves — the declaration is skipped wherever
 * they appear. `em`/`rem` are NOT here: the engine resolves em against
 * the computed font size and the build rewrites both, so they work. */
export const UNSUPPORTED_UNITS = new Set(['vw', 'vh', 'vmin', 'vmax']);

/** `vertical-align` accepts only these — anything else is skipped
 * (css-compat「文字」表；`inherit` 走通用的 inherit 关键字）. */
export const VERTICAL_ALIGN_VALUES = new Set(['sub', 'super', 'inherit']);

/** Properties `transition`/`transition-property` may name for the App to
 * actually tween them (css-compat「视觉效果」表的 transition 行). Named
 * properties outside this set animate on web but snap on the App — worth
 * a warn, not a drop, because the declaration is otherwise honored.
 * `all`/`none`/unknown names are not judged: `all` covers the set above,
 * and a custom-property name is unresolvable statically. */
export const TRANSITIONABLE_ON_APP = new Set([
  'transform',
  'opacity',
  'background-color',
  'border-color',
  'color',
  'width',
  'height',
  'padding',
  'margin',
  'left',
  'top',
  'right',
  'bottom',
]);

/** Properties whose `@keyframes` frames actually animate on the App: any
 * node gets transform/opacity (render/animation.dart drives a ticker),
 * and inline `<svg>` shapes additionally get the stroke/fill family.
 * Everything else arrives with the frame but does not move on the App
 * while web plays it natively — the exact class of silent divergence
 * this table exists for. The SVG family MUST stay exempt or every vant
 * spinner (`stroke-dashoffset` keyframes on a `<circle>`) false-positives. */
export const KEYFRAMES_ANIMATABLE_ON_APP = new Set([
  'transform',
  'opacity',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'fill-opacity',
  'fill-rule',
  'display',
  'visibility',
]);

/** Pseudo-classes the engine understands. Anything else in a selector
 * drops the WHOLE rule (parseSelector returns null). `:not(...)` is
 * special-cased: supported only when its argument is one of the
 * structural pair (specs/069 — vant skeleton), any other argument drops
 * the rule too. */
export const SUPPORTED_PSEUDO_CLASSES = new Set([
  'active',
  'hover',
  'first-child',
  'last-child',
  'disabled',
]);
/** Argument values `:not(arg)` accepts, in the spelling a stylesheet
 * writes them (leading `:` included — the parser slices `(` and `:`
 * together); anything else drops the rule. */
export const SUPPORTED_NOT_ARGS = new Set([':first-child', ':last-child']);

/** Pseudo-elements the engine understands: the decorative pair, plus
 * `::placeholder` (specs/100 — it styles the input's hint text, carried to
 * the peer as the `placeholderStyle` prop instead of a box). Anything else
 * (`::selection`, …) drops the whole rule. */
export const SUPPORTED_PSEUDO_ELEMENTS = new Set(['before', 'after', 'placeholder']);

/** Attribute selectors match ONLY the class attribute
 * (`[class*=van-hairline]`, specs/069); any other attribute drops the
 * rule. */
export const SUPPORTED_ATTR_SELECTORS = new Set(['class']);

/** At-rules with no engine support — the whole block is skipped. The
 * supported ones (`@media`, `@font-face`, `@keyframes`) are handled
 * before this table is consulted, so they must not appear here. */
export const DROPPED_AT_RULES: Record<string, string> = {
  '@supports': 'feature queries are not evaluated; the block is skipped',
  '@import': 'stylesheets are not merged at runtime; import the file from JS instead',
  '@charset': 'not needed — sources are read as UTF-8',
  '@namespace': 'not supported',
};

/** `@font-face` constraints (specs/071): remote sources cannot register —
 * the build inlines WOFF2/WOFF/TTF as data URLs, and a network source has
 * no such path. `local()` and `unicode-range` are ignored with a warning. */
export const FONT_FACE_UNSUPPORTED = {
  /** Substrings that make a `src` unusable on the App. */
  src: ['http://', 'https://', '//', 'local('],
  /** Descriptors ignored wholesale. */
  descriptors: new Set(['unicode-range', 'font-display']),
};

/** @media vocabulary the engine evaluates (css-compat §5). Anything
 * outside — other types, other features — drops the WHOLE block (the
 * parser's parseMediaCondition answers the same question at runtime; this
 * set lets the linter answer it statically without firing warnOnce). */
export const SUPPORTED_MEDIA_TYPES = new Set(['screen', 'all']);
export const SUPPORTED_MEDIA_FEATURES = new Set([
  'min-width',
  'max-width',
  'width',
  'min-height',
  'max-height',
  'height',
  'orientation',
]);
