import { furnitureApiConfig } from '../../tools/vite/furniture-api.js';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(async ({ mode, command }) => {
  const env = { ...loadEnv(mode, repositoryRoot, ''), ...loadEnv(mode, process.cwd(), '') };
  const furniture = await furnitureApiConfig({ command, env });
  return {
    base: './',
    define: furniture.define,
    server: {
      // Share the image upload client with the 3D viewer in the same repository.
      fs: { allow: [repositoryRoot] },
      watch: { ignored: ['**/.envs/**', '**/runtime/**', '**/.tooling/**'] },
      proxy: furniture.proxy,
    },
  };
});
