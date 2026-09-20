import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fjs } from '@ufjs/cli/vite';
import { vant } from './vite/vant.ts';

export default defineConfig({
  // vant() adapts vant for the fjs app build (its `fjs.app` hook, see
  // vite/vant.ts); the web build is untouched
  plugins: [fjs(), vant(), vue()],
  // Same dist/web as `fjs build --web`, so a web build does not empty dist/
  // out from under the Flutter bundle from `fjs build`.
  build: { outDir: 'dist/web' },
});
