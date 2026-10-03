// specs/169: a release --pages build's shared chunk exports only the names
// the entry and the page chunks import; dev keeps whole namespaces.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectSharedImports, sharedEntrySource } from '../src/bundler/build';
import { sharedExternalPlugin, SHARED_BARE_BUILTIN } from '../src/bundler/vue-plugin';

describe('shared chunk narrowing (specs/169)', () => {
  it('collects named imports per shared specifier; namespace / default imports fall back to the whole module', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-narrow-'));
    fs.writeFileSync(path.join(dir, 'a.ts'), "import { ref, computed as c } from 'vue';\nimport { useRouter } from 'fjs/router';\nexport const x = [ref, c, useRouter];");
    fs.writeFileSync(path.join(dir, 'b.ts'), "import * as fjs from 'fjs';\nimport V from 'pinia';\nimport { watch } from 'vue';\nexport const y = [fjs, V, watch];");
    const shared = [...SHARED_BARE_BUILTIN, 'pinia'];
    const names = await collectSharedImports(
      [
        { name: 'a', contents: `export * from ${JSON.stringify(path.join(dir, 'a.ts'))};` },
        { name: 'b', contents: `export * from ${JSON.stringify(path.join(dir, 'b.ts'))};` },
      ],
      dir,
      shared,
      [sharedExternalPlugin(undefined, shared)],
    );
    expect([...(names.get('vue') as Set<string>)].sort()).toEqual(['computed', 'ref', 'watch']);
    expect([...(names.get('fjs/router') as Set<string>)]).toEqual(['useRouter']);
    expect(names.get('fjs')).toBe('*');
    expect(names.get('pinia')).toBe('*');
    // nobody imports fjs/vue, but a DOM shim reads these off __FJS_SHARED (specs/200)
    expect([...(names.get('fjs/vue') as Set<string>)].sort()).toEqual(['measureTextBlock', 'onGlobalPointerDown', 'styleEngine']);
  });

  it('keeps the dynamically-read names with a static import alongside, and the whole namespace when asked for (specs/200)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-narrow-'));
    fs.writeFileSync(path.join(dir, 'a.ts'), "import { registerStyles } from 'fjs/vue';\nexport const x = registerStyles;");
    fs.writeFileSync(path.join(dir, 'b.ts'), "import * as v from 'fjs/vue';\nexport const y = v;");
    const shared = [...SHARED_BARE_BUILTIN];
    const run = (file: string, shared2: string[]) =>
      collectSharedImports(
        [{ name: 'e', contents: `export * from ${JSON.stringify(path.join(dir, file))};` }],
        dir,
        shared2,
        [sharedExternalPlugin(undefined, shared2)],
      );
    const named = await run('a.ts', shared);
    expect([...(named.get('fjs/vue') as Set<string>)].sort()).toEqual(['measureTextBlock', 'onGlobalPointerDown', 'registerStyles', 'styleEngine']);
    expect((await run('b.ts', shared)).get('fjs/vue')).toBe('*');
    // a specifier the app does not share is not conjured into the map
    fs.writeFileSync(path.join(dir, 'c.ts'), "import { ref } from 'vue';\nexport const z = ref;");
    expect((await run('c.ts', shared.filter((id) => id !== 'fjs/vue'))).has('fjs/vue')).toBe(false);
  });

  it('generates named imports when names are known, namespaces otherwise', () => {
    const narrowed = sharedEntrySource(new Map(), ['pinia'], [], new Map<string, Set<string> | '*'>([
      ['vue', new Set(['ref', 'watch'])],
      ['fjs', '*'],
      ['pinia', new Set(['defineStore'])],
    ]));
    expect(narrowed).toContain('import { ref as vue_0, watch as vue_1 } from "vue";');
    expect(narrowed).toContain('import * as fjs from "fjs";');
    // no page imports it: still evaluated, nothing shared
    expect(narrowed).toContain('import "@vue/runtime-core";');
    expect(narrowed).toContain('import { defineStore as __s0_0 } from "pinia";');
    expect(narrowed).not.toContain("import * as vue from 'vue'");
    const dev = sharedEntrySource(new Map(), ['pinia'], []);
    expect(dev).toContain('import * as vue from "vue";');
    expect(dev).toContain('import * as runtimeCore from "@vue/runtime-core";');
    expect(dev).toContain('import * as __s0 from "pinia";');
  });
});
