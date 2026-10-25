import { test, expect } from '@playwright/test';

// Home page and 집들이: the home page and header, the gallery of real homes with tags and homes like
// 우리 집, the theme fit check, a 3D preview in 우리 집 and applying the theme.
const CLEARANCE = '가구 사이 여유가 60cm 미만일 수 있어요.';
const inspect = (page) => page.evaluate(() => window.__studio.inspect());
const tours = (page) => page.evaluate(() => window.__tours.state());
// The kept king bed the fit check plans around (src/house-tours/fit.js KEPT) must match the live model.
async function expectKing(page) {
  const king = (await inspect(page)).items.find((i) => i.id === 'king-bed');
  expect(king.x).toBeCloseTo(11.34, 3); expect(king.z).toBeCloseTo(6.32, 3);
  expect(king.width).toBeCloseTo(2.158, 3); expect(king.depth).toBeCloseTo(1.7953, 3);
}
const layout = async (page) => (await inspect(page)).items.filter((i) => !i.deleted).map(({ id, x, z, angle }) => `${id}@${x.toFixed(2)},${z.toFixed(2)},${angle.toFixed(2)}`).sort();
async function landing(page, query = '') {
  await page.goto(`/?studio=1&test=1&quality=light${query}`);
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'complex', { timeout: 90000 });
}

const inViewport = (page, selector) => page.locator(selector).evaluate((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight; });
const cards = (page) => page.locator('#tours-page .tp-card');
async function pick(page, group, tag) {
  await page.locator(`.tp-filter[data-group="${group}"]`).click();
  await page.locator(`.tp-chip[data-group="${group}"][data-tag="${tag}"]`).click();
}

test('the home page leads to 우리 집, 새로운 집 찾기 and 집들이, and the header follows', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await landing(page, '&variant=expanded');
  await expect(page.locator('.studio-header nav button')).toHaveText(['우리 집', '새로운 집 찾기', '집들이']);
  await expect(page.locator('#studio-sidebar')).toBeHidden();
  // Above the fold: the most popular 집들이, 우리 집 and 새로운 집 찾기, then the shortcuts.
  await expect(page.locator('.hf-slide').first()).toHaveAttribute('data-tour', 'mountain-white'); // most popular first
  await expect(page.locator('.hf-slide img').first()).toHaveAttribute('src', /images\.unsplash\.com\/photo-/); // real photos
  await expect(page.locator('.home-mine .hm-name')).toHaveText('아크로리버파크 112A 확장형');
  for (const selector of ['.home-feature', '#open-my-home', '#home-find-search', '#open-tours']) expect(await inViewport(page, selector), selector).toBe(true);
  await expect(page.locator('.home-quick .hq-item')).toHaveCount(6);
  const slide = await page.locator('.hf-count').textContent();
  await page.locator('.hf-next').click();
  await expect(page.locator('.hf-count')).not.toHaveText(slide);
  // Homes like 우리 집, then spaces and styles from the 집들이 photos; the complex photo stays the official one.
  const near = page.locator('.home-section', { has: page.locator('h2', { hasText: '우리 집과 비슷한 집들이' }) });
  await expect(near.locator('.tp-card')).toHaveCount(4);
  await expect(near.locator('.tp-card').first()).toHaveAttribute('data-tour', 'mountain-white');
  await expect(page.locator('.photos-space img')).toHaveCount(6);
  await expect(page.locator('.photos-style img')).toHaveCount(5);
  const tiles = await page.locator('.hp-photo img').evaluateAll((images) => images.map((img) => img.getAttribute('src')));
  expect(new Set(tiles).size).toBe(tiles.length); // no photo twice
  await expect(page.locator('#location-hero img.official-photo')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('home.png') });
  // A space photo opens the 집들이 that furnish that space.
  await page.locator('.hp-tile[data-tag=pet]').click();
  await expect(page.locator('#tours-page')).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  await expect(page.locator('.tp-filter[data-group=space]')).toHaveText('반려동물');
  // The header search finds 집들이 (and complexes).
  await page.locator('#header-search').fill('피아노');
  await expect(page.locator('.hs-option').first()).toContainText('업라이트 피아노');
  await page.keyboard.press('Enter');
  await expect(page.locator('#tours-title')).toHaveText(/피아노/);

  // The brand returns home; 새로운 집 찾기 searches the registered complexes.
  await page.locator('.studio-brand').click();
  await expect(page.locator('#location-hero')).toBeVisible();
  await expect(page.locator('#tours-page')).toBeHidden();
  await page.locator('#home-find-search').fill('잠실');
  await page.locator('.hfm-search button').click();
  await expect(page.locator('.hfm-hint')).toContainText('에 맞는 단지가 없어요');
  await page.locator('#home-find-search').fill('반포');
  await page.locator('.hfm-search button').click();
  await expect(page.locator('#floor-range')).toBeVisible();
  await expect(page.locator('#nav-complex')).toHaveCSS('color', 'rgb(31, 106, 82)');
  await expect(page.locator('#find-complex-search')).toHaveValue('반포');
  await expect(page.locator('.find-results strong')).toHaveText('아크로 리버파크');
  // 우리 집 opens the saved home; the brand returns to the home page.
  await page.locator('#nav-plan').click();
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'overview', { timeout: 90000 });
  await page.locator('.studio-brand').click();
  await expect(page.locator('#location-hero')).toBeVisible();
  await page.locator('#open-my-home').click();
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'overview');
  // 집들이 from the header, and the browser back button returns.
  await page.locator('#nav-tours').click();
  await expect(page.locator('#tours-page')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('tours')).toBe('all');
  await page.goBack();
  await expect(page.locator('#tours-page')).toBeHidden();
  expect(errors).toEqual([]);
});

