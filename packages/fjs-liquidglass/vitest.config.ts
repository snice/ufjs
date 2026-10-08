// The web stand-in is an SFC, so the test run needs the Vue plugin. The
// runtime package gets away without a config because its web components are
// plain .ts; this module keeps the .vue shape iconmind uses, because that is
// what fjs.widgets reads the props types out of.
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
});
