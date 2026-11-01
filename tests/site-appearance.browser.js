import { test, expect } from '@playwright/test';

test('outdoor environment is local and rendering a site visit restores the interior look', async ({ page }, info) => {
  const errors = [], remote = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (/polyhaven\.(com|org)/.test(request.url())) remote.push(request.url()); });
  await page.goto('/?studio=1&test=1&quality=light');
  await page.locator('#select-building').click();
  await expect.poll(() => page.evaluate(() => window.__studio.inspect().siteAppearance.environment)).toBe('ready');
  expect(await page.evaluate(() => window.__studio.inspect().siteAppearance.facadeWindows)).toBeGreaterThan(10000);
  await expect(page.locator('#context-toolbar')).toContainText('시각화용 디자인');
  await page.screenshot({ path: info.outputPath('focused-building.png') });
  await page.locator('#open-unit').click();
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'overview');
  const original = await page.locator('canvas').first().screenshot({ path: info.outputPath('interior-before.png') });
  const state = await page.evaluate(() => window.__walkthrough.getState());
  await page.locator('#nav-complex').click();
  await page.locator('#select-building').click();
  await page.locator('[data-view="site"]').click();
  await page.screenshot({ path: info.outputPath('whole-site.png') });
  await info.attach('site-render-counters', { body: JSON.stringify(await page.evaluate(() => window.__walkthrough.getState().renderStats)), contentType: 'application/json' });
  await page.locator('#open-unit').click();
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'overview');
  const restored = await page.locator('canvas').first().screenshot({ path: info.outputPath('interior-restored.png') });
  expect(restored.equals(original), 'site sky, fog, lights and exposure must not leak into interiors').toBe(true);
  const after = await page.evaluate(() => window.__walkthrough.getState());
  expect(after.lighting).toBe(state.lighting); expect(after.doors).toEqual(state.doors);
  expect(after.scale).toEqual([1, 1, 1]);
  expect(errors).toEqual([]); expect(remote).toEqual([]);
});

test('missing local HDRI leaves a usable fallback sky and building/floor controls', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*.hdr*', route => route.fulfill({ status: 404, body: 'missing' }));
  await page.goto('/?studio=1&test=1&quality=light');
  await page.locator('#select-building').click();
  await expect.poll(() => page.evaluate(() => window.__studio.inspect().siteAppearance.environment)).toBe('fallback');
  await page.locator('#context-building').selectOption('102');
  await page.locator('#floor-down').click();
  await expect(page.locator('#floor-range')).toHaveValue('21');
  await page.locator('[data-view="site"]').click();
  expect(await page.evaluate(() => window.__studio.inspect().visibleBuildings.length)).toBe(15);
  expect(errors).toEqual([]);
});
