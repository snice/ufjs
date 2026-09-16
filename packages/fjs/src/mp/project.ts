// Mini-program project files: app.json / app.js / app.wxss / sitemap.json /
// project.config.json and the per-page wrapper WXML/JSON. Values follow the
// official skyline quickstart (renderer + glass-easel + lazyCodeLoading) with
// two deliberate deviations from the template:
//   * defaultDisplayBlock / defaultContentBox stay at their defaults
//     (flex column + border-box), because fjs layout semantics ARE Flutter's
//     — the web adapter's base-css makes the same choice;
//   * navigationStyle is custom because the app shell (NavBar/TabBar) is
//     compiled into every page, same as the other two platforms.
import fs from 'node:fs';
import path from 'node:path';

/** Runtime-shipped custom components (fjs built-in tags that have no wx
 * native counterpart). Module widgets come from their own packages — see
 * modules.ts `fjs.widgets.*.mp` — not from here. */
export const RUNTIME_COMPONENTS: Record<string, string> = {
  'fjs-modal': 'fjs/fjs-modal/fjs-modal',
  'fjs-safe-area': 'fjs/fjs-safe-area/fjs-safe-area',
  'fjs-checkbox': 'fjs/fjs-checkbox/fjs-checkbox',
  'fjs-radio': 'fjs/fjs-radio/fjs-radio',
  'fjs-checkbox-group': 'fjs/fjs-checkbox-group/fjs-checkbox-group',
  'fjs-radio-group': 'fjs/fjs-radio-group/fjs-radio-group',
  'fjs-label': 'fjs/fjs-label/fjs-label',
  'fjs-progress': 'fjs/fjs-progress/fjs-progress',
  'fjs-rich-text': 'fjs/fjs-rich-text/fjs-rich-text',
  // not a tag of its own: fjs-rich-text's recursive child, copied alongside
  'fjs-rich-node': 'fjs/fjs-rich-node/fjs-rich-node',
  // the webview-renderer sticky pair (specs/053): skyline uses the native
  // components, so the build skips these under skyline
  'fjs-sticky-header': 'fjs/fjs-sticky-header/fjs-sticky-header',
  'fjs-sticky-section': 'fjs/fjs-sticky-section/fjs-sticky-section',
};

export interface MpPage {
  /** route path ('/comp/switch') */
  path: string;
  name: string;
  meta: Record<string, unknown>;
}

export function appJson(
  pages: MpPage[],
  renderer: 'webview' | 'skyline' = 'webview',
  options: {
    workers?: boolean;
    /** specs/063 — entries already hold page paths relative to their root.
     * The key is only emitted when non-empty: a project without subpackages
     * keeps the exact pre-subpackage output shape. */
    subpackages?: Array<{ root: string; pages: string[] }>;
    /** specs/063 — already translated to real page-path keys by
     * translatePreloadRule. Only emitted when non-empty. */
    preloadRule?: Record<string, { network?: 'all' | 'wifi'; packages: string[] }>;
  } = {},
): string {
  // native tab bar from the routes' <route> tab meta (hello uni-app style):
  // text-only items — iconPath is optional and the app ships no icon assets
  const tabPages = pages
    .filter((p) => typeof p.meta.tab === 'number')
    .sort((a, b) => (a.meta.tab as number) - (b.meta.tab as number));
  const tabBar =
    tabPages.length >= 2
      ? {
          color: '#999999',
          selectedColor: '#007aff',
          backgroundColor: '#ffffff',
          borderStyle: 'black',
          list: tabPages.map((p) => ({
            pagePath: `pages/${p.name}/${p.name}`,
            text: String(p.meta.title ?? p.name),
          })),
        }
      : undefined;
  return (
    JSON.stringify(
      {
        pages: pages.map((p) => `pages/${p.name}/${p.name}`),
        ...(options.subpackages?.length && {
          subPackages: options.subpackages.map(({ root, pages: list }) => ({ root, pages: list })),
        }),
        ...(options.preloadRule && Object.keys(options.preloadRule).length && {
          preloadRule: options.preloadRule,
        }),
        window: {
          navigationStyle: 'custom',
          navigationBarTextStyle: 'black',
        },
        tabBar,
        // worker scripts live in miniprogram/workers (project/workers.ts)
        ...(options.workers && { workers: 'workers' }),
        style: 'v2',
        // webview is the platform default; the keys only appear for skyline
        ...(renderer === 'skyline' && {
          renderer: 'skyline',
          rendererOptions: {
            skyline: {
              // quickstart defaults: unstyled elements behave like webview
              // (block display, content-box) — our .fjs-box baseline keeps
              // containers flex column + border-box regardless
              defaultDisplayBlock: true,
              defaultContentBox: true,
              tagNameStyleIsolation: 'legacy',
              disableABTest: true,
              sdkVersionBegin: '3.0.0',
              sdkVersionEnd: '15.255.255',
            },
          },
        }),
        componentFramework: 'glass-easel',
        sitemapLocation: 'sitemap.json',
        lazyCodeLoading: 'requiredComponents',
      },
      null,
      2,
    ) + '\n'
  );
}

