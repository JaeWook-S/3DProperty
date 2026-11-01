import {test,expect} from '@playwright/test';
import fs from 'node:fs';
// Test-only font for readable captures on the Linux host; no product asset added.
const fontPath='/home/nas5/kinamkim/Repos/geonwoo/AisideProject/realestate-spatial-ai/docs/benchmarking/2026-10-22-rivals/feature-teardown-2026-10-23/assets/fonts/NanumGothic-Regular.ttf';
const snapshot=page=>page.evaluate(()=>window.cortexFloorAccess.inspect());
async function ready(page){await page.goto('/floor-access-review.html');await expect(page.locator('body')).toHaveAttribute('data-load-state','ready');if(fs.existsSync(fontPath)){await page.addStyleTag({content:`@font-face{font-family:CaptureKorean;src:url(data:font/ttf;base64,${fs.readFileSync(fontPath).toString('base64')})}body,button,input,select,text{font-family:CaptureKorean,sans-serif!important}`});await page.evaluate(()=>document.fonts.ready);}}

test('shared floor isolates geometry, verifies recorded routes and lazily renders real models',async({page},testInfo)=>{
 const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 await ready(page);let state=await snapshot(page);
 expect(state.units).toHaveLength(2);expect(state.units.map(u=>u.scale)).toEqual([1,1]);expect(state.poseCheck.clear).toBe(true);expect(state.carCheck.fits).toBe(true);
 expect(requests.filter(u=>/\.(glb|hdr)(\?|$)/.test(u))).toHaveLength(0);
 const count=state.renderer.renderCount;await page.waitForTimeout(300);expect((await snapshot(page)).renderer.renderCount).toBeLessThanOrEqual(count+1);
 await page.locator('#example-route').click();state=await snapshot(page);expect(state.routeResult.status).toBe('clear');expect(state.routeResult.completeEndpoints).toBe(true);
 await expect(page.locator('#route-result')).toContainText('현관 앞 경로에 간섭 없음');
 await page.locator('#door-toggle').click();expect((await snapshot(page)).route).toHaveLength(0);
 await page.locator('#example-route').click();state=await snapshot(page);expect(state.routeResult.status).toBe('blocked');expect(state.routeResult.hitIds).toContain('lift-door');
 await page.locator('#door-toggle').click();
 await page.locator('#cargo-height').fill('2.2');await page.locator('#cargo-height').dispatchEvent('change');
 await page.locator('#example-route').click();state=await snapshot(page);expect(state.carCheck.fits).toBe(true);expect(state.routeResult.status).toBe('blocked');expect(state.routeResult.hitIds).toContain('lift-lintel');
 await page.locator('#cargo-kind').selectOption('cc0-dining-chair-02');
 await page.locator('#cargo-render').click();await expect(page.locator('#cargo-feedback')).toContainText('원본 모델 비율 유지');
 const furnitureUrls=requests.filter(u=>/assets\/furniture\/cc0\/.*model\.glb/.test(u));expect(furnitureUrls).toHaveLength(1);
 await page.locator('#cargo-render').click();await expect(page.locator('#cargo-feedback')).toContainText('원본 모델 비율 유지');expect(requests.filter(u=>/assets\/furniture\/cc0\/.*model\.glb/.test(u))).toHaveLength(1);
 await page.locator('#cargo-place').selectOption('car');await page.locator('#example-route').click();
 await page.screenshot({path:testInfo.outputPath('common-floor.png'),fullPage:true});
 await page.locator('#unit-context').check();await expect.poll(async()=>(await snapshot(page)).renderer.unitsLoaded,{timeout:90000}).toBe(true);
 state=await snapshot(page);expect(state.renderer.modelFetches).toBe(1);expect(state.renderer.unitTransforms).toHaveLength(2);
 for(const u of state.renderer.unitTransforms)expect(u.scale).toEqual([1,1,1]);
 await page.locator('#plan-all').click();await page.screenshot({path:testInfo.outputPath('two-units.png'),fullPage:true});
 await page.locator('#unit-context').uncheck();await page.locator('#unit-context').check();expect((await snapshot(page)).renderer.modelFetches).toBe(1);
 expect(requests.filter(u=>/\/api\//.test(u))).toHaveLength(0);expect(errors).toEqual([]);
 const download=page.waitForEvent('download');await page.locator('#export-review').click();await (await download).saveAs(testInfo.outputPath('review.json'));
 await testInfo.attach('state',{body:JSON.stringify(await snapshot(page),null,2),contentType:'application/json'});
});

test('390px layout, real pointer coordinates, keyboard rotation and invalid config preserve honest state',async({page},testInfo)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:390,height:844});await ready(page);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.locator('#record-route').click();const before=await snapshot(page);
 await page.locator('#floor-plan').focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('e');
 const after=await snapshot(page);expect(after.cargo.x-before.cargo.x).toBeCloseTo(.05,8);expect(after.cargo.yaw-before.cargo.yaw).toBeCloseTo(Math.PI/12,8);expect(after.route.length).toBeGreaterThanOrEqual(3);
 await page.locator('#floor-plan').scrollIntoViewIfNeeded();
 const drag=await page.locator('#floor-plan').evaluate(svg=>{const c=window.cortexFloorAccess.inspect().cargo;const point=(x,z)=>{const p=svg.createSVGPoint();p.x=x;p.y=z;const t=p.matrixTransform(svg.getScreenCTM());return {x:t.x,y:t.y};};return {a:point(c.x,c.z),b:point(c.x+.2,c.z+.1)};});
 await page.mouse.move(drag.a.x,drag.a.y);await page.mouse.down();await page.mouse.move(drag.b.x,drag.b.y,{steps:4});await page.mouse.up();
 const dragged=await snapshot(page);expect(dragged.cargo.x-after.cargo.x).toBeCloseTo(.2,3);expect(dragged.cargo.z-after.cargo.z).toBeCloseTo(.1,3);
 await page.locator('[name=hallWidth]').fill('3');await page.locator('[name=carWidth]').fill('2');await page.locator('#dimensions-form button[type=submit]').click();
 await expect(page.locator('#dimension-feedback')).toContainText('양쪽 통로');expect((await snapshot(page)).config.hallWidth).toBe(4.8);
 await page.locator('[name=hallWidth]').fill('5.2');await page.locator('#dimensions-form button[type=submit]').click();expect((await snapshot(page)).config.hallWidth).toBe(5.2);expect((await snapshot(page)).route).toHaveLength(0);
 await page.evaluate(()=>window.cortexFloorAccess.setPose({x:20,z:20,yaw:0}));
 expect((await snapshot(page)).poseCheck.clear).toBe(false);await expect(page.locator('#pose-result')).toContainText('검토 범위 밖');
 await page.evaluate(()=>window.cortexFloorAccess.setRoute([{x:20,z:20,yaw:0},{x:21,z:20,yaw:0}]));
 expect((await snapshot(page)).routeResult.status).toBe('unresolved');expect((await snapshot(page)).routeResult.reason).toBe('outside-review-scope');
 await page.locator('#cargo-place').selectOption('car');expect((await snapshot(page)).poseCheck.clear).toBe(true);
 expect(errors).toEqual([]);
 await page.screenshot({path:testInfo.outputPath('mobile.png'),fullPage:true});
});


