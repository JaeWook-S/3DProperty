import {test,expect} from '@playwright/test';
import fs from 'node:fs';
const output=new URL(process.env.PAIRED_REVIEW_OUTPUT||'../runtime/paired-floor-review/2026-10-26/',import.meta.url);
fs.mkdirSync(output,{recursive:true});
const state=page=>page.evaluate(()=>window.__pairedFloor.inspect());
async function moveTo(page,point){return page.evaluate(point=>{const w=window.__pairedFloor,s=w.inspect();w.move(point[0]-s.position[0],point[1]-s.position[2]);const current=w.inspect();return {position:current.position,standing:current.standing,distance:Math.hypot(current.position[0]-point[0],current.position[2]-point[1])};},point);}
async function aim(page,point){const frames=await page.evaluate(point=>{const w=window.__pairedFloor,s=w.inspect();w.look(Math.atan2(s.position[0]-point[0],s.position[2]-point[1]),0);return s.frames;},point);await expect.poll(async()=>(await state(page)).frames).toBeGreaterThan(frames);}
async function doorProgress(page,id,progress){await expect.poll(async()=>(await state(page)).doors.find(door=>door.id===id).progress,{timeout:15000}).toBeCloseTo(progress,3);}
for(const variant of ['basic','expanded'])test(`paired ${variant}: two actual units, shared hall and collision-aware elevator`,async({page})=>{
  test.setTimeout(180000);const errors=[],downloads=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/\.glb(?:\?|$)/.test(request.url())&&!request.url().includes('?import'))downloads.push(request.url());});
  await page.goto(`/paired-floor-review.html?variant=${variant}&test=1`);
  await expect(page.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:90000});
  await expect(page.locator('h1')).toHaveText('168C · 211A 공용층 시범');
  const before=await state(page);expect(before.units.map(unit=>unit.id).sort()).toEqual(['168c','211a']);
  expect(before.units.every(unit=>unit.scale.join(',')==='1,1,1')).toBe(true);expect(before.eyeHeight).toBe(1.6);expect(before.bodyWidth).toBe(.44);
  expect(new Set(downloads).size).toBe(2);expect(downloads.some(url=>url.includes('/211a/'))).toBe(true);expect(downloads.some(url=>url.includes('/168c/'))).toBe(true);
  await page.screenshot({path:new URL(`${variant}-overview.png`,output).pathname});
  await page.locator('#walk-hall').click();expect((await state(page)).mode).toBe('walk');expect((await state(page)).standing).toBe(true);
  const layout=before.layout,elevator=layout.commonArea.elevator,[nx,nz]=elevator.doorNormal,door=elevator.doorCenter;
  // The fixture normal points out of the car and into the shared hall.
  const outside=[door[0]+nx*.9,door[1]+nz*.9],inside=layout.spawns.elevator;
  expect(await page.evaluate(point=>window.__pairedFloor.place(...point),outside)).toBe(true);
  await aim(page,door);expect(await page.evaluate(()=>window.__pairedFloor.pickDoor())).toBe('paired-floor:elevator');
  const closed=await moveTo(page,inside);expect(closed.distance).toBeGreaterThan(.4);expect(closed.standing).toBe(true);
  await page.evaluate(point=>window.__pairedFloor.place(...point),outside);await aim(page,door);
  expect(await page.evaluate(()=>window.__pairedFloor.interact())).toBe(true);await doorProgress(page,'paired-floor:elevator',1);
  const crossed=await moveTo(page,inside);expect(crossed.distance).toBeLessThan(.03);expect(crossed.standing).toBe(true);
  await aim(page,layout.spawns.hall);await page.screenshot({path:new URL(`${variant}-elevator.png`,output).pathname});
  await page.evaluate(()=>window.__pairedFloor.door('paired-floor:elevator',false));await doorProgress(page,'paired-floor:elevator',0);
  const blocked=await moveTo(page,outside);expect(blocked.distance).toBeGreaterThan(.4);expect(blocked.standing).toBe(true);
  await page.evaluate(()=>window.__pairedFloor.door('paired-floor:elevator',true));await doorProgress(page,'paired-floor:elevator',1);
  expect((await moveTo(page,outside)).distance).toBeLessThan(.03);
  // Walk continuously from the elevator to each original entrance; no unit
  // shortcut is used in these routes. The closed exported leaves must block.
  expect((await moveTo(page,layout.spawns.hall)).distance).toBeLessThan(.03);
  for(const id of ['211a','168c']){
    const unit=before.units.find(unit=>unit.id===id),entry=unit.entryWorld;
    const outsideEntry=[-1.28,entry[1]],insideEntry=[id==='211a'?.7:1.3,entry[1]],entryId=`paired-floor:${id}:${variant}:door-00`;
    expect((await moveTo(page,outsideEntry)).distance).toBeLessThan(.03);
    await aim(page,entry);expect(await page.evaluate(()=>window.__pairedFloor.pickDoor())).toBe(entryId);
    const closedEntry=await moveTo(page,insideEntry);expect(closedEntry.distance).toBeGreaterThan(.6);expect(closedEntry.standing).toBe(true);
    expect((await moveTo(page,outsideEntry)).distance).toBeLessThan(.03);await aim(page,entry);
    expect(await page.evaluate(()=>window.__pairedFloor.interact())).toBe(true);await doorProgress(page,entryId,1);
    const entered=await moveTo(page,insideEntry);console.log(variant,id,'entry-crossing',entered);expect(entered.distance).toBeLessThan(.03);expect(entered.standing).toBe(true);
    await aim(page,[insideEntry[0]+2,insideEntry[1]]);await page.screenshot({path:new URL(`${variant}-${id}-interior.png`,output).pathname});
    await page.evaluate(id=>window.__pairedFloor.door(id,false),entryId);await doorProgress(page,entryId,0);
    const returnClosed=await moveTo(page,outsideEntry);expect(returnClosed.distance).toBeGreaterThan(.5);expect(returnClosed.standing).toBe(true);
    expect((await moveTo(page,insideEntry)).distance).toBeLessThan(.03);await aim(page,entry);
    expect(await page.evaluate(()=>window.__pairedFloor.pickDoor())).toBe(entryId);
    expect(await page.evaluate(()=>window.__pairedFloor.interact())).toBe(true);await doorProgress(page,entryId,1);
    expect((await moveTo(page,outsideEntry)).distance).toBeLessThan(.03);expect((await moveTo(page,layout.spawns.hall)).distance).toBeLessThan(.03);
  }
  await page.screenshot({path:new URL(`${variant}-hall-return.png`,output).pathname});
  expect(errors).toEqual([]);
  fs.writeFileSync(new URL(`${variant}-review.json`,output),JSON.stringify({pass:true,before,after:await state(page),downloads:[...new Set(downloads)],errors},null,2)+'\n');
});