/** Global base styles. Mirrors fjs-runtime/src/web/base-css.ts: containers
 * are column flexboxes with border-box sizing (Flutter semantics).
 *
 * Skyline supports CLASS selectors only — the tag-selector form of this
 * baseline is silently ignored there — so the rules live on `.fjs-box`,
 * which the compiler stamps onto every container element (see wxml.ts
 * CONTAINER_TAGS). Component styleIsolation is apply-shared, so this file
 * reaches every compiled component. `page` gets an explicit 100vh: the
 * percentage height chain is not reliable under skyline (the official
 * skyline quickstart does the same). */
export const APP_WXSS = `page {
  height: 100vh;
  width: 100vw;
  display: flex;
  flex-direction: column;
  background-color: #f4f5f7;
  color: #333333;
  /* body defaults of the web adapter (base-css.ts) — text inherits them */
  font-size: 14px;
  line-height: 1.4;
}

/* page content wrapper (page wxml emits it around the shell): percent
   lengths are not supported by skyline, so the height chain runs on flex
   with a px basis — no :host, whose support there is not documented */
.fjs-page-host {
  flex-grow: 1;
  flex-shrink: 1;
  flex-basis: 0px;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* the app shell's root element fills the page, whatever tag it is — web's
   \`fjs-page-host > * { flex: 1 1 0% }\`, Flutter's root growChildren */
.fjs-page-root.fjs-page-root {
  flex-grow: 1;
  flex-shrink: 1;
  flex-basis: 0px;
  min-height: 0;
}

.fjs-box {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  flex-shrink: 0;
}

/* text: base-css.ts gives text display:block, which a column flex parent
   still clamps to its own width. Skyline sizes a cross-axis-centered text
   at its max-content width instead, so a long line runs off both edges
   rather than wrapping — the max-width restores the clamp. */
.fjs-text {
  max-width: 100%;
  flex-shrink: 0;
  line-height: 1.4;
}

/* picker-view: five 44px rows (base-css.ts picker-view, WeUI's flat wheel).
   The native wheel has no height of its own and measures its rows, so the
   row height sits on every row (the compiler stamps .fjs-picker-item). */
.fjs-picker-view {
  height: 220px;
  flex-shrink: 0;
}
.fjs-picker-item {
  height: 44px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: #333333;
}

/* rich-text host: a block box like the view the other ends render */
.fjs-rich-text-host {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-width: 0;
  box-sizing: border-box;
}

/* checkbox / radio host: a row with the control beside its label slot,
   sized to its content (base-css.ts checkbox / radio) */
.fjs-choice-host {
  display: flex;
  flex-direction: row;
  align-items: center;
  align-self: center;
  gap: 8px;
  flex-shrink: 0;
  box-sizing: border-box;
}

/* radio-group / checkbox-group: no chrome, a column scoping its controls */
.fjs-group-host {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  box-sizing: border-box;
}

/* progress: a block of its own height; the ring sizes itself */
.fjs-progress-host {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  box-sizing: border-box;
}

/* label: base-css.ts label defaults */
.fjs-label-host {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  margin: 4px;
  font-size: 14px;
  color: #666666;
  box-sizing: border-box;
}

/* input / textarea: base-css.ts .fjs-input. The doubled class outranks
   the wx built-ins (input height, textarea's fixed 300px width); a page
   class still wins (it comes later with the same specificity once scoped).
   Known gap: skyline's input ignores line-height, so a single-line input
   is ~2px shorter than on the web. */
.fjs-input.fjs-input {
  padding: 8px 0;
  min-height: 0;
  height: auto;
  width: auto;
  font-size: 14px;
  line-height: 1.4;
  box-sizing: border-box;
  flex-shrink: 0;
}

.fjs-placeholder {
  color: #999999;
}

/* a swiper page's content fills its swiper-item (wxml.ts) */
.fjs-fill {
  flex-grow: 1;
  flex-shrink: 1;
  flex-basis: 0px;
  min-height: 0;
}

/* slider: full width like the web's <input type=range>; wx indents it
   18px on each side for the knob */
.fjs-slider.fjs-slider {
  margin: 0;
}

/* button: same numbers as base-css.ts .fjs-button (WeUI press model aside).
   Resets the wx built-in look — fixed 184px width, auto side margins, bold
   16px text, grey fill and the ::after hairline border. The doubled class
   is deliberate: skyline's built-in button width outranks a single class. */
.fjs-button.fjs-button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: auto;
  margin: 0;
  padding: 10px 16px;
  font-size: 14px;
  font-weight: normal;
  line-height: 1.4;
  color: #007aff;
  background-color: transparent;
  border: 1px solid rgba(0, 0, 0, 0.16);
  border-radius: 8px;
  box-sizing: border-box;
  text-align: center;
  flex-shrink: 0;
}
.fjs-button::after {
  border: none;
}
/* pressed: WeUI's model — the button darkens under the finger whatever its
   own colors (base-css.ts .fjs-button:active::after, same 10% black). An
   inset shadow rather than the web's ::after mask: the webview renderer's
   built-in button styles its ::after itself and the mask never shows there;
   the shadow paints over the background, under the label, in both
   renderers, and follows the border radius. */
.fjs-button.fjs-button.fjs-button--pressed {
  box-shadow: inset 0 0 0 999px rgba(0, 0, 0, 0.1);
}
.fjs-button.fjs-button--primary {
  background-color: #007aff;
  border-color: transparent;
  color: #ffffff;
}
.fjs-button.fjs-button--warn {
  background-color: #ff3b30;
  border-color: transparent;
  color: #ffffff;
}
.fjs-button.fjs-button--primary.fjs-button--plain {
  background-color: transparent;
  border-color: #007aff;
  color: #007aff;
}
.fjs-button.fjs-button--warn.fjs-button--plain {
  background-color: transparent;
  border-color: #ff3b30;
  color: #ff3b30;
}
.fjs-button.fjs-button--mini {
  padding: 6px 12px;
  font-size: 12px;
}
/* disabled: the web's 50% fade over the variant's own colors
   (base-css.ts .fjs-button:disabled). wx paints its own grey disabled look,
   which outranks the doubled variant classes — hence the extra class. */
.fjs-button.fjs-button.fjs-button--disabled {
  opacity: 0.5;
}
.fjs-button.fjs-button.fjs-button--default.fjs-button--disabled {
  background-color: transparent;
  border-color: rgba(0, 0, 0, 0.16);
  color: #007aff;
}
.fjs-button.fjs-button.fjs-button--primary.fjs-button--disabled {
  background-color: #007aff;
  border-color: transparent;
  color: #ffffff;
}
.fjs-button.fjs-button.fjs-button--warn.fjs-button--disabled {
  background-color: #ff3b30;
  border-color: transparent;
  color: #ffffff;
}
.fjs-button.fjs-button.fjs-button--primary.fjs-button--plain.fjs-button--disabled {
  background-color: transparent;
  border-color: #007aff;
  color: #007aff;
}
.fjs-button.fjs-button.fjs-button--warn.fjs-button--plain.fjs-button--disabled {
  background-color: transparent;
  border-color: #ff3b30;
  color: #ff3b30;
}
/* loading: inert but not faded (base-css.ts .fjs-button--loading); the
   spinner sits before the label on the same line */
.fjs-button.fjs-button {
  flex-direction: row;
}
.fjs-button.fjs-button.fjs-button--loading {
  pointer-events: none;
}
`;

