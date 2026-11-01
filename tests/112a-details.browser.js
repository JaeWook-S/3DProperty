import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const state=page=>page.evaluate(()=>window.__walkthrough.getState());
for(const variant of ['basic','expanded'])test(`112A ${variant}: image-based hinges permit actual bedroom entry and foyer preview`,async({page},testInfo)=>{
  test.setTimeout(180000);
  const source=JSON.parse(readFileSync(new URL(`../assets/models/acro-river-park/112a/archisketch-circulation-v5/${variant}/model-info.json`,import.meta.url)));
  const key=`112a-${variant}-archisketch`;const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`/?studio=1&variant=${key}&test=1&quality=light`);
  await expect(page.locator('body')).toHaveAttribute('data-studio-mode','complex',{timeout:90000});
  await page.locator('#select-building').click();await page.locator('#open-unit').click();
  await expect(page.locator('.plan-entry')).toHaveCount(1);
  expect((await page.locator('.plan-entry-label').boundingBox()).width).toBeLessThan(45);
  await expect(page.locator('.plan-door-swing')).toHaveCount(source.openings.filter(o=>o.kind==='door').length);
  await page.screenshot({path:testInfo.outputPath(`${variant}-plan.png`)});
  await page.locator('#studio-room').selectOption('living');await page.locator('#room-walk').click();
  await expect.poll(async()=>(await state(page)).locked).toBe(true);
  const p=variant==='basic'?[2.90,4.10,2.90,2.70]:[2.62,4.00,2.62,2.60];
  await page.evaluate(p=>window.__walkthrough.place(...p),p);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await page.screenshot({path:testInfo.outputPath(`${variant}-foyer.png`)});
  for(const door of source.openings.filter(o=>o.kind==='door'&&o.axis==='x'&&o.center_m[1]>5)){
    const [x,z]=door.center_m;
    await page.evaluate(p=>window.__walkthrough.place(...p),[x,z-.65,x,z]);
    await page.evaluate(()=>window.__walkthrough.move(0,1.5));
    expect((await state(page)).position[2]).toBeLessThan(z);
    await page.evaluate(p=>window.__walkthrough.place(...p),[x,z-.65,x,z]);
    const id=`archisketch:112a:${variant}:${door.id}`;
    expect(await page.evaluate(()=>window.__walkthrough.pickDoor())).toBe(id);
    await page.evaluate(()=>window.__walkthrough.interact());
    await expect.poll(async()=>(await state(page)).doors.find(d=>d.id===id).progress,{timeout:30000}).toBeCloseTo(1,3);
    await page.evaluate(()=>window.__walkthrough.move(0,1.5));
    expect((await state(page)).position[2]).toBeGreaterThan(z+.65);
    expect((await state(page)).standing).toBe(true);
  }
  expect(errors).toEqual([]);
});
