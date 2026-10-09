import { test, expect } from '@playwright/test';

// Recommended concepts (W7-06) and window photos (W7-07) in the studio.
const CLEARANCE = '가구 사이 여유가 60cm 미만일 수 있어요.';
const PANORAMA_2X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAIAAAA8r+mnAAAATklEQVR4nA3JMQEAMQgEwVcSG9g4ETQ4oKbGATYQsU08faad7zTWqImmmmm2uc13EkuURFLJJJvcfOGYIyeccsZZ5/oLYUIiRIkRK674AYNyNXGc1jGYAAAAAElFTkSuQmCC', 'base64');

const inspect = (page) => page.evaluate(() => window.__studio.inspect());
const concepts = (page) => page.evaluate(() => window.__concepts.state());
async function openUnit(page, query = '', variant = 'expanded') {
  await page.goto(`/?studio=1&test=1&quality=light${query}`);
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'complex', { timeout: 90000 });
  await page.locator('#hero-building').click();
  if (variant !== 'expanded') await page.locator('#studio-variant').selectOption(variant);
  await page.locator('#open-unit').click();
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'overview', { timeout: 90000 });
}
async function hardWarnings(page) {
  return (await inspect(page)).warnings.flatMap((w) => w.messages.filter((m) => m !== CLEARANCE).map((m) => `${w.id}: ${m}`));
}

test('three tabs and a whole-unit place; the concept tab ranks by household and keeps the list after applying', async ({ page }, testInfo) => {
  test.setTimeout(300000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await openUnit(page);
  await expect(page.locator('.mode-switch button')).toHaveText(['둘러보기', '꾸미기', '컨셉 보기']);
  await expect(page.locator('#studio-room')).toHaveValue('whole');
  await expect(page.locator('#room-walk')).toHaveText('거실에서 둘러보기');
  await page.locator('#studio-room').selectOption('Bedroom west');
  await expect(page.locator('#room-walk')).toHaveText('이곳에서 둘러보기');
  await page.locator('#room-edit').click();
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'edit');
  await page.locator('#studio-room').selectOption('whole');
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'overview');
  await expect(page.locator('#plan-pane')).toBeVisible();

  await page.locator('#mode-concepts').click();
  await expect(page.locator('body')).toHaveAttribute('data-concepts', 'open');
  await expect(page.locator('#mode-concepts')).toHaveClass(/selected/);
  await expect(page.locator('#concept-heading')).toHaveText('우리 가족에 맞춘 배치');
  await expect(page.locator('.concept-card')).toHaveCount(4);
  for (const [household, first] of [['family4', 'family-lounge'], ['baby', 'kids-play'], ['couple', 'newlywed'], ['solo', 'wfh-studio']]) {
    await page.locator(`.concept-chip[data-value=${household}]`).click();
    await expect(page.locator('.concept-card').first()).toHaveAttribute('data-concept', first);
    await expect(page.locator('.concept-card').first().locator('.concept-fit')).toHaveText('가장 잘 맞아요');
  }
  await page.locator('.concept-chip[data-value=family4]').click();
  await page.locator('.concept-chip[data-value=classic]').click();
  expect((await page.evaluate(() => window.__concepts.ranked()))[0]).toEqual({ id: 'family-lounge', fit: 'best', palette: 'walnut-navy' });
  await page.locator('.concept-chip[data-value=classic]').click(); // mood is optional and toggles off
  await page.screenshot({ path: testInfo.outputPath('01-concept-list.png') });

  // Applying keeps the household list; the applied card offers its colors in place.
  await page.locator('.concept-card[data-concept=family-lounge] .concept-apply').click();
  await expect(page.locator('#concept-heading')).toHaveText('우리 가족에 맞춘 배치');
  expect((await concepts(page)).view).toBe('list');
  const card = page.locator('.concept-card[data-concept=family-lounge]');
  await expect(card).toHaveClass(/is-applied/);
  await expect(card.locator('.concept-applied-tag')).toHaveText('적용됨');
  await expect(page.locator('body')).toHaveAttribute('data-finish-state', 'ready', { timeout: 60000 });
  expect(await page.locator('#finish').inputValue()).toBe('oak');
  const family = await inspect(page);
  const planned = await page.evaluate(() => window.__concepts.plan('family-lounge').placements.length);
  expect(family.items.filter((i) => !i.deleted && i.id.startsWith('added-family-lounge'))).toHaveLength(planned);
  expect(family.items.find((i) => i.id === 'catalog-sofa-2790').deleted).toBe(true);
  expect(family.items.find((i) => i.id === 'king-bed').deleted).toBe(false);
  expect(family.warnings.flatMap((w) => w.messages)).toEqual([]);
  await expect(page.locator('#layout-plan [data-item^="added-family-lounge"]')).toHaveCount(planned);
  await page.screenshot({ path: testInfo.outputPath('02-family-lounge.png') });

  await card.locator('.concept-card-palette[data-palette=walnut-navy]').click();
  await expect.poll(async () => (await page.evaluate(() => window.__concepts.colors())).fabric).toBe('#34435c');
  await expect.poll(() => page.locator('#finish').inputValue()).toBe('stone');
  await expect(page.locator('body')).toHaveAttribute('data-finish-state', 'ready', { timeout: 60000 });
  await expect.poll(async () => (await page.evaluate(() => window.__concepts.colors())).fabric).toBe('#34435c');
  await expect(card.locator('.concept-card-palette-name')).toHaveText('월넛 & 네이비');
  expect(new URL(page.url()).searchParams.get('palette')).toBe('walnut-navy');

  // Details open only on request; the tab always returns to the list.
  await card.locator('.concept-more').click();
  await expect(page.locator('#concept-heading')).toHaveText('패밀리 라운지');
  await expect(page.locator('.concept-checks li.ok')).toHaveCount(5);
  await page.locator('.concept-segment button', { hasText: '해질녘' }).click();
  expect(await page.locator('#lighting').inputValue()).toBe('sunset');
  await page.screenshot({ path: testInfo.outputPath('03-detail.png') });
  await page.locator('#mode-concepts').click();
  await expect(page.locator('#concept-heading')).toHaveText('우리 가족에 맞춘 배치');

  for (const id of ['kids-play', 'newlywed', 'wfh-studio']) {
    await page.evaluate((conceptId) => window.__concepts.apply(conceptId), id);
    const warnings = (await inspect(page)).warnings.filter((w) => w.messages.length);
    expect(await hardWarnings(page), id).toEqual([]);
    // Only the crib that deliberately stands beside the parents' bed is closer than 60 cm.
    expect(warnings.map((w) => w.id).sort(), id).toEqual(id === 'kids-play' ? ['added-kids-play-12', 'king-bed'] : []);
    await page.screenshot({ path: testInfo.outputPath(`04-${id}.png`) });
  }

  await page.locator('.concept-reset').click();
  const reset = await inspect(page);
  expect(reset.items.some((i) => i.id.startsWith('added-'))).toBe(false);
  expect(reset.items.find((i) => i.id === 'catalog-sofa-2790').deleted).toBe(false);
  expect((await concepts(page)).applied).toBe(null);
  await page.locator('.concept-close').click();
  await expect(page.locator('#mode-concepts')).not.toHaveClass(/selected/);
  expect(errors).toEqual([]);
});

