import {test,expect} from '@playwright/test';
const state=page=>page.evaluate(()=>window.__walkthrough.getState());
test('168C finishes, room navigation and return to both 112A models',async({page},info)=>{
 test.setTimeout(180000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/?studio=1&variant=168c-expanded&test=1&quality=light');
 await expect(page.locator('body')).toHaveAttribute('data-studio-mode','complex',{timeout:90000});
 await expect(page.locator('#studio-variant')).toHaveValue('168c-expanded');
 await page.locator('#select-building').click();await page.locator('#open-unit').click();
 await expect(page.locator('body')).toHaveAttribute('data-studio-mode','overview');
 await expect(page.locator('#studio-model')).toHaveValue('168c-expanded');
 await expect(page.locator('#nav-plan')).toHaveText('168C · 확장형');
 const viewbox=(await page.locator('#layout-plan').getAttribute('viewBox')).split(' ').map(Number);expect(viewbox[2]).toBeGreaterThan(20);
 expect((await state(page)).standing).toBe(true);expect((await state(page)).scale).toEqual([1,1,1]);
 expect((await state(page)).doors.filter(d=>d.type==='sliding')).toHaveLength(2);
 await page.screenshot({path:info.outputPath('168c-overview.png')});
 for(const room of ['living','kitchen','bedroom-1','bedroom-2','bedroom-3','primary-bedroom','bathroom-1','primary-bathroom','pantry','primary-balcony','living-balcony']){
  await page.locator('#studio-room').selectOption(room);await page.locator('#room-walk').click();
  await expect.poll(async()=>(await state(page)).locked).toBe(true);
  expect((await state(page)).standing,room).toBe(true);
  await expect(page.locator('#minimap-variant')).toHaveText('168C · 확장형');
  if(room==='living')await page.screenshot({path:info.outputPath('168c-living.png')});
  await page.evaluate(()=>document.exitPointerLock());
 }
 await page.locator('#studio-room').selectOption('living');await page.locator('#room-edit').click();
 await page.locator('#add-kind').selectOption('armchair');await page.locator('#add-item').click();
 const placed=await page.evaluate(()=>window.__studio.inspect());expect(placed.items.some(i=>i.kind==='armchair')).toBe(true);
 await page.locator('#save-layout').click();
 await page.locator('#studio-model').selectOption('basic');
 await expect.poll(async()=>(await state(page)).variant,{timeout:90000}).toBe('basic');
 expect((await state(page)).standing).toBe(true);
 await expect(page.locator('#studio-room option[value="Bedroom center"]')).toHaveCount(1);
 await page.locator('#studio-model').selectOption('expanded');
 await expect.poll(async()=>(await state(page)).variant,{timeout:90000}).toBe('expanded');expect((await state(page)).standing).toBe(true);
 await page.locator('#studio-model').selectOption('168c-expanded');await expect.poll(async()=>(await state(page)).variant).toBe('168c-expanded');
 await page.locator('#studio-room').selectOption('living');await expect(page.locator('body')).toHaveAttribute('data-studio-mode','edit');await page.locator('#restore-layout').click();
 expect((await page.evaluate(()=>window.__studio.inspect())).items.some(i=>i.kind==='armchair')).toBe(true);
 expect((await state(page)).visibleVariants).toBe(1);expect(errors).toEqual([]);
});

test('168C pantry hinge and both balcony sliders open real collision gaps',async({page})=>{
 test.setTimeout(240000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/?studio=0&variant=168c-expanded&test=1&quality=light');
 await expect(page.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:90000});
 const cases=[
  {id:'168c-door:pantry-door',from:[11.65,10.017],target:[12.492,10.017],delta:[1.48,0],axis:0,limit:12.3,passed:12.8},
  {id:'168c-door:living-window-2',from:[17.92,9.08],target:[17.92,9.989],delta:[0,1.65],axis:2,limit:9.85,passed:10.3},
  {id:'168c-door:primary-balcony-opening',from:[17.52,3.26],target:[18.43,3.26],delta:[1.65,0],axis:0,limit:18.3,passed:18.7},
 ];
 for(const c of cases){
  await page.evaluate(c=>window.__walkthrough.place(...c.from,...c.target),c);
  await page.evaluate(c=>window.__walkthrough.move(...c.delta),c);
  expect((await state(page)).position[c.axis],c.id+' blocks walking when closed').toBeLessThan(c.limit);
  await page.evaluate(c=>window.__walkthrough.place(...c.from,...c.target),c);
  expect(await page.evaluate(()=>window.__walkthrough.pickDoor())).toBe(c.id);
  await page.evaluate(()=>window.__walkthrough.interact());
  await expect.poll(async()=>(await state(page)).doors.find(d=>d.id===c.id).progress,{timeout:60000,message:c.id+' opens'}).toBeCloseTo(1,3);
  await page.evaluate(c=>window.__walkthrough.move(...c.delta),c);
  expect((await state(page)).position[c.axis],c.id+' permits walking when open').toBeGreaterThan(c.passed);
  expect((await state(page)).standing).toBe(true);
 }
 expect(errors).toEqual([]);
});

test.describe('168C on a phone',()=>{
 test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 test('touch walking uses 168C room map and body scale',async({page},info)=>{
  await page.goto('/?studio=1&variant=168c-expanded&test=1&quality=light');
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode','complex',{timeout:90000});
  await page.locator('#select-building').tap();await page.locator('#open-unit').tap();
  await page.locator('#studio-room').selectOption('bedroom-2');await page.locator('#room-walk').tap();
  await expect.poll(async()=>(await state(page)).touchWalking).toBe(true);
  await expect(page.locator('#minimap-room')).toHaveText('침실 2');expect((await state(page)).standing).toBe(true);
  await page.screenshot({path:info.outputPath('168c-mobile.png')});
 });
});
