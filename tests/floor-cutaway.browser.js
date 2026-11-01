import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import {mockMap} from '../apps/web/tests/map-fixtures.js';

for(const viewport of [{width:1440,height:1000},{width:390,height:844}])test(`cutaway geometry, picking and reversible controls ${viewport.width}`,async({page},info)=>{
 await page.setViewportSize(viewport);await mockMap(page);
 const errors=[],glbs=[],api=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/\.glb(?:\?|$)/.test(r.url()))glbs.push(r.url());if(/\/api\//.test(r.url()))api.push(r.url());});
 await page.goto('/?serviceTour=1&test=1&locationId=acro-river-park&building=104&floor=16');
 await expect(page.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:60000});
 const state=()=>page.evaluate(()=>window.__siteTour.state());
 await expect.poll(async()=>(await state()).environment,{timeout:60000}).toBe('ready');
 await expect.poll(async()=>(await state()).rendererClippingDuringFrame).toBe(true);
 const sixteen=await state();expect(sixteen.visibleBuildings).toBe(15);expect(sixteen.cutaway.active).toBe(true);
 expect(sixteen.cutaway.buildings.filter(b=>b.active).map(b=>b.id)).toEqual(['104']);
 expect(sixteen.cutaway.buildings.find(b=>b.id==='104').materialPlanes.every(m=>m.count===1&&m.clipShadows)).toBe(true);
 expect(sixteen.cutaway.buildings.filter(b=>b.id!=='104').every(b=>b.materialPlanes.every(m=>m.count===0))).toBe(true);
 expect(sixteen.rendererClippingAfterFrame).toBe(false);
 await page.screenshot({path:info.outputPath('104-floor16-cut.png')});
 await page.locator('#tour-floor-rail [data-floor="7"]').click();
 await expect.poll(async()=>(await state()).cutaway.requestedFloor).toBe(7);
 const seven=await state();expect(seven.cutaway.clipTop_m).toBeLessThan(sixteen.cutaway.clipTop_m);
 const selected=seven.cutaway.buildings.find(b=>b.active);expect(selected.plates.some(p=>p.visible)).toBe(true);
 expect(selected.labelY).toBeCloseTo(seven.cutaway.clipTop_m+8);
 const rayProbe=await page.evaluate(()=>{
  const b=window.__siteTour.bounds(),cut=window.__siteTour.state().cutaway;const find=y=>{
   for(let i=1;i<20;i++){const origin=[b.maxX+1,y,b.minZ+(b.maxZ-b.minZ)*i/20],result=window.__siteTour.ray(origin,[-1,0,0]);if(result.raw.some(h=>h.id===b.id))return {origin,result};}return null;
  };return {above:find(b.height-1),below:find(1)};
 });
 expect(rayProbe.above).not.toBeNull();expect(rayProbe.below).not.toBeNull();
 expect(rayProbe.above.result.raw.filter(h=>h.id==='104').every(h=>!h.accepted)).toBe(true);expect(rayProbe.above.result.hit?.id).not.toBe('104');expect(rayProbe.below.result.hit?.id).toBe('104');
 await page.screenshot({path:info.outputPath('104-floor7-cut.png')});
 await page.locator('#tour-cutaway').click();await expect(page.locator('#tour-cutaway')).toHaveAttribute('aria-pressed','false');
 const off=await state();expect(off.cutaway.active).toBe(false);expect(off.cutaway.buildings.every(b=>b.materialPlanes.every(m=>m.count===0)&&b.plates.every(p=>!p.visible))).toBe(true);
 const restoredRay=await page.evaluate(origin=>window.__siteTour.ray(origin,[-1,0,0]),rayProbe.above.origin);expect(restoredRay.hit?.id).toBe('104');
 await page.screenshot({path:info.outputPath('104-whole-building.png')});
 await page.locator('#tour-cutaway').click();await expect(page.locator('#tour-cutaway')).toHaveAttribute('aria-pressed','true');
 await page.locator('#tour-building').selectOption('100');expect((await state()).cutaway.active).toBe(false);
 await page.locator('#tour-floor-rail [data-floor="3"]').click();await page.locator('#tour-unit').selectOption('305');
 const hundred=await state();expect(hundred.cutaway.buildings.filter(b=>b.active).map(b=>b.id)).toEqual(['100']);
 await page.locator('#tour-variant').selectOption('168c-basic-archisketch');
 await page.screenshot({path:info.outputPath('100-floor3-305.png')});
 await page.locator('#tour-building').selectOption('111');await page.locator('#tour-floor-rail [data-floor="22"]').click();
 const unsupported=await state();expect(unsupported.cutaway.requestedFloor).toBe(22);expect(unsupported.cutaway.active).toBe(false);expect(unsupported.cutaway.floorMarkerVisible).toBe(false);await expect(page.locator('#tour-cutaway')).toBeDisabled();
 expect(unsupported.visibleBuildings).toBe(15);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);expect(glbs).toEqual([]);expect(api).toEqual([]);
 await fs.writeFile(info.outputPath('verification.json'),JSON.stringify({passed:true,viewport,sixteen,seven,off,hundred,unsupported,rayProbe,restoredRay,errors,glbs,api},null,2));
});