test('basic plan adapts the dining table, and a saved concept layout restores with its palette', async ({ page }) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1280, height: 860 });
  await openUnit(page, '', 'basic');
  await page.locator('#mode-concepts').click();
  await page.locator('.concept-card[data-concept=family-lounge] .concept-apply').click();
  await page.locator('.concept-card[data-concept=family-lounge] .concept-more').click();
  await expect(page.locator('.concept-note')).toContainText('2인 식탁');
  await expect(page.locator('.concept-checks li.short')).toContainText('4인 이상 식탁');
  expect(await hardWarnings(page)).toEqual([]);

  await page.evaluate(() => window.__concepts.apply('newlywed', 'sage-white'));
  await page.locator('#mode-edit').click();
  await page.locator('#save-layout').click();
  const saved = (await inspect(page)).items.filter((i) => !i.deleted).map((i) => i.id).sort();
  await page.locator('#reset-layout').click();
  expect((await concepts(page)).applied).toBe(null);
  expect((await inspect(page)).items.some((i) => i.id.startsWith('added-'))).toBe(false);
  await page.locator('#restore-layout').click();
  expect((await inspect(page)).items.filter((i) => !i.deleted).map((i) => i.id).sort()).toEqual(saved);
  expect((await concepts(page)).applied).toEqual({ concept: 'newlywed', palette: 'sage-white' });
  expect((await page.evaluate(() => window.__concepts.colors())).fabric).toBe('#c8d1bf');
});