/** Template helpers WXML can call (a wxs module — plain function calls are
 * not allowed in {{ }}). Written to fjs/fjs.wxs; wxml.ts imports it into a
 * template that uses one. */
export const FJS_WXS = `// generated by fjs — template helpers for compiled wxml
// v-for over a number counts 1..n in Vue; wx:for over a number counts from 0
function list(v) {
  if (typeof v !== 'number') return v;
  var out = [];
  for (var i = 1; i <= v; i++) out.push(i);
  return out;
}
// :style object values: a number means px, except on unitless properties
// (the same table as the runtime's stringifyStyle, wx/style.ts)
var UNITLESS = ['flex', 'flex-grow', 'flex-shrink', 'order', 'z-index', 'opacity', 'font-weight', 'line-height', 'zoom', 'aspect-ratio'];
function unit(v, prop) {
  if (typeof v !== 'number') return v;
  return UNITLESS.indexOf(prop) >= 0 ? v : v + 'px';
}
// picker-view value: a fresh copy each time the binding re-evaluates. The
// \`ready\` argument is only there to make it re-evaluate after the first
// render — skyline drops the value a picker-view is created with but applies
// the same indices handed over again (an empty array instead would reset the
// wheel and fire change with [0, 0]).
function pickerValue(v, ready) {
  // no Array.isArray / constructor test: wxs and skyline's JS disagree on both
  if (!v || typeof v !== 'object' || typeof v.length !== 'number') return v;
  var out = [];
  for (var i = 0; i < v.length; i++) out.push(v[i]);
  return out;
}
module.exports = { list: list, unit: unit, pickerValue: pickerValue };
`;

