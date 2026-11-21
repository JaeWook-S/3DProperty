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
      // 자연어 편집 LLM(vLLM) 프록시: 브라우저가 /nl-llm으로 호출하면 로컬 8001로 넘겨준다.
      // 덕분에 노트북에서 5173 포트 하나만 SSH 포워딩하면 된다(8001 별도 터널 불필요).
      proxy: {
        ...furniture.proxy,
        '/nl-llm': {
          target: env.VITE_NL_PROXY_TARGET || 'http://127.0.0.1:8001',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/nl-llm/, ''),
        },
      },
    },
  };
});