test('a shared link applies its concept; walking, number keys and C switch themes in place', async ({ page }, testInfo) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?studio=1&test=1&quality=light&concept=kids-play&palette=sage-white');
  await expect.poll(() => page.evaluate(() => window.__concepts?.state().applied ?? null), { timeout: 90000 }).toEqual({ concept: 'kids-play', palette: 'sage-white' });
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'overview');
  await expect(page.locator('#concept-heading')).toHaveText('우리 가족에 맞춘 배치');
  await expect(page.locator('.concept-card[data-concept=kids-play]')).toHaveClass(/is-applied/);

  await page.locator('.concept-card[data-concept=kids-play] .concept-walk').click();
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'tour');
  const start = await page.evaluate(() => window.__walkthrough.getState());
  expect(start.standing).toBe(true);
  // The walk starts in the living room's north-west corner, facing the furniture.
  expect(start.position[0]).toBeCloseTo(6.52, 1);
  expect(start.position[2]).toBeCloseTo(6.08, 1);
  await expect(page.locator('#walk-themes')).toBeVisible();
  await expect(page.locator('.wt-theme[data-theme=kids-play]')).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: testInfo.outputPath('walk-kids.png') });

  await page.keyboard.press('Digit4');
  expect((await concepts(page)).applied.concept).toBe('newlywed');
  await expect(page.locator('.wt-flash')).toContainText('신혼 갤러리');
  expect(await page.evaluate(() => window.__walkthrough.getState().standing)).toBe(true);
  expect(await hardWarnings(page)).toEqual([]);
  const before = (await concepts(page)).applied.palette;
  await page.keyboard.press('KeyC');
  expect((await concepts(page)).applied.palette).not.toBe(before);
  await page.screenshot({ path: testInfo.outputPath('walk-newlywed.png') });

  await page.keyboard.press('Digit1');
  expect((await concepts(page)).applied).toBe(null);
  expect((await inspect(page)).items.find((i) => i.id === 'catalog-sofa-2790').deleted).toBe(false);
  expect(await page.evaluate(() => window.__walkthrough.getState().standing)).toBe(true);
  await page.locator('.wt-theme[data-theme=wfh-studio]').click();
  expect((await concepts(page)).applied.concept).toBe('wfh-studio');

  await page.locator('#studio-room').selectOption('whole');
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'overview');
  await expect(page.locator('#walk-themes')).toBeHidden();
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('concept sheet folds after applying; while walking a 테마 button opens the theme list', async ({ page }, testInfo) => {
    test.setTimeout(180000);
    await openUnit(page);
    await expect(page.locator('#mode-concepts')).toBeVisible();
    await page.locator('#mode-concepts').tap();
    // The sheet slides up from the bottom edge.
    await expect.poll(async () => { const sheet = await page.locator('#concept-panel').boundingBox(); return Math.round(sheet.y + sheet.height); }).toBe(844);
    expect(await page.locator('.concept-results').evaluate((list) => list.scrollWidth > list.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('phone-list.png') });
    await page.locator('.concept-card').first().locator('.concept-apply').tap();
    await expect(page.locator('#concept-panel')).toHaveAttribute('data-sheet', 'peek');
    await expect(page.locator('#concept-heading')).toHaveText('우리 가족에 맞춘 배치');
    const folded = await page.locator('#concept-panel').boundingBox();
    const view = await page.locator('#viewport').boundingBox();
    expect(view.y + view.height).toBeLessThanOrEqual(folded.y + 1);
    expect(view.height).toBeGreaterThan(150);
    await page.screenshot({ path: testInfo.outputPath('phone-applied.png') });

    await page.locator('.concept-card').first().locator('.concept-walk').tap();
    await expect(page.locator('body')).toHaveClass(/touch-walking/);
    await expect(page.locator('.wt-toggle')).toBeVisible();
    await expect(page.locator('.wt-body')).toBeHidden();
    await page.locator('.wt-toggle').tap();
    await expect(page.locator('.wt-body')).toBeVisible();
    await page.locator('.wt-theme[data-theme=newlywed]').tap();
    expect((await concepts(page)).applied.concept).toBe('newlywed');
    await expect(page.locator('.wt-toggle')).toContainText('신혼 갤러리');
    expect(await page.evaluate(() => window.__walkthrough.getState().touchWalking)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('phone-walk-themes.png') });
  });
});

test('window: the official photo is the main view; an own 360° photo can replace it and be turned back', async ({ page }) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openUnit(page);
  await page.locator('#room-walk').click();
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'tour');
  await page.evaluate(() => document.exitPointerLock?.());
  await expect(page.locator('#window-view')).toBeVisible();
  const view = () => page.evaluate(() => window.__windowView.state());
  const official = (await view()).badge;
  expect(await view()).toMatchObject({ custom: false, sphereVisible: false, photoVisible: true });
  expect(official).toContain('공식 사진');
  expect(official).not.toContain('예시');

  await page.locator('#window-view summary').click();
  await page.locator('#wv-file').setInputFiles({ name: 'room-360.png', mimeType: 'image/png', buffer: PANORAMA_2X1 });
  await expect.poll(async () => (await view()).custom).toBe(true);
  expect(await view()).toMatchObject({ sphereVisible: true, photoVisible: false });
  expect((await view()).badge).toContain('360°');
  await expect(page.locator('#wv-file-status')).toContainText('적용됨');
  await page.locator('#wv-photo-heading').fill('90');
  expect((await view()).rotation).toBeCloseTo(Math.PI / 2, 6);
  await page.locator('#wv-reset').click();
  expect(await view()).toMatchObject({ custom: false, sphereVisible: false, photoVisible: true, badge: official });
});
