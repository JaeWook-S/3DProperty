import { test, expect } from '@playwright/test';

// Shared dev-server HMR is unrelated to this scoped integration scenario.
test.beforeEach(async ({ page }) => { await page.routeWebSocket('**/*', socket => socket.close()); });

// Real pointer lock needs a focused browsing context in automated Chrome. Keep
// the native permission prompt out of this local interaction test; do not mock the API.
test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-features=KeyboardAndPointerLockPrompt'] } });
test.beforeEach(async ({ page, context }) => {
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
});

const state = page => page.evaluate(() => window.__walkthrough.getState());
async function load(page, studio = false) {
  await page.goto(`/?studio=${studio ? 1 : 0}&entry=overview&test=1&quality=light`);
  await expect(page.locator('body')).toHaveAttribute('data-load-state', 'ready', { timeout: 90000 });
  if (studio) await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'overview');
}
async function aimFurniture(page, kind = 'sofa') {
  // Use the actual active model bounds and collision checks, not a legacy model's coordinates.
  const found = await page.evaluate(kind => {
    const tour = window.__walkthrough;
    const item = tour.inspectStagedFurniture().find(item => item.kind === kind);
    if (!item) return false;
    const [x, y, z] = item.min.map((value, axis) => (value + item.max[axis]) / 2);
    for (const gap of [.7, 1, 1.5, 2]) {
      for (const [px, pz] of [[item.min[0] - gap, z], [item.max[0] + gap, z], [x, item.min[2] - gap], [x, item.max[2] + gap],
        [item.min[0] - gap, item.min[2] - gap], [item.max[0] + gap, item.max[2] + gap]]) {
        try {
          tour.place(px, pz, x, z, y);
          if (tour.getState().furnitureTarget?.id === item.id) return true;
        } catch { /* Try a different collision-free approach. */ }
      }
    }
    return false;
  }, kind);
  expect(found).toBe(true);
}

test('P opens the actual model card, freezes walking/look and restores pointer lock on P', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await load(page);
  await aimFurniture(page);
  await page.locator('#start').click();
  await expect.poll(async () => (await state(page)).locked).toBe(true);
  await expect(page.locator('#furniture-info-hint')).toBeVisible();
  const target = (await state(page)).furnitureTarget;
  expect(target).not.toBeNull();
  // Hold movement across the mode switch: it must not remain stuck on return.
  await page.keyboard.down('w'); await page.keyboard.press('p');
  await expect(page.locator('#furniture-info-card')).toBeVisible();
  await expect.poll(async () => (await state(page)).locked).toBe(false);
  await page.keyboard.up('w');
  await expect(page.locator('#furniture-info-link')).toHaveAttribute('href', 'https://example.com/');
  await expect(page.locator('#furniture-info-price')).toContainText('₩');
  await expect.poll(() => page.locator('#furniture-info-image').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(page.locator('#furniture-info-image')).toHaveAttribute('src', /^data:image\/png/);
  const frozen = await state(page);
  expect(frozen.furnitureInfo.id).toBe(target.id);
  await page.keyboard.down('w'); await page.keyboard.down('d');
  await page.mouse.move(700, 400); await page.mouse.move(900, 600, { steps: 4 });
  await page.waitForTimeout(350);
  await page.keyboard.up('w'); await page.keyboard.up('d');
  const after = await state(page);
  expect(after.position).toEqual(frozen.position); expect(after.yaw).toBe(frozen.yaw); expect(after.pitch).toBe(frozen.pitch);
  await page.screenshot({ path: info.outputPath('tour-product-card.png') });
  await page.keyboard.press('p');
  await expect(page.locator('#furniture-info-layer')).toBeHidden();
  await expect.poll(async () => (await state(page)).locked).toBe(true);
  await page.waitForTimeout(200);
  expect((await state(page)).position).toEqual(frozen.position);
  // Several complete toggles must work without retaining a stale target or key.
  for (let n = 0; n < 2; n++) {
    await page.keyboard.press('p'); await expect(page.locator('#furniture-info-card')).toBeVisible();
    await expect.poll(async () => (await state(page)).locked).toBe(false);
    await page.keyboard.press('p'); await expect.poll(async () => (await state(page)).locked).toBe(true);
  }
  await page.keyboard.down('s');
  try { await expect.poll(async () => (await state(page)).position, { timeout: 15000 }).not.toEqual(frozen.position); }
  finally { await page.keyboard.up('s'); }
  const yaw = (await state(page)).yaw;
  await page.evaluate(() => {
    window.__furniturePointerAudit = [];
    document.addEventListener('mousemove', event => window.__furniturePointerAudit.push({
      movementX: event.movementX, movementY: event.movementY, trusted: event.isTrusted,
      clientX: event.clientX, clientY: event.clientY, locked: Boolean(document.pointerLockElement),
      yaw: window.__walkthrough.getState().yaw,
    }));
  });
  await page.mouse.move(500, 300, { steps: 3 });
  const pointerEvents = await page.evaluate(() => window.__furniturePointerAudit);
  await info.attach('pointer-movement', {body: JSON.stringify(pointerEvents), contentType:'application/json'});
  // Headless Chrome may emit equal/opposite trusted warp events after a move,
  // returning the final yaw to its start. Verify actual event-time rotation.
  expect(pointerEvents.some(event => event.trusted && event.locked && event.movementX !== 0 && Math.abs(event.yaw - yaw) > 1e-6)).toBe(true);
  expect(errors).toEqual([]);
});

