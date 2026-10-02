// The tag decision + parse/compiler option builders shared by the esbuild
// SFC plugin, the vite plugin and the vapor SFC compiler (specs/166 split it
// out of vue-plugin.ts so the vapor compiler does not import the vdom side).
import { isHTMLTag, isSVGTag, isMathMLTag } from '@vue/shared';
import {
  FJS_TAGS as FJS_TAG_LIST,
  FJS_COMPONENT_TAGS,
} from '../tags.js';
import { WEB_TAG_MODULES } from './tags/web/index';
import { FLUTTER_TAG_MODULES } from './tags/flutter/index';

/** The component-backed fjs tags of a platform (specs/171): the ones with
 * an `fjs/tag/<tag>` registration module. On Flutter that is the built-in
 * components (every other fjs tag is a Dart widget); on web, every tag the
 * web adapter implements with behavior — view / text / safe-area /
 * swiper-item / stack stay native elements (gestures and styles only), so
 * hot paths like a 4050-cell grid never go through the render host. */
export function tagModulesFor(web: boolean): readonly string[] {
  return web ? WEB_TAG_MODULES : FLUTTER_TAG_MODULES;
}
const WEB_COMPONENT_TAGS = new Set<string>(WEB_TAG_MODULES);

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
 * static hoisting is a VDOM notion.
 *
 * The tag rule is the SAME on both platforms and differs from the VDOM
 * build's web branch: a Vapor template's fjs tags compile as NATIVE
 * elements — the Flutter backend clones `<view>`/`<text>` element trees
 * directly and the web backend creates the same custom elements
 * (document.createElement), with events and props flowing through the
 * backend's own on()/setAttr. The web VDOM path has to resolve them as
 * components only because its renderer maps tag names onto the adapter's
 * component implementations; the vapor backend has no such layer, and a
 * resolveComponent("view") in a pure-vapor app (enableVapor, no component
 * table) would be unresolvable. The component-backed tags (`form`,
 * `picker`, `list-view`, `textarea`, …) stay components: their behavior
 * lives in real component code on both platforms, so a pure-vapor page
 * using one needs the vdom interop (or throws the plain resolveComponent
 * error in enableVapor mode). [moduleTags] adds the widget tags a module's
 * Flutter side renders. */
export function vaporCompilerOptions({
  web = false,
  moduleTags = new Set<string>(),
}: {
  web?: boolean;
  moduleTags?: Set<string>;
}): Record<string, unknown> {
  return {
    isNativeTag: (tag: string) =>
      !FLUTTER_COMPONENT_TAGS.has(tag) &&
      !(web && WEB_COMPONENT_TAGS.has(tag)) &&
      (moduleTags.has(tag) ||
        FJS_TAGS.has(tag) ||
        isHTMLTag(tag) ||
        isSVGTag(tag) ||
        isMathMLTag(tag)),
  };
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
  // ignoreEmpty: false — compiler-sfc otherwise drops a whitespace-only
  // `<script setup vapor>` along with its `vapor` attribute, so a display-only
  // page is judged VDOM (and the auto-vapor re-parse then tags it twice:
  // `<script setup vapor vapor>` → "Duplicate attribute."). specs/168.
  return {
    ignoreEmpty: false,
    templateParseOptions: { isNativeTag: (tag: string) => isNativeTagFor(tag, { web, moduleTags }) },
  };
}

/** A library's SFC (under node_modules) is compiled as Vapor when all it
 * has is `<script setup>` — the only script form Vapor supports — unless
 * the app sets `fjs.vapor.libs: false` (specs/148). */
/** Whether an SFC compiles as vapor (specs/177) — the one rule both build
 * paths (CLI esbuild plugin, vite plugin) apply:
 *   - an explicit `vapor` attribute: always (a vapor island in a VDOM app);
 *   - node_modules: the library rule (isAutoVapor, specs/148);
 *   - a project SFC under `enableVapor`: whenever it can be — it has a
 *     `<script setup>`, or no script at all (template-only). An Options API
 *     component (a plain `<script>` only) stays VDOM.
 * `explicit` is the caller's isVaporDescriptor answer for this descriptor. */
export function sfcCompilesAsVapor(
  file: string,
  descriptor: { script: unknown; scriptSetup: unknown },
  opts: { explicit: boolean; enableVapor: boolean; libs: boolean },
): boolean {
  if (opts.explicit) return true;
  if (/[\\/]node_modules[\\/]/.test(file)) return isAutoVapor(file, descriptor, opts.libs);
  if (!opts.enableVapor) return false;
  return !!descriptor.scriptSetup || !descriptor.script;
}

/** An SFC that stays VDOM under enableVapor because it cannot be vapor: an
 * Options API component (specs/177). */
export function isOptionsApiSfc(descriptor: { script: unknown; scriptSetup: unknown }): boolean {
  return !!descriptor.script && !descriptor.scriptSetup;
}

export function isAutoVapor(
  file: string,
  descriptor: { script: unknown; scriptSetup: unknown },
  libs: boolean,
): boolean {
  return libs && /[\\/]node_modules[\\/]/.test(file) && !!descriptor.scriptSetup && !descriptor.script;
}
