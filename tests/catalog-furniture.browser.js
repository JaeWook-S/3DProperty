import { test, expect } from '@playwright/test';

test('catalog sofa and stool preserve dimensions, living placement and real collisions', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?test=1&variant=expanded&view=living&quality=light');
  await expect(page.locator('body')).toHaveAttribute('data-load-state', 'ready', { timeout: 90000 });
  const state = () => page.evaluate(() => window.__walkthrough.getState());
  const furniture = await page.evaluate(() => window.__walkthrough.inspectFurniture());
  expect(furniture).toHaveLength(2);
  const sofa = furniture.find((item) => item.asset_id === 'catalog-sofa-2790');
  const stool = furniture.find((item) => item.asset_id === 'catalog-stool-980');
  // Both face west: local width maps to world Z, depth to world X, height to Y.
  for (const [item, expected] of [[sofa, [1.17, .73, 2.79]], [stool, [.70, .40, .98]]]) {
    expected.forEach((size, axis) => expect(item.sizeWorld[axis]).toBeCloseTo(size, 4));
    expect(item.min[1]).toBeCloseTo(0, 5);
    // Reparenting an exported quaternion introduces sub-micrometer rounding.
    item.scale.forEach(value => expect(value).toBeCloseTo(1, 6));
    expect(item.basis).toBe('catalog');
  }
  expect(sofa.min[0] - stool.max[0]).toBeCloseTo(.55, 4);
  expect(9.890719264983659 - sofa.max[0]).toBeCloseTo(.16, 4);
  expect((await state()).position).toEqual([6.35, 1.6, 6.4]);
  expect((await state()).standing).toBe(true);
  await page.locator('#catalog-furniture summary').click();
  await expect(page.locator('#catalog-furniture')).toContainText('2,790 × 1,170 × 730 mm');
  await expect(page.locator('#catalog-furniture')).toContainText('980 × 700 × 400 mm');
  await page.screenshot({ path: testInfo.outputPath('catalog-living-controls.png') });
  // Approach the sofa from the front, away from the stool.
  await page.evaluate(() => window.__walkthrough.place(7.9, 6.65, 9.2, 6.65));
  await page.evaluate(() => window.__walkthrough.move(2, 0));
  const sofaBlocked = await state();
  expect(sofaBlocked.position[0]).toBeGreaterThan(8.25);
  expect(sofaBlocked.position[0]).toBeLessThan(sofa.min[0]);
  expect(sofaBlocked.standing).toBe(true);
  // The stool is a solid obstacle too, not just a rendered overlay.
  await page.evaluate(() => window.__walkthrough.place(6.6, 8.05, 7.66, 8.05));
  await page.evaluate(() => window.__walkthrough.move(2, 0));
  const stoolBlocked = await state();
  // Rounded upholstery can resolve several triangle contacts conservatively.
  // Require reaching within 40 cm of the measured edge without penetrating it.
  expect(stoolBlocked.position[0]).toBeGreaterThan(stool.min[0] - .40);
  expect(stoolBlocked.position[0]).toBeLessThan(stool.min[0]);
  expect(stoolBlocked.standing).toBe(true);
  // The specified gap and the wide west aisle remain traversable.
  await page.evaluate(() => window.__walkthrough.place(8.28, 8.1, 9.1, 8.1));
  expect((await state()).standing).toBe(true);
  await page.evaluate(() => window.__walkthrough.place(6.35, 6.4, 6.35, 9));
  await page.evaluate(() => window.__walkthrough.move(0, 2.4));
  expect((await state()).position[2]).toBeCloseTo(8.8, 3);
  expect((await state()).standing).toBe(true);
  await page.locator('#living-view').click();
  await page.locator('#start').click();
  await expect.poll(async () => (await state()).locked).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('catalog-living-walkthrough.png') });
  await page.evaluate(() => document.exitPointerLock());
  await page.locator('#variant').selectOption('basic');
  await expect.poll(async () => (await state()).variant, { timeout: 60000 }).toBe('basic');
  expect(await page.evaluate(() => window.__walkthrough.inspectFurniture())).toEqual([]);
  await expect(page.locator('#living-view')).toBeDisabled();
  await page.locator('#variant').selectOption('expanded');
  await expect.poll(async () => (await state()).variant, { timeout: 60000 }).toBe('expanded');
  expect(await page.evaluate(() => window.__walkthrough.inspectFurniture())).toHaveLength(2);
  expect((await state()).visibleVariants).toBe(1);
  await testInfo.attach('catalog-placement-verification', { body: JSON.stringify({ furniture, sofaBlocked, stoolBlocked }, null, 2), contentType: 'application/json' });
  expect(errors).toEqual([]);
});

test('missing furniture preserves a previously loaded basic apartment', async ({ page }) => {
  await page.route('**/living-furniture.glb*', (route) => route.fulfill({ status: 404, body: 'Missing catalog furniture' }));
  await page.goto('/?test=1&variant=basic&quality=light');
  await expect(page.locator('body')).toHaveAttribute('data-load-state', 'ready', { timeout: 90000 });
  await page.locator('#variant').selectOption('expanded');
  await expect(page.locator('#status')).toContainText('이전 공간을 유지', { timeout: 60000 });
  expect(await page.evaluate(() => window.__walkthrough.getState().variant)).toBe('basic');
  expect(await page.evaluate(() => window.__walkthrough.getState().standing)).toBe(true);
  await expect(page.locator('#start')).toBeEnabled();
});
