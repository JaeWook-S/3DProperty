import {test,expect} from '@playwright/test';
import fs from 'node:fs';

const VIEWER='http://127.0.0.1:53173';
const SERVICE='http://127.0.0.1:53185';
const PHOTO='<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="#dadfda"/><text x="80" y="500" font-size="60">OFFLINE PHOTO FIXTURE</text></svg>';
const state=page=>page.evaluate(()=>window.__studio.inspect());
const applied=page=>page.evaluate(()=>window.__concepts.state().applied);
const items=async page=>(await state(page)).items.map(item=>JSON.parse(JSON.stringify(item))).sort((a,b)=>a.id.localeCompare(b.id));
async function observe(page){
 const report={passed:false,errors:[],httpErrors:[],furnitureRequests:[],models:[],externalFixtures:[],stages:[]};
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('response',r=>{if(r.status()>=400&&r.url().startsWith('http://127.0.0.1:531'))report.httpErrors.push({url:r.url(),status:r.status()});});
 page.on('request',r=>{if(r.url().includes('/api/furniture'))report.furnitureRequests.push(r.url());if(/\.glb(\?|$)/.test(r.url()))report.models.push(r.url());});
 await page.context().route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(['127.0.0.1','localhost'].includes(url.hostname))return route.continue();
  if(!['http:','https:'].includes(url.protocol))return route.continue();
  report.externalFixtures.push(url.hostname);
  if(url.hostname==='photon.komoot.io')return route.fulfill({json:{features:[]}});
  if(route.request().resourceType()==='stylesheet')return route.fulfill({contentType:'text/css',body:''});
  return route.fulfill({contentType:'image/svg+xml',body:PHOTO});
 });
 const fontPath='/home/nas5/kinamkim/Repos/geonwoo/3D-To-Video/blender-5.1.0-linux-x64/5.1/datafiles/fonts/Noto Sans CJK Regular.woff2';
 if(fs.existsSync(fontPath)){
  await page.context().route('**/__integration-font.woff2',route=>route.fulfill({contentType:'font/woff2',body:fs.readFileSync(fontPath)}));
  await page.addInitScript(()=>{window.__qaFontReady=Promise.all(['Pretendard','Noto Sans KR'].map(async name=>{const font=new FontFace(name,'url(/__integration-font.woff2)');await font.load();document.fonts.add(font);}));});
 }
 return report;
}
async function home(page){
 await page.goto('/?test=1&quality=light');
 await expect(page.locator('#location-hero.has-home .home-feature')).toBeVisible({timeout:90000});
 await expect(page.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:90000});
 await expect.poll(()=>page.evaluate(()=>window.__walkthrough?.getState().variant)).toBe('112a-expanded-archisketch');
 expect(await page.evaluate(()=>window.__walkthrough.getState().scale)).toEqual([1,1,1]);
}
async function cpuRenderer(page){
 const renderer=await page.evaluate(()=>{
  for(const canvas of document.querySelectorAll('canvas')){
   const gl=canvas.getContext('webgl2')||canvas.getContext('webgl');
   if(gl){const debug=gl.getExtension('WEBGL_debug_renderer_info');return gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER);}
  }
  return null;
 });
 expect(renderer).toMatch(/SwiftShader/i);return renderer;
}
function finish(report,info){fs.writeFileSync(info.outputPath('verification.json'),JSON.stringify(report,null,2));}

