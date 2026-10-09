import { test, expect } from '@playwright/test';

// Touch walking on emulated phones/tablets: real touch events through CDP, so the
// browser produces the same pointer events (pointerType "touch") a device would.
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const LOOK = 2.4; // radians per shorter screen side, src/mobile/touch-input.js

const ready = (page) => expect(page.locator('body')).toHaveAttribute('data-load-state', 'ready', { timeout: 90000 });
const state = (page) => page.evaluate(() => window.__walkthrough.getState());
const turn = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const travelled = (a, b) => Math.hypot(b[0] - a[0], b[2] - a[2]);

async function fingers(page) {
  const cdp = await page.context().newCDPSession(page);
  // Each argument is one finger [x, y]; its position in the list is its touch id.
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  return {
    down: (...points) => send('touchStart', points),
    move: (...points) => send('touchMove', points),
    up: () => send('touchEnd', []),
    cancel: () => send('touchCancel', []),
  };
}
async function stickCentre(page) {
  const box = await page.locator('.touch-stick').boundingBox();
  return { box, x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('phone', () => {
  test.use(PHONE);

  test('left stick walks, right-hand drag looks, doors open by button or tap', async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/?test=1&quality=light');
    await ready(page);
    await expect(page.locator('.touch-help')).toBeVisible();
    await expect(page.locator('.controls-help:not(.touch-help)')).toBeHidden();
    await expect(page.locator('#touch-walk')).toBeHidden();
    const initial = await state(page);

    await page.locator('#start').tap();
    await expect.poll(async () => (await state(page)).touchWalking).toBe(true);
    expect((await state(page)).locked).toBe(false);
    await expect(page.locator('body')).toHaveClass(/touch-walking/);
    for (const selector of ['#panel', '#pause', '.topbar', '#interaction']) await expect(page.locator(selector)).toBeHidden();
    await expect(page.locator('.touch-hint')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('phone-touch-walk.png') });

    const touch = await fingers(page);
    const stick = await stickCentre(page);
    // A full push up walks forward (+Z from the start heading); releasing stops at once.
    await touch.down([stick.x, stick.y]);
    await touch.move([stick.x, stick.y - 30]);
    await touch.move([stick.x, stick.y - 80]);
    await expect(page.locator('.touch-hint')).toBeHidden();
    await expect.poll(async () => (await state(page)).touchInput).toEqual([1, 0]);
    await expect.poll(async () => (await state(page)).position[2], { timeout: 15000 }).toBeGreaterThan(initial.position[2] + 0.15);
    await page.screenshot({ path: testInfo.outputPath('phone-stick-forward.png') });
    await touch.up();
    await expect.poll(async () => (await state(page)).touchInput).toEqual([0, 0]);
    const stopped = await state(page);
    expect(stopped.standing).toBe(true);
    expect(stopped.position[1]).toBe(1.6);
    await page.waitForTimeout(400);
    expect((await state(page)).position).toEqual(stopped.position);
    await expect.poll(() => page.locator('.touch-knob').evaluate((knob) => getComputedStyle(knob).transform)).toBe('none');

    // Thumb beside the pad: the pad moves under it, so nothing moves until the thumb slides.
    const beside = [stick.box.x + stick.box.width + 30, stick.box.y - 20];
    await touch.down(beside);
    await expect.poll(async () => (await state(page)).touchInput).toEqual([0, 0]);
    await touch.move([beside[0], beside[1] - 80]);
    await expect.poll(async () => (await state(page)).touchInput).toEqual([1, 0]);
    await touch.up();

    // A cancelled touch (system gesture) must not leave the player walking.
    await touch.down([stick.x, stick.y]);
    await touch.move([stick.x + 80, stick.y]);
    await expect.poll(async () => (await state(page)).touchInput).toEqual([0, 1]);
    await touch.cancel();
    await expect.poll(async () => (await state(page)).touchInput).toEqual([0, 0]);

    // Moving the touch's implicit capture off the touched knob (Safari reports it) keeps the
    // stick held; only a capture lost by the touch layer itself releases it.
    await page.evaluate(() => document.addEventListener('pointerdown', (event) => { window.__pointerId = event.pointerId; }, { capture: true }));
    await touch.down([stick.x, stick.y]);
    await touch.move([stick.x, stick.y - 80]);
    const lose = (selector) => page.evaluate((s) => document.querySelector(s).dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: window.__pointerId, bubbles: true })), selector);
    await lose('.touch-knob');
    await expect.poll(async () => (await state(page)).touchInput).toEqual([1, 0]);
    await lose('#touch-walk');
    await expect.poll(async () => (await state(page)).touchInput).toEqual([0, 0]);
    await touch.up();

    // Right-hand look: dragging left by 100px turns left by 100 × 2.4 / 390 rad, pitch kept.
    const beforeLook = await state(page);
    await touch.down([300, 420]);
    for (let step = 1; step <= 5; step++) await touch.move([300 - step * 20, 420]);
    await touch.up();
    const looked = await state(page);
    expect(turn(beforeLook.yaw, looked.yaw)).toBeCloseTo(100 * LOOK / 390, 3);
    expect(looked.pitch).toBeCloseTo(beforeLook.pitch, 6);
    expect(looked.position).toEqual(beforeLook.position);
    // Looking up stops at the same polar limit as the mouse.
    await touch.down([300, 700]);
    for (let step = 1; step <= 6; step++) await touch.move([300, 700 - step * 100]);
    await touch.up();
    expect((await state(page)).pitch).toBeCloseTo(Math.PI / 2 - 0.2, 5);

    // Both thumbs at once: the left walks while the right turns.
    await page.evaluate(() => window.__walkthrough.place(7.81, 5.4, 7.81, 8));
    const together = await state(page);
    await touch.down([stick.x, stick.y]);
    await touch.down([stick.x, stick.y], [300, 420]);
    await touch.move([stick.x, stick.y - 80], [300, 420]);
    for (let step = 1; step <= 4; step++) await touch.move([stick.x, stick.y - 80], [300 + step * 15, 420]);
    await expect.poll(async () => travelled(together.position, (await state(page)).position), { timeout: 15000 }).toBeGreaterThan(0.1);
    const both = await state(page);
    await touch.up();
    expect(turn(together.yaw, both.yaw)).toBeCloseTo(-60 * LOOK / 390, 3);
    expect(both.standing).toBe(true);

    // A still tap is not a look drag.
    const beforeTap = await state(page);
    await page.touchscreen.tap(300, 300);
    expect((await state(page)).yaw).toBe(beforeTap.yaw);

    // Doors: the bottom-right button names the door in the crosshair; tapping the door works too.
    const action = page.locator('.touch-action');
    await page.evaluate(() => window.__walkthrough.place(4.938, 4.8, 4.938, 5.525));
    await expect(action).toHaveText('가운데 침실 문 열기');
    await page.screenshot({ path: testInfo.outputPath('phone-door-button.png') });
    await action.tap();
    await expect.poll(async () => (await state(page)).doors.find((d) => d.id === 'acro_0275').progress, { timeout: 60000 }).toBeCloseTo(1, 3);
    await page.evaluate(() => window.__walkthrough.place(2.25, 4.8, 2.25, 5.525));
    await expect(action).toHaveText('서쪽 침실 문 열기');
    await page.touchscreen.tap(PHONE.viewport.width / 2, PHONE.viewport.height / 2);
    await expect.poll(async () => (await state(page)).doors.find((d) => d.id === 'acro_0263').target).toBe(1);

    await page.locator('.touch-exit').tap();
    await expect(page.locator('#panel')).toBeVisible();
    await expect(page.locator('#touch-walk')).toBeHidden();
    await expect(page.locator('#start')).toContainText('이어서 둘러보기');
    expect((await state(page)).touchWalking).toBe(false);
    expect(errors).toEqual([]);
  });
});

