// The tag decision + parse/compiler option builders shared by the esbuild
// SFC plugin, the vite plugin and the vapor SFC compiler (specs/166 split it
// out of vue-plugin.ts so the vapor compiler does not import the vdom side).
import { isHTMLTag, isSVGTag, isMathMLTag } from '@vue/shared';
import {
  FJS_TAGS as FJS_TAG_LIST,
  FJS_COMPONENT_TAGS,
} from '../tags.js';

/** Tags the fjs runtime provides. On web they must compile as components
 * (several — text, image, switch — are otherwise native SVG/HTML tags);
 * on Flutter they pass through to the custom renderer verbatim. */
const FJS_TAGS = new Set<string>(FJS_TAG_LIST);

/** fjs tags the FLUTTER path implements as Vue components rather than as
 * host elements, so the compiler has to resolve them (see
 * fjs-runtime/src/components/). `list-view` feeds a Dart builder; `form`
 * collects its fields from the JS shadow tree; `picker` is pure
 * orchestration over `modal` + `picker-view` (constitution VII). */
// `textarea` and `form` are real HTML tag names, so they only stay components
// because the isNativeTag check below asks this set FIRST. Get that order
// wrong and the page renders nothing, without an error.
//
// The list itself lives in fjs-runtime/src/component-tags.json because the
// Volar plugin (CommonJS) needs the same one — the IDE decides "element or
// component?" separately from the build, and a mismatch shows up as bogus
// DOM types on an fjs component.
const FLUTTER_COMPONENT_TAGS = new Set<string>(FJS_COMPONENT_TAGS);

/** Web `isNativeTag`: the fjs tags must NOT be native, so the compiler emits
 * resolveComponent() and they reach the DOM adapter. Several of them (text,
 * image, switch, view are SVG; input, button, progress are HTML) are real
 * tags, so compiler-dom's default would render them verbatim — the element
 * shows up in the DOM, `@tap` becomes a listener for a DOM event named
 * "tap", and nothing works. Shared with the Vite plugin, which has to hand
 * this to @vitejs/plugin-vue. */
export function webIsNativeTag(tag: string): boolean {
  // The component guard belongs HERE, not only in the callers: this function
  // is the web half of the decision and is called from vite.ts as well, and
  // `textarea` is both an fjs component and a real HTML tag.
  return (
    !FLUTTER_COMPONENT_TAGS.has(tag) &&
    !FJS_TAGS.has(tag) &&
    (isHTMLTag(tag) || isSVGTag(tag) || isMathMLTag(tag))
  );
}

/** The tag decision the SFC compiler is given, as a function so a test can
 * ask it directly. Getting it wrong is SILENT — a component compiled as an
 * element renders nothing and reports no error — which is why the order
 * below is spelled out and pinned by test/vue-plugin.test.ts. */
export function isNativeTagFor(
  tag: string,
  options: { web?: boolean; moduleTags?: Set<string> } = {},
): boolean {
  const { web = false, moduleTags = new Set<string>() } = options;
  // FIRST: a tag this runtime implements as a component is never native.
  // Some of them (`form`, `textarea`) are also HTML tag names, and
  // isHTMLTag below would drag them back to being elements.
  if (FLUTTER_COMPONENT_TAGS.has(tag)) return false;
  if (moduleTags.has(tag)) return true;
  if (web) return webIsNativeTag(tag);
  return (
    FJS_TAGS.has(tag) || isHTMLTag(tag) || isSVGTag(tag) || isMathMLTag(tag)
  );
}

/** Template options for a Vapor SFC. compiler-vapor has its own transform
 * pipeline, so the VDOM-side nodeTransforms (swiper children) do not apply;
 * static hoisting is a VDOM notion. The tag split is the same as the VDOM
 * build's. */
export function vaporCompilerOptions({
  web = false,
  moduleTags = new Set<string>(),
}: {
  web?: boolean;
  moduleTags?: Set<string>;
}): Record<string, unknown> {
  return { isNativeTag: (tag: string) => isNativeTagFor(tag, { web, moduleTags }) };
}

/** Parse-time options for EVERY SFC parse in the esbuild build. tagType —
 * element vs component — is decided by the PARSER (sfc.parse's
 * templateParseOptions), not by the later template compile: compiler-sfc's
 * compileScript only forwards templateOptions.compilerOptions to the vapor
 * transform, which cannot retroactively re-tag. Without this, an fjs tag
 * with only component children (`<scroll-view>` around a van-* row) parses
 * as a component and the emitted code resolves it on the app context at
 * runtime — where nothing registers built-in tags. Passing it for VDOM SFCs
 * too is harmless: the same predicate decides their template compile. */
export function sfcParseOptions({
  web = false,
  moduleTags = new Set<string>(),
}: {
  web?: boolean;
  moduleTags?: Set<string>;
} = {}): Record<string, unknown> {
  return { templateParseOptions: { isNativeTag: (tag: string) => isNativeTagFor(tag, { web, moduleTags }) } };
}

/** A library's SFC (under node_modules) is compiled as Vapor when all it
 * has is `<script setup>` — the only script form Vapor supports — unless
 * the app sets `fjs.vapor.libs: false` (specs/148). */
export function isAutoVapor(
  file: string,
  descriptor: { script: unknown; scriptSetup: unknown },
  libs: boolean,
): boolean {
  return libs && /[\\/]node_modules[\\/]/.test(file) && !!descriptor.scriptSetup && !descriptor.script;
}
