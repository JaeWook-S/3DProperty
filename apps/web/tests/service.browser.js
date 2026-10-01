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
 await page.screenshot({ path: capturePath(name, testInfo), fullPage });
}


test('both service links open the actual selected GLB and permit PC entry and return', async ({ page, context }, testInfo) => {
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');
 await expect(page.locator('#open-viewer')).toHaveAttribute('href', /variant=expanded/);
 await capture(page, 'service-space.png', testInfo);
 for(const variant of ['expanded','basic']) {
   await page.locator(`[name="variant"][value="${variant}"]`).check();
   const href = await page.locator('#open-viewer').getAttribute('href');
   expect(new URL(href).searchParams.get('variant')).toBe(variant);
   const modelResponse = context.waitForEvent('response', response => response.url().includes(`acro112a-${variant}.glb`));
   const popupWait=context.waitForEvent('page');await page.locator('#open-viewer').click();const viewer=await popupWait;
   viewer.on('pageerror',e=>errors.push(e.message));
   await expect(viewer.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:120000});
   await expect(viewer.locator('#variant')).toHaveValue(variant);
   expect((await modelResponse).status()).toBe(200);
   for (const [id, value] of Object.entries({ finish: 'original', lighting: 'day', quality: 'high' })) await expect(viewer.locator(`#${id}`)).toHaveValue(value);
   expect(await viewer.evaluate(() => typeof window.__walkthrough)).toBe('undefined');
   const resources=await viewer.evaluate(()=>performance.getEntriesByType('resource').map(x=>x.name));
   expect(resources.some(u=>u.includes(`acro112a-${variant}.glb`))).toBe(true);
   await expect(viewer.locator('#start')).toBeEnabled();
   await viewer.locator('#view-settings summary').click();
   await viewer.locator('#quality').selectOption('light');
   await viewer.locator('#start').click();
   await expect(viewer.locator('body')).toHaveClass(/walking/);
   await viewer.keyboard.down('w');await viewer.waitForTimeout(200);await viewer.keyboard.up('w');
   // Headless exit API is tested here; a physical Esc key on a real device is not verified.
   await viewer.evaluate(()=>document.exitPointerLock());
   await expect(viewer.locator('#panel')).toBeVisible();
   await capture(viewer, `service-opened-${variant}.png`, testInfo, false);
   await viewer.close();await page.bringToFront();await expect(page.locator('#open-viewer')).toBeVisible();
 }
 expect(errors).toEqual([]);
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

test('mobile service layout fits without claiming mobile walkthrough controls',async({page},testInfo)=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');
 await expect(page.locator('.mobile-note')).toContainText('PC에서 지원');
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

test('GLB failure and unreachable viewer leave the service tab usable', async ({ page, context }) => {
 await page.goto('/');
 const viewerOrigin = new URL(await page.locator('#open-viewer').getAttribute('href')).origin;
 for (const failure of ['glb', 'server']) {
  let intercepted = false;
  const handler = async route => {
   if (failure === 'server' && route.request().isNavigationRequest()) { intercepted = true; await route.abort('connectionrefused'); }
   else if (failure === 'glb' && route.request().url().endsWith('.glb')) { intercepted = true; await route.fulfill({ status: 404, body: 'Controlled missing model' }); }
   else await route.continue();
  };
  await context.route(`${viewerOrigin}/**`, handler);
  const popupWait = context.waitForEvent('page'); await page.locator('#open-viewer').click(); const viewer = await popupWait;
  if (failure === 'glb') {
   await expect(viewer.locator('body')).toHaveAttribute('data-load-state', 'error', { timeout: 30000 });
   await expect(viewer.locator('#status')).toContainText('공간을 열지 못했습니다');
   await expect(viewer.locator('#start')).toBeDisabled();
  }
  await expect.poll(() => intercepted).toBe(true);
  await viewer.close(); await context.unroute(`${viewerOrigin}/**`, handler); await page.bringToFront();
  await page.locator('[name="variant"][value="basic"]').check();
  await expect(page.locator('#open-viewer')).toHaveAttribute('href', /variant=basic/);
  await page.locator('#furniture-tab').click(); await page.locator('#load-example').click();
  await expect(page.locator('#result')).toHaveAttribute('data-status', 'valid');
  await page.locator('#space-tab').click();
 }
});