test('one tag per group from each dropdown, homes like 우리 집, and three orders', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await landing(page);
  await page.evaluate(() => { localStorage.removeItem('cortex-my-home'); localStorage.removeItem('cortex-tour-stats'); });
  await page.locator('#open-tours').click();
  await expect(cards(page)).toHaveCount(14);
  await expect(page.locator('#tours-page .tp-card img').first()).toHaveJSProperty('complete', true);
  expect(await page.locator('#tours-page .tp-card img').first().evaluate((img) => img.naturalWidth)).toBeGreaterThan(300);
  await expect(page.locator('.tp-mine')).toContainText('아파트 · 34평 · 방 3');
  // 인기순 by default; 최신순 puts the latest first; 우리 집과 비슷한 순 puts the closest first.
  await expect(page.locator('[data-sort=popular]')).toHaveAttribute('aria-checked', 'true');
  await expect(cards(page).first()).toHaveAttribute('data-tour', 'mountain-white');
  await page.locator('[data-sort=recent]').click();
  await expect(cards(page).first()).toHaveAttribute('data-tour', 'plant-jungle');
  await page.locator('[data-sort=similar]').click();
  await expect(cards(page).nth(1)).toHaveAttribute('data-tour', 'pink-nursery');
  await expect(cards(page).first().locator('.tp-near')).toHaveText('우리 집과 비슷해요');
  await page.locator('[data-sort=popular]').click();

  // Picking another tag in the same group replaces the first one, and closes the dropdown.
  await pick(page, 'household', 'solo');
  await pick(page, 'household', 'couple');
  await expect(page.locator('.tp-chip[aria-checked=true]')).toHaveCount(1);
  await expect(page.locator('.tp-pop:not([hidden])')).toHaveCount(0);
  await expect(page.locator('.tp-filter[data-group=household]')).toHaveText('신혼부부');
  await expect(cards(page)).toHaveCount(9);
  await pick(page, 'style', 'minimal');
  await expect(cards(page)).toHaveCount(4);
  expect(await cards(page).evaluateAll((list) => list.map((c) => c.dataset.tour))).toEqual(['mountain-white', 'hotel-condo', 'gray-orange', 'green-marble']);
  await expect(page.locator('.tp-filter[data-group=style]')).toBeFocused(); // focus returns to the dropdown that was used
  await page.screenshot({ path: testInfo.outputPath('gallery-filtered.png') });
  await page.locator('.tp-selected .tp-tag', { hasText: '미니멀' }).click();
  await expect(cards(page)).toHaveCount(9);
  await pick(page, 'type', 'villa');
  await pick(page, 'size', '40s');
  await pick(page, 'style', 'minimal');
  await pick(page, 'color', 'pink');
  await expect(page.locator('.tp-chip[aria-checked=true]')).toHaveCount(5); // at most one per group
  await expect(page.locator('.tp-empty')).toBeVisible();
  await page.locator('.tp-empty .tp-ghost').click();
  await expect(cards(page)).toHaveCount(14);
  // Escape and a click outside close an open dropdown.
  await page.locator('.tp-filter[data-group=color]').click();
  await expect(page.locator('#tp-pop-color')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#tp-pop-color')).toBeHidden();
  await page.locator('.tp-filter[data-group=space]').click();
  await page.locator('#tours-title').click();
  await expect(page.locator('#tp-pop-space')).toBeHidden();

  // 우리 집과 비슷한 집: apartments around 30평 with similar rooms, each saying what matches.
  await page.locator('#tours-similar').check();
  const similar = await cards(page).evaluateAll((list) => list.map((c) => c.dataset.tour));
  expect(similar.sort()).toEqual(['golden-dog', 'gray-orange', 'green-marble', 'hotel-condo', 'mountain-white', 'olive-piano', 'pink-nursery', 'river-view']);
  await expect(page.locator('#tours-page .tp-card[data-tour=pink-nursery] .tp-similar')).toHaveText('같은 조건: 아파트 · 30평대 · 방 3');
  // The plan of 우리 집 is remembered for the preview and applying.
  await page.locator('.tp-head [data-home=basic]').click();
  expect(await page.evaluate(() => localStorage.getItem('cortex-my-home'))).toBe('basic');
  await page.screenshot({ path: testInfo.outputPath('gallery-basic.png') });
});

