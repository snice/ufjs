import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fjs } from '@ufjs/cli/vite';

export default defineConfig({
  plugins: [fjs(), vue()],
  // same output dir as `fjs build --web`, so a web build does not wipe the Flutter bundle
  build: { outDir: 'dist/web' },
});
