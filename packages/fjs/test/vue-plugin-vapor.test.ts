// Vapor SFCs in fjs builds (specs/161). A component opts in with
// `<script setup vapor>`; a library's `<script setup>`-only SFC under
// node_modules is compiled as Vapor automatically (fjs.vapor.libs: false
// turns that off). A Vapor module's helpers come from fjs/vapor (the own
// runtime); a VDOM module importing a Vapor SFC is redirected to the
// compile-time wrapper.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { describe, expect, it } from 'vitest';
import { isAutoVapor, isVaporSfcFile, sharedBare, stripJsComments, usesVapor, usesEnableVapor, vaporWrapperModule, vueSfcPlugin, vuePinPlugin, vaporWrapperPlugin } from '../src/bundler/vue-plugin';

const VDOM = `<script setup lang="ts">
const n: number = 1
</script>
<template><view class="a"><text>{{ n }}</text></view></template>
<style scoped>.a { color: red; }</style>`;
const VAPOR = VDOM.replace('<script setup', '<script setup vapor');

function project(files: Record<string, string>, pkg: Record<string, unknown> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-vapor-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 't', ...pkg }));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

/** The compiled module of [file], as esbuild's SFC plugin emits it. */
async function compiled(dir: string, file: string): Promise<string> {
  const res = await esbuild.build({
    entryPoints: [path.join(dir, file)],
    absWorkingDir: dir,
    bundle: true,
    write: false,
    format: 'esm',
    external: ['vue', 'fjs/vue', 'fjs/vapor'],
    plugins: [vueSfcPlugin({}), vaporWrapperPlugin()],
    logLevel: 'silent',
  });
  return res.outputFiles[0].text;
}

