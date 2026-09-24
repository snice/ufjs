// Builds the two generated inputs of the spec 093 end-to-end run (spec 109):
//
//   bundle.js  app-entry.js + the REAL runtime source, as the VM runs it
//   relay.cjs  packages/fjs/src/debug/cdp-server.ts, runnable by plain node
//
// Both used to be committed, which let them silently drift from the source
// they were built from — the e2e then tested old code. They are gitignored
// now; run this before every e2e (see README.md).
//
// esbuild comes from packages/fjs, which already depends on it: no new
// dependency. The app bundle uses the same settings the CLI's dev build
// uses (packages/fjs/src/bundler/build.ts: flutterEsbuildPlatform,
// target es2019 for PrimJS, fjsDefines with the DevTools data plane on).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const req = createRequire(path.join(root, 'packages/fjs/package.json'));
const esbuild = req('esbuild');

await esbuild.build({
  entryPoints: [path.join(here, 'app-entry.js')],
  outfile: path.join(here, 'bundle.js'),
  bundle: true,
  format: 'iife',
  target: 'es2019',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  // app-entry.js sits outside every package; resolve its bare imports
  // (@vue/runtime-core) the way the runtime package itself does
  nodePaths: [path.join(root, 'packages/fjs-runtime/node_modules')],
  define: {
    'process.env.NODE_ENV': '"production"',
    __VUE_OPTIONS_API__: 'true',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    __FJS_DEVTOOLS__: 'true',
  },
  logLevel: 'warning',
});

await esbuild.build({
  entryPoints: [path.join(root, 'packages/fjs/src/debug/cdp-server.ts')],
  outfile: path.join(here, 'relay.cjs'),
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  nodePaths: [path.join(root, 'packages/fjs/node_modules')],
  logLevel: 'warning',
});

console.log('built bundle.js and relay.cjs in', path.relative(process.cwd(), here) || '.');
