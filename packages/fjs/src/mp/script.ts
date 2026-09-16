// SFC script -> mini-program page/component module. compileScript's output
// (a defineComponent options object with a setup that returns __returned__)
// is post-processed in place: the compiler-generated handlers and computeds
// from wxml.ts are injected into the setup scope, added to __returned__, and
// the module ends with a createWevuComponent() registration call. The `vue`
// specifier resolves to @ufjs/runtime/wx (the reactivity shim), so no vdom
// runtime ever enters the bundle.
import type { WxmlResult } from './wxml.js';

export interface ScriptGenOptions {
  /** compileScript result. */
  compiled: { content: string; bindings: Record<string, string> };
  wxml: WxmlResult;
  kind: 'page' | 'component';
  filename: string;
  /** page only: the compile-time route. The SFC itself is the
   * Component()-constructed page (isPage) and exposes `route` to its
   * template (the shell prop), synced with onLoad query. */
  route?: { path: string; name: string; meta: Record<string, unknown> };
  /** @media conditions of this SFC's styles, by block index (css.ts
   * extractMedia) — the runtime evaluates them into `__fjsMq`. */
  media?: string[];
}

const RUNTIME_IMPORT =
  "import { createWevuComponent as __fjsCreate } from '@ufjs/runtime/wx';";
const HELPER_IMPORT =
  "import { computed as __fjsComputed, stringifyClass as __fjsStringifyClass, stringifyStyle as __fjsStringifyStyle, project as __fjsProject, pickerSync as __fjsPickerSync } from '@ufjs/runtime/wx';";
// v-motion: the helpers live in the runtime, `useMotion` comes from the
// library itself — the runtime bundle stays free of @vueuse/motion
const MOTION_IMPORT =
  "import { motion as __fjsMotion, motionEach as __fjsMotionEach } from '@ufjs/runtime/wx';\nimport { useMotion as __fjsUseMotion } from '@vueuse/motion';";
const PAGE_IMPORT =
  "import { reactive as __fjsReactive, onShow as __fjsOnShow, pageQuery as __fjsPageQuery, setActiveRoute as __fjsSetPageRoute } from '@ufjs/runtime/wx';";

/** Browser globals the mini-program module wrapper shadows with its own
 * undefined bindings, so assigning them on globalThis does not help: a
 * module that names one gets it imported from the wx runtime instead. */
export const SHADOWED_GLOBALS = [
  'requestAnimationFrame',
  'cancelAnimationFrame',
  // not shadowed but missing outright: a library probing for a browser takes
  // its Node branch and reads this bare global (Anime.js picks its main loop
  // that way, while its module evaluates)
  'setImmediate',
  'clearImmediate',
];

/** Comments blanked and string bodies emptied, so the tests below see code
 * and only code. A prose "…the build imports requestAnimationFrame…" in a
 * comment used to read as "this module already imports it" and the injection
 * was skipped silently — the module then threw
 * `requestAnimationFrame is not a function` on a real device only.
 *
 * Regex literals are deliberately NOT recognised: telling `/` apart from a
 * division needs the previous significant token, which is most of a parser.
 * The one way a regex literal can hold a literal `//` is an escaped slash
 * right before the closing one (`/\//`), so a `//` preceded by a backslash
 * is not treated as a comment. Anything past that (a `//` built by string
 * concatenation into a `new RegExp`) is already inside a string here. */
