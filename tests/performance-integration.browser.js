import {test,expect} from '@playwright/test';
const state=page=>page.evaluate(()=>window.__walkthrough.getState());
async function openUnit(page,variant='expanded'){
 await page.goto('/?studio=1&test=1&variant='+variant);
 await expect(page.locator('body')).toHaveAttribute('data-studio-mode','complex',{timeout:90000});
 await page.locator('#select-building').click();await page.locator('#open-unit').click();
 await expect(page.locator('body')).toHaveAttribute('data-studio-mode','overview');
}
async function settle(page){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r)))));}
test('static batching, cached orbit shadows and live furniture shadows preserve the editor',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openUnit(page);await settle(page);
 const before=await state(page);
 expect(before.quality).toBe('balanced');
 expect(before.batching.savedDraws).toBeGreaterThan(150);
 const rect=await page.locator('#viewport canvas').boundingBox();
 await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);
 await page.mouse.down();await page.mouse.move(rect.x+rect.width/2+90,rect.y+rect.height/2+10,{steps:8});await page.mouse.up();await settle(page);
 const orbit=await state(page);
 expect(orbit.renderStats.frames).toBeGreaterThan(before.renderStats.frames);
 expect(orbit.renderStats.shadowUpdates).toBe(before.renderStats.shadowUpdates);
 expect(orbit.renderStats.calls).toBeLessThan(350);
 await page.locator('#room-edit').click();await settle(page);
 const original=await page.evaluate(()=>window.__studio.inspect());
 const item=original.items.find(i=>i.id===original.selection);
 const count=(await state(page)).renderStats.shadowUpdates;
 await page.locator('#item-x').fill(String(item.x+.05));await page.locator('#apply-position').click();await settle(page);
 const moved=await page.evaluate(()=>window.__studio.inspect());
 const after=moved.items.find(i=>i.id===item.id);
 expect(after.width).toBe(item.width);expect(after.depth).toBe(item.depth);
 expect(after.x).toBeCloseTo(item.x+.05);
 expect((await state(page)).renderStats.shadowUpdates).toBeGreaterThan(count);
 expect(errors).toEqual([]);
});
for(const variant of ['basic','expanded'])test('coordinate '+variant+': all concepts, palette, saved layout and reset',async({page},testInfo)=>{
 test.setTimeout(180000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openUnit(page,variant);
 await page.locator('#mode-concepts').click();
 await expect(page.locator('.concept-card')).toHaveCount(4);
 const initial=await page.evaluate(()=>window.__studio.inspect().items);
 for(const id of ['family-lounge','kids-play','newlywed','wfh-studio']){
  expect(await page.evaluate(id=>window.__concepts.apply(id),id)).toBe(true);
  await expect(page.locator('body')).toHaveAttribute('data-finish-state','ready');
  const current=await page.evaluate(()=>window.__studio.inspect());
  expect(current.items.filter(i=>!i.deleted&&i.id.startsWith('added-')).length).toBeGreaterThanOrEqual(5);
  expect(current.warnings.flatMap(w=>w.messages.filter(m=>!m.includes('60cm')))).toEqual([]);
 }
 await page.evaluate(()=>window.__concepts.setPalette('walnut-navy'));
 await expect(page.locator('body')).toHaveAttribute('data-finish-state','ready');
 expect(await page.evaluate(()=>window.__concepts.colors().fabric)).toBe('#34435c');
 await page.locator('#mode-edit').click();await page.locator('#save-layout').click();
 await page.locator('#reset-layout').click();await page.locator('#restore-layout').click();
 expect(await page.evaluate(()=>window.__concepts.state().applied)).toEqual({concept:'wfh-studio',palette:'walnut-navy'});
 await page.locator('#mode-concepts').click();await settle(page);
 await page.screenshot({path:testInfo.outputPath(variant+'-concept.png')});
 await page.evaluate(()=>window.__concepts.clear());
 const reset=await page.evaluate(()=>window.__studio.inspect().items);
 expect(reset.map(i=>[i.id,i.width,i.depth,i.x,i.z,i.deleted])).toEqual(initial.map(i=>[i.id,i.width,i.depth,i.x,i.z,i.deleted]));
 expect(errors).toEqual([]);
});
test.describe('phone coordinate model',()=>{
 test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
 test('touch walking and theme switching use the current 112A model',async({page},testInfo)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await openUnit(page);
  await page.locator('#room-walk').tap();
  await expect.poll(async()=>(await state(page)).touchWalking).toBe(true);
  const before=await state(page);
  await page.touchscreen.tap(300,350);
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:300,y:350,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:245,y:350,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  expect(Math.abs((await state(page)).yaw-before.yaw)).toBeGreaterThan(.1);
  await page.locator('.wt-toggle').tap();
  await page.locator('.wt-theme[data-theme="newlywed"]').tap();
  await expect(page.locator('body')).toHaveAttribute('data-finish-state','ready');
  expect(await page.evaluate(()=>window.__concepts.state().applied.concept)).toBe('newlywed');
  expect((await state(page)).standing).toBe(true);
  await page.screenshot({path:testInfo.outputPath('phone-theme.png')});
  expect(errors).toEqual([]);
 });
});
