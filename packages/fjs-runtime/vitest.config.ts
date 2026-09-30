import { defineConfig } from 'vitest/config';

// The vapor tests (specs/161) run in the main project: the own runtime
// imports @vue/reactivity and @vue/shared straight from node resolution, and
// nothing needs the esm-bundler inlining (or the runtime-dom mock) that the
// runtime-vapor shell required.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
