import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sample = JSON.parse(readFileSync(new URL('../public/examples/manual-table.json', import.meta.url), 'utf8'));
async function importAsset(page, asset) {
 await page.locator('#asset-file').setInputFiles({ name: 'diagnostics-check.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(asset)) });
}
async function start(page) {
 await page.goto('/'); await page.locator('#furniture-tab').click();
}
async function expectReview(page, asset, reason) {
 await expect(page.locator('#result')).toHaveAttribute('data-status', 'review');
 await expect(page.locator('.review-list')).toContainText(reason);
 await expect(page.locator('#display-unit')).toBeDisabled();
 await expect(page.locator('.dimensions strong')).toHaveText(['미정', '미정', '미정']);
 expect(JSON.parse(await page.locator('.raw-json pre').textContent())).toEqual(asset);
}

test('misplaced diagnostics imports show each exact field error and remove previously usable dimensions', async ({ page }) => {
 await start(page);
 const fields = { geometry_status: 'succeeded', dimensions_status: 'failed', code: 'DIMENSIONS_INFERENCE_FAILED', message: 'Wrong location', missing: [], scene_point_cloud_is_furniture_asset: false };
 for (const [key, value] of Object.entries(fields)) {
  await importAsset(page, sample);
  await expect(page.locator('#display-unit')).toBeEnabled();
  await importAsset(page, { ...sample, [key]: value });
  await expect(page.locator('#result')).toHaveAttribute('data-status', 'invalid');
  await expect(page.locator('.error-list')).toContainText(`diagnostics.${key}`);
  await expect(page.locator('.error-list')).toContainText('진단 필드 위치가 잘못되었습니다');
  await expect(page.locator('.dimensions')).toHaveCount(0);
  await expect(page.locator('#display-unit')).toHaveCount(0);
 }
});

test('incomplete and contradictory diagnostics imports block numeric display and preserve original JSON', async ({ page }) => {
 const requests = [];
 page.on('request', request => { if (request.method() !== 'GET' || /\.(glb|ply|npz)(\?|$)/.test(request.url())) requests.push(request.url()); });
 await start(page);
 for (const diagnostics of [{}, { code: 'DIMENSIONS_INFERENCE_FAILED', message: 'No dimensions status.' }, { geometry_status: 'succeeded' }]) {
  const asset = { ...sample, diagnostics };
  await importAsset(page, asset); await expectReview(page, asset, '치수 처리 상태가 없습니다');
 }
 for (const code of ['DIMENSIONS_SUCCEEDED', 'DIMENSIONS_UNRESOLVED', 'DIMENSIONS_INFERENCE_FAILED', 'INVALID_DIMENSIONS_OUTPUT', 'OBJECT_NOT_DETECTED']) {
  const asset = { ...sample, diagnostics: { code, dimensions_status: code === 'DIMENSIONS_SUCCEEDED' ? 'failed' : 'succeeded', message: '<img src=x onerror=alert(1)>' } };
  await importAsset(page, asset); await expectReview(page, asset, `진단 코드 ${code}`);
  await expect(page.locator('.diagnostics')).toContainText(code);
  await expect(page.locator('#result img')).toHaveCount(0);
 }
 const unknown = { ...sample, diagnostics: { dimensions_status: 'Future_Status ', code: 'FUTURE_CODE' } };
 await importAsset(page, unknown); await expectReview(page, unknown, '치수 처리 결과가 성공으로 보고되지 않아');
 await expect(page.locator('.diagnostics')).toContainText('Future_Status');
 expect(requests).toEqual([]);
});

test('original Cube6 and sofa2 files retain import compatibility alongside independent successful dimensions', async ({ page }) => {
 const root = process.env.CORTEX_FURNITURE_ROOT;
 test.skip(!root, 'Set CORTEX_FURNITURE_ROOT to verify the seven private S2 original files.');
 const index = JSON.parse(readFileSync(resolve(root, 'runs/2026-09-29-abo6-cubercnn/furniture-packages/index.json'), 'utf8'));
 expect(index).toHaveLength(6);
 await start(page);
 for (const row of index) {
  const path = resolve(root, row.path), asset = JSON.parse(readFileSync(path, 'utf8'));
  await page.locator('#asset-file').setInputFiles(path);
  await expect(page.locator('#result')).toHaveAttribute('data-status', 'valid');
  await expect(page.locator('#display-unit')).toBeEnabled();
  await expect(page.locator('#result h3')).toHaveText(asset.asset_id);
  await expect(page.locator('.basis-line')).toContainText('모델 추정');
  expect(JSON.parse(await page.locator('.raw-json pre').textContent())).toEqual(asset);
 }
 const sofaPath = resolve(root, 'runs/2026-09-29-moge3-sofa2-geometry/furniture-package/asset.json');
 await page.locator('#asset-file').setInputFiles(sofaPath);
 await expectReview(page, JSON.parse(readFileSync(sofaPath, 'utf8')), '치수 처리 결과가 성공으로 보고되지 않아');
 await expect(page.locator('.diagnostics')).toContainText('가구 치수미정');
 const manual = { ...sample, diagnostics: { geometry_status: 'failed', dimensions_status: 'succeeded', code: 'GEOMETRY_INFERENCE_FAILED' } };
 await importAsset(page, manual);
 await expect(page.locator('#result')).toHaveAttribute('data-status', 'valid');
 await expect(page.locator('#display-unit')).toBeEnabled();
 await expect(page.locator('.diagnostics')).toContainText('기하 처리실패');
 const estimate = JSON.parse(readFileSync(resolve(root, index[0].path), 'utf8'));
 estimate.diagnostics = { dimensions_status: 'succeeded', code: 'DIMENSIONS_SUCCEEDED', missing: ['independent_dimensions_ground_truth'] };
 await importAsset(page, estimate);
 await expect(page.locator('#result')).toHaveAttribute('data-status', 'valid');
 await expect(page.locator('#display-unit')).toBeEnabled();
 await expect(page.locator('.diagnostics')).toContainText('비교할 독립 정답 치수');
});
