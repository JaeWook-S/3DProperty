// Shared by both Vite apps. Manual dev and the Mac launcher use the same
// preview-only fallback when the GPU API is unavailable. Builds never probe it.
export async function furnitureApiConfig({ command, env = {}, processEnv = process.env,
  fetchImpl = globalThis.fetch, timeoutMs = 1500 }) {
  const target = processEnv.FURNITURE_API_TARGET || env.FURNITURE_API_TARGET || 'http://127.0.0.1:8000';
  const configured = processEnv.VITE_FURNITURE_MEASUREMENT_ENABLED ?? env.VITE_FURNITURE_MEASUREMENT_ENABLED;
  let enabled = configured;
  if (enabled === undefined && command === 'serve') {
    try {
      const response = await fetchImpl(new URL('/health', target), { signal: AbortSignal.timeout(timeoutMs) });
      const health = response.ok ? await response.json() : null;
      enabled = health?.status === 'ok' && health.ready === true ? '1' : '0';
    } catch { enabled = '0'; }
  }
  // Retain the deployment's explicit flag and the existing build default.
  // A build on a laptop must not permanently disable a remote production API.
  if (enabled === undefined) enabled = '1';
  if (!['0', '1'].includes(enabled)) throw new Error('VITE_FURNITURE_MEASUREMENT_ENABLED must be 0 or 1.');
  return {
    define: { 'import.meta.env.VITE_FURNITURE_MEASUREMENT_ENABLED': JSON.stringify(enabled) },
    proxy: { '/api/furniture': { target, changeOrigin: true } },
  };
}
