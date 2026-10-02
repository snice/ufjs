// specs/172: an app build carries only the libfjs-style-backed style
// engine. vue/host-ops.ts picks it on `__FJS_TS_STYLE__ = false`, and the TS
// per-element engine must then be dead code esbuild drops — this bundles
// host-ops both ways and looks for a string only that engine contains.
import path from 'node:path';
import * as esbuild from 'esbuild';
import { describe, expect, it } from 'vitest';
import { parseBuildArgs } from '../src/bundler/build.js';
import { runtimeDir } from '../src/bundler/vue-plugin.js';

const TS_ENGINE_MARK = 'subtree walk hit its visit cap';
const NATIVE_ENGINE_MARK = 'this host has no native style engine';

async function bundleHostOps(tsStyle: boolean): Promise<string> {
  const out = await esbuild.build({
    stdin: {
      contents: `import { styleEngine } from ${JSON.stringify(path.join(runtimeDir(), 'src/vue/host-ops.ts'))};\nglobalThis.__e = styleEngine;`,
      resolveDir: runtimeDir(),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    logLevel: 'silent',
    define: {
      'process.env.NODE_ENV': '"production"',
      __VUE_OPTIONS_API__: 'true',
      __VUE_PROD_DEVTOOLS__: 'false',
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
      __FJS_DEVTOOLS__: 'false',
      __FJS_TS_STYLE__: String(tsStyle),
    },
  });
  return out.outputFiles[0].text;
}

describe('--ts-style (specs/172)', () => {
  it('is parsed into the build options', () => {
    expect(parseBuildArgs(['--ts-style']).tsStyle).toBe(true);
    expect(parseBuildArgs([]).tsStyle).toBeUndefined();
  });

  it('drops the TS per-element engine from a default app bundle', async () => {
    const native = await bundleHostOps(false);
    expect(native).not.toContain(TS_ENGINE_MARK);
    expect(native).toContain(NATIVE_ENGINE_MARK);
    const ts = await bundleHostOps(true);
    expect(ts).toContain(TS_ENGINE_MARK);
  }, 60_000);
});