test('the detail page explains what changes in 우리 집 before applying', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await landing(page, '&tours=olive-piano');
  await expect(page.locator('#tours-title')).toHaveText('올리브 소파 옆 업라이트 피아노, 음악이 흐르는 24평');
  await expect(page.locator('.td-photo')).toHaveCount(4);
  await expect(page.locator('.td-byline a')).toHaveAttribute('href', 'https://unsplash.com/@alextyson195');
  await expect(page.locator('.td-facts')).toContainText('24평');
  await expect(page.locator('.td-theme')).toContainText('피아노 북카페 하우스');
  await page.locator('.td-aside [data-home=expanded]').click();
  await expect(page.locator('.td-aside .fit-verdict')).toContainText('그대로 가져갈 수 있어요');
  await page.locator('.td-aside [data-home=basic]').click();
  await expect(page.locator('.td-aside .fit-verdict')).toContainText('1개는 우리 집에 가져갈 수 없어요');
  await page.screenshot({ path: testInfo.outputPath('detail.png') });
  await page.locator('#tour-apply-open').click();
  await expect(page.locator('#tour-apply')).toBeVisible();
  const excluded = page.locator('.tp-change-room li.s-excluded', { hasText: '라운지 체어' });
  await expect(excluded).toContainText('방이 작아져 놓을 자리가 없어요');
  await expect(page.locator('.tp-change-room', { hasText: '피아노 방' })).toContainText('세로 3.08m → 2.59m');
  await expect(page.locator('#tour-apply .pl-excluded')).toHaveCount(await page.locator('#tour-apply li.s-excluded').count());
  await page.screenshot({ path: testInfo.outputPath('sheet.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('#tour-apply')).toBeHidden();
});

test('previewing a 집들이 theme in 우리 집 in 3D stages it, and leaving restores the layout exactly', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await landing(page, '&variant=expanded');
  const before = await layout(page);
  const lighting = await page.locator('#lighting').inputValue();
  await expectKing(page);

  await page.evaluate(() => window.__tours.show('detail', 'hotel-condo'));
  await page.locator('#tour-walk').click();
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'tour');
  await expect(page.locator('#tour-session')).toBeVisible();
  await expect(page.locator('#walk-themes')).toBeHidden();
  const visit = await page.evaluate(() => window.__walkthrough.getState());
  expect(visit.standing).toBe(true);
  expect(await page.evaluate(() => window.__walkthrough.getState().variant)).toBe('expanded'); // the preview is in 우리 집
  expect(await page.evaluate(() => window.__concepts.state().applied)).toEqual({ concept: 'hotel-minimal', palette: 'greige-terracotta' });
  expect(await page.locator('#lighting').inputValue()).toBe('sunset');
  expect((await inspect(page)).items.some((i) => i.id.startsWith('added-hotel-minimal'))).toBe(true);
  expect((await inspect(page)).warnings.flatMap((w) => w.messages).filter((m) => m !== CLEARANCE)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('visit.png') });

  await page.locator('#tour-session .ts-room', { hasText: '게스트룸' }).click();
  expect((await inspect(page)).roomId).toBe('Bedroom west');
  expect(await page.evaluate(() => window.__walkthrough.getState().standing)).toBe(true);

  await page.locator('#tour-session .ts-exit').click();
  await expect(page.locator('#tours-page')).toBeVisible();
  await expect(page.locator('#tours-title')).toHaveText(/호텔 같은 침실/);
  expect((await tours(page)).session).toBe(null);
  expect(await layout(page)).toEqual(before);
  expect(await page.evaluate(() => window.__concepts.state().applied)).toBe(null);
  expect(await page.locator('#lighting').inputValue()).toBe(lighting);
});

