import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// test/vapor.test.ts (specs/148) runs in a project of its own. It vi.mocks
// the '@vue/runtime-dom' that runtime-vapor imports — the fjs shim, as the
// app build pins it — which only works when Vue's packages are processed by
// vite (inline) and resolve to their esm-bundler builds: node's CJS
// runtime-core hides its exports from the shim's `export *`. Every other
// test keeps node's resolution, where vue-router and friends load the same
// copy of Vue as the test.
const require = createRequire(import.meta.url);
const esm = (pkg: string, file: string) =>
  path.join(path.dirname(require.resolve(`${pkg}/package.json`)), 'dist', file);
const fromVapor = createRequire(require.resolve('@vue/runtime-vapor/package.json'));
const VAPOR_TESTS = ['test/vapor*.test.ts'];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'runtime',
          include: ['test/**/*.test.ts'],
          exclude: VAPOR_TESTS,
        },
      },
      {
        resolve: {
          alias: [
            { find: /^@vue\/runtime-core$/, replacement: esm('@vue/runtime-core', 'runtime-core.esm-bundler.js') },
            { find: /^@vue\/reactivity$/, replacement: esm('@vue/reactivity', 'reactivity.esm-bundler.js') },
            { find: /^@vue\/shared$/, replacement: esm('@vue/shared', 'shared.esm-bundler.js') },
            { find: /^@vue\/runtime-vapor$/, replacement: esm('@vue/runtime-vapor', 'runtime-vapor.esm-bundler.js') },
            {
              find: /^@vue\/runtime-dom$/,
              replacement: path.join(path.dirname(fromVapor.resolve('@vue/runtime-dom/package.json')), 'dist', 'runtime-dom.esm-bundler.js'),
            },
          ],
        },
        test: {
          name: 'vapor',
          include: VAPOR_TESTS,
          server: { deps: { inline: [/[\\/]@vue[\\/]/] } },
        },
      },
    ],
  },
});
