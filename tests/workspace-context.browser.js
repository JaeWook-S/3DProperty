import {test,expect} from '@playwright/test';

test('neighbor views and bottom workspace keep selection, placement and walk actions usable',async({page},info)=>{
 test.setTimeout(240000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1440,height:960});
 await page.goto('/?studio=1&test=1&quality=light');
 await expect(page.locator('body')).toHaveAttribute('data-studio-mode','complex',{timeout:90000});
 await page.locator('#hero-building').click();
 expect((await page.evaluate(()=>window.__studio.inspect())).buildingCount).toBe(15);
 await page.screenshot({path:info.outputPath('01-surrounding-buildings.png')});
 for(const view of ['site','river','street']){
   await page.locator(`[data-view="${view}"]`).click();
   expect((await page.evaluate(()=>window.__studio.inspect())).contextView).toBe(view);
   await page.screenshot({path:info.outputPath(`02-${view}.png`)});
 }
 await page.locator('#context-building').selectOption('B');
 await expect(page.locator('#open-unit')).toBeDisabled();
 await expect(page.locator('#floor-availability')).toContainText('외관 탐색');
 await expect(page.locator('#studio-variant')).toBeHidden();
 expect((await page.evaluate(()=>window.__studio.inspect())).buildingId).toBe('B');
 await page.locator('#context-photo').click();await expect(page.locator('#context-photo-panel')).toBeVisible();
 await page.locator('#close-context-photo').click();await expect(page.locator('#context-photo-panel')).toBeHidden();
 await page.locator('#context-building').selectOption('A');await page.locator('#floor-range').fill('22');
 await page.locator('#open-unit').click();await page.locator('#room-edit').click();
 for(const id of ['rotate-item','remove-item','save-layout','restore-layout','reset-layout','allow-overlap','placement-warnings','room-walk'])expect(await page.locator(`#${id}`).evaluate(e=>Boolean(e.closest('#editor-dock')))).toBe(true);
 await page.locator('#selected-item').selectOption('catalog-stool-980');
 await page.locator('#rotate-item').click();
 expect((await page.evaluate(()=>window.__studio.inspect())).items.find(i=>i.kind==='stool').angle).toBeCloseTo(Math.PI/2);
 await page.locator('#save-layout').click();await expect(page.locator('#dock-status')).toContainText('저장');
 await page.locator('#reset-layout').click();await page.locator('#restore-layout').click();
 expect((await page.evaluate(()=>window.__studio.inspect())).items.find(i=>i.kind==='stool').angle).toBeCloseTo(Math.PI/2);
 await page.locator('#frame-room').click();
 for(const [width,height] of [[1440,960],[900,850],[390,844]]){
   await page.setViewportSize({width,height});
   await expect.poll(async()=>{
     const p=await page.locator('#plan-pane').boundingBox(),v=await page.locator('#viewport').boundingBox(),d=await page.locator('#editor-dock').boundingBox();
     return p.y+p.height<=d.y+1&&v.y+v.height<=d.y+1&&v.height>200;
   }).toBe(true);
   for(const id of ['rotate-item','save-layout','allow-overlap','room-walk']){
     const b=await page.locator(`#${id}`).boundingBox();expect(b.x).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(width+1);expect(b.y+b.height).toBeLessThanOrEqual(height+1);
   }
   await page.screenshot({path:info.outputPath(`03-bottom-editor-${width}.png`)});
 }
 await page.setViewportSize({width:1440,height:960});
 await page.locator('#room-walk').click();await expect.poll(()=>page.evaluate(()=>window.__walkthrough.getState().locked)).toBe(true);
 await expect(page.locator('#editor-dock')).toBeHidden();
 await page.evaluate(()=>document.exitPointerLock());await page.locator('#nav-plan').click();
 expect(await page.locator('#room-walk').evaluate(e=>Boolean(e.closest('#room-picker')))).toBe(true);
 await page.locator('#nav-complex').click();await expect(page.locator('#editor-dock')).toBeHidden();
 expect(errors).toEqual([]);
});
