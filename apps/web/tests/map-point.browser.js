import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {mockMap} from './map-fixtures.js';
const out=path.resolve(process.env.CORTEX_MAP_POINT_EVIDENCE_DIR||'../../runtime/service-map/2026-10-25/map-point-classification/browser');
fs.mkdirSync(out,{recursive:true});
const drafts=page=>page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('cortex-floorplan-request:')));
async function mapClick(page,x,y){
 await page.locator('#location-map').scrollIntoViewIfNeeded();await expect(page.locator('.leaflet-pan-anim,.leaflet-zoom-anim')).toHaveCount(0);
 const point=await page.locator('#location-map').evaluate((map,[x,y])=>{const box=map.getBoundingClientRect();for(const [a,b] of [[x,y],[.25,.65],[.8,.5],[.3,.8]]){const px=box.left+box.width*a,py=box.top+box.height*b,target=document.elementFromPoint(px,py);if(target&&map.contains(target)&&!target.closest('.leaflet-marker-icon,.leaflet-control,button,a'))return {x:px,y:py};}return null;},[x,y]);
 expect(point).not.toBeNull();await page.mouse.click(point.x,point.y);await expect(page.locator('.place-pin.point')).toHaveCount(1);return new URL(page.url()).searchParams.get('locationId');
}
for(const viewport of [{width:1440,height:1000},{width:390,height:844}])test(`one unregistered coordinate stays outside prepared/search lists at ${viewport.width}px`,async({page})=>{
 await page.setViewportSize(viewport);await mockMap(page);const errors=[],heavy=[],api=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/\.(glb|hdr)(\?|$)/i.test(r.url()))heavy.push(r.url());if(/\/api\//.test(r.url())&&new URL(r.url()).hostname!=='photon.komoot.io')api.push(r.url());});
 await page.goto('/?test=1');await page.evaluate(()=>window.__mapService.ready);
 await expect(page.locator('#result-title')).toHaveText('준비된 공간');await expect(page.locator('.place-card')).toHaveCount(1);
 const first=await mapClick(page,.55,.55),second=await mapClick(page,.73,.7);expect(first).not.toBe(second);
 await expect(page.locator('.place-pin.ready')).toHaveCount(1);await expect(page.locator('.place-pin')).toHaveCount(2);
 await expect(page.locator('#place-results [data-place-id="acro-river-park"]')).toHaveCount(1);await expect(page.locator('.place-card')).toHaveCount(1);await expect(page.locator('#result-count')).toHaveText('1곳');
 await expect(page.locator('#place-readiness')).toHaveText('선택한 위치 · 미등록');await expect(page.locator('#selected-point-note')).toContainText('실제 건물이나 준비된 3D 단지를 뜻하지 않습니다');
 await expect(page.locator('.unit-fields')).toBeHidden();await expect(page.locator('[data-service-view="3d"]')).toBeDisabled();expect(await drafts(page)).toEqual([]);
 await page.reload();await page.evaluate(()=>window.__mapService.ready);expect(new URL(page.url()).searchParams.get('locationId')).toBe(second);
 await expect(page.locator('.place-pin.point')).toHaveCount(1);await expect(page.locator('.place-card')).toHaveCount(1);await expect(page.locator('#result-title')).toHaveText('준비된 공간');expect(await drafts(page)).toEqual([]);
 await page.evaluate(()=>window.__testFontReady);await page.screenshot({path:path.join(out,`point-${viewport.width}.png`),fullPage:viewport.width<650});
 await page.locator('#place-query').fill('서울역');await page.locator('#place-search button').click();await expect(page.locator('.place-card')).toHaveCount(5);await expect(page.locator('#result-title')).toHaveText('검색 결과');
 await expect(page.locator('.place-pin.ready')).toHaveCount(1);await expect(page.locator('.place-pin.point')).toHaveCount(1);await expect(page.locator('.place-pin')).toHaveCount(7);
 await page.locator('.place-card').first().click();await expect(page.locator('#selected-place-name')).toHaveText('서울역');await expect(page.locator('#place-readiness')).toHaveText('도면·3D 미등록');await expect(page.locator('.place-pin.point')).toHaveCount(0);
 const third=await mapClick(page,.62,.6);await expect(page.locator('.place-card')).toHaveCount(5);await expect(page.locator('#result-title')).toHaveText('검색 결과');expect(await drafts(page)).toEqual([]);
 await page.locator('#save-plan-request').click();await expect(page.locator('#request-status')).toContainText('서버에는 접수되지 않았습니다');expect(await drafts(page)).toEqual(['cortex-floorplan-request:'+third]);
 const draft=await page.evaluate(id=>JSON.parse(localStorage.getItem('cortex-floorplan-request:'+id)),third);expect(draft.selection.locationId).toBe(third);expect(draft.status).toBe('local_draft_not_submitted');await expect(page.locator('#download-plan-request')).toBeVisible();
 await page.locator('#clear-selected-point').click();await expect(page.locator('.place-pin.point')).toHaveCount(0);await expect(page.locator('.place-pin.ready')).toHaveCount(1);await expect(page.locator('.place-card')).toHaveCount(5);await expect(page.locator('#place-detail')).toBeHidden();expect(new URL(page.url()).searchParams.has('locationId')).toBe(false);
 expect(await drafts(page)).toEqual(['cortex-floorplan-request:'+third]);await page.reload();await page.evaluate(()=>window.__mapService.ready);await expect(page.locator('.place-pin.point')).toHaveCount(0);await expect(page.locator('.place-card')).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(heavy).toEqual([]);expect(api).toEqual([]);expect(errors).toEqual([]);
 fs.writeFileSync(path.join(out,`result-${viewport.width}.json`),JSON.stringify({at:new Date().toISOString(),passed:true,viewport,pointIds:[first,second,third],preparedPlaces:1,searchPlaces:5,requestOnlyAfterSave:true,clearRetainsExplicitDraft:true,urlRestore:true,heavy,api,errors},null,2));
});
