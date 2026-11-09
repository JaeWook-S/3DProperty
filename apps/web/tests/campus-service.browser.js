import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {mockMap} from './map-fixtures.js';
const out=path.resolve('../../runtime/inha-campus/2026-11-01/s3-service/browser');
fs.mkdirSync(out,{recursive:true});
const viewerBase='http://127.0.0.1:15739/viewer/';
// This fixture isolates the service/iframe contract; it does not validate campus rendering.
async function mockViewer(page){
 await page.route(url=>url.origin===new URL(viewerBase).origin&&url.pathname==='/viewer/',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body style="font-family:sans-serif;background:#e8ede5;color:#365542;padding:24px"><h2>서비스 연결 계약 검사</h2><p>캠퍼스 렌더러를 대체한 검사 fixture입니다.</p><button id="back">지도 복귀</button><button id="try-indoor">잘못된 실내 요청 시험</button><script>
 const target=new URL(new URL(location.href).searchParams.get('serviceUrl')).origin;
 window.received=[];const post=(type,extra={})=>parent.postMessage({type,...extra},target);
 addEventListener('message',e=>{if(e.origin!==target||e.source!==parent)return;received.push(e.data);if(e.data.type==='cortex:visibility')document.body.dataset.visible=String(e.data.visible);});
 document.querySelector('#back').onclick=()=>post('cortex:show-map');
 document.querySelector('#try-indoor').onclick=()=>post('cortex:open-interior',{selection:{locationId:'acro-river-park',building:'100',floor:3,unit:'305',sampleVariant:'168c-expanded-archisketch',previewMode:'sample'}});
 post('cortex:viewer-ready');
 </script></body></html>`}));
}
const inspect=page=>page.evaluate(()=>window.__mapService.state());
const boot=async(page,params={})=>{const url=new URL('http://127.0.0.1:5185/');url.searchParams.set('test','1');url.searchParams.set('viewerUrl',viewerBase);for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));await page.goto(url.href);await page.evaluate(()=>window.__mapService.ready);};
async function campusOnly(page){
 await expect(page.locator('#campus-preview')).toBeVisible();await expect(page.locator('.campus-interior-status')).toHaveText('실내 공간은 준비 중입니다.');
 for(const selector of ['.unit-fields','.mapping-status','#sample-models','#open-floor-access','#plan-request','[data-service-view="plan"]','[data-service-view="3d"]'])await expect(page.locator(selector)).toBeHidden();
 await expect(page.locator('#sample-variant option')).toHaveCount(0);await expect(page.locator('#service-viewer')).not.toHaveAttribute('src');await expect(page.locator('#open-floor-access')).not.toHaveAttribute('href');
 const s=(await inspect(page)).selection;expect(s.locationId).toBe('inha-university');expect(s.unit).toBe('');expect(s.building).toBe('');expect(s.floor).toBe(null);expect(s.sampleVariant).toBe('');
}
for(const width of [1440,390])test(`campus selection, messages and Acro return stay exterior-only at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:width===390?844:1000});await mockMap(page);await mockViewer(page);
 const requests=[],errors=[];page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(e.message));
 await boot(page);await expect(page.locator('.place-card')).toHaveCount(2);await expect(page.locator('#result-count')).toHaveText('2곳');
 await expect(page.locator('#site-tour-frame')).not.toHaveAttribute('src');await expect(page.locator('#service-viewer')).not.toHaveAttribute('src');
 expect(requests.filter(u=>/\.(glb|hdr)(\?|$)|three[._]|\/src\/campus\//i.test(u))).toEqual([]);
 const initialRequests=[...requests];
 for(const query of ['인하대','인하대학교']){
  await page.locator('#place-query').fill(query);await page.locator('#place-search button').click();await expect(page.locator('.place-card')).toHaveCount(1);await expect(page.locator('[data-place-id="inha-university"]')).toContainText('캠퍼스 외관 3D');
 }
 expect(requests.filter(u=>u.startsWith('https://photon.komoot.io/'))).toEqual([]);
 await page.locator('[data-place-id="inha-university"]').click();await campusOnly(page);await expect(page.locator('#site-stage')).toBeVisible();await expect(page.locator('#site-load-status')).toBeHidden();
 const src=await page.locator('#site-tour-frame').getAttribute('src'),url=new URL(src);
 expect(url.origin+url.pathname).toBe(viewerBase);expect(url.searchParams.get('serviceTour')).toBe('1');expect(url.searchParams.get('locationId')).toBe('inha-university');expect(url.searchParams.has('variant')).toBe(false);expect(url.searchParams.has('studio')).toBe(false);expect(new URL(url.searchParams.get('serviceUrl')).origin).toBe('http://127.0.0.1:5185');
 const site=page.frameLocator('#site-tour-frame');await expect(site.locator('body')).toHaveAttribute('data-visible','true');
 await site.locator('#try-indoor').click();await campusOnly(page);await expect(page.locator('#site-stage')).toBeVisible();
 await page.evaluate(()=>window.__testFontReady);await page.screenshot({path:path.join(out,`campus-ui-contract-${width}.png`),fullPage:width===390});
 expect(requests.filter(u=>/acro-(site-selection|evidence)\.json|\/floorplans\//.test(u))).toEqual([]);
 await site.locator('#back').click();await expect(page.locator('#map-stage')).toBeVisible();await expect(site.locator('body')).toHaveAttribute('data-visible','false');
 await page.reload();await page.evaluate(()=>window.__mapService.ready);await campusOnly(page);await expect(page.locator('#site-tour-frame')).not.toHaveAttribute('src');await expect(page.locator('#map-stage')).toBeVisible();
 await page.locator('#ready-place').click();await expect(page.locator('.place-card')).toHaveCount(2);await expect(page.locator('#selected-place-name')).toHaveText('인하대학교');
 await page.locator('[data-place-id="acro-river-park"]').click();await expect(page.locator('.unit-fields')).toBeVisible();await expect(page.locator('#campus-preview')).toBeHidden();await expect(page.locator('[data-service-view="site"]')).toHaveText('단지투어');
 await expect(page.locator('#selected-building option[value="100"]')).toHaveCount(1);await page.locator('#selected-building').selectOption('100');await page.locator('#selected-floor').selectOption('3');await page.locator('#selected-unit').selectOption('305');
 await expect(page.locator('#sample-variant option')).toHaveCount(2);await expect(page.locator('#unit-mapping')).toContainText('168.95C');await expect(page.locator('#open-plan')).toBeEnabled();await expect(page.locator('#open-floor-access')).toHaveAttribute('href',/^http:\/\/127\.0\.0\.1:15739\/viewer\/floor-access-review\.html/);
 await page.locator('#open-plan').click();await expect(page.locator('#service-plan [data-room]')).not.toHaveCount(0);
 await page.locator('[data-place-id="inha-university"]').click();await campusOnly(page);expect(new URL(page.url()).searchParams.get('serviceView')).toBe('site');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(requests.filter(u=>/\.(glb|hdr)(\?|$)|\/api\//i.test(u))).toEqual([]);expect(errors).toEqual([]);
 fs.writeFileSync(path.join(out,`contract-${width}.json`),JSON.stringify({passed:true,width,renderer:'iframe message fixture; not actual campus renderer',at:new Date().toISOString(),initialRequests,requests,errors,src,selection:(await inspect(page)).selection},null,2));
});
test('campus direct links discard forged household and interior intent; Acro direct state still restores',async({page})=>{
 await mockMap(page);await mockViewer(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await boot(page,{locationId:'inha-university',serviceView:'3d',building:'100',floor:3,unit:'305',room:'kitchen',sampleVariant:'168c-expanded-archisketch',previewMode:'sample',lat:0,lon:0});
 await campusOnly(page);await expect(page.locator('#site-load-status')).toBeHidden();const s=(await inspect(page)).selection;expect(s.lat).toBe(37.4501371);expect(s.lon).toBe(126.6537133);expect(s.serviceView).toBe('site');
 await page.reload();await page.evaluate(()=>window.__mapService.ready);await campusOnly(page);await expect(page.locator('#site-stage')).toBeVisible();
 await boot(page,{locationId:'acro-river-park',serviceView:'plan',building:'100',floor:3,unit:'305',sampleVariant:'168c-basic-archisketch'});await expect(page.locator('#selected-unit')).toHaveValue('305');await expect(page.locator('#sample-variant')).toHaveValue('168c-basic-archisketch');await expect(page.locator('#service-plan [data-room]')).not.toHaveCount(0);
 expect(errors).toEqual([]);fs.writeFileSync(path.join(out,'url-restoration.json'),JSON.stringify({passed:true,renderer:'iframe message fixture',campusState:s,acroState:(await inspect(page)).selection,errors},null,2));
});
