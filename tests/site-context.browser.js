import { test, expect } from '@playwright/test';

test('actual site massing supports building selection, real height ratios and independent preview selection at every floor', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?studio=1&test=1&quality=light');
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'complex', { timeout: 90000 });
  await page.locator('#select-building').click();

  const options = page.locator('#context-building option');
  await expect(options).toHaveCount(15);
  expect(await options.evaluateAll((items) => items.map((item) => item.value))).toEqual(
    Array.from({ length: 15 }, (_, index) => String(100 + index)),
  );
  await expect(page.locator('#context-building')).toHaveValue('109');
  await expect(page.locator('#building-evidence')).toContainText('109동 · OSM 38층 / 132m');
  expect((await page.evaluate(() => window.__studio.inspect())).building.floorHeight_m).toBeCloseTo(132 / 38, 2);

  await page.locator('#context-building').selectOption('111');
  await expect(page.locator('#building-evidence')).toContainText('파트 층수 상충 있음');

  await page.locator('#context-building').selectOption('112');
  await expect(page.locator('#floor-range')).toHaveAttribute('max', '19');
  await expect(page.locator('#open-unit')).toBeEnabled();
  await expect(page.locator('#floor-availability')).toContainText('실제 호·타입은 확인되지 않았습니다');

  await page.locator('#context-building').selectOption('102');
  await page.locator('#floor-range').fill('22');
  await expect(page.locator('#open-unit')).toBeEnabled();
  await expect(page.locator('#floor-availability')).toContainText('체험 평면은 이 층의 세대를 뜻하지 않습니다');
  expect((await page.evaluate(() => window.__studio.inspect())).building).toEqual({
    id: '102', floors: 22, height_m: 77, floorHeight_m: 77,
  });

  await page.locator('[data-view="site"]').click();
  await page.screenshot({ path: testInfo.outputPath('actual-osm-site.png') });
  expect(errors).toEqual([]);
});

test('floor selection uses deliberate drag steps, follows the floor height and does not open a unit on selection', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?studio=1&test=1&quality=light&floor=22');
  await page.locator('#select-building').click();
  const range = page.locator('#floor-range');
  await expect(range).toHaveValue('22');
  await page.locator('[data-view="site"]').click();
  const beforeCamera = await page.evaluate(() => window.__studio.inspect().contextCamera);
  expect((await page.evaluate(() => window.__studio.inspect())).visibleBuildings).toHaveLength(15);
  await range.scrollIntoViewIfNeeded();
  const box = await range.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(range).toHaveValue('22'); // Track press must not jump.
  await page.mouse.move(x + 10, y);
  await expect(range).toHaveValue('22');
  await page.mouse.move(x + 24, y);
  await expect(range).toHaveValue('23');
  await page.mouse.move(x + 48, y);
  await expect(range).toHaveValue('24');
  await page.mouse.up();
  expect((await page.evaluate(() => window.__studio.inspect())).contextView).toBe('site');
  await expect.poll(async () => {
    const camera = await page.evaluate(() => window.__studio.inspect().contextCamera);
    return Math.abs(camera.position_m[1] - beforeCamera.position_m[1] - 2 * 132 / 38);
  }).toBeLessThan(.02);
  const afterCamera = await page.evaluate(() => window.__studio.inspect().contextCamera);
  expect(afterCamera.position_m[0]).toBeCloseTo(beforeCamera.position_m[0], 6);
  expect(afterCamera.position_m[2]).toBeCloseTo(beforeCamera.position_m[2], 6);
  for (let axis = 0; axis < 3; axis++) {
    expect(afterCamera.position_m[axis] - afterCamera.target_m[axis]).toBeCloseTo(
      beforeCamera.position_m[axis] - beforeCamera.target_m[axis], 6,
    );
  }
  await page.locator('#floor-down').click();
  await expect(range).toHaveValue('23');
  await range.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(range).toHaveValue('22');
  await page.locator('#floor-rail').hover();
  await page.mouse.wheel(0, 300);
  await expect(range).toHaveValue('22');
  await page.locator('#floor-rail [data-floor="22"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'complex');
  await range.focus();
  await page.keyboard.press('Home');
  await expect(range).toHaveValue('1');
  await expect(page.locator('#floor-down')).toBeDisabled();
  await page.keyboard.press('End');
  await expect(range).toHaveValue('38');
  await expect(page.locator('#floor-up')).toBeDisabled();
  await page.locator('#context-building').selectOption('112');
  await expect(range).toHaveValue('19');
  await expect(page.locator('#floor-up')).toBeDisabled();

  await page.locator('#context-building').selectOption('102');
  await range.fill('12');
  await page.locator('[data-view="focus"]').click();
  const focusState = await page.evaluate(() => window.__studio.inspect());
  expect(focusState.visibleBuildings).toHaveLength(15);
  expect(focusState.buildingPresentation.find(({ id }) => id === '102')).toEqual({ id: '102', opacity: 1, depthWrite: true });
  for (const neighbour of focusState.buildingPresentation.filter(({ id }) => id !== '102')) {
    expect(neighbour.opacity).toBeGreaterThan(0);
    expect(neighbour.opacity).toBeLessThan(.3);
    expect(neighbour.depthWrite).toBe(false);
  }
  await expect(page.locator('#context-selection-note')).toContainText('주변 동은 반투명');
  await page.screenshot({ path: testInfo.outputPath('floor-12-facade.png') });
  // At this fixed viewport, the 100 label sits above the translucent foreground tower.
  await page.mouse.click(990, 340);
  await expect(page.locator('#context-building')).toHaveValue('100');
  const switched = await page.evaluate(() => window.__studio.inspect().buildingPresentation);
  expect(switched.find(({ id }) => id === '100').opacity).toBe(1);
  expect(switched.find(({ id }) => id === '102').opacity).toBeLessThan(.3);
  await page.locator('#context-building').selectOption('102');
  await range.fill('12');
  await page.locator('[data-view="site"]').click();
  expect((await page.evaluate(() => window.__studio.inspect())).buildingPresentation.every(({ opacity, depthWrite }) => opacity === 1 && depthWrite)).toBe(true);
  await page.locator('[data-view="focus"]').click();
  await range.fill('1');
  await expect.poll(async () => (await page.evaluate(() => window.__studio.inspect().contextCamera)).target_m[1]).toBeCloseTo(3.5, 1);
  await page.screenshot({ path: testInfo.outputPath('floor-01-facade.png') });
  await range.fill('22');
  await expect.poll(async () => (await page.evaluate(() => window.__studio.inspect().contextCamera)).target_m[1]).toBeCloseTo(77, 1);
  await page.screenshot({ path: testInfo.outputPath('floor-22-facade.png') });
  await page.locator('#open-unit').click();
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'overview');
  expect(errors).toEqual([]);
});

test('touch dragging also changes only one floor per deliberate movement', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto('http://127.0.0.1:5173/?studio=1&test=1&quality=light&floor=22');
    await page.locator('#select-building').click();
    const range = page.locator('#floor-range');
    await range.scrollIntoViewIfNeeded();
    const box = await range.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const client = await context.newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 10, y }] });
    await expect(range).toHaveValue('22');
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 25, y }] });
    await expect(range).toHaveValue('23');
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(range).not.toHaveClass(/dragging/);
  } finally {
    await context.close();
  }
});