test('new default home opens tours, filters, previews safely, applies, undoes and restores theme history',async({page},info)=>{
 const report=await observe(page);
 try{
  await home(page);report.renderer=await cpuRenderer(page);
  await expect(page.locator('#open-my-home')).toBeVisible();await expect(page.locator('#quick-find')).toBeVisible();
  const before=await items(page),beforeTheme=await applied(page);
  await page.evaluate(()=>window.__qaFontReady);await page.screenshot({path:info.outputPath('default-home.png')});
  await page.locator('#open-tours').click();
  await expect(page.locator('#tours-page .tp-card')).toHaveCount(14);
  await page.locator('.tp-filter[data-group="style"]').click();
  await page.locator('.tp-chip[data-group="style"][data-tag="minimal"]').click();
  await expect(page.locator('.tp-filter[data-group="style"]')).toContainText('미니멀');
  const filtered=await page.locator('#tours-page .tp-card').count();expect(filtered).toBeGreaterThan(0);expect(filtered).toBeLessThan(14);
  await page.locator('#tours-page .tp-card[data-tour="hotel-condo"]').click();
  await expect(page.locator('#tours-title')).toContainText('호텔');
  await expect(page.locator('.td-photo')).toHaveCount(5);
  await page.locator('.td-aside [data-home="expanded"]').click();
  await page.locator('#tour-walk').click();
  await expect(page.locator('#tour-session')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode','tour');
  expect(await page.evaluate(()=>window.__walkthrough.getState().variant)).toBe('112a-expanded-archisketch');
  expect(await applied(page)).toMatchObject({concept:'hotel-minimal',palette:'greige-terracotta'});
  report.stages.push({stage:'tour-preview',variant:await page.evaluate(()=>window.__walkthrough.getState().variant),applied:await applied(page)});
  report.exitHitTest=await page.evaluate(()=>{const el=document.querySelector('#tour-session .ts-exit'),r=el.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {pointerLock:document.pointerLockElement?.tagName??null,pointerLockId:document.pointerLockElement?.id??null,rect:{x:r.x,y:r.y,width:r.width,height:r.height},top:{tag:top?.tagName,id:top?.id,className:top?.className},pointerEvents:getComputedStyle(el).pointerEvents,bodyClass:document.body.className};});
  expect(report.exitHitTest.pointerLock).toBe(null);
  expect(report.exitHitTest.top.className).toContain('ts-exit');
  await page.locator('#tour-session .ts-exit').click();
  await expect(page.locator('#tours-page')).toBeVisible();
  expect(await items(page)).toEqual(before);expect(await applied(page)).toEqual(beforeTheme);
  report.stages.push({stage:'preview-restored',originalItemCount:before.length});
  await page.locator('#tour-apply-open').click();await expect(page.locator('#tour-apply')).toBeVisible();
  await page.locator('#tour-apply-confirm').click();
  await expect(page.locator('#tour-toast')).toBeVisible();
  expect(await applied(page)).toMatchObject({concept:'hotel-minimal',palette:'greige-terracotta',tour:'hotel-condo'});
  await page.locator('#tour-toast .tt-undo').click();
  expect(await applied(page)).toEqual(beforeTheme);expect(await items(page)).toEqual(before);
  report.stages.push({stage:'apply-and-undo-restored'});
  await page.locator('.studio-brand').click();
  await expect(page.locator('#home-themes .th-item[data-tour="hotel-condo"]')).toBeVisible();
  await page.locator('#home-themes .th-item[data-tour="hotel-condo"] .th-apply').click();
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode','overview');
  expect(await applied(page)).toMatchObject({concept:'hotel-minimal',tour:'hotel-condo'});
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('cortex-theme-history')).some(x=>x.tour==='hotel-condo'))).toBe(true);
  await page.screenshot({path:info.outputPath('theme-reapplied.png')});
  report.stages.push({stage:'history-reapplied',variant:await page.evaluate(()=>window.__walkthrough.getState().variant)});
  expect(report.furnitureRequests).toEqual([]);expect(report.errors).toEqual([]);expect(report.httpErrors).toEqual([]);report.passed=true;
 }finally{finish(report,info);}
});

