import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  // Other app builds replace dist directories on the shared NAS filesystem.
  server: { watch: { ignored: ['**/dist/**', '**/*.blend', '**/*.blend1'] } },
});
