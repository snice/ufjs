// specs/121 — the shared chunk evaluates what the app entry imports in the
// entry's own order, so style sheets register as in main.ts / the web build.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { entryImportOrder } from '../src/bundler/build.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('entryImportOrder', () => {
  it('lists runtime imports in source order, relative ones made absolute', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-entry-'));
    dirs.push(dir);
    const entry = path.join(dir, 'main.ts');
    fs.writeFileSync(
      entry,
      `import { createFjsApp } from 'fjs/app';
import type { App } from 'vue';
import { routes } from 'fjs/pages';
import Shell from './Shell.vue';
import './theme.css';
import {
  plugins,
} from 'fjs/plugins';
createFjsApp({ routes, shell: Shell, plugins }).mount();
`,
    );
    expect(entryImportOrder(entry)).toEqual([
      'fjs/app',
      'fjs/pages',
      path.join(dir, 'Shell.vue'),
      path.join(dir, 'theme.css'),
      'fjs/plugins',
    ]);
  });
});
