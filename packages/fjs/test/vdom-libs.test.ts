// specs/182: an enableVapor app bundles the Vue renderer only when its
// sources import a third-party package that ships VDOM-compiled components.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { usesVaporInterop, vdomComponentLibs } from '../src/bundler/vdom-libs';

function project(files: Record<string, string>, fjs: Record<string, unknown> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-vdomlibs-'));
  const all: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'app', fjs }),
    'src/main.ts': "import { createFjsApp } from 'fjs/app';\ncreateFjsApp({ enableVapor: true, routes: [] }).mount();\n",
    ...files,
  };
  for (const [rel, text] of Object.entries(all)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return root;
}

const lib = (name: string, entry: Record<string, string>) =>
  Object.fromEntries([
    [`node_modules/${name}/package.json`, JSON.stringify({ name, module: 'es/index.mjs' })],
    ...Object.entries(entry).map(([f, t]) => [`node_modules/${name}/${f}`, t]),
  ]);

describe('VDOM component library detection (specs/182)', () => {
  it('finds a library whose barrel re-exports compiled components, follows deep imports, skips composables', () => {
    const root = project({
      'src/plugins/ui.ts': "import { Button } from 'ui-kit';\nimport Tag from 'tagger/dist/tag/index.mjs';\nimport { defineStore } from 'store-lib';\n",
      ...lib('ui-kit', {
        'es/index.mjs': 'export * from "./button/index.mjs";\n',
        'es/button/index.mjs': 'import _Button from "./Button.mjs";\nexport const Button = _Button;\n',
        'es/button/Button.mjs': 'import { createVNode as _createVNode, defineComponent } from "vue";\nexport default defineComponent({ setup: () => () => _createVNode("button") });\n',
      }),
      ...lib('tagger', {
        'es/index.mjs': 'export {};\n',
        'dist/tag/index.mjs': 'import { openBlock, createElementBlock } from "vue";\nexport default {};\n',
      }),
      ...lib('store-lib', {
        'es/index.mjs': 'import { ref, inject } from "vue";\nexport function defineStore() { return ref(0); }\n',
      }),
    });
    expect(vdomComponentLibs(root)).toEqual(['tagger', 'ui-kit']);
    expect(usesVaporInterop(root)).toBe(true);
  });

  it("a createBlock of a library's own (not from vue) is no marker; no library means no interop", () => {
    const root = project({
      'src/pages/index.vue': "<script setup>\nimport { Leafer } from 'canvas-lib'\n</script>\n<template><view /></template>\n",
      ...lib('canvas-lib', { 'es/index.mjs': 'export function createBlock() {}\nexport class Leafer {}\n' }),
    });
    expect(vdomComponentLibs(root)).toEqual([]);
    expect(usesVaporInterop(root)).toBe(false);
  });

  it('fjs.vapor.interop forces it either way; a non-enableVapor app never asks', () => {
    const forcedOn = project({}, { vapor: { interop: true } });
    expect(usesVaporInterop(forcedOn)).toBe(true);
    const forcedOff = project(
      {
        'src/a.ts': "import 'ui-kit';\n",
        ...lib('ui-kit', { 'es/index.mjs': 'import { createVNode } from "vue";\n' }),
      },
      { vapor: { interop: false } },
    );
    expect(usesVaporInterop(forcedOff)).toBe(false);
    const vdomApp = project({ 'src/main.ts': "createFjsApp({ routes: [] }).mount();\n" });
    expect(usesVaporInterop(vdomApp)).toBe(false);
  });
});
