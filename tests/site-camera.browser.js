import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import {mockMap} from '../apps/web/tests/map-fixtures.js';
const distance=s=>Math.hypot(...s.camera.map((x,i)=>x-s.target[i]));
for(const viewport of [{width:1440,height:1000},{width:390,height:844}])test(`close facade camera and floor following ${viewport.width}`,async({page},info)=>{
 await page.setViewportSize(viewport);await mockMap(page);
 const errors=[],glbs=[],api=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/\.glb(?:\?|$)/.test(r.url()))glbs.push(r.url());if(/\/api\//.test(r.url()))api.push(r.url());});
 await page.goto('/?serviceTour=1&test=1&locationId=acro-river-park&building=104&floor=16');
 const state=()=>page.evaluate(()=>window.__siteTour.state());
 await expect.poll(()=>page.evaluate(()=>window.__siteTour?.state().environment),{timeout:90000}).toBe('ready');
 await expect.poll(async()=>(await state()).surroundings.state).toBe('ready');
 const settled=async()=>{await expect.poll(async()=>Math.abs((await state()).pendingCameraOffset),{timeout:10000}).toBeLessThan(.01);return state();};
 const first=await settled();expect(distance(first)).toBeLessThan(100);expect(distance(first)).toBeLessThan(Math.hypot(105,48,135)*.57);expect(first.camera[1]-first.target[1]).toBeLessThan(12);expect(first.target[1]).toBeCloseTo(110/33*15.5,2);expect(first.cutaway.active).toBe(true);expect(first.visibleBuildings).toBe(15);
 await page.screenshot({path:info.outputPath('104-floor16-close.png')});
 await page.locator('#tour-cutaway').click();expect((await state()).cutaway.active).toBe(false);await page.screenshot({path:info.outputPath('104-floor16-whole-close.png')});await page.locator('#tour-cutaway').click();
 // Every supported building must remain outside its envelope with the closer pose.
 const buildings=[];
 for(let n=100;n<=114;n++){
  await page.locator('#tour-building').selectOption(String(n));
  const s=await state(),b=await page.evaluate(()=>window.__siteTour.bounds());
  expect(s.selection.floor).toBeNull();expect(s.cutaway.active).toBe(false);expect(s.visibleBuildings).toBe(15);expect(distance(s)).toBeLessThan(100);
  const clearance=Math.hypot(Math.max(b.minX-s.camera[0],0,s.camera[0]-b.maxX),Math.max(b.minZ-s.camera[2],0,s.camera[2]-b.maxZ));expect(clearance).toBeGreaterThan(20);expect(s.target[1]).toBeCloseTo(b.height*.45,2);
  buildings.push({id:b.id,camera:s.camera,target:s.target,distance:distance(s),envelopeClearance:clearance});
 }
 await page.locator('#tour-building').selectOption('104');const noFloor=await state();await page.screenshot({path:info.outputPath('104-building-selected-close.png')});
 await page.locator('#tour-floor-rail [data-floor="3"]').click();const low=await settled();
 await page.locator('#tour-floor-rail [data-floor="25"]').click();const high=await settled();const delta=22*110/33;
 expect(high.camera[1]-low.camera[1]).toBeCloseTo(delta,1);expect(high.target[1]-low.target[1]).toBeCloseTo(delta,1);for(const axis of [0,2])expect(high.camera[axis]).toBeCloseTo(low.camera[axis],3);expect(distance(high)).toBeCloseTo(distance(low),2);
 await page.locator('#tour-floor-rail [data-floor="16"]').click();const restored=await settled();expect(restored.target[1]).toBeCloseTo(first.target[1],1);
 await page.locator('[data-view="site"]').click();const overview=await state();expect(distance(overview)).toBeGreaterThan(400);await page.locator('[data-view="focus"]').click();expect(distance(await state())).toBeLessThan(100);
 await page.locator('#tour-building').selectOption('111');await page.locator('#tour-floor-rail [data-floor="22"]').click();const beyond=await settled();expect(beyond.cutaway.active).toBe(false);expect(beyond.cutaway.floorMarkerVisible).toBe(false);
 await expect(page.locator('#tour-cutaway')).toBeDisabled();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);expect(glbs).toEqual([]);expect(api).toEqual([]);
 await fs.writeFile(info.outputPath('verification.json'),JSON.stringify({passed:true,at:new Date().toISOString(),viewport,first,buildings,noFloor,low,high,restored,overview,beyond,errors,glbs,api,scope:'CPU Chromium SwiftShader; not physical device performance'},null,2));
});
