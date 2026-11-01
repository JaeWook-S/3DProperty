import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {pointInRoom} from '../src/walkthrough/minimap-geometry.js';
for(const variant of ['basic','expanded'])test(`112A ${variant}: separate walk destinations and corrected entrance side walls`,async({page},testInfo)=>{
 test.setTimeout(180000);
 const s=JSON.parse(readFileSync(new URL(`../assets/models/acro-river-park/112a/archisketch-circulation-v5/${variant}/model-info.json`,import.meta.url)));
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`/?studio=1&entry=overview&variant=112a-${variant}-archisketch&test=1&quality=light`);
 await expect(page.locator('body')).toHaveAttribute('data-studio-mode','overview',{timeout:90000});
 for(const zone of s.navigation_zones){
  await expect(page.locator(`#studio-room option[value="${zone.id}"]`)).toHaveText(zone.name);
  await expect(page.locator(`#layout-plan .plan-room[data-room="${zone.id}"]`)).toHaveCount(1);
 }
 await page.screenshot({path:testInfo.outputPath(`${variant}-separate-places.png`)});
 for(const zone of s.navigation_zones){
  await page.locator('#studio-room').selectOption(zone.id);await page.locator('#room-walk').click();
  await expect.poll(()=>page.evaluate(()=>window.__walkthrough.getState().locked)).toBe(true);
  const state=await page.evaluate(()=>window.__walkthrough.getState());expect(state.standing).toBe(true);
  expect(pointInRoom(zone,state.position[0],state.position[2])).toBe(true);
  await expect(page.locator('#studio-room')).toHaveValue(zone.id);
  await expect(page.locator('#minimap-room')).toHaveText(zone.name);
  await expect(page.locator('#room')).toHaveText(zone.name);
  expect((await page.evaluate(()=>window.__studio.inspect())).roomId).toBe('living-kitchen-hall');
  await page.evaluate(()=>document.exitPointerLock());await expect.poll(()=>page.evaluate(()=>window.__walkthrough.getState().locked)).toBe(false);
 }
 const o=s.openings.find(o=>o.id==='door-00'),[x,z]=o.center_m;
 const collision=await page.evaluate(({x,z})=>{
  const stand=(x,z)=>{try{window.__walkthrough.place(x,z,x,z-1);return true;}catch{return false;}};
  return {approach:stand(x,z+.5),leftWall:stand(x-.72,z+.14),rightWall:stand(x+.72,z+.14)};
 },{x,z});
 expect(collision).toEqual({approach:true,leftWall:false,rightWall:false});
 await page.evaluate(({x,z})=>window.__walkthrough.place(x,z+.5,x,z),{x,z});
 expect(await page.evaluate(()=>window.__walkthrough.pickDoor())).toBe(`archisketch:112a:${variant}:door-00`);
 await page.evaluate(()=>window.__walkthrough.interact());
 await expect.poll(()=>page.evaluate(id=>window.__walkthrough.getState().doors.find(d=>d.id===id).progress,`archisketch:112a:${variant}:door-00`),{timeout:30000}).toBeCloseTo(1,3);
 await page.screenshot({path:testInfo.outputPath(`${variant}-one-meter-entry.png`)});
 await page.locator('#studio-room').selectOption('kitchen');await page.locator('#room-edit').click();
 await page.locator('#selected-item').selectOption('living-coffee-table');
 expect((await page.evaluate(()=>window.__studio.inspect())).roomId).toBe('living-kitchen-hall');
 expect(errors).toEqual([]);
});
