import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
for(const variant of ['basic','expanded'])test(`112A ${variant}: adult-width continuous kitchen and sliding passage`,async({page},info)=>{
 test.setTimeout(240000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`/?studio=0&variant=112a-${variant}-archisketch&test=1&quality=light`);
 await expect(page.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:90000});
 const state=()=>page.evaluate(()=>window.__walkthrough.getState());const baseline=await state();expect(baseline.bodyRadius).toBe(.22);expect(baseline.eyeHeight).toBe(1.6);expect(baseline.scale).toEqual([1,1,1]);
 const paths=variant==='basic'?[[8.0,5.55],[7.85,5.55],[7.85,3.25],[7.85,2.8],[8.3,2.8]]:[[7.7,5.65],[7.7,2.8],[7.48,2.8],[7.48,1.1],[8.3,1.1]];
 await page.evaluate(p=>window.__walkthrough.place(...p,...p),paths[0]);
 await page.locator('#body-width').evaluate(el=>{el.value='50';el.dispatchEvent(new Event('input',{bubbles:true}));});expect((await state()).bodyRadius).toBe(.25);
 for(const p of paths.slice(1)){
  const result=await page.evaluate(([x,z])=>{const w=window.__walkthrough,s=w.getState();w.move(x-s.position[0],z-s.position[2]);return w.getState();},p);
  console.log(variant,'path',p,'reached',result.position);expect(result.position[0]).toBeCloseTo(p[0],2);expect(result.position[2]).toBeCloseTo(p[1],2);expect(result.standing).toBe(true);
 }
 await page.screenshot({path:info.outputPath(`${variant}-kitchen-reached.png`)});
 const cases=variant==='basic'?[
  {id:'sliding-20',x:12.593,from:2.18,target:1.44,to:1.05},
  {id:'sliding-11',x:12.54,from:4.98,target:4.37,to:3.80},
  {id:'sliding-10',x:7.477,from:2.30,target:1.44,to:.85},
 ]:[{id:'sliding-10',x:12.39,from:4.95,target:4.316,to:3.75}];
 const results=[];
 for(const c of cases){
  await page.evaluate(c=>window.__walkthrough.place(c.x,c.from,c.x,c.target),c);
  const doorId=`archisketch:112a:${variant}:${c.id}`;
  await page.evaluate(()=>window.__walkthrough.look(0));expect(await page.evaluate(()=>window.__walkthrough.pickDoor())).toBe(doorId);
  await page.evaluate(c=>window.__walkthrough.move(0,c.to-c.from),c);expect((await state()).position[2]).toBeGreaterThan(c.target+.23);
  await page.evaluate(c=>window.__walkthrough.place(c.x,c.from,c.x,c.target),c);await page.evaluate(()=>{window.__walkthrough.look(0);window.__walkthrough.interact();});
  await expect.poll(async()=>(await state()).doors.find(d=>d.id===doorId).progress,{timeout:30000}).toBeCloseTo(1,3);
  await page.evaluate(c=>window.__walkthrough.move(0,c.to-c.from),c);let s=await state();expect(s.position[2]).toBeCloseTo(c.to,2);expect(s.standing).toBe(true);
  await page.screenshot({path:info.outputPath(`${variant}-${c.id}-passed.png`)});
  await page.evaluate(c=>window.__walkthrough.move(0,c.from-c.to),c);s=await state();expect(s.position[2]).toBeCloseTo(c.from,2);expect(s.standing).toBe(true);results.push({id:doorId,passed_both_directions:true,body_width_m:.50});
 }
 writeFileSync(info.outputPath(`${variant}-routes.json`),JSON.stringify({variant,baseline,paths,sliding:results,errors},null,2));expect(errors).toEqual([]);
});
