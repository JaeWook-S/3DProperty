import {mockMap} from './map-fixtures.js';
import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const sample = JSON.parse(readFileSync(new URL('../public/examples/manual-table.json', import.meta.url), 'utf8'));
const captureDir = process.env.CORTEX_CAPTURE_DIR;
function capturePath(name, testInfo) { if(captureDir) { mkdirSync(captureDir,{recursive:true}); return `${captureDir}/${name}`; } return testInfo.outputPath(name); }
async function capture(page, name, testInfo, fullPage = true) {
 await page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
 });
 await page.screenshot({ path: capturePath(name, testInfo), fullPage, animations: 'disabled' });
}


test.beforeEach(async({page})=>mockMap(page));
for(const [variant,revision] of [['112a-basic-archisketch','archisketch-metric-v1'],['112a-expanded-archisketch','archisketch-metric-v1'],['168c-basic-archisketch','archisketch-details-v2'],['168c-expanded-archisketch','archisketch-metric-v1']])test('ready sample opens current model: '+variant,async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/?locationId=acro-river-park&building=100&floor=7');await page.locator('#sample-variant').selectOption(variant);
 const response=page.waitForResponse(r=>r.url().includes(revision)&&r.url().endsWith('.glb'));await page.locator('#open-3d').click();const viewer=page.frameLocator('#service-viewer');await expect(viewer.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:90000});expect((await response).status()).toBe(200);await expect(viewer.locator('#studio-model')).toHaveValue(variant);await expect(viewer.locator('#finish')).toHaveValue('original');expect(new URL(await page.locator('#service-viewer').getAttribute('src')).searchParams.get('unitType')).toBe('unknown');expect(errors).toEqual([]);
});

