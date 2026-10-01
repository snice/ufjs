// Compiles an SFC string in the test, the way the CLI does for Flutter
// builds (vue-plugin.ts): VDOM with hoistStatic off, or Vapor (specs/161).
// The module's `import { … } from 'vue'` lines become a destructure of the
// runtime object the test passes in. The VDOM path compiles with the
// workspace vue (3.5, what the runtime ships against); the Vapor path is
// the own SFC compiler (sfc-compiler.ts): stable compiler-sfc for the
// script, @vue/compiler-vapor (build-time devDependency) for the template.
import { compileScript, parse } from 'vue/compiler-sfc';
import { inlineVaporOnce } from '../../src/vapor/once-inline';
import { compileVaporSfc } from '../../src/vapor/sfc-compiler';

const FJS_TAGS = new Set(['view', 'text', 'image', 'button', 'input', 'scroll-view', 'swiper', 'swiper-item']);

export interface CompiledSfc {
  component: Record<string, unknown>;
  scopeId: string;
  css: { scoped: boolean; text: string }[];
}

let seq = 0;

export function compileSfc(
  source: string,
  { vapor, runtime, imports = {}, modules = {}, web = false }: {
    vapor: boolean;
    /** compile with the web tag rules (specs/171: component-backed tags) */
    web?: boolean;
    runtime: Record<string, unknown>;
    imports?: Record<string, unknown>;
    /** named imports from other specifiers: `import { useRouter } from
     * 'fjs/router'` destructures from modules['fjs/router'] */
    modules?: Record<string, Record<string, unknown>>;
  },
): CompiledSfc {
  const text = vapor ? source.replace('<script setup', '<script setup vapor') : source;
  const scopeId = `data-v-t${seq++}`;
  let content: string;
  let styleTexts: { scoped: boolean; text: string }[];
  if (vapor) {
    const res = compileVaporSfc(text, { file: `t${seq}.vue`, id: scopeId, web, moduleTags: new Set() });
    if ('errors' in res) throw new Error(res.errors.map((e) => e.text).join('\n'));
    content = res.code;
    styleTexts = source.match(/<style[^>]*>([\s\S]*?)<\/style>/g)?.map((block) => {
      const scoped = /scoped/.test(block.split('>')[0]);
      return { scoped, text: block.replace(/^<style[^>]*>/, '').replace(/<\/style>$/, '') };
    }) ?? [];
  } else {
    const { descriptor, errors } = parse(text, { filename: `t${seq}.vue` });
    if (errors.length) throw errors[0];
    const { content: script } = compileScript(descriptor, {
      id: scopeId,
      inlineTemplate: true,
      templateOptions: { compilerOptions: { isNativeTag: (t: string) => FJS_TAGS.has(t), hoistStatic: false } },
    });
    content = script;
    styleTexts = descriptor.styles.map((s) => ({ scoped: !!s.scoped, text: s.content }));
  }
  const body = content
    // specs/171: tag registration imports — a test registers what it needs
    .replace(/import\s*"fjs\/tag\/[^"]+";?\n?/g, '')
    .replace(/import\s*\{([^}]*)\}\s*from\s*['"]vue['"];?/g, (_, spec: string) => `const {${spec.replace(/\s+as\s+/g, ': ')}} = __vue;`)
    .replace(/import\s*\{([^}]*)\}\s*from\s*['"]fjs\/vapor['"];?/g, (_, spec: string) => `const {${spec.replace(/\s+as\s+/g, ': ')}} = __vue;`)
    .replace(/import\s*\{([^}]*)\}\s*from\s*['"]fjs\/router['"];?/g, (_, spec: string) => `const {${spec.replace(/\s+as\s+/g, ': ')}} = __fjsRouter;`)
    .replace(/import\s+(\w+)\s+from\s*['"]([^'"]+)['"];?/g, (_, name: string, from: string) => `const ${name} = __imports[${JSON.stringify(from)}];`)
    .replace('export default', 'return');
  const component = new Function('__vue', '__imports', '__fjsRouter', body)(
    runtime,
    imports,
    modules['fjs/router'] ?? {},
  ) as Record<string, unknown>;
  const css = styleTexts;
  if (css.some((s) => s.scoped)) component.__scopeId = scopeId;
  return { component, scopeId, css };
}
