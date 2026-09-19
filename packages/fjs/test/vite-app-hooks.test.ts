// Vite plugins reach the app build only through an `fjs.app` hook: the
// collector must pick exactly those out of a plugins list, and the esbuild
// side must feed matching files through them. Plain plugin objects — no
// project, no Vite, no component library.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';
import {
  collectAppHooks,
  loadViteAppHooks,
  viteAppHooksPlugin,
  type FjsAppHook,
} from '../src/project/vite-plugins';

const app = { filter: /\/lib\.mjs$/, transform: (code: string) => code };

describe('vite app hooks', () => {
  it('collects only plugins that declare fjs.app, through Vite list shapes', async () => {
    const hooks = await collectAppHooks([
      { name: 'web-only' },
      [{ name: 'nested', fjs: { app } }, null, false],
      Promise.resolve({ name: 'async', fjs: { app } }),
      { name: 'other-fjs-key', fjs: {} },
    ]);
    expect(hooks.map((h) => h.plugin)).toEqual(['nested', 'async']);
  });

  it('rejects a malformed hook by plugin name', async () => {
    await expect(collectAppHooks([{ name: 'broken', fjs: { app: { filter: '/x/' } } }])).rejects.toThrow(
      /"broken"/,
    );
  });

  it('a project without a vite config has no hooks', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-no-vite-'));
    expect(await loadViteAppHooks(dir)).toEqual([]);
  });

  it('chains matching hooks over a file and leaves the rest alone', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-hooks-'));
    fs.writeFileSync(path.join(dir, 'lib.mjs'), 'export const v = "a";\n');
    fs.writeFileSync(path.join(dir, 'other.mjs'), 'export const w = "a";\n');
    fs.writeFileSync(path.join(dir, 'entry.mjs'), 'export { v } from "./lib.mjs"; export { w } from "./other.mjs";\n');
    const hook = (plugin: string, from: string, to: string): FjsAppHook => ({
      plugin,
      filter: /\/lib\.mjs$/,
      transform: (code) => code.replace(from, to),
    });
    const out = await esbuild.build({
      entryPoints: [path.join(dir, 'entry.mjs')],
      bundle: true,
      write: false,
      format: 'esm',
      plugins: [viteAppHooksPlugin([hook('one', '"a"', '"b"'), hook('two', '"b"', '"c"')])],
    });
    const code = out.outputFiles[0].text;
    expect(code).toContain('v = "c"');
    expect(code).toContain('w = "a"');
  });
});
