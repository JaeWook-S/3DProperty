import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.browser.js', timeout: 180000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:5185', viewport: { width: 1440, height: 1000 },
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    launchOptions: { env: { ...process.env, ...(process.env.CORTEX_FONTCONFIG_FILE ? { FONTCONFIG_FILE: process.env.CORTEX_FONTCONFIG_FILE } : {}) }, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] } },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5185', reuseExistingServer: !process.env.CI },
});
