import { test, expect } from '@playwright/test';

async function load(page) {
  await page.goto('/?studio=1&entry=overview&test=1&quality=light');
  await expect(page.locator('body')).toHaveAttribute('data-load-state', 'ready', { timeout: 90000 });
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'overview');
}
async function hoverFurniture(page, kind = 'sofa') {
  let found = null;
  await expect.poll(async () => {
    const items = await page.evaluate(() => window.__walkthrough.inspectStagedFurniture());
    const item = items.find(item => item.kind === kind);
    if (!item) return false;
    const rect = await page.locator('#viewport').boundingBox();
    // Approach from an edge so the tag must move to the furniture center, not the cursor.
    for (const point of [...item.screenPoints].reverse()) {
      if (point.x < rect.x + 18 || point.x > rect.x + rect.width - 18 || point.y < rect.y + 18 || point.y > rect.y + rect.height - 18) continue;
      await page.mouse.move(point.x, point.y);
      const shown = await page.locator('#furniture-hover-plus').evaluate((button, id) => !button.hidden && button.dataset.itemId === id, item.id);
      if (shown) { found = item; return true; }
    }
    return false;
  }, { timeout: 15000 }).toBe(true);
  return found;
}

test('3D hover reveals a plus and opens a compact card without changing the room or 2D layout', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await load(page);
  const before = await page.evaluate(() => window.__studio.inspect());
  const item = await hoverFurniture(page);
  const expectedCenter = item.screenPoints[0];
  const plus = page.locator('#furniture-hover-plus');
  await expect(plus).toHaveCount(1);
  const centered = await plus.boundingBox();
  expect(centered.x + centered.width / 2).toBeCloseTo(expectedCenter.x, 0);
  expect(centered.y + centered.height / 2).toBeCloseTo(expectedCenter.y, 0);
  // Different parts of the same sofa must keep the single tag at the same center.
  let sameFurniturePoints = 0;
  for (const point of item.screenPoints.slice(2)) {
    await page.mouse.move(point.x, point.y);
    const same = await plus.evaluate((button, id) => !button.hidden && button.dataset.itemId === id, item.id);
    if (!same) continue;
    const box = await plus.boundingBox();
    expect(box.x + box.width / 2).toBeCloseTo(expectedCenter.x, 0);
    expect(box.y + box.height / 2).toBeCloseTo(expectedCenter.y, 0);
    sameFurniturePoints++;
  }
  expect(sameFurniturePoints).toBeGreaterThan(1);
  await expect(page.locator('#furniture-hover-card')).toBeHidden();
  await expect(page.locator('#furniture-info-layer')).toBeHidden();
  await page.locator('#furniture-hover-plus').click();
  await expect(page.locator('#furniture-hover-card')).toBeVisible();
  await expect(page.locator('#furniture-hover-card')).toHaveAttribute('data-item-id', item.id);
  await expect(page.locator('#furniture-hover-name')).toContainText('소파');
  await expect(page.locator('#furniture-hover-price')).toContainText('₩899,000');
  await expect(page.locator('#furniture-hover-link')).toHaveAttribute('href', 'https://example.com/');
  await expect.poll(() => page.locator('#furniture-hover-image').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(page.locator('#furniture-hover-image')).toHaveAttribute('src', /^data:image\/png/);
  const after = await page.evaluate(() => window.__studio.inspect());
  expect(after.items).toEqual(before.items); expect(after.roomId).toBe(before.roomId);
  expect(after.contextCamera).toEqual(before.contextCamera);
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
  const viewport = await page.locator('#viewport').boundingBox(), card = await page.locator('#furniture-hover-card').boundingBox();
  expect(card.x).toBeGreaterThanOrEqual(viewport.x);
  expect(card.y).toBeGreaterThanOrEqual(viewport.y);
  expect(card.x + card.width).toBeLessThanOrEqual(viewport.x + viewport.width + 1);
  expect(card.y + card.height).toBeLessThanOrEqual(viewport.y + viewport.height + 1);
  expect(card.height).toBeLessThan(240);
  await page.screenshot({ path: info.outputPath('split-3d-product-card.png') });
  await page.locator('#furniture-hover-close').click();
  await expect(page.locator('#furniture-hover-card')).toBeHidden();
  await page.locator('#layout-plan').hover();
  await expect(page.locator('#furniture-hover-plus')).toBeHidden();
  await page.locator('#layout-plan [data-item]').first().click();
  await expect(page.locator('#furniture-hover-card')).toBeHidden();
  await expect(page.locator('#furniture-info-layer')).toBeHidden();
  expect(errors).toEqual([]);
});