test('only tour responds to P, YAML edits reload per card and malformed YAML leaves it usable', async ({ page }, info) => {
  await load(page, true);
  const before = await page.evaluate(() => window.__studio.inspect().items);
  await page.keyboard.press('p'); await expect(page.locator('#furniture-info-layer')).toBeHidden();
  await page.locator('#room-edit').click();
  await page.keyboard.press('p'); await expect(page.locator('#furniture-info-layer')).toBeHidden();
  expect(await page.evaluate(() => window.__studio.inspect().items)).toEqual(before);
  await page.locator('#room-walk').click();
  await expect.poll(async () => (await state(page)).locked).toBe(true);
  await aimFurniture(page);
  const target = (await state(page)).furnitureTarget;
  expect(target).not.toBeNull();
  let contents = `version: 1\ndefaults:\n  name: "사용자가 수정한 상품"\n  price: 123456\n  currency: KRW\n  seller: "수정한 판매처"\n  url: "https://example.org/product"\n  placeholder: false\nproducts: {}\n`;
  await page.route('**/furniture-products.yaml', route => route.fulfill({ contentType: 'text/yaml', body: contents }));
  await page.keyboard.press('p');
  await expect(page.locator('#furniture-info-name')).toHaveText('사용자가 수정한 상품');
  await expect(page.locator('#furniture-info-price')).toContainText('123,456');
  await expect(page.locator('#furniture-info-seller')).toHaveText('수정한 판매처');
  await expect(page.locator('#furniture-info-example')).toBeHidden();
  await page.route('https://example.org/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Test product</p>' }));
  const popup = page.waitForEvent('popup'); await page.locator('#furniture-info-link').click();
  const tab = await popup; await tab.close(); await page.bringToFront();
  expect((await state(page)).locked).toBe(false);
  contents = 'version: [';
  await page.keyboard.press('p'); await expect.poll(async () => (await state(page)).locked).toBe(true);
  await page.keyboard.press('p');
  await expect(page.locator('#furniture-info-status')).toContainText('상품 정보를 읽지 못해');
  await page.screenshot({ path: info.outputPath('tour-product-fallback.png') });
  await page.keyboard.press('Escape'); await expect(page.locator('#furniture-info-layer')).toBeHidden();
  expect((await state(page)).locked).toBe(false);
  await page.locator('#back-plan').click();
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'overview');
  await page.keyboard.press('p'); await expect(page.locator('#furniture-info-layer')).toBeHidden();
});

test('CC0 furniture uses the exact catalog preview image in tour', async ({ page }, info) => {
  await load(page, true);
  await page.locator('#room-edit').click();
  await page.locator('#add-kind').selectOption('catalog:modern-arm-chair-01');
  await page.locator('#add-item').click();
  await expect(page.locator('#add-item')).toBeEnabled();
  await page.locator('#room-walk').click();
  await expect.poll(async () => (await state(page)).locked).toBe(true);
  await aimFurniture(page, 'catalog:modern-arm-chair-01');
  await page.keyboard.press('p');
  await expect(page.locator('#furniture-info-name')).toHaveText('임시 상품 · 라운지 체어');
  await expect(page.locator('#furniture-info-image')).toHaveAttribute('src', /\/modern-arm-chair-01\/preview\.png/);
  await expect.poll(() => page.locator('#furniture-info-image').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: info.outputPath('tour-cc0-card.png') });
  await page.keyboard.press('p'); await expect.poll(async () => (await state(page)).locked).toBe(true);
});
