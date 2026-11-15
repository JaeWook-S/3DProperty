import { test, expect } from '@playwright/test';

test('mountain-white GLBs render, stay scoped to their tour, and survive saved-layout restore', async ({ page }, testInfo) => {
  test.setTimeout(240000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const consoleErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  if (process.env.SERVICE_ENTRY_URL) {
    await page.goto(`${process.env.SERVICE_ENTRY_URL}/?tours=mountain-white`);
    await page.waitForURL(url => url.origin === new URL(testInfo.project.use.baseURL).origin && url.searchParams.get('studio') === '1');
    expect(new URL(page.url()).searchParams.get('tours')).toBe('mountain-white');
  }
  await page.goto('/?studio=1&test=1&quality=light&tours=mountain-white');
  await page.waitForFunction(() => (window.__tours && window.__studio) || document.documentElement.dataset.entryState === 'error', null, { timeout: 90000 });
  expect(await page.evaluate(() => document.documentElement.dataset.entryState), consoleErrors.join('\n')).not.toBe('error');
  await page.evaluate(() => window.__tours.startTour('mountain-white'));
  const walk = await page.evaluate(() => window.__walkthrough.getState());
  expect(walk.standing).toBe(true);
  expect(walk.position[0]).toBeGreaterThan(5.79);
  expect(walk.position[0]).toBeLessThan(9.88);
  expect(walk.position[2]).toBeGreaterThan(5.01);
  expect(walk.position[2]).toBeLessThan(9.1);
  const customKinds = async () => page.evaluate(() => window.__studio.inspect().items.filter(p => !p.deleted && p.kind.startsWith('mw')).map(p => p.kind).sort());
  const expected = ['mwBed', 'mwCoffeeTable', 'mwDiningTable', 'mwFloorLamp', 'mwRug', 'mwSofa', 'mwTvConsole'];
  expect(await customKinds()).toEqual(expected);
  const bounds = await page.evaluate(() => window.__walkthrough.inspectStagedFurniture().filter(p => p.kind.startsWith('mw')));
  expect(bounds.every(p => p.max[0] - p.min[0] < 4 && p.max[2] - p.min[2] < 4)).toBe(true);
  expect((await page.evaluate(() => window.__walkthrough.inspectInterior())).materials.some(name => name.startsWith('TVR_'))).toBe(true);
  const texturedKinds = await page.evaluate(() => {
    return window.__surfaceMaterials.getActive().staging.items.filter(p => !p.deleted && p.kind.startsWith('mw')).filter(item => {
      let decoded = false;
      item.group.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if ((m.map?.image?.width ?? 0) > 0) decoded = true; });
      return decoded;
    }).map(p => p.kind).sort();
  });
  expect(texturedKinds).toEqual(expected);
  await page.evaluate(() => window.__tours.overview());
  await page.screenshot({ path: testInfo.outputPath('mountain-white-overview.png') });
  await page.evaluate(() => window.__tours.applyToHome('mountain-white', 'expanded'));
  expect((await page.evaluate(() => window.__concepts.state())).applied.tour).toBe('mountain-white');
  await page.reload();
  await page.waitForFunction(() => window.__tours && window.__studio, null, { timeout: 90000 });
  await expect.poll(customKinds).toEqual(expected);
  await page.evaluate(() => document.getElementById('save-layout').click());
  await page.evaluate(() => window.__tours.applyToHome('river-view', 'expanded'));
  expect(await customKinds()).toEqual([]);
  await page.evaluate(() => document.getElementById('restore-layout').click());
  await expect.poll(customKinds).toEqual(expected);
  await page.reload();
  await page.waitForFunction(() => window.__tours && window.__studio, null, { timeout: 90000 });
  await page.evaluate(() => window.__tours.applyToHome('mountain-white', 'expanded'));
  expect(await customKinds()).toEqual(expected);
  expect(errors).toEqual([]);
});
