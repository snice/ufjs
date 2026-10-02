import { defineConfig } from 'vitest/config';

// The vapor tests (specs/161) run in the main project: the own runtime
// imports @vue/reactivity and @vue/shared straight from node resolution, and
// nothing needs the esm-bundler inlining (or the runtime-dom mock) that the
// runtime-vapor shell required.
//
// solid-js resolves by the "node" condition to its SERVER build, where
// createEffect is a no-op (specs/163's seam validation would silently never
// run) — the alias pins the bare specifier to the client build.
export default defineConfig({
  resolve: {
    alias: [{ find: /^solid-js$/, replacement: 'solid-js/dist/solid.js' }],
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
