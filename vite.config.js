import { defineConfig, loadEnv } from 'vite';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: './',
    // Other app builds replace dist directories on the shared NAS filesystem.
    server: {
      watch: { ignored: ['**/dist/**', '**/*.blend', '**/*.blend1', '**/.envs/**', '**/runtime/**', '**/.tooling/**'] },
      proxy: {
        '/api/furniture': { target: env.FURNITURE_API_TARGET || 'http://127.0.0.1:8000', changeOrigin: true },
      },
    },
  };
});