function stripCommentsAndStrings(code: string): string {
  let out = '';
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    const next = code[i + 1];
    if (c === '/' && next === '/' && code[i - 1] !== '\\') {
      while (i < code.length && code[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = code.indexOf('*/', i + 2);
      const skipped = code.slice(i, end === -1 ? code.length : end + 2);
      // keep the newlines so line-based reading of the result still lines up
      out += skipped.replace(/[^\n]/g, ' ');
      i = end === -1 ? code.length : end + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      out += c;
      i++;
      while (i < code.length) {
        const s = code[i];
        if (s === '\\') {
          i += 2;
          continue;
        }
        if (s === c) break;
        // a template's ${…} holds code, not text: keep it
        if (c === '`' && s === '$' && code[i + 1] === '{') {
          let depth = 1;
          let j = i + 2;
          while (j < code.length && depth) {
            if (code[j] === '{') depth++;
            else if (code[j] === '}') depth--;
            j++;
          }
          out += code.slice(i, j);
          i = j;
          continue;
        }
        if (s === '\n') out += '\n';
        i++;
      }
      out += c;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** True when `code` really binds `name` itself — a declaration or an import
 * of that name. Only a binding shadows the module wrapper's own undefined
 * one, so only a binding may cancel the injection. */
function bindsName(code: string, name: string): boolean {
  return (
    new RegExp(`(?:function|const|let|var|class)\\s+${name}\\b`).test(code) ||
    // import { a, requestAnimationFrame as raf } from '…'
    new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(code) ||
    // import requestAnimationFrame from '…' / import * as requestAnimationFrame from '…'
    new RegExp(`import\\s+(?:${name}\\b|\\*\\s+as\\s+${name}\\b)`).test(code)
  );
}

export function shadowedGlobalsImport(code: string): string {
  const bare = stripCommentsAndStrings(code);
  // `globalThis.requestAnimationFrame` counts as a use and gets an import it
  // does not need. That way round is a dead import line; the other way round
  // is a crash on the device, so the test stays broad on purpose.
  const used = SHADOWED_GLOBALS.filter(
    (g) => new RegExp(`\\b${g}\\b`).test(bare) && !bindsName(bare, g),
  );
  return used.length ? `import { ${used.join(', ')} } from '@ufjs/runtime/wx';\n` : '';
}

export function genScriptCode(options: ScriptGenOptions): string {
  const { compiled, wxml } = options;
  let code = compiled.content;

  // `export default <obj>` -> `const __sfc__ = <obj>` (the registration call
  // below replaces the default export's job)
  if (code.includes('export default')) {
    code = code.replace(/export default/, 'const __sfc__ =');
  } else {
    code = `const __sfc__ = {};\n${code}`;
  }

  // page flavor: the page's route location (the shell's `route` prop), the
  // same plain-object shape the other routers expose. It is created FIRST in
  // setup, with the query the runtime hands over from onLoad, and made the
  // active route right away — so the page's own `useRoute()` during setup
  // reads this page and its query, not the previous page. A generated name:
  // a page may well declare its own `route`. onShow restores it as active
  // when the user comes back to this page.
  const extraSetup: string[] = [];
  const extraNames: string[] = [];
  const extraImports: string[] = [];
  const setupHead: string[] = [];
  if (options.kind === 'page' && options.route) {
    const { path, name, meta } = options.route;
    const routeLit = JSON.stringify({ path, name, meta, fullPath: path });
    setupHead.push(
      `const __fjsRoute = __fjsReactive({ ...${routeLit}, params: {}, query: { ...__fjsPageQuery() } });`,
      `{ const __q = Object.entries(__fjsRoute.query); if (__q.length) __fjsRoute.fullPath = '${path}?' + __q.map(([k, v]) => k + '=' + encodeURIComponent(String(v))).join('&'); }`,
      `__fjsSetPageRoute(__fjsRoute);`,
      `__fjsOnShow(() => __fjsSetPageRoute(__fjsRoute));`,
    );
    extraNames.push('__fjsRoute');
    extraImports.push(PAGE_IMPORT);
  }

  // inject generated handlers/computeds into the setup scope, then attach
  // them to __returned__ before it escapes. Textually extending the object
  // literal is NOT safe: `let` bindings compile into get/set accessor pairs
  // whose braces would swallow a naive splice.
  const setupCode = [...extraSetup, ...wxml.setupCode];
  const returnedNames = [...extraNames, ...wxml.returnedNames];
  const dataNames = [...extraNames, ...wxml.dataNames];
  if (setupHead.length) {
    const head = /setup\s*\([^)]*\)\s*\{(\s*__expose\(\);)?/.exec(code);
    if (!head) throw new Error(`${options.filename}: cannot find setup() in compileScript output`);
    const at = head.index + head[0].length;
    code = code.slice(0, at) + `\n  ${setupHead.join('\n  ')}\n` + code.slice(at);
  }
  if (setupCode.length || setupHead.length) {
    const decl = /(\s*)const __returned__ = \{/.exec(code);
    if (!decl) {
      throw new Error(
        `${options.filename}: compileScript produced no __returned__ — script-setup templates only`,
      );
    }
    const pad = decl[1];
    const generated = setupCode.map((l) => `${pad}  ${l}`).join('\n');
    const assignments = returnedNames.map((n) => `${pad}__returned__.${n} = ${n};`).join('\n');
    code = code.slice(0, decl.index) + `${generated}\n` + code.slice(decl.index);
    const defineRe = /(\s*)(Object\.defineProperty\(__returned__|return __returned__)/;
    const dm = defineRe.exec(code);
    if (!dm) {
      throw new Error(`${options.filename}: cannot find __returned__ handoff in compileScript output`);
    }
    code = code.slice(0, dm.index) + `${assignments}\n` + code.slice(dm.index);
  }

  // the runtime narrows setData to exactly the bindings the template reads —
  // keeps event-handler-only bindings (a router object, say) out of data
  code += `\n__sfc__.__fjsData = ${JSON.stringify(dataNames)};`;
  if (options.media?.length) code += `\n__sfc__.__fjsMedia = ${JSON.stringify(options.media)};`;
  if (wxml.canvasRefs?.length) code += `\n__sfc__.__fjsCanvas = ${JSON.stringify(wxml.canvasRefs)};`;
  code += `\n${HELPER_IMPORT}`;
  if (wxml.usesMotion) code += `\n${MOTION_IMPORT}`;
  for (const extra of extraImports) code += `\n${extra}`;
  const shadowed = shadowedGlobalsImport(compiled.content);
  if (shadowed) code += `\n${shadowed.trimEnd()}`;
  code += `\n${RUNTIME_IMPORT}`;
  const initialData =
    options.kind === 'page' && options.route
      ? `, data: { __fjsRoute: ${JSON.stringify({ path: options.route.path, name: options.route.name, meta: options.route.meta, fullPath: options.route.path, params: {}, query: {} })} }`
      : '';
  code += `\n__fjsCreate(__sfc__, { isPage: ${options.kind === 'page'}${initialData} });`;
  // importing SFCs still `import X from './X.vue'` for usingComponents book
  // keeping — the default export keeps the emission honest even though tag
  // resolution itself goes through the component's JSON path
  code += `\nexport default __sfc__;`;
  return code;
}