test.describe('iPhone Safari without Pointer Lock', () => {
  test.use(PHONE);

  test('viewer and studio load, walk by touch and release without the Pointer Lock API', async ({ page }) => {
    test.setTimeout(240000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // iPhone Safari has neither document.exitPointerLock nor Element.requestPointerLock.
    await page.addInitScript(() => { delete Document.prototype.exitPointerLock; delete Element.prototype.requestPointerLock; });
    await page.goto('/?test=1&quality=light');
    await expect(page.locator('body')).toHaveAttribute('data-load-state', /ready|error/, { timeout: 90000 });
    expect(await page.locator('#status').textContent()).not.toContain('공간을 열지 못했습니다'); // shows the 원인 on failure
    expect(await page.evaluate(() => [typeof document.exitPointerLock, typeof document.body.requestPointerLock])).toEqual(['undefined', 'undefined']);

    await page.locator('#start').tap();
    await expect.poll(async () => (await state(page)).touchWalking).toBe(true);
    const touch = await fingers(page);
    const stick = await stickCentre(page);
    const start = await state(page);
    await touch.down([stick.x, stick.y]);
    await touch.move([stick.x, stick.y - 80]);
    await expect.poll(async () => (await state(page)).position[2], { timeout: 15000 }).toBeGreaterThan(start.position[2] + 0.1);
    await touch.up();
    // Focus loss, exiting and a plan switch all unlock; none may throw without Pointer Lock.
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.locator('.touch-exit').tap();
    await expect(page.locator('#panel')).toBeVisible();
    await page.locator('#variant').selectOption('basic');
    await expect.poll(async () => (await state(page)).variant, { timeout: 60000 }).toBe('basic');

    // The studio unlocks on every mode change, starting with its first screen.
    await page.goto('/?studio=1&test=1&quality=light');
    await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'complex', { timeout: 90000 });
    await page.locator('#select-building').tap();
    await page.locator('#open-unit').tap();
    await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'overview');
    await page.locator('#room-walk').tap();
    await expect.poll(async () => (await state(page)).touchWalking).toBe(true);
    await page.locator('.touch-exit').tap();
    await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'tour');
    expect(errors).toEqual([]);
  });
});

