import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fjs } from '@ufjs/cli/vite';

export default defineConfig({
  plugins: [fjs(), vue()],
  // same output directory as `fjs build --web`
  build: { outDir: 'dist/web' },
});