test('site render restores interior clipping, lighting and pixels',async({page},info)=>{
 await mockMap(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/?studio=1&test=1&quality=light');
 await page.locator('#select-building').click();
 await expect.poll(()=>page.evaluate(()=>window.__studio?.inspect().siteAppearance.environment),{timeout:90000}).toBe('ready');
 await page.locator('#open-unit').click();await expect(page.locator('body')).toHaveAttribute('data-studio-mode','overview');
 const before=await page.locator('canvas').first().screenshot({path:info.outputPath('interior-before.png')});
 const beforeState=await page.evaluate(()=>({studio:window.__studio.inspect(),home:window.__walkthrough.getState()}));
 await page.locator('#nav-complex').click();await page.locator('#select-building').click();await page.locator('#context-building').selectOption('104');
 await page.locator('#floor-range').fill('7');await page.locator('#floor-range').dispatchEvent('input');
 await expect.poll(()=>page.evaluate(()=>window.__studio.inspect().cutaway.active)).toBe(true);
 await page.locator('#context-cutaway').click();await expect.poll(()=>page.evaluate(()=>window.__studio.inspect().cutaway.active)).toBe(false);
 await page.locator('#context-cutaway').click();
 await page.screenshot({path:info.outputPath('studio-cutaway.png')});
 await page.locator('#open-unit').click();await expect(page.locator('body')).toHaveAttribute('data-studio-mode','overview');
 const after=await page.locator('canvas').first().screenshot({path:info.outputPath('interior-after.png')});
 const afterState=await page.evaluate(()=>({studio:window.__studio.inspect(),home:window.__walkthrough.getState()}));
 expect(after.equals(before)).toBe(true);expect(afterState.studio.rendererLocalClipping).toBe(beforeState.studio.rendererLocalClipping);expect(afterState.home.doors).toEqual(beforeState.home.doors);expect(errors).toEqual([]);
 await fs.writeFile(info.outputPath('verification.json'),JSON.stringify({passed:true,pixelsEqual:true,rendererBefore:beforeState.studio.rendererLocalClipping,rendererAfter:afterState.studio.rendererLocalClipping,errors},null,2));
});

test('actual service preserves household and basic variant through cutaway to 2D',async({page},info)=>{
 await mockMap(page);const glbs=[],api=[],errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/\.glb(?:\?|$)/.test(r.url()))glbs.push(r.url());if(/\/api\//.test(r.url()))api.push(r.url());});
 await page.goto('http://127.0.0.1:5185/?locationId=acro-river-park&serviceView=map');
 await page.locator('#selected-building').selectOption('100');await page.locator('#selected-floor').selectOption('3');await page.locator('#selected-unit').selectOption('305');
 await page.locator('#open-site').click();const site=page.frameLocator('#site-tour-frame');await expect(site.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:90000});
 await expect(site.locator('#tour-cutaway')).toHaveAttribute('aria-pressed','true');await site.locator('#tour-cutaway').click();await site.locator('#tour-cutaway').click();
 await site.locator('#tour-variant').selectOption('168c-basic-archisketch');await site.locator('#tour-plan').click();await expect(page.locator('#plan-stage')).toBeVisible();await expect(page.locator('#plan-name')).toContainText('100동 305호');await expect(page.locator('#sample-variant')).toHaveValue('168c-basic-archisketch');
 expect(glbs).toEqual([]);expect(api).toEqual([]);expect(errors).toEqual([]);await page.screenshot({path:info.outputPath('service-2d-return.png')});
 await fs.writeFile(info.outputPath('verification.json'),JSON.stringify({passed:true,glbs,api,errors,url:page.url()},null,2));
});
