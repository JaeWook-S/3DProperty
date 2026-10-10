import { test, expect } from '@playwright/test';
import { generatedFixture } from './fixtures/generated-asset.js';

const { asset, bytes } = generatedFixture();

test('Studio image registration automatically places the resulting GLB in the selected room', async ({ page }) => {
  const jobId = asset.asset_id.slice(0, 32);
  await page.route('**/api/furniture/**', route => {
    const url = route.request().url();
    if (url.endsWith('/assets')) return route.fulfill({ json: { assets: [] } });
    if (url.endsWith('/model.glb')) return route.fulfill({ contentType: 'model/gltf-binary', body: bytes });
    if (route.request().method() === 'POST') return route.fulfill({ status: 202, json: { job_id: jobId } });
    return route.fulfill({ json: { status: 'completed', result: { outcome: 'measured',
      objects: [{ status: 'ok', width_m: .8, depth_m: .6, height_m: .75 }],
      generation: { status: 'completed', provider: 'stub-no-api', assets: [asset], errors: [] } } } });
  });
  await page.goto('/?test=1&quality=light');
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'complex', { timeout: 90000 });
  await page.locator('#select-building').click(); await page.locator('#open-unit').click();
  await page.locator('#studio-room').selectOption('Living front'); await page.locator('#room-edit').click();
  await page.locator('#furniture-image-file').setInputFiles({ name: 'table.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
  await expect(page.locator('#studio-status')).toContainText('테스트 모델 1개를 배치', { timeout: 15000 });
  await expect(page.locator('#register-furniture')).toBeEnabled();
  await expect(page.locator('#selected-item option:checked')).toHaveText(asset.title);
  const state = await page.evaluate(() => window.__studio.inspect());
  expect(state.roomId).toBe('Living front');
  expect(state.items.filter(item => item.kind === `generated:${asset.asset_id}` && !item.deleted)).toHaveLength(1);
});

test('a generated GLB opens in Studio, moves, rotates and restores after reload', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/furniture/assets**', route => route.fulfill(route.request().url().endsWith('/model.glb')
    ? { contentType: 'model/gltf-binary', body: bytes } : { json: { assets: [asset] } }));
  await page.goto(`/?test=1&quality=light&furnitureAsset=${asset.asset_id}`);
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'edit', { timeout: 90000 });
  await expect(page.locator('#selected-item option')).toContainText([asset.title]);
  await expect(page.locator('#studio-status')).toContainText('테스트 모델');
  const inspect = () => page.evaluate(() => window.__studio.inspect());
  let state = await inspect();
  const generated = state.items.find(item => item.kind === `generated:${asset.asset_id}`);
  expect(generated.width).toBe(.8); expect(generated.depth).toBe(.6); expect(generated.height).toBe(.75);
  await page.locator('#item-x').fill('6.1'); await page.locator('#item-z').fill('6.2');
  await page.locator('#apply-position').click(); await page.locator('#rotate-item').click();
  await page.locator('#save-layout').click();
  await page.locator('#remove-item').click();
  await page.locator('#restore-layout').click();
  await expect(page.locator('#studio-status')).toContainText('저장한 배치');
  state = await inspect();
  const restored = state.items.find(item => item.kind === generated.kind);
  expect(restored.x).toBe(6.1); expect(restored.z).toBe(6.2); expect(restored.angle).toBeCloseTo(Math.PI / 2);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode', 'edit', { timeout: 90000 });
  await page.locator('#restore-layout').click();
  await expect(page.locator('#studio-status')).toContainText('저장한 배치');
  expect((await inspect()).items.find(item => item.kind === generated.kind).x).toBe(6.1);
  await page.screenshot({ path: testInfo.outputPath('generated-furniture-in-studio.png') });
  expect(errors).toEqual([]);
});