test('paired review: 390px controls, door action, and both-variant switching',async({page})=>{
  test.setTimeout(180000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:390,height:844});
  await page.goto('/paired-floor-review.html?variant=expanded');
  await expect(page.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:90000});
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await page.locator('#walk-hall').click();
  await expect(page.locator('#interaction')).toBeVisible();await page.locator('#interaction').click();await doorProgress(page,'paired-floor:elevator',1);
  const hall=(await state(page)).layout.spawns.hall;
  expect((await state(page)).standing).toBe(true);
  await page.screenshot({path:new URL('mobile-390-walk.png',output).pathname,fullPage:true});
  await page.locator('#variant').selectOption('basic');await expect(page.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:90000});
  expect((await state(page)).variant).toBe('basic');expect((await state(page)).mode).toBe('overview');
  expect((await state(page)).units.map(unit=>unit.id).sort()).toEqual(['168c','211a']);
  const width=await page.evaluate(()=>document.documentElement.scrollWidth);expect(width).toBeLessThanOrEqual(390);
  await page.screenshot({path:new URL('mobile-390-basic.png',output).pathname,fullPage:true});
  expect(errors).toEqual([]);
  fs.writeFileSync(new URL('mobile-390-review.json',output),JSON.stringify({pass:true,viewport:390,hall,state:await state(page),errors},null,2)+'\n');
});