test.describe('phone landscape', () => {
  test.use({ ...PHONE, viewport: { width: 844, height: 390 } });

  test('panel and touch controls fit a low viewport without overlapping', async ({ page }, testInfo) => {
    await page.goto('/?test=1&quality=light');
    await ready(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const panel = await page.locator('#panel').boundingBox();
    expect(panel.y + panel.height).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath('landscape-panel.png') });
    await page.locator('#start').tap();
    await expect.poll(async () => (await state(page)).touchWalking).toBe(true);
    await page.evaluate(() => window.__walkthrough.place(4.938, 4.8, 4.938, 5.525));
    await expect(page.locator('.touch-action')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('landscape-touch-walk.png') });
    const boxes = await Promise.all(['.touch-stick', '.touch-action', '.touch-top', '.bottom-bar > div'].map((s) => page.locator(s).first().boundingBox()));
    const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j])).toBe(false);
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(844); expect(box.y + box.height).toBeLessThanOrEqual(390);
    }
  });
});

test.describe('tablet', () => {
  test.use({ viewport: { width: 1180, height: 820 }, isMobile: true, hasTouch: true });

  test('studio room walk switches to full-screen touch controls and back', async ({ page }, testInfo) => {
    test.setTimeout(240000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/?studio=1&test=1&quality=light');
    await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'complex', { timeout: 90000 });
    await page.locator('#select-building').tap();
    await page.locator('#open-unit').tap();
    await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'overview');
    await expect(page.locator('#orbit-help')).toHaveText('드래그 회전 · 두 손가락 확대');
    await page.locator('#studio-room').selectOption('Living front');
    await page.locator('#room-walk').tap();
    await expect.poll(async () => (await state(page)).touchWalking).toBe(true);
    await expect(page.locator('#studio-description')).toContainText('왼쪽 아래 방향키');
    await expect(page.locator('.studio-header')).toBeHidden();
    await expect(page.locator('#back-plan')).toBeHidden();
    expect(await page.locator('#viewport').boundingBox()).toEqual({ x: 0, y: 0, width: 1180, height: 820 });
    await page.screenshot({ path: testInfo.outputPath('tablet-studio-touch-walk.png') });

    const touch = await fingers(page);
    const stick = await stickCentre(page);
    const start = await state(page);
    await touch.down([stick.x, stick.y]);
    await touch.move([stick.x, stick.y - 90]);
    await expect.poll(async () => travelled(start.position, (await state(page)).position), { timeout: 15000 }).toBeGreaterThan(0.1);
    await touch.up();
    expect((await state(page)).standing).toBe(true);

    await page.locator('.touch-exit').tap();
    await expect.poll(async () => (await state(page)).touchWalking).toBe(false);
    await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'tour');
    await expect(page.locator('#studio-sidebar')).toBeVisible();
    await expect(page.locator('#back-plan')).toBeVisible();
    await expect.poll(async () => (await page.locator('#viewport').boundingBox()).x).toBe(330);
    expect(errors).toEqual([]);
  });
});

test.describe('desktop', () => {
  test('a mouse keeps Pointer Lock walking; ?input=touch opens the touch controls with a mouse', async ({ page }) => {
    await page.goto('/?test=1&quality=light');
    await ready(page);
    await expect(page.locator('.controls-help:not(.touch-help)')).toBeVisible();
    await expect(page.locator('.touch-help')).toBeHidden();
    await page.locator('#start').click();
    // Whether headless Chromium grants the lock varies by platform; the touch layer must stay off either way.
    await page.waitForTimeout(500);
    expect((await state(page)).touchWalking).toBe(false);
    await expect(page.locator('#touch-walk')).toBeHidden();
    await page.evaluate(() => document.exitPointerLock());

    await page.goto('/?test=1&quality=light&input=touch');
    await ready(page);
    await page.locator('#start').click();
    await expect.poll(async () => (await state(page)).touchWalking).toBe(true);
    expect((await state(page)).locked).toBe(false);
    const stick = await stickCentre(page);
    const start = await state(page);
    await page.mouse.move(stick.x, stick.y);
    await page.mouse.down();
    await page.mouse.move(stick.x, stick.y - 80, { steps: 4 });
    await expect.poll(async () => (await state(page)).touchInput).toEqual([1, 0]);
    await expect.poll(async () => (await state(page)).position[2], { timeout: 15000 }).toBeGreaterThan(start.position[2] + 0.1);
    await page.mouse.up();
    await expect.poll(async () => (await state(page)).touchInput).toEqual([0, 0]);
    const beforeLook = await state(page);
    await page.mouse.move(900, 450);
    await page.mouse.down();
    await page.mouse.move(800, 450, { steps: 5 });
    await page.mouse.up();
    expect(turn(beforeLook.yaw, (await state(page)).yaw)).toBeCloseTo(100 * LOOK / 900, 3);
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await state(page)).touchWalking).toBe(false);
    await expect(page.locator('#panel')).toBeVisible();
  });
});