describe('Vapor SFC compile', () => {
  it('<script setup vapor> compiles to a Vapor component over the own runtime', async () => {
    const dir = project({ 'A.vue': VAPOR });
    const js = await compiled(dir, 'A.vue');
    expect(js).toContain('defineVaporComponent');
    expect(js).toContain('template(');
    expect(js).not.toContain('createElementBlock');
    expect(js).not.toContain('enableVapor');
    // scoped CSS still reaches the style engine, and the scope id the
    // template stamps is the one registered
    const scope = /__fjsRegisterStyles\("(data-v-[0-9a-f]+)"/.exec(js)?.[1];
    expect(scope).toBeTruthy();
    expect(js).toContain(`${scope} class=a`);
  });

  it("a Vapor module takes its helpers from fjs/vapor, not the 'vue' shim", async () => {
    const dir = project({ 'A.vue': VAPOR.replace('const n', "import { ref } from 'vue'\nconst r = ref(0)\nconst n") });
    const js = await compiled(dir, 'A.vue');
    expect(js).not.toMatch(/from\s*["']vue["']/);
    expect(js).toMatch(/from\s*["']fjs\/vapor["']/);
  });

  it('a --pages build shares fjs/vapor only when the app has a Vapor component', () => {
    const plain = project({ 'src/A.vue': VDOM });
    const vapor = project({ 'src/pages/B.vue': VAPOR });
    const lib = project({ 'node_modules/ui/package.json': '{}', 'node_modules/ui/C.vue': VDOM }, { dependencies: { ui: '1.0.0' } });
    expect(usesVapor(plain)).toBe(false);
    expect(sharedBare(plain)).not.toContain('fjs/vapor');
    expect(usesVapor(vapor)).toBe(true);
    expect(sharedBare(vapor)).toContain('fjs/vapor');
    expect(usesVapor(lib)).toBe(true);
  });

  it('a plain <script setup> stays VDOM', async () => {
    const dir = project({ 'A.vue': VDOM });
    const js = await compiled(dir, 'A.vue');
    expect(js).toContain('createElementBlock');
    expect(js).not.toContain('defineVaporComponent');
    expect(js).not.toContain('enableVapor');
  });

  it('a library SFC with only <script setup> is Vapor; fjs.vapor.libs: false keeps it VDOM', async () => {
    const lib = { 'node_modules/ui/B.vue': VDOM, 'entry.ts': "import B from 'ui/B.vue'; export default B;" };
    expect(await compiled(project(lib), 'entry.ts')).toContain('defineVaporComponent');
    expect(await compiled(project(lib, { fjs: { vapor: { libs: false } } }), 'entry.ts')).not.toContain('defineVaporComponent');
  });

  it('a library SFC with a plain <script> (options API) is left alone', () => {
    const d = { script: {}, scriptSetup: {} };
    expect(isAutoVapor(path.join('x', 'node_modules', 'ui', 'C.vue'), d, true)).toBe(false);
    expect(isAutoVapor(path.join('x', 'src', 'C.vue'), { script: null, scriptSetup: {} }, true)).toBe(false);
  });

  it('pins one physical copy of the runtime packages; nothing pulls runtime-vapor', async () => {
    const dir = project({ 'entry.ts': "import { ref } from 'vue'; export default ref(0);" });
    const res = await esbuild.build({
      entryPoints: [path.join(dir, 'entry.ts')],
      bundle: true,
      write: false,
      format: 'esm',
      metafile: true,
      plugins: [vuePinPlugin()],
      logLevel: 'silent',
    });
    const inputs = Object.keys(res.metafile!.inputs);
    expect(inputs.some((f) => f.endsWith('runtime-core.esm-bundler.js'))).toBe(true);
    expect(inputs.some((f) => f.includes('runtime-vapor'))).toBe(false);
    expect(inputs.some((f) => f.endsWith('runtime-dom.esm-bundler.js'))).toBe(false);
  });
});

describe('Vapor wrapper (a VDOM module importing a Vapor SFC)', () => {
  it('redirects the import to a generated wrapper and leaves VDOM imports alone', async () => {
    const dir = project({ 'Page.vue': VDOM, 'Kid.vue': VAPOR, 'entry.ts': "import Kid from './Kid.vue'; import Page from './Page.vue'; export { Kid, Page };" });
    const js = await compiled(dir, 'entry.ts');
    // Kid went through the wrapper (adopts a vapor block, renders the
    // placeholder); Page compiled as a VDOM component as usual
    expect(js).toContain('adoptVaporComponent');
    expect(js).toContain('fjs-vapor-root');
    expect(js).toContain('createElementBlock');
    expect((js.match(/adoptVaporComponent/g) ?? []).length).toBe(1);
  });

  it('isVaporSfcFile judges by parse; the wrapper module references the SFC path', () => {
    const dir = project({ 'Kid.vue': VAPOR, 'Plain.vue': VDOM });
    expect(isVaporSfcFile(path.join(dir, 'Kid.vue'), true)).toBe(true);
    expect(isVaporSfcFile(path.join(dir, 'Plain.vue'), true)).toBe(false);
    const mod = vaporWrapperModule(path.join(dir, 'Kid.vue'));
    expect(mod).toContain('adoptVaporComponent');
    expect(mod).toContain('mountAdoptNodes');
    expect(mod).toContain('releaseAdopt');
    expect(mod).toContain('fjs-vapor-root');
    expect(mod).toContain(JSON.stringify(path.join(dir, 'Kid.vue')));
  });

  it('a --pages build still shares fjs/vapor only when the app has a Vapor component', () => {
    const plain = project({ 'src/A.vue': VDOM });
    const vapor = project({ 'src/pages/B.vue': VAPOR });
    expect(usesVapor(plain)).toBe(false);
    expect(sharedBare(plain)).not.toContain('fjs/vapor');
    expect(usesVapor(vapor)).toBe(true);
    expect(sharedBare(vapor)).toContain('fjs/vapor');
  });
});

describe('enableVapor (specs/166)', () => {
  it('usesEnableVapor reads the flag off the app entry', () => {
    const dir = project({
      'src/main.ts': "import { createFjsApp } from 'fjs/app';\ncreateFjsApp({ enableVapor: true, routes: [] });",
      'src/other.ts': 'const enableVapor = { true: 1 };',
    });
    expect(usesEnableVapor(dir, 'src/main.ts')).toBe(true);
    expect(usesEnableVapor(dir, 'src/other.ts')).toBe(false);
    expect(usesEnableVapor(dir)).toBe(true); // default entry src/main.ts
  });

  it('specs/167: comments do not switch it on; only a literal true counts', () => {
    const dir = project({
      'src/a.ts': "// the app says so once — `enableVapor: true`\ncreateFjsApp({ routes });",
      'src/b.ts': "/* enableVapor: true */ createFjsApp({ routes, url: 'http://x//enableVapor: true' });",
      'src/c.ts': 'createFjsApp({ enableVapor: flag, routes });',
      'src/d.ts': 'createFjsApp({ enableVapor: false, routes });',
      'src/e.ts': "// enableVapor: false\ncreateFjsApp({ enableVapor: true });",
    });
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (m: string) => warns.push(m);
    try {
      expect(usesEnableVapor(dir, 'src/a.ts')).toBe(false);
      // the string stays a string: its `//` is not a comment start
      expect(usesEnableVapor(dir, 'src/b.ts')).toBe(false);
      expect(usesEnableVapor(dir, 'src/c.ts')).toBe(false);
      expect(usesEnableVapor(dir, 'src/d.ts')).toBe(false);
      expect(usesEnableVapor(dir, 'src/e.ts')).toBe(true);
    } finally {
      console.warn = orig;
    }
    expect(warns.filter((w) => w.includes('literal')).length).toBe(1);
    expect(warns.some((w) => w.includes('c.ts'))).toBe(true);
    expect(stripJsComments("a('//x') // y\n/* z */b")).toBe("a('//x') \nb");
  });

  it('specs/167: a vapor SFC importing useRouter from vue-router warns under enableVapor', async () => {
    const page = VAPOR.replace('<script setup vapor lang="ts">', "<script setup vapor lang=\"ts\">\nimport { useRouter } from 'vue-router'\nconst r = useRouter()");
    const dir = project({ 'RPage.vue': page, 'entry.ts': "import P from './RPage.vue'; export default P;" });
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (m: string) => warns.push(m);
    const build = (enableVapor: boolean) => esbuild.build({
      entryPoints: [path.join(dir, 'entry.ts')],
      absWorkingDir: dir, bundle: true, write: false, format: 'esm',
      external: ['vue', 'vue-router', 'fjs/vue', 'fjs/vapor'],
      plugins: [vueSfcPlugin({ enableVapor })],
      logLevel: 'silent',
    });
    try {
      await build(false);
      expect(warns.filter((w) => w.includes('vue-router')).length).toBe(0);
      await build(true);
      await build(true);
    } finally {
      console.warn = orig;
    }
    expect(warns.filter((w) => w.includes("from 'fjs/router'")).length).toBe(1);
  });

  it('the wrapper plugin is skipped: a vapor import compiles bare (the router mounts it)', async () => {
    const dir = project({ 'Kid.vue': VAPOR, 'entry.ts': "import Kid from './Kid.vue'; export default Kid;" });
    const withWrapper = await esbuild.build({
      entryPoints: [path.join(dir, 'entry.ts')],
      absWorkingDir: dir, bundle: true, write: false, format: 'esm',
      external: ['vue', 'fjs/vue', 'fjs/vapor'],
      plugins: [vueSfcPlugin({}), vaporWrapperPlugin()],
      logLevel: 'silent',
    });
    expect(withWrapper.outputFiles[0].text).toContain('fjs-vapor-root');
    const pure = await esbuild.build({
      entryPoints: [path.join(dir, 'entry.ts')],
      absWorkingDir: dir, bundle: true, write: false, format: 'esm',
      external: ['vue', 'fjs/vue', 'fjs/vapor'],
      plugins: [vueSfcPlugin({ enableVapor: true })],
      logLevel: 'silent',
    });
    const js = pure.outputFiles[0].text;
    expect(js).not.toContain('fjs-vapor-root');
    expect(js).not.toContain('adoptVaporComponent');
    // the page still compiles as a vapor component the router can mount
    expect(js).toContain('__vapor');
    expect(js).toContain('template(');
  });

  it('an enableVapor app names its VDOM SFCs — they would mount as nothing', async () => {
    const dir = project({ 'Page.vue': VDOM, 'entry.ts': "import Page from './Page.vue'; export default Page;" });
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (m: string) => warns.push(m);
    try {
      await esbuild.build({
        entryPoints: [path.join(dir, 'entry.ts')],
        absWorkingDir: dir, bundle: true, write: false, format: 'esm',
        external: ['vue', 'fjs/vue', 'fjs/vapor'],
        plugins: [vueSfcPlugin({ enableVapor: true })],
        logLevel: 'silent',
      });
    } finally {
      console.warn = orig;
    }
    expect(warns.join('\n')).toContain('Page.vue');
    expect(warns.join('\n')).toContain('no vapor attribute');
  });
});