// app.ts is emitted by build.ts (it needs a depth-aware runtime import)

export const SITEMAP_JSON = `${JSON.stringify(
  {
    desc: '关于本文件的更多信息，请参考文档 https://developers.weixin.qq.com/miniprogram/dev/framework/sitemap.html',
    rules: [{ action: 'allow', page: '*' }],
  },
  null,
  2,
)}\n`;

export function projectConfigJson(
  projectName: string,
  appid?: string,
  renderer: 'webview' | 'skyline' = 'webview',
  setting: Record<string, unknown> = {},
): string {
  return (
    JSON.stringify(
      {
        description: 'generated by fjs build --mp',
        miniprogramRoot: 'miniprogram/',
        compileType: 'miniprogram',
        appid: appid ?? 'touristappid',
        projectname: projectName,
        setting: {
          // emitted modules are TypeScript sources: the typescript compiler
          // plugin strips types only, so the output keeps `??`, `?.`,
          // async… The simulator runs that fine, but preview / upload
          // validates the package and rejects it ("Unexpected token ?").
          // es6 + enhance (the official TS template's settings) have
          // DevTools transpile it down for real devices.
          es6: false,
          postcss: false,
          minified: false,
          minifyWXSS: false,
          minifyWXML: false,
          enhance: false,
          skylineRenderEnable: renderer === 'skyline',
          ignoreUploadUnusedFiles: true,
          useCompilerPlugins: ['typescript'],
          // app.config.ts wxmp.setting, key by key over the defaults above
          ...setting,
        },
        libVersion: 'trial',
        simulatorType: 'wechat',
        simulatorPluginLibVersion: {},
        condition: {},
      },
      null,
      2,
    ) + '\n'
  );
}

/** The page wrapper: the compiled shell with the compiled page in its slot. */
export function pageWrapperWxml(shellTag: string, pageTag: string): string {
  return `<${shellTag} route="{{ route }}">\n  <${pageTag} />\n</${shellTag}>\n`;
}

export function componentJson(usingComponents: Record<string, string>): string {
  // apply-shared: app.wxss carries the layout baseline (view = column flex,
  // border-box) and must reach component internals — the default isolation
  // would leave every component's views display:inline and collapse layout
  return `${JSON.stringify(
    { component: true, styleIsolation: 'apply-shared', usingComponents },
    null,
    2,
  )}\n`;
}

export function pageJson(usingComponents: Record<string, string>): string {
  return `${JSON.stringify({ styleIsolation: 'apply-shared', usingComponents }, null, 2)}\n`;
}

/** Copies the runtime-provided component four-packs (fjs-modal, icon-mind)
 * from @ufjs/runtime/src/wx/components into the output's fjs/ directory.
 * `skip` names RUNTIME_COMPONENTS keys left out (the rich-text pair when no
 * page uses the component). */
export function copyRuntimeComponents(
  runtimeDir: string,
  miniprogramDir: string,
  options: { skip?: ReadonlySet<string> } = {},
): void {
  for (const [tag, rel] of Object.entries(RUNTIME_COMPONENTS)) {
    if (options.skip?.has(tag)) continue;
    const srcDir = path.join(runtimeDir, 'src', 'wx', 'components', path.basename(rel));
    const destDir = path.join(miniprogramDir, path.dirname(rel));
    fs.mkdirSync(destDir, { recursive: true });
    for (const entry of fs.readdirSync(srcDir)) {
      fs.copyFileSync(path.join(srcDir, entry), path.join(destDir, entry));
    }
  }
}
