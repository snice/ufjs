// Vapor SFC compilation over the stable compiler (specs/166). The own Vapor
// runtime needs exactly one artifact from Vue 3.6: the template CODEGEN.
// compiler-sfc stays on the stable 3.5 line for parse + script-setup; the
// template is compiled directly by @vue/compiler-vapor and spliced into the
// setup the way compiler-sfc@3.6's inlineTemplate used to — its module output
// minus the `__returned__` tail, with the vapor block code (which carries
// its own `return`) appended inside setup.
//
// Surgery on compileScript's generated module, anchored on shapes the script
// transform itself emits:
//   1. the setup tail  — `const __returned__ = {…} / defineProperty /
//      return __returned__` is replaced by the vapor block code (its last
//      statement returns the root block, which is what the own runtime's
//      `blockOf(comp.setup(…))` consumes);
//   2. `_defineComponent` → `_defineVaporComponent` (the underscore alias is
//      compiler-internal, so a user's own `defineComponent` import — a VDOM
//      child inside a Vapor page — is never touched);
//   3. `__vapor: true` stamped into the component options — the marker the
//      own runtime dispatches on (runtime.ts isVaporComponent);
//   4. v-bind() in CSS: the injected `useCssVars` call is renamed to the
//      vapor variant and its variable names lose the `data-v-` prefix (the
//      style engine keys them by the short id — the same values the specs/161
//      pipeline produced);
//   5. the template preamble (helper imports + `template()` declarations)
//      goes in front of the module, where the block code can see it.
// Everything still imports from 'vue' at this point; the caller's existing
// `from 'vue'` → `from 'fjs/vapor'` rewrite runs over the whole module.
import { parse, compileScript, type SFCDescriptor } from '@vue/compiler-sfc';
import { compile as compileVaporTemplate } from '@vue/compiler-vapor';
import { inlineVaporOnce } from './once-inline';
import { isAutoVapor, sfcParseOptions, vaporCompilerOptions } from './sfc-tags';

/** Whether a parsed descriptor is a Vapor SFC. compiler-sfc@3.5 does not
 * know the `vapor` attribute, so the flag is read off the script block's
 * attrs (`<script setup vapor>` → `attrs.vapor`); `descriptor.vapor` covers
 * a 3.6 parse if one ever shows up. */
export function isVaporDescriptor(d: {
  vapor?: unknown;
  script?: { attrs?: Record<string, unknown> } | null;
  scriptSetup?: { attrs?: Record<string, unknown> } | null;
}): boolean {
  if (d.vapor === true) return true;
  return (d.scriptSetup?.attrs?.vapor ?? d.script?.attrs?.vapor) !== undefined;
}

export interface VaporSfcResult {
  code: string;
  /** compiler-sfc's binding metadata — what the template expressions were
   * compiled against (setup refs, props, …). */
  bindings: Record<string, unknown>;
  /** the stable scope id ('data-v-…'), for the caller's style attach */
  id: string;
  scriptMappings?: string;
}

/** Compiles a Vapor SFC into module code whose imports still point at
 * 'vue' (the caller rewrites to fjs/vapor) and whose styles are NOT yet
 * attached (the caller appends registerStyles/injectStyle per platform —
 * the same split the two call sites already owned). [opts.id] is the scope
 * id the caller has already derived (the CLI hashes the path relative to
 * the build root; tests pass their own) — it lands in the template strings
 * of scoped styles and in the v-bind() CSS variable names. */
