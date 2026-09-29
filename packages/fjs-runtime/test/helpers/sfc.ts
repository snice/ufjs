// Compiles an SFC string in the test, the way the CLI does for Flutter
// builds (vue-plugin.ts): VDOM with hoistStatic off, or Vapor (specs/148).
// The module's `import { … } from 'vue'` lines become a destructure of the
// runtime object the test passes in.
import { compileScript, parse } from 'vue/compiler-sfc';

const FJS_TAGS = new Set(['view', 'text', 'image', 'button', 'input', 'scroll-view', 'swiper', 'swiper-item']);

export interface CompiledSfc {
  component: Record<string, unknown>;
  scopeId: string;
  css: { scoped: boolean; text: string }[];
}

let seq = 0;

export function compileSfc(
  source: string,
  { vapor, runtime, imports = {} }: { vapor: boolean; runtime: Record<string, unknown>; imports?: Record<string, unknown> },
): CompiledSfc {
  const text = vapor ? source.replace('<script setup', '<script setup vapor') : source;
  const { descriptor, errors } = parse(text, { filename: `t${seq}.vue` });
  if (errors.length) throw errors[0];
  const scopeId = `data-v-t${seq++}`;
  const compilerOptions = { isNativeTag: (t: string) => FJS_TAGS.has(t), hoistStatic: false };
  const { content } = compileScript(descriptor, { id: scopeId, inlineTemplate: true, templateOptions: { compilerOptions } });
  const body = content
    .replace(/import\s*\{([^}]*)\}\s*from\s*['"]vue['"];?/g, (_, spec: string) => `const {${spec.replace(/\s+as\s+/g, ': ')}} = __vue;`)
    .replace(/import\s+(\w+)\s+from\s*['"]([^'"]+)['"];?/g, (_, name: string, from: string) => `const ${name} = __imports[${JSON.stringify(from)}];`)
    .replace('export default', 'return');
  const component = new Function('__vue', '__imports', body)(runtime, imports) as Record<string, unknown>;
  const css = descriptor.styles.map((s) => ({ scoped: !!s.scoped, text: s.content }));
  if (css.some((s) => s.scoped)) component.__scopeId = scopeId;
  return { component, scopeId, css };
}