test('applying brings the 집들이 theme into 우리 집, and the toast can undo it', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await landing(page, '&variant=expanded');
  await page.evaluate(() => window.__tours.show('detail', 'mountain-white'));
  await page.locator('.td-aside [data-home=basic]').click();
  await page.locator('#tour-apply-open').click();
  await page.locator('#tour-apply-confirm').click();
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'overview', { timeout: 90000 });
  expect(await page.evaluate(() => window.__walkthrough.getState().variant)).toBe('basic');
  await expectKing(page);
  expect(await page.evaluate(() => window.__concepts.state().applied)).toEqual({ concept: 'family-lounge', palette: 'oat-oak', tour: 'mountain-white' });
  const applied = await inspect(page);
  // What the sheet promised is what landed: the basic plan's 2-seat table instead of 6 seats.
  expect(applied.items.some((i) => i.kind === 'dining2' && !i.deleted)).toBe(true);
  expect(applied.items.some((i) => i.kind === 'dining6' && !i.deleted)).toBe(false);
  expect(applied.warnings.flatMap((w) => w.messages).filter((m) => m !== CLEARANCE)).toEqual([]);
  await expect(page.locator('#tour-toast')).toBeVisible();
  await expect(page.locator('#tour-toast')).toContainText('기본형');
  expect(new URL(page.url()).searchParams.get('tours')).toBe(null);
  await page.screenshot({ path: testInfo.outputPath('applied.png') });

  await page.locator('#tour-toast .tt-undo').click();
  expect(await page.evaluate(() => window.__concepts.state().applied)).toBe(null);
  expect((await inspect(page)).items.some((i) => i.id.startsWith('added-'))).toBe(false);
  await expect(page.locator('#tour-toast')).toBeHidden();
});

