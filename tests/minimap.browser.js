import {test,expect} from '@playwright/test';

const state=page=>page.evaluate(()=>window.__walkthrough.getState());
async function readyStudio(page) {
 await page.goto('/?studio=1&test=1&quality=light');
 await expect(page.locator('body')).toHaveAttribute('data-studio-mode','complex',{timeout:90000});
 await expect(page.locator('#walk-minimap')).toBeHidden();
 await page.locator('#select-building').click();await page.locator('#open-unit').click();
 await expect(page.locator('body')).toHaveAttribute('data-studio-mode','overview');
 await expect(page.locator('#walk-minimap')).toBeHidden();
}
async function markerMatches(page) {
 await expect.poll(()=>page.evaluate(()=>{
  const marker=document.querySelector('#minimap-position'),p=window.__walkthrough.getState().position;
  return Math.abs(Number(marker.dataset.x)-p[0])<1e-6&&Math.abs(Number(marker.dataset.z)-p[2])<1e-6;
 })).toBe(true);
}

test('minimap follows real position, heading, furniture edits and the active floor plan',async({page},info)=>{
 test.setTimeout(240000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await readyStudio(page);
 await page.locator('#studio-room').selectOption('Bedroom west');await page.locator('#room-walk').click();
 await expect.poll(async()=>(await state(page)).locked).toBe(true);
 await expect(page.locator('#walk-minimap')).toBeVisible();
 await expect(page.locator('#minimap-room')).toHaveText('작은 방 1');
 await expect(page.locator('#walk-minimap')).toHaveAttribute('data-variant','expanded');
 await markerMatches(page);
 const start=await state(page);
 await page.keyboard.down('w');
 await expect.poll(async()=>(await state(page)).position[2],{timeout:15000}).toBeGreaterThan(start.position[2]+.12);
 await page.keyboard.up('w');await markerMatches(page);
 await page.evaluate(()=>window.__walkthrough.look(Math.PI/2));
 await expect.poll(()=>page.locator('#minimap-position').getAttribute('data-heading').then(Number)).toBeCloseTo(-90,4);
 const before=await state(page);
 await page.keyboard.press('m');await expect(page.locator('#minimap-content')).toBeHidden();
 await page.keyboard.press('m');await expect(page.locator('#minimap-content')).toBeVisible();
 expect((await state(page)).position).toEqual(before.position);
 expect((await state(page)).scale).toEqual([1,1,1]);
 await page.screenshot({path:info.outputPath('01-pc-walk-minimap.png')});
 await page.evaluate(()=>document.exitPointerLock());
 await page.locator('#minimap-toggle').click();await expect(page.locator('#minimap-content')).toBeHidden();
 await page.locator('#minimap-toggle').click();await expect(page.locator('#minimap-content')).toBeVisible();
 await page.locator('#studio-room').selectOption('Living front');await page.locator('#room-edit').click();
 await expect(page.locator('#walk-minimap')).toBeHidden();
 await page.locator('#selected-item').selectOption('catalog-stool-980');
 const initial=(await page.evaluate(()=>window.__studio.inspect())).items.find(i=>i.id==='catalog-stool-980');
 await page.locator('#item-x').fill(String(initial.x-.35));await page.locator('#apply-position').click();
 await page.locator('#room-walk').click();
 await expect(page.locator('#walk-minimap')).toBeVisible();
 await expect.poll(()=>page.locator('#minimap-plan [data-item="catalog-stool-980"]').evaluate(node=>{
  const p=node.getAttribute('points').split(' ').map(v=>v.split(',').map(Number));return p.reduce((s,v)=>s+v[0],0)/4;
 })).toBeCloseTo(initial.x-.35,4);
 await page.evaluate(()=>document.exitPointerLock());
 await page.locator('#nav-complex').click();await expect(page.locator('#walk-minimap')).toBeHidden();
 await page.locator('#select-building').click();await page.locator('#studio-variant').selectOption('basic');await page.locator('#open-unit').click();
 await expect(page.locator('body')).toHaveAttribute('data-studio-mode','overview',{timeout:90000});
 await page.locator('#studio-room').selectOption('Bedroom center');await page.locator('#room-walk').click();
 await expect(page.locator('#walk-minimap')).toHaveAttribute('data-variant','basic');
 await expect.poll(()=>page.locator('#minimap-plan [data-room="Bedroom center"] rect').getAttribute('height').then(Number)).toBeCloseTo(2.593,4);
 await expect(page.locator('#minimap-room')).toHaveText('작은 방 2');await markerMatches(page);
 expect((await state(page)).standing).toBe(true);expect(errors).toEqual([]);
 await page.screenshot({path:info.outputPath('02-basic-minimap.png')});
});

test.describe('touch minimap',()=>{
 test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 test('map controls coexist with phone movement and do not steal look gestures',async({page},info)=>{
  test.setTimeout(180000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?studio=0&test=1&quality=light');
  await expect(page.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:90000});
  await expect(page.locator('#walk-minimap')).toBeHidden();
  await page.locator('#start').tap();await expect.poll(async()=>(await state(page)).touchWalking).toBe(true);
  await expect(page.locator('#walk-minimap')).toBeVisible();await markerMatches(page);
  const map=await page.locator('#walk-minimap').boundingBox();
  const overlaps=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
  for(const selector of ['.touch-top','.touch-stick'])expect(overlaps(map,await page.locator(selector).boundingBox())).toBe(false);
  expect(map.x).toBeGreaterThanOrEqual(0);expect(map.x+map.width).toBeLessThanOrEqual(390);
  expect(map.y+map.height).toBeLessThanOrEqual(844);
  await page.locator('#minimap-toggle').tap();await expect(page.locator('#minimap-content')).toBeHidden();
  expect((await state(page)).touchWalking).toBe(true);
  await page.locator('#minimap-toggle').tap();await expect(page.locator('#minimap-content')).toBeVisible();
  // A finger dragged on the map drawing reaches the look layer underneath.
  const svg=await page.locator('#minimap-plan').boundingBox(),cdp=await page.context().newCDPSession(page);
  const send=(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:1}]});
  const before=await state(page),x=svg.x+svg.width*.8,y=svg.y+svg.height*.5;
  await send('touchStart',x,y);
  for(let i=1;i<=4;i++)await send('touchMove',x-i*12,y);
  await send('touchEnd');
  const after=await state(page);expect(Math.abs(after.yaw-before.yaw)).toBeGreaterThan(.1);
  await expect.poll(()=>page.locator('#minimap-position').getAttribute('data-heading').then(Number)).toBeCloseTo(-after.yaw*180/Math.PI,4);
  expect(after.position).toEqual(before.position);
  const stick=await page.locator('.touch-stick').boundingBox(),sx=stick.x+stick.width/2,sy=stick.y+stick.height/2;
  await send('touchStart',sx,sy);await send('touchMove',sx,sy-80);
  await expect.poll(async()=>Math.hypot((await state(page)).position[0]-before.position[0],(await state(page)).position[2]-before.position[2]),{timeout:15000}).toBeGreaterThan(.08);
  await send('touchEnd');await markerMatches(page);
  await page.screenshot({path:info.outputPath('03-phone-minimap.png')});
  await page.locator('.touch-exit').tap();await expect(page.locator('#walk-minimap')).toBeHidden();
  expect(errors).toEqual([]);
 });
});

test.describe('short touch viewport',()=>{
 test.use({viewport:{width:844,height:390},isMobile:true,hasTouch:true});
 test('landscape map starts folded and fits clear of touch controls when opened',async({page},info)=>{
  await page.goto('/?studio=0&test=1&quality=light');
  await expect(page.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:90000});
  await page.locator('#start').tap();await expect(page.locator('#walk-minimap')).toBeVisible();
  await expect(page.locator('#minimap-content')).toBeHidden();
  await page.locator('#minimap-toggle').tap();await expect(page.locator('#minimap-content')).toBeVisible();
  await page.evaluate(()=>window.__walkthrough.place(4.938,4.8,4.938,5.525));
  await expect(page.locator('.touch-action')).toBeVisible();
  const map=await page.locator('#walk-minimap').boundingBox();
  for(const selector of ['.touch-action','.touch-stick','.touch-top']){
   const b=await page.locator(selector).boundingBox();
   expect(map.x<b.x+b.width&&b.x<map.x+map.width&&map.y<b.y+b.height&&b.y<map.y+map.height).toBe(false);
  }
  expect(map.y+map.height).toBeLessThanOrEqual(390);
  await page.screenshot({path:info.outputPath('04-landscape-minimap.png')});
 });
});