test('failed unit context retries without certifying an unloaded scene',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));let attempts=0;
 await page.route('**/acro168c-expanded.glb',async route=>{attempts++;if(attempts===1)await route.fulfill({status:404,body:'missing fixture'});else await route.continue();});
 await ready(page);await page.locator('#unit-context').check();
 await expect(page.locator('#render-status')).toContainText('모델 로드 실패');await expect(page.locator('#unit-context')).not.toBeChecked();
 expect((await snapshot(page)).renderer.unitsLoaded).toBe(false);
 await page.locator('#example-route').click();expect((await snapshot(page)).routeResult.status).toBe('clear');
 await page.locator('#unit-context').check();await expect.poll(async()=>(await snapshot(page)).renderer.unitsLoaded).toBe(true);
 expect(attempts).toBe(2);await expect(page.locator('#render-status')).toContainText('원본 168C × 2');expect(errors).toEqual([]);
});

test('unavailable WebGL preserves 2D review and never announces a loaded model',async({page})=>{
 const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 await page.addInitScript(()=>{const getContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(['webgl','webgl2','experimental-webgl'].includes(type))return null;return getContext.call(this,type,...args);};});
 await page.goto('/floor-access-review.html');await expect(page.locator('body')).toHaveAttribute('data-load-state','2d-only');
 await page.locator('#unit-context').click();await expect(page.locator('#unit-context')).not.toBeChecked();await expect(page.locator('#render-status')).toContainText('3D 표시 실패');
 expect((await snapshot(page)).renderer.unitsLoaded).toBe(false);
 await page.locator('#example-route').click();expect((await snapshot(page)).routeResult.status).toBe('clear');
 expect(requests.filter(u=>/\.(glb|hdr)(\?|$)/.test(u))).toHaveLength(0);expect(errors).toEqual([]);
});
