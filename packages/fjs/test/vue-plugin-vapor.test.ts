// Vue Vapor SFCs in fjs builds (specs/148). A component opts in with
// `<script setup vapor>`; a library's `<script setup>`-only SFC under
// node_modules is compiled as Vapor automatically (fjs.vapor.libs: false
// turns that off). A Vapor module must also switch the interop on at module
// evaluation — enableVapor() — or a VDOM page cannot mount it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { describe, expect, it } from 'vitest';
import { isAutoVapor, prepareVaporSfcSource, sharedBare, usesVapor, vueSfcPlugin, vuePinPlugin } from '../src/bundler/vue-plugin';

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
    plugins: [vueSfcPlugin({})],
    logLevel: 'silent',
  });
  return res.outputFiles[0].text;
}

describe('Vapor SFC compile', () => {
  it('<script setup vapor> compiles to a Vapor component that enables the interop', async () => {
    const dir = project({ 'A.vue': VAPOR });
    const js = await compiled(dir, 'A.vue');
    expect(js).toContain('defineVaporComponent');
    expect(js).toContain('template(');
    expect(js).not.toContain('createElementBlock');
    expect(js).toMatch(/enableVapor[\s\S]*__fjsEnableVapor\(\)/);
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

  it('pins runtime-dom to the fjs shim and hands runtime-vapor the DOM shell', async () => {
    const dir = project({ 'entry.ts': "export { template } from '@vue/runtime-vapor';" });
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
    expect(inputs.some((f) => f.endsWith(path.join('src', 'vue', 'runtime-dom-shim.ts')))).toBe(true);
    expect(inputs.some((f) => f.endsWith(path.join('src', 'vapor', 'dom.ts')))).toBe(true);
    expect(inputs.some((f) => /runtime-dom\.esm-bundler\.js$/.test(f))).toBe(false);
  });
});

describe('Vite (web dev) source preparation', () => {
  it('adds the module-level enableVapor call to a Vapor SFC, matching its script lang', () => {
    const out = prepareVaporSfcSource(VAPOR, '/app/src/A.vue', true)!;
    expect(out).toMatch(/^<script lang="ts">\nimport \{ enableVapor as __fjsEnableVapor \} from 'fjs\/vapor';/);
    expect(out).toContain('<script setup vapor lang="ts">');
  });

  it('marks a library SFC as Vapor, and leaves VDOM SFCs untouched', () => {
    expect(prepareVaporSfcSource(VDOM, '/app/node_modules/ui/B.vue', true)).toContain('<script setup vapor lang="ts">');
    expect(prepareVaporSfcSource(VDOM, '/app/node_modules/ui/B.vue', false)).toBeNull();
    expect(prepareVaporSfcSource(VDOM, '/app/src/A.vue', true)).toBeNull();
  });
});