test('home find reaches map and actual 112A and 168C households retain 2D and all four canonical interiors',async({page},info)=>{
 test.setTimeout(240000);const report=await observe(page);
 try{
  await home(page);await page.locator('#quick-find').click();
  await page.waitForURL(url=>url.origin===SERVICE&&url.searchParams.get('serviceView')==='map');
  await expect(page.locator('#map-stage')).toBeVisible();
  // Keep the actual navigation intact; enable development inspection on its URL.
  const instrumented=new URL(page.url());instrumented.searchParams.set('test','1');await page.goto(instrumented.href);
  await page.waitForFunction(()=>Boolean(window.__mapService));await page.evaluate(()=>window.__mapService.ready);
  if(!await page.locator('#selected-building').isVisible())await page.locator('#ready-place').click();
  await page.locator('[data-service-view="map"]').click();
  const viewer=()=>page.frames().find(frame=>frame.url().startsWith(VIEWER)&&frame.url().includes('embedded=1')&&!frame.url().includes('serviceTour'));
  const rows=[{building:'104',floor:'16',unit:'1604',type:'112.74A',variants:['112a-basic-archisketch','112a-expanded-archisketch']},{building:'100',floor:'3',unit:'305',type:'168.95C',variants:['168c-basic-archisketch','168c-expanded-archisketch']}];
  for(const row of rows){
   await page.locator('[data-service-view="map"]').click();
   await page.locator('#selected-building').selectOption(row.building);await page.locator('#selected-floor').selectOption(row.floor);await page.locator('#selected-unit').selectOption(row.unit);
   await expect(page.locator('#unit-mapping')).toContainText(row.type);
   await expect(page.locator('#sample-variant option')).toHaveCount(2);
   for(const variant of row.variants){
    await page.locator('#sample-variant').selectOption(variant);await page.locator('#open-plan').click();
    await expect(page.locator('#plan-stage')).toBeVisible();await expect(page.locator('#service-plan [data-room]')).not.toHaveCount(0);
    await expect(page.locator('#plan-name')).toContainText(row.unit+'호');
    const rooms=await page.locator('#service-plan [data-room]').count();
    await page.locator('#open-3d').click();
    await expect.poll(async()=>viewer()?.evaluate(()=>window.__walkthrough?.getState().variant),{timeout:90000}).toBe(variant);
    const actual=await viewer().evaluate(()=>({view:window.__walkthrough.getState(),studio:window.__studio.inspect()}));
    expect(actual.view.scale).toEqual([1,1,1]);expect(actual.view.meshCount).toBeGreaterThan(0);expect(actual.studio.serviceSelection.unit).toBe(row.unit);expect(actual.studio.layoutScope).toContain(`${row.building}:${row.floor}:${row.unit}`);
    await expect(page.frameLocator('#service-viewer').locator('#studio-model')).toHaveValue(variant);
    report.stages.push({stage:'actual-unit-plan-and-interior',building:row.building,floor:row.floor,unit:row.unit,variant,rooms,scale:actual.view.scale,meshCount:actual.view.meshCount,layoutScope:actual.studio.layoutScope});
   }
  }
  await page.screenshot({path:info.outputPath('actual-168c-interior.png')});
  await page.locator('#furniture-tab').click();await expect(page.locator('#furniture-image-status')).toHaveAttribute('data-state','offline');
  await page.locator('#furniture-image-file').setInputFiles({name:'offline-chair.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')});
  await expect(page.locator('#furniture-image-preview')).toBeVisible();await expect(page.locator('#furniture-image-status')).toContainText('서버 전송은 하지 않습니다');
  report.stages.push({stage:'measurement0-local-preview'});
  expect(report.furnitureRequests).toEqual([]);expect(report.errors).toEqual([]);expect(report.httpErrors).toEqual([]);report.passed=true;
 }finally{finish(report,info);}
});

// Real public images and fonts: deliberately no route mocking in this visual smoke.
test('actual-photo HOME screenshot uses unmocked public photo requests',async({page},info)=>{
 test.setTimeout(120000);const report={passed:false,routeMocking:false,errors:[],httpErrors:[],furnitureRequests:[],photos:[],stages:[]};
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('request',r=>{if(r.url().includes('/api/furniture'))report.furnitureRequests.push(r.url());});
 page.on('response',r=>{if(r.status()>=400)report.httpErrors.push({url:r.url(),status:r.status()});});
 try{
  await home(page);report.renderer=await cpuRenderer(page);
  await page.evaluate(()=>document.fonts.ready);
  await expect.poll(()=>page.locator('#location-hero img').evaluateAll(images=>images.filter(i=>i.getBoundingClientRect().width>0&&i.complete&&i.naturalWidth>0).length),{timeout:60000}).toBeGreaterThan(0);
  report.photos=await page.locator('#location-hero img').evaluateAll(images=>images.map(i=>({src:i.currentSrc||i.src,loaded:i.complete&&i.naturalWidth>0,width:i.naturalWidth,height:i.naturalHeight,visible:i.getBoundingClientRect().width>0})));
  await page.screenshot({path:info.outputPath('actual-photo-home.png')});
  report.stages.push({stage:'unmocked-home-screenshot'});
  expect(report.furnitureRequests).toEqual([]);expect(report.errors).toEqual([]);report.passed=true;
 }finally{finish(report,info);}
});