test('edit view uses the CC0 preview, keeps orbit dragging, and clears cards on mode switches', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await load(page);
  await page.locator('#room-edit').click();
  await page.locator('#add-kind').selectOption('catalog:modern-arm-chair-01');
  await page.locator('#add-item').click(); await expect(page.locator('#add-item')).toBeEnabled();
  await hoverFurniture(page, 'catalog:modern-arm-chair-01');
  await page.locator('#furniture-hover-plus').click();
  await expect(page.locator('#furniture-hover-name')).toHaveText('임시 상품 · 라운지 체어');
  await expect(page.locator('#furniture-hover-image')).toHaveAttribute('src', /\/modern-arm-chair-01\/preview\.png/);
  await expect.poll(() => page.locator('#furniture-hover-image').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: info.outputPath('edit-3d-cc0-card.png') });
  const before = await page.evaluate(() => window.__studio.inspect());
  const rect = await page.locator('#viewport').boundingBox();
  await page.mouse.move(rect.x + 35, rect.y + 90); await page.mouse.down();
  await page.mouse.move(rect.x + 135, rect.y + 130, { steps: 5 }); await page.mouse.up();
  await expect(page.locator('#furniture-hover-card')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__studio.inspect().contextCamera)).not.toEqual(before.contextCamera);
  expect(await page.evaluate(() => window.__studio.inspect().items)).toEqual(before.items);
  await page.locator('#frame-room').click();
  await hoverFurniture(page, 'catalog:modern-arm-chair-01'); await page.locator('#furniture-hover-plus').click();
  await expect(page.locator('#furniture-hover-card')).toBeVisible();
  // Enter the paused tour without requesting native pointer lock in this test.
  await page.evaluate(() => window.__studio.setMode('tour'));
  await expect(page.locator('#furniture-hover-layer')).toBeHidden();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await expect(page.locator('#furniture-hover-plus')).toBeHidden();
  expect(errors).toEqual([]);
});

test('shared YAML reloads on each plus click and late responses cannot reopen dismissed cards', async ({ page }) => {
  await load(page);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  await page.route('**/furniture-products.yaml', async route => {
    const first = calls++ === 0;
    if (first) await gate;
    await route.fulfill({ contentType: 'text/yaml', body: `version: 1\ndefaults:\n  name: "${first ? '늦게 도착한 정보' : '수정한 상품'}"\n  price: 123456\n  seller: "수정한 판매처"\n  url: "https://example.org/product"\n  placeholder: false\nproducts: {}\n` });
  });
  await hoverFurniture(page); await page.locator('#furniture-hover-plus').click();
  await expect(page.locator('#furniture-hover-card')).toBeVisible();
  await expect.poll(() => calls).toBe(1);
  await page.locator('#furniture-hover-close').click();
  await hoverFurniture(page); await page.locator('#furniture-hover-plus').click();
  await expect(page.locator('#furniture-hover-name')).toHaveText('수정한 상품');
  release();
  await expect.poll(() => calls).toBe(2);
  await expect(page.locator('#furniture-hover-name')).toHaveText('수정한 상품');
  await expect(page.locator('#furniture-hover-seller')).toHaveText('수정한 판매처');
  await expect(page.locator('#furniture-hover-link')).toHaveAttribute('href', 'https://example.org/product');
  await expect(page.locator('#furniture-hover-example')).toBeHidden();
  await page.keyboard.press('Escape'); await expect(page.locator('#furniture-hover-card')).toBeHidden();
});
