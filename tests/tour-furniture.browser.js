import { test, expect } from '@playwright/test';
import { TOUR_FURNITURE_SPECS, TOUR_PIECES } from '../src/concepts/tour-furniture-spec.js';

// Staging holds the table and chairs of a set as separate pieces, never the set itself.
const kindsOf = (set) => Object.keys(TOUR_FURNITURE_SPECS).filter(kind => TOUR_FURNITURE_SPECS[kind].set === set && !(TOUR_PIECES[kind] && TOUR_PIECES[kind][0][0] !== kind)).sort();
const setKinds = (page) => page.evaluate((specs) => [...new Set(window.__studio.inspect().items.filter(p => !p.deleted && specs[p.kind]).map(p => p.kind))].sort(), TOUR_FURNITURE_SPECS);
const surfaces = (page) => page.evaluate(() => ({ finish: document.getElementById('finish').value, lighting: document.getElementById('lighting').value }));

test('each 집들이 furniture set renders with its textures, walls and floor, stays scoped to its tour, and survives saved-layout restore', async ({ page }, testInfo) => {
  test.setTimeout(300000);
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

  for (const [tour, palette, finish] of [['mountain-white', 'white-oak', 'oak'], ['stone-walnut', 'stone-walnut', 'walnut']]) {
    await page.evaluate((id) => window.__tours.startTour(id), tour);
    const walk = await page.evaluate(() => window.__walkthrough.getState());
    expect(walk.standing).toBe(true);
    // The preview starts inside the living room.
    expect(walk.position[0]).toBeGreaterThan(5.79);
    expect(walk.position[0]).toBeLessThan(9.88);
    expect(walk.position[2]).toBeGreaterThan(5.01);
    expect(walk.position[2]).toBeLessThan(9.1);
    expect(await setKinds(page)).toEqual(kindsOf(tour));
    expect(await page.evaluate(() => window.__concepts.state().applied)).toMatchObject({ palette, tour });
    await expect.poll(() => surfaces(page).then(s => s.finish)).toBe(finish);
    const bounds = await page.evaluate((set) => window.__walkthrough.inspectStagedFurniture().filter(p => p.kind.startsWith(set)), tour === 'mountain-white' ? 'mw' : 'sw');
    expect(bounds.every(p => p.max[0] - p.min[0] < 4 && p.max[2] - p.min[2] < 4)).toBe(true);
    const textured = await page.evaluate((specs) => window.__surfaceMaterials.getActive().staging.items.filter(p => !p.deleted && specs[p.kind]).filter(item => {
      let decoded = false;
      item.group.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if ((m.map?.image?.width ?? 0) > 0) decoded = true; });
      return decoded;
    }).map(p => p.kind), TOUR_FURNITURE_SPECS);
    expect([...new Set(textured)].sort()).toEqual(kindsOf(tour));
    await page.evaluate(() => window.__tours.overview());
    await page.screenshot({ path: testInfo.outputPath(`${tour}-overview.png`) });
    await page.evaluate(() => window.__tours.endTour());
  }
  expect((await page.evaluate(() => window.__walkthrough.inspectInterior())).materials.some(name => name.startsWith('TVR_'))).toBe(false);

  // Applied to 우리 집, the set survives a reload and a saved layout; another 집들이 uses the kit.
  await page.evaluate(() => window.__tours.applyToHome('stone-walnut', 'expanded'));
  expect((await page.evaluate(() => window.__concepts.state())).applied.tour).toBe('stone-walnut');
  await page.reload();
  await page.waitForFunction(() => window.__tours && window.__studio, null, { timeout: 90000 });
  await expect.poll(() => setKinds(page)).toEqual(kindsOf('stone-walnut'));
  await page.evaluate(() => document.getElementById('save-layout').click());
  await page.evaluate(() => window.__tours.applyToHome('olive-piano', 'expanded'));
  expect(await setKinds(page)).toEqual([]);
  await page.evaluate(() => document.getElementById('restore-layout').click());
  await expect.poll(() => setKinds(page)).toEqual(kindsOf('stone-walnut'));
  await page.evaluate(() => window.__tours.applyToHome('mountain-white', 'expanded'));
  expect(await setKinds(page)).toEqual(kindsOf('mountain-white'));
  expect((await page.evaluate(() => window.__walkthrough.inspectInterior())).materials.some(name => name.startsWith('TVR_'))).toBe(true);
  expect(errors).toEqual([]);
});
