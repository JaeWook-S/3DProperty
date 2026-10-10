import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, repositoryRoot, ''), ...loadEnv(mode, process.cwd(), '') };
  return {
    base: './',
    server: {
      // Share the image upload client with the 3D viewer in the same repository.
      fs: { allow: [repositoryRoot] },
      watch: { ignored: ['**/.envs/**', '**/runtime/**', '**/.tooling/**'] },
      proxy: {
        '/api/furniture': { target: process.env.FURNITURE_API_TARGET || env.FURNITURE_API_TARGET || 'http://127.0.0.1:8000', changeOrigin: true },
      },
    },
  };
});