test('최근 적용한 테마 collects what was applied to 우리 집 and applies it again', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await landing(page, '&variant=expanded');
  const sidebar = () => page.locator('#theme-history .th-item').evaluateAll((items) => items.map((li) => `${li.dataset.concept}/${li.dataset.palette}/${li.dataset.tour ?? '-'}${li.classList.contains('is-current') ? '*' : ''}`));
  // Nothing applied yet: no section on the home page or in the sidebar.
  await expect(page.locator('#home-themes')).toHaveCount(0);
  await page.locator('#quick-home').click();
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'overview', { timeout: 90000 });
  await expect(page.locator('#theme-history')).toBeHidden();

  // A 3D preview stays out; applying a 집들이, a concept and new colors go in, newest first.
  await page.evaluate(() => window.__tours.startTour('olive-piano'));
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'tour', { timeout: 90000 });
  await page.evaluate(() => window.__tours.endTour());
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'overview', { timeout: 90000 });
  await page.evaluate(() => window.__tours.applyToHome('hotel-condo', 'expanded'));
  await expect(page.locator('#tour-toast')).toBeVisible();
  await page.evaluate(() => { window.__concepts.apply('home-gym'); window.__concepts.apply('kids-play', 'cream-pastel'); window.__concepts.setPalette('sage-white'); });
  await expect(page.locator('#theme-history')).toBeVisible();
  expect(await sidebar(page)).toEqual(['kids-play/sage-white/-*', expect.stringMatching(/^home-gym\//), 'hotel-minimal/greige-terracotta/hotel-condo']);
  await expect(page.locator('#theme-history .th-item').first().locator('.th-current')).toHaveText('적용 중');
  await expect(page.locator('#theme-history .th-item').nth(2)).toContainText('호텔 같은 침실');
  await page.screenshot({ path: testInfo.outputPath('sidebar.png') });

  // 다시 적용 brings back the 집들이 theme with its colors; the toast undoes it.
  await page.locator('#theme-history .th-item').nth(2).locator('.th-apply').click();
  await expect(page.locator('#tour-toast')).toContainText('다시 적용했어요');
  expect(await page.evaluate(() => window.__concepts.state().applied)).toEqual({ concept: 'hotel-minimal', palette: 'greige-terracotta', tour: 'hotel-condo' });
  expect((await sidebar(page))[0]).toBe('hotel-minimal/greige-terracotta/hotel-condo*');
  await page.locator('#tour-toast .tt-undo').click();
  expect(await page.evaluate(() => window.__concepts.state().applied)).toEqual({ concept: 'kids-play', palette: 'sage-white' });
  expect((await sidebar(page))[1]).toBe('kids-play/sage-white/-*');

  // The home page lists them too, and 다시 적용 there opens 우리 집 with the theme.
  await page.locator('.studio-brand').click();
  await expect(page.locator('#home-themes .th-item')).toHaveCount(3);
  await page.locator('#home-themes').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('home.png') });
  await page.locator('#home-themes .th-item[data-concept=home-gym] .th-apply').click();
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'overview', { timeout: 90000 });
  expect((await page.evaluate(() => window.__concepts.state().applied)).concept).toBe('home-gym');
  // Reloading keeps the list.
  await page.reload();
  await expect(page.locator('#home-themes .th-item')).toHaveCount(3, { timeout: 90000 });
  await expect(page.locator('#home-themes .th-item').first()).toHaveAttribute('data-concept', 'home-gym');
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('the home page stacks, the detail keeps its actions at hand, and a touch visit has a way back', async ({ page }, testInfo) => {
    test.setTimeout(180000);
    await landing(page);
    // The featured 집들이, 우리 집 and 새로운 집 찾기 follow each other, without sideways scrolling.
    const [feature, mine, find] = await Promise.all(['.home-feature', '.home-mine', '.home-find'].map((s) => page.locator(s).boundingBox()));
    expect(feature.y).toBeLessThan(100);
    expect(mine.y).toBeGreaterThan(feature.y + feature.height - 1);
    expect(find.y).toBeGreaterThan(mine.y + mine.height - 1);
    expect(await page.locator('#location-hero').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(page.locator('.studio-header nav')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('phone-home.png') });
    await page.locator('#open-tours').tap();
    await expect(cards(page).first()).toBeVisible();
    expect(await page.locator('#tours-page').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    // A dropdown opens as a sheet at the bottom on phones.
    await page.locator('.tp-filter[data-group=space]').tap();
    await expect.poll(async () => { const pop = await page.locator('#tp-pop-space').boundingBox(); return Math.round(pop.y + pop.height); }).toBe(832);
    await page.locator('.tp-chip[data-group=space][data-tag=kids]').tap();
    await expect(cards(page)).toHaveCount(1);
    await page.locator('#tours-page .tp-card[data-tour=pink-nursery]').tap();
    await expect(page.locator('.td-mobile-bar')).toBeVisible();
    await expect(page.locator('.td-fit-line')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('phone-detail.png') });
    await page.locator('.td-mobile-bar .btn-primary').tap();
    // The sheet slides up and sits on the bottom edge.
    await expect.poll(async () => { const sheet = await page.locator('#tour-apply').boundingBox(); return Math.round(sheet.y + sheet.height); }).toBe(844);
    await page.locator('.tp-sheet-foot .btn:not(.btn-primary)').tap();
    await page.locator('.td-mobile-bar .btn:not(.btn-primary)').tap();
    await expect(page.locator('body')).toHaveClass(/touch-walking/, { timeout: 90000 }); // first load of the basic model
    await expect(page.locator('#tour-float')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('phone-visit.png') });
    await page.locator('#tour-float .tf-exit').tap();
    await expect(page.locator('#tours-page')).toBeVisible();
    expect((await tours(page)).session).toBe(null);
  });
});
