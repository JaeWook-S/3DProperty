import {test,expect} from '@playwright/test';
const state = page => page.evaluate(() => window.__walkthrough.getState());
const keys = ['168c-basic-archisketch','168c-expanded-archisketch'];

test('both Archisketch homes: selection, room tour, staging and isolated saved layouts', async ({page}, info) => {
  test.setTimeout(360000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?studio=1&variant=168c-basic-archisketch&test=1&quality=light');
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode','complex',{timeout:90000});
  await page.locator('#select-building').click();
  await expect(page.locator('#studio-variant option')).toHaveCount(4);
  await page.locator('#open-unit').click();
  for (const key of keys) {
    await page.locator('#studio-model').selectOption(key);
    await expect.poll(async()=>(await state(page)).variant,{timeout:60000}).toBe(key);
    await expect(page.locator('#variant')).toHaveValue(key);
    await expect(page.locator('#studio-variant')).toHaveValue(key);
    expect((await state(page)).scale).toEqual([1,1,1]);
    expect((await state(page)).standing).toBe(true);
    await expect(page.locator('#finish')).toBeEnabled();
    await expect(page.locator('#studio-dimension-note')).toContainText('아키스케치');
    await expect(page.locator('#layout-plan polygon')).not.toHaveCount(0);
    expect(await page.locator('.plan-walls path').count()).toBeGreaterThan(0);
    expect(await page.locator('.plan-fixed').count()).toBeGreaterThan(10);
    expect((await page.evaluate(()=>window.__studio.inspect())).items.find(i=>i.kind==='sofa').width).toBeCloseTo(2.79,3);
    await page.locator('#nav-plan').click();
    await page.screenshot({path:info.outputPath(key+'-overview.png')});
    for(const room of ['living-kitchen-hall','bedroom-1','bedroom-2','bedroom-3','primary','bathroom-1','primary-bath','primary-balcony','living-balcony',key===keys[0]?'bedroom-balcony':'kitchen-pantry']) {
      await page.locator('#studio-room').selectOption(room);
      await page.locator('#room-walk').click();
      await expect.poll(async()=>(await state(page)).locked).toBe(true);
      expect((await state(page)).standing,room).toBe(true);
      await expect(page.locator('#walk-minimap')).toHaveAttribute('data-room',room,{timeout:20000});
      await expect(page.locator('.minimap-walls rect')).toHaveCount(0);
      if(room==='bedroom-2'||room==='living-kitchen-hall') await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      if(room==='bedroom-2'||room==='living-kitchen-hall') await page.screenshot({path:info.outputPath(key+'-'+room+'-walk.png')});
      await page.evaluate(()=>document.exitPointerLock());
      await expect.poll(async()=>(await state(page)).locked,{timeout:20000}).toBe(false);
    }
    await page.locator('#studio-room').selectOption('living-kitchen-hall');
    await page.locator('#room-edit').click();
    await page.locator('#add-kind').selectOption('coffee-table');await page.locator('#add-item').click();
    expect((await page.evaluate(()=>window.__studio.inspect())).items.filter(i=>!i.deleted)).toHaveLength(3);
    await page.locator('#item-x').fill('16.5');await page.locator('#apply-position').click();
    const placed=await page.evaluate(()=>window.__studio.inspect());
    expect(placed.positions.find(p=>p.id===placed.selection).position[0]).toBe(16.5);
    await page.locator('#save-layout').click();
    await page.locator('#nav-plan').click();
  }
  await page.locator('#studio-model').selectOption(keys[0]);
  await expect.poll(async()=>(await state(page)).variant).toBe(keys[0]);
  await page.locator('#studio-room').selectOption('living-kitchen-hall');await page.locator('#room-edit').click();
  await page.locator('#restore-layout').click();
  expect((await page.evaluate(()=>window.__studio.inspect())).items.filter(i=>!i.deleted)).toHaveLength(3);
  for (const key of ['112a-basic-archisketch','112a-expanded-archisketch','168c-expanded-archisketch']) {
    await page.locator('#studio-model').selectOption(key);
    await expect.poll(async()=>(await state(page)).variant,{timeout:90000}).toBe(key);
    expect((await state(page)).standing).toBe(true);
    await expect(page.locator('#finish')).toBeEnabled();
  }
  expect((await state(page)).visibleVariants).toBe(1);expect(errors).toEqual([]);
});

test('new door leaves open from the saved closed pose in the real viewer',async({page})=>{
  test.setTimeout(120000);
  await page.goto('/?studio=0&variant=168c-expanded-archisketch&test=1&quality=light');
  await expect(page.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:90000});
  for(const c of [
    {id:'door-05',from:[6.645,5.629],target:[6.645,6.379],delta:[0,1.5],axis:2,edge:6.379},
    {id:'primary-balcony-door',from:[18.569,2.6795],target:[19.319,2.6795],delta:[1.5,0],axis:0,edge:19.319},
  ]) {
    await page.evaluate(c=>window.__walkthrough.place(...c.from,...c.target),c);
    await page.evaluate(c=>window.__walkthrough.move(...c.delta),c);
    expect((await state(page)).position[c.axis]).toBeLessThan(c.edge);
    await page.evaluate(c=>window.__walkthrough.place(...c.from,...c.target),c);
    expect(await page.evaluate(()=>window.__walkthrough.pickDoor())).toBe('archisketch:expanded:'+c.id);
    await page.evaluate(()=>window.__walkthrough.interact());
    await expect.poll(async()=>(await state(page)).doors.find(d=>d.id==='archisketch:expanded:'+c.id).progress,{timeout:30000}).toBeCloseTo(1,3);
    await page.evaluate(c=>window.__walkthrough.move(...c.delta),c);
    expect((await state(page)).position[c.axis]).toBeGreaterThan(c.edge+.65);
  }
});

