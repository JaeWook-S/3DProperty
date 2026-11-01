import { furnitureApiConfig } from './tools/vite/furniture-api.js';
import { defineConfig, loadEnv } from 'vite';
export default defineConfig(async ({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const furniture = await furnitureApiConfig({ command, env });
  return {
    base: './',
    define: furniture.define,
    // Other app builds replace dist directories on the shared NAS filesystem.
    server: {
      watch: { ignored: ['**/dist/**', '**/*.blend', '**/*.blend1', '**/.envs/**', '**/runtime/**', '**/.tooling/**'] },
      proxy: furniture.proxy,
    },
  };
});
