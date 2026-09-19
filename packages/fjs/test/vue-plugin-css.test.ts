// A plain `import 'x.css'` in a Flutter build. esbuild's own css loader
// writes a sibling .css file the host never reads, so a component library's
// styles vanished without an error (vant: specs/068). The SFC plugin turns
// the import into a registerStyles call instead.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { describe, expect, it } from 'vitest';
import { vueSfcPlugin } from '../src/bundler/vue-plugin';

async function bundle(web: boolean): Promise<esbuild.BuildResult & { outputFiles: esbuild.OutputFile[] }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-css-'));
  fs.writeFileSync(path.join(dir, 'lib.css'), ':root { --brand: #1989fa } .btn { color: var(--brand) }');
  fs.writeFileSync(path.join(dir, 'entry.js'), "import './lib.css';");
  return esbuild.build({
    entryPoints: [path.join(dir, 'entry.js')],
    bundle: true,
    write: false,
    outdir: path.join(dir, 'out'),
    format: 'iife',
    // 'fjs/vue' is the runtime alias; the test only cares about the call
    external: ['fjs/vue'],
    plugins: [vueSfcPlugin({ web })],
    logLevel: 'silent',
  });
}

describe('css imports', () => {
  it('flutter: the stylesheet is registered with the style engine, no .css emitted', async () => {
    const res = await bundle(false);
    expect(res.outputFiles.map((f) => path.extname(f.path))).toEqual(['.js']);
    const js = res.outputFiles[0].text;
    expect(js).toContain('registerStyles');
    expect(js).toContain('--brand: #1989fa');
  });

  it('web: left to the css loader', async () => {
    const res = await bundle(true);
    expect(res.outputFiles.some((f) => f.path.endsWith('.css'))).toBe(true);
    expect(res.outputFiles.find((f) => f.path.endsWith('.js'))!.text).not.toContain('registerStyles');
  });
});
