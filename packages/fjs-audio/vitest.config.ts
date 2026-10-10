import { defineConfig } from 'vitest/config';

// A pure-API module: no SFCs, no plugin. The tests read the package entry
// and talk to fake __fjs / wx / Audio globals.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