test('local JSON has explicit provenance, converts units, rejects errors and does not send it to an API', async ({ page },testInfo) => {
 const outbound=[];page.on('request',r=>{if(r.method()!=='GET')outbound.push(r.url());});
 await page.goto('/');await page.locator('#furniture-tab').click();
 await page.locator('#asset-file').setInputFiles({ name:'manual.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(sample)) });
 await expect(page.locator('#result')).toHaveAttribute('data-status','valid');
 await expect(page.locator('.dimensions')).toContainText('120 cm');await expect(page.locator('.example-banner')).toContainText('추론이나 실제 가구 실측 결과가 아닙니다');
 await expect(page.locator('.provenance')).toContainText('제공되지 않음');
 await page.locator('#display-unit').selectOption('mm');await expect(page.locator('.dimensions')).toContainText('1,200 mm');
 await page.locator('#display-unit').selectOption('cm');
 await capture(page, 'service-furniture-result.png', testInfo);
 const bad={...sample,units:'cm',dimensions_m:{width:-1,depth:'0.6',height:0}};
 await page.locator('#asset-file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bad))});
 await expect(page.locator('#result')).toHaveAttribute('data-status','invalid');await expect(page.locator('.error-list li')).toHaveCount(4);
 await page.locator('#load-unresolved').click();await expect(page.locator('#result')).toHaveAttribute('data-status','review');await expect(page.locator('#display-unit')).toBeDisabled();
 await expect(page.locator('.dimensions strong')).toHaveText(['미정','미정','미정']);
 const xss={...sample,asset_id:'<img src=x onerror=alert(1)>'};await page.locator('#asset-file').setInputFiles({name:'text.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(xss))});
 await expect(page.locator('#result h3')).toHaveText(xss.asset_id);await expect(page.locator('#result img')).toHaveCount(0);
 expect(outbound).toEqual([]);
});

test('mobile service layout fits and explains touch walkthrough controls',async({page},testInfo)=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');
 await expect(page.locator('#location-map')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await capture(page, 'service-mobile-layout.png', testInfo);
 await page.locator('#furniture-tab').click();await page.locator('#load-example').click();await expect(page.locator('#result')).toHaveAttribute('data-status','valid');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('actual S2 unresolved package preserves diagnostics and never presents geometry as dimensions', async ({ page }, testInfo) => {
 const assetPath = process.env.CORTEX_FURNITURE_ASSET;
 test.skip(!assetPath, 'Set CORTEX_FURNITURE_ASSET to the private S2 sofa2 asset.json for the integration check.');
 const bytes = readFileSync(assetPath), asset = JSON.parse(bytes);
 expect(asset.asset_id).toBe('sofa2-moge3-geometry-20260929');
 expect(asset.dimensions_m).toEqual({ width: null, depth: null, height: null });
 expect(asset.diagnostics.geometry_status).toBe('succeeded');
 const unexpectedRequests = [];
 page.on('request', request => {
  if (request.method() !== 'GET' || /\.(glb|ply|npz)(\?|$)/.test(request.url())) unexpectedRequests.push(request.url());
 });
 await page.goto('/'); await page.locator('#furniture-tab').click();
 await page.locator('#asset-file').setInputFiles(assetPath);
 await expect(page.locator('#result')).toHaveAttribute('data-status', 'review');
 await expect(page.locator('.dimensions strong')).toHaveText(['미정', '미정', '미정']);
 await expect(page.locator('#display-unit')).toBeDisabled();
 await expect(page.locator('.diagnostics')).toContainText('기하 처리성공');
 await expect(page.locator('.diagnostics')).toContainText('가구 치수미정');
 await expect(page.locator('.diagnostics')).toContainText(asset.diagnostics.code);
 await expect(page.locator('.diagnostics')).toContainText(asset.diagnostics.message);
 await expect(page.locator('.diagnostics li')).toHaveCount(asset.diagnostics.missing.length);
 await expect(page.locator('.diagnostics')).toContainText('장면 점군은 배치용 가구 모델이 아닙니다');
 await expect(page.locator('#result > .provenance')).toContainText('박스 규격 미정 · 가구 모델 없음');
 await expect(page.locator('#result > .provenance')).toContainText('제공되지 않음');
 await expect(page.locator('#result > .provenance')).toContainText(asset.provenance.weights_id);
 await expect(page.locator('.example-banner')).toHaveCount(0);
 await expect(page.locator('.next-stage')).toContainText('아직 공간 뷰어에 전달되지 않습니다');
 expect(JSON.parse(await page.locator('.raw-json pre').textContent())).toEqual(asset);
 await capture(page, 'service-s2-unresolved.png', testInfo);
 await page.setViewportSize({ width: 390, height: 844 });
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 await capture(page, 'service-s2-unresolved-mobile.png', testInfo);
 expect(unexpectedRequests).toEqual([]);
 await testInfo.attach('s2-input-provenance', { body: JSON.stringify({ path: assetPath, sha256: createHash('sha256').update(bytes).digest('hex'), asset_id: asset.asset_id, revision: asset.revision, status: 'review', metricReady: false }, null, 2), contentType: 'application/json' });
});

test('failed dimensions with stale numbers remain review-only and diagnostic text cannot execute', async ({ page }) => {
 await page.goto('/'); await page.locator('#furniture-tab').click();
 const failed = { ...sample, diagnostics: { geometry_status: 'succeeded', dimensions_status: 'failed', code: 'DIMENSIONS_FAILED', message: '<img src=x onerror=alert(1)>', missing: ['object_local_axes'] } };
 await page.locator('#asset-file').setInputFiles({ name: 'failed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(failed)) });
 await expect(page.locator('#result')).toHaveAttribute('data-status', 'review');
 await expect(page.locator('.dimensions strong')).toHaveText(['미정', '미정', '미정']);
 await expect(page.locator('#display-unit')).toBeDisabled();
 await expect(page.locator('.diagnostics')).toContainText('가구 치수실패');
 await expect(page.locator('.diagnostics')).toContainText(failed.diagnostics.message);
 await expect(page.locator('#result img')).toHaveCount(0);
});

test('GLB failure leaves map and local furniture tools usable',async({page})=>{
 await page.route('**/*.glb',route=>route.fulfill({status:404,body:'Controlled missing model'}));await page.goto('/?locationId=acro-river-park&building=100&floor=7');await page.locator('#open-3d').click();
 await expect(page.frameLocator('#service-viewer').locator('body')).toHaveAttribute('data-load-state','error',{timeout:30000});await expect(page.locator('#viewer-load-status')).toContainText('공간을 불러오지 못했습니다');await page.locator('[data-service-view="map"]').click();await expect(page.locator('#location-map')).toBeVisible();await page.locator('#furniture-tab').click();await page.locator('#load-example').click();await expect(page.locator('#result')).toHaveAttribute('data-status','valid');
});