test('service cards expose all four current models with working previews and studio links',async({page})=>{
  await page.goto('http://127.0.0.1:5185/');
  for(const key of ['112a-basic-archisketch','112a-expanded-archisketch',...keys]){
    await page.locator(`[name="variant"][value="${key}"]`).check();
    await expect(page.locator('#variant-description')).toContainText('아키스케치');
    await expect(page.locator('#open-viewer')).toHaveAttribute('href',new RegExp('variant='+key));
    await expect(page.locator('#open-studio')).toHaveAttribute('href',new RegExp('variant='+key));
    await expect.poll(()=>page.locator('#space-preview').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
    await expect(page.locator('#space-area')).toContainText(key.startsWith('112a')?'84.97':'129.96');
  }
});


test('112A updates existing links, dimensions, room walkthrough and furnished layouts with current source structure',async({page},info)=>{
  test.setTimeout(360000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?studio=1&variant=basic&test=1&quality=light');
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode','complex',{timeout:90000});
  expect((await state(page)).variant).toBe('112a-basic-archisketch');
  await page.locator('#select-building').click();
  await expect(page.locator('#studio-variant option')).toHaveCount(4);
  await page.locator('#open-unit').click();
  for(const [key,width,depth] of [['112a-basic-archisketch',2.504,2.594],['112a-expanded-archisketch',2.426,3.015]]){
    await page.locator('#studio-model').selectOption(key);
    await expect.poll(async()=>(await state(page)).variant,{timeout:60000}).toBe(key);
    await page.locator('#studio-room').selectOption('bedroom-2');
    await expect(page.locator('#studio-room-dimensions')).toContainText(`${width.toFixed(3)}m × 깊이 ${depth.toFixed(3)}m · 천장 2.60m`);
    const size=await page.evaluate(()=>window.__walkthrough.inspectRoom('bedroom-2'));
    expect(size[0]).toBeCloseTo(width,5);expect(size[2]).toBeCloseTo(depth,5);
    await page.locator('#nav-plan').click();
    await page.screenshot({path:info.outputPath(key+'-overview.png')});
    for(const room of ['bedroom-1','bedroom-2','primary','bathroom-1','primary-bath','primary-balcony','bedroom-2-balcony','living']){
      await page.locator('#studio-room').selectOption(room);await page.locator('#room-walk').click();
      await expect.poll(async()=>(await state(page)).locked).toBe(true);
      expect((await state(page)).standing,room).toBe(true);
      if(room==='bedroom-2')await page.screenshot({path:info.outputPath(key+'-'+room+'-walk.png')});
      await page.evaluate(()=>document.exitPointerLock());
      await expect.poll(async()=>(await state(page)).locked,{timeout:20000}).toBe(false);
    }
    await page.locator('#room-edit').click();
    expect((await page.evaluate(()=>window.__studio.inspect())).items.filter(i=>!i.deleted)).toHaveLength(11);
    await expect(page.locator('#finish')).toBeEnabled();
    expect((await state(page)).visibleVariants).toBe(1);
    await page.locator('#nav-plan').click();
  }
  expect(errors).toEqual([]);
});
