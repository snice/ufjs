import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fjs } from '@ufjs/cli/vite';
import { vant } from './vite/vant.ts';
import { nutui } from './vite/nutui.ts';

export default defineConfig({
  // vant() / nutui() adapt the two component libraries for the fjs app
  // build (their `fjs.app` hooks, see vite/vant.ts and vite/nutui.ts); the
  // web build is untouched
  plugins: [fjs(), vant(), nutui(), vue()],
  // Same dist/web as `fjs build --web`, so a web build does not empty dist/
  // out from under the Flutter bundle from `fjs build`.
  build: { outDir: 'dist/web' },
});
