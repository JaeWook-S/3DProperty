import { test, expect } from '@playwright/test';

const presets = 'variant=expanded&lighting=day&finish=original&quality=high';

for (const [name, url] of [
  ['root', '/'],
  ['presets without studio', `/?${presets}`],
  ['explicit studio', `/?studio=1&${presets}`],
]) {
  test(`${name} opens the same default Studio screen`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'complex', { timeout: 90000 });
    await expect(page.locator('.studio-brand')).toContainText('CORTEX');
    await expect(page.locator('#select-building')).toBeVisible();
    await expect(page.locator('#panel')).toBeHidden();
    await expect(page.locator('#studio-variant')).toHaveValue('expanded');
    for (const [id, value] of Object.entries({ lighting: 'day', finish: 'original', quality: 'high' })) {
      await expect(page.locator(`#${id}`)).toHaveValue(value);
      expect(new URL(page.url()).searchParams.get(id)).toBe(value);
    }
    expect(errors).toEqual([]);
  });
}

test('default Studio honors non-default model and rendering presets', async ({ page }) => {
  await page.goto('/?test=1&variant=basic&lighting=night&finish=original&quality=light');
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'complex', { timeout: 90000 });
  await expect(page.locator('#studio-variant')).toHaveValue('basic');
  const state = await page.evaluate(() => window.__walkthrough.getState());
  expect(state.variant).toBe('basic');
  expect(state.lighting).toBe('night');
  expect(state.finish).toBe('original');
  expect(state.quality).toBe('light');
});

test('studio=0 explicitly retains the legacy walkthrough', async ({ page }) => {
  await page.goto('/?studio=0&test=1&quality=light');
  await expect(page.locator('body')).toHaveAttribute('data-load-state', 'ready', { timeout: 90000 });
  await expect(page.locator('#panel')).toBeVisible();
  await expect(page.locator('#start')).toBeEnabled();
  await expect(page.locator('#studio-ui')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('studio')).toBe('0');
});