export function compileVaporSfc(
  source: string,
  opts: {
    file: string;
    id: string;
    web: boolean;
    moduleTags: Set<string>;
  },
): VaporSfcResult | { errors: { text: string }[] } {
  const filename = opts.file.split(/[\\/]/).pop() ?? opts.file;
  const parseOpts = sfcParseOptions({ web: opts.web, moduleTags: opts.moduleTags });
  const parsed = parseDescriptor(source, filename, parseOpts);
  if ('errors' in parsed) return parsed;
  let descriptor: SFCDescriptor = parsed.descriptor;
  // an EMPTY `<script setup vapor>` is dropped by the parser, and with it
  // the attribute isVaporDescriptor reads — re-injecting `vapor` into a
  // source that already says it made `<script setup vapor vapor>` and a
  // "Duplicate attribute." error (compiler-sfc versions that do not set
  // descriptor.vapor). The source's own attribute is the authority.
  const saysVapor = /<script\b[^>]*\bsetup\b[^>]*\bvapor\b/.test(source) || /<script\b[^>]*\bvapor\b[^>]*\bsetup\b/.test(source);
  if (!isVaporDescriptor(descriptor) && !saysVapor) {
    // an auto-vapor library SFC: tag the script and re-parse (the injected
    // attribute is the only `vapor` in the file, so the re-parse is clean)
    const reparsed = parseDescriptor(
      source.replace(/<script(\s[^>]*)?\ssetup\b/, (m) => `${m} vapor`),
      filename,
      parseOpts,
    );
    if ('errors' in reparsed) return reparsed;
    descriptor = reparsed.descriptor;
    if (!isVaporDescriptor(descriptor)) return { errors: [{ text: 'not a vapor SFC' }] };
  }

  const id = opts.id;
  const shortId = id.replace(/^data-v-/, '');

  // ---- script: compiler-sfc's transform, template NOT inlined ----------
  let compiled;
  try {
    compiled = compileScript(descriptor, { id });
  } catch (e) {
    return { errors: [{ text: String((e as Error).message ?? e) }] };
  }
  let content = compiled.content;
  const isTS = descriptor.scriptSetup?.lang === 'ts' || descriptor.script?.lang === 'ts';

  // ---- template: compiler-vapor, inline body ---------------------------
  let preamble = '';
  let body = 'return null'; // no template: a render-less vapor component
  if (descriptor.template) {
    const tplErrors: { text: string }[] = [];
    let tpl: { preamble?: string; code?: string };
    try {
      tpl = compileVaporTemplate(descriptor.template.content, {
        ...vaporCompilerOptions({ web: opts.web, moduleTags: opts.moduleTags }),
        prefixIdentifiers: true,
        inline: true,
        isTS,
        bindingMetadata: compiled.bindings ?? {},
        ...(descriptor.styles.some((s) => s.scoped) ? { scopeId: id } : {}),
        onError: (e: unknown) => {
          const err = e as { message?: string; loc?: { start?: { line?: number; column?: number } } };
          const loc = err.loc?.start;
          tplErrors.push({
            text: `SFC template error${loc ? ` (template line ${loc.line}:${loc.column ?? 0})` : ''}: ${
              err.message ?? String(e)
            }`,
          });
        },
      } as Record<string, unknown>);
    } catch (e) {
      return { errors: [{ text: `SFC template error: ${String((e as Error).message ?? e)}` }] };
    }
    if (tplErrors.length) return { errors: tplErrors };
    // the preamble's helper import points at 'vue' like everything else; the
    // caller's rewrite catches it. The `t0…` template declarations are module
    // scope — the block code references them from inside setup.
    preamble = tpl.preamble ?? '';
    body = (tpl.code ?? '').trim() || 'return null';
  }

  // ---- splice -----------------------------------------------------------
  // 3.5's script tail hands the template's bindings back to the VDOM
  // renderer; the vapor block code ends with the root block instead.
  const tail = /\n\s*const __returned__ = \{[\s\S]*?\n\s*return __returned__\n/;
  if (!tail.test(content)) {
    return { errors: [{ text: 'vapor SFC: unexpected compileScript shape (no __returned__ tail)' }] };
  }
  content = content.replace(tail, `\n${body}\n`);
  // the auto-inserted expose call is meaningless here (the own runtime's
  // setup ctx.expose is a no-op and vapor has no devtools instance)
  content = content.replace(/\n {2}__expose\(\);/, '');
  // helper rename: only the compiler's underscore alias, never a user import
  content = content.replace(/_defineComponent\b/g, '_defineVaporComponent');
  content = content.replace(
    /\bdefineComponent as _defineVaporComponent\b/,
    'defineVaporComponent as _defineVaporComponent',
  );
  // v-bind() in CSS: vapor has no instance proxy — the vapor variant applies
  // vars to the block's root elements, keyed by the short id
  if (descriptor.cssVars.length) {
    content = content.replace(/\b_useCssVars\b/g, '_useVaporCssVars');
    content = content.replaceAll('useCssVars as _useVaporCssVars', 'useVaporCssVars as _useVaporCssVars');
    content = content.replaceAll(`"${id}-`, `"${shortId}-`);
  }
  // the marker the own runtime dispatches on, stamped on the final export.
  // compileScript emits three shapes — a `_defineComponent` call, an
  // `Object.assign` over a normal <script>'s default, or a bare options
  // object when there is no default export at all — and only the first has
  // a helper call to anchor an in-object injection on. `export default` and
  // `const __sfc__ =` are both 14 characters, so this rewrite does not move
  // any column the script map recorded (the same trick the callers use —
  // which therefore must NOT repeat the conversion on this output).
  content = content.replace(/export default/, 'const __sfc__ =');
  content += '\n__sfc__.__vapor = true;\nexport default __sfc__;';

  return {
    // the output carries `const __sfc__ = …` + `__sfc__.__vapor = true` +
    // `export default __sfc__` — the callers append style attach after it
    code: inlineVaporOnce(`${preamble ? preamble + '\n' : ''}${content}`),
    bindings: compiled.bindings ?? {},
    id,
    scriptMappings: compiled.map?.mappings,
  };
}

function parseDescriptor(
  source: string,
  filename: string,
  parseOpts: Record<string, unknown>,
): { descriptor: SFCDescriptor } | { errors: { text: string }[] } {
  const { descriptor, errors } = parse(source, { filename, ...parseOpts });
  if (errors.length) {
    return {
      errors: errors.map((e) => ({ text: String((e as { message?: string }).message ?? e) })),
    };
  }
  return { descriptor };
}

