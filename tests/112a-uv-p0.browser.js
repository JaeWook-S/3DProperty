import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const revision='archisketch-uv-p0-v1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const variant of ['basic','expanded'])test(`112A ${variant}: UV-only candidate preserves render, finishes and50cm routes`,async({page},info)=>{
 test.setTimeout(300000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const state=()=>page.evaluate(()=>window.__walkthrough.getState());
 const url=`/?studio=0&variant=112a-${variant}-archisketch&test=1&quality=light&finish=original`;
 await page.goto(url);await expect(page.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:90000});
 const baseline=await state();const canvas=page.locator('canvas').first();
 const before=await canvas.screenshot({path:info.outputPath('v5-original.png'),mask:[page.locator('#status')]});
 const candidate=readFileSync(new URL(`../assets/models/acro-river-park/112a/${revision}/${variant}/acro112a-${variant}.glb`,import.meta.url));
 let served=0;
 await page.route(`**/assets/models/acro-river-park/112a/archisketch-circulation-v5/${variant}/acro112a-${variant}.glb*`,async route=>{served++;await route.fulfill({status:200,contentType:'model/gltf-binary',body:candidate});});
 await page.reload();await expect(page.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:90000});expect(served).toBe(1);
 const after=await state();for(const k of ['position','scale','eyeHeight','bodyRadius','horizontalFov','doors'])expect(after[k]).toEqual(baseline[k]);
 const image=await canvas.screenshot({path:info.outputPath('p0-original.png'),mask:[page.locator('#status')]});
 expect(image.equals(before),'UV-only candidate should preserve the original untextured surfaces and existing maps').toBe(true);
 for(const finish of ['oak','stone','original']){
  await page.locator('#finish').selectOption(finish);await expect(page.locator('body')).toHaveAttribute('data-finish-state','ready');expect((await state()).finish).toBe(finish);
 }
 const restored=await canvas.screenshot({path:info.outputPath('p0-restored.png'),mask:[page.locator('#status')]});expect(restored.equals(image)).toBe(true);
 const paths=variant==='basic'?[[8,5.55],[7.85,5.55],[7.85,3.25],[7.85,2.8],[8.3,2.8]]:[[7.7,5.65],[7.7,2.8],[7.48,2.8],[7.48,1.1],[8.3,1.1]];
 await page.evaluate(p=>window.__walkthrough.place(...p,...p),paths[0]);
 await page.locator('#body-width').evaluate(el=>{el.value='50';el.dispatchEvent(new Event('input',{bubbles:true}));});expect((await state()).bodyRadius).toBe(.25);
 for(const [x,z] of paths.slice(1)){
  const s=await page.evaluate(([x,z])=>{const w=window.__walkthrough,p=w.getState().position;w.move(x-p[0],z-p[2]);return w.getState();},[x,z]);
  expect(s.position[0]).toBeCloseTo(x,2);expect(s.position[2]).toBeCloseTo(z,2);expect(s.standing).toBe(true);
 }
 const doors=variant==='basic'?[{id:'sliding-20',x:12.593,from:2.18,to:1.05},{id:'sliding-11',x:12.54,from:4.98,to:3.8},{id:'sliding-10',x:7.477,from:2.3,to:.85}]:[{id:'sliding-10',x:12.39,from:4.95,to:3.75}];
 for(const d of doors){
  await page.evaluate(d=>{window.__walkthrough.place(d.x,d.from,d.x,d.to);window.__walkthrough.look(0);},d);
  const id=`archisketch:112a:${variant}:${d.id}`;expect(await page.evaluate(()=>window.__walkthrough.pickDoor())).toBe(id);
  await page.evaluate(d=>window.__walkthrough.move(0,d.to-d.from),d);expect((await state()).position[2]).toBeGreaterThan(d.to+.3);
  await page.evaluate(d=>{const w=window.__walkthrough;w.place(d.x,d.from,d.x,d.to);w.look(0);w.interact();},d);
  await expect.poll(async()=>(await state()).doors.find(x=>x.id===id).progress,{timeout:30000}).toBeCloseTo(1,3);
  for(const z of [d.to,d.from]){
   await page.evaluate(z=>{const w=window.__walkthrough;w.move(0,z-w.getState().position[2]);},z);
   const s=await state();expect(s.position[2]).toBeCloseTo(z,2);expect(s.standing).toBe(true);
  }
 }
 writeFileSync(info.outputPath('verification.json'),JSON.stringify({variant,candidate_revision:revision,candidate_glb_sha256:hash(candidate),interception_count:served,baseline_state:baseline,candidate_state:after,original_pixels_equal:true,finish_roundtrip_pixels_equal:true,body_width_m:.5,continuous_kitchen_path:paths,doors_verified_both_directions:doors.map(d=>d.id),metadata_source:'active v5 metadata; candidate differs only in revision and artifact hashes',active_web_changed:false,errors},null,2));
 expect(errors).toEqual([]);
});
