import {test,expect} from '@playwright/test';import {readFileSync,writeFileSync} from 'node:fs';
const cases=JSON.parse(readFileSync(new URL('../tools/blender/specs/acro168c-details-v2-circulation.json',import.meta.url)));
for(const variant of ['basic','expanded'])test(`168C ${variant}: doors, kitchen and all room routes at 50cm body width`,async({page},testInfo)=>{
 test.setTimeout(360000);await page.setViewportSize({width:800,height:600});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // Candidate validation works before activation, and becomes a no-op afterward.
 await page.route('**/src/walkthrough/variants.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replaceAll('168c/archisketch-interiors-v1','168c/archisketch-details-v2')});});
 await page.goto(`/?studio=0&variant=168c-${variant}-archisketch&quality=light&test=1`);await expect(page.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:90000});
 const state=()=>page.evaluate(()=>window.__walkthrough.getState());const initial=await state();expect(initial.bodyRadius).toBe(.22);expect(initial.eyeHeight).toBe(1.6);expect(initial.scale).toEqual([1,1,1]);expect(await page.evaluate(()=>window.__walkthrough.inspectInterior().finishRevision)).toBe(variant==='expanded'?'archisketch-metric-v1':'archisketch-details-v2');
 await page.locator('#body-width').evaluate(el=>{el.value='50';el.dispatchEvent(new Event('input',{bubbles:true}));});expect((await state()).bodyRadius).toBe(.25);
 const place=async(p,c=p)=>page.evaluate(({p,c})=>{const w=window.__walkthrough;w.place(...p,...c);if(p[0]!==c[0]||p[1]!==c[1])w.look(Math.atan2(p[0]-c[0],p[1]-c[1]));},{p,c});
 const move=async(p)=>page.evaluate(p=>{const w=window.__walkthrough,s=w.getState();w.move(p[0]-s.position[0],p[1]-s.position[2]);return w.getState();},p);
 const reached=(s,p)=>{expect(s.position[0]).toBeCloseTo(p[0],2);expect(s.position[2]).toBeCloseTo(p[1],2);expect(s.standing).toBe(true);};
 const doorResults=[];
 for(const c of cases[variant].door_cases){
  const id=`archisketch:${variant}:${c.id}`;await place(c.from,c.center);expect(await page.evaluate(()=>window.__walkthrough.pickDoor())).toBe(id);
  const closed=await move(c.to);expect(Math.hypot(closed.position[0]-c.to[0],closed.position[2]-c.to[1])).toBeGreaterThan(.25);
  await place(c.from,c.center);await page.evaluate(()=>window.__walkthrough.interact());await expect.poll(async()=>(await state()).doors.find(d=>d.id===id).progress,{timeout:40000}).toBeCloseTo(1,3);
  reached(await move(c.to),c.to);reached(await move(c.from),c.from);doorResults.push({id,closed_blocks:true,open_passes_both_directions:true});
 }
 const paths=[];
 for(const route of cases[variant].routes){
  await place(route.path[0],route.path[1]);
  for(const p of route.path.slice(1))reached(await move(p),p);
  for(const p of route.path.slice(0,-1).reverse())reached(await move(p),p);
  paths.push({room_id:route.room_id,waypoints:route.path,passed_both_directions:true});
 }
 // Fresh room starts remain collision-free; editing/tour transitions consume these.
 const meta=JSON.parse(readFileSync(new URL(`../assets/models/acro-river-park/168c/archisketch-details-v2/${variant}/model-info.json`,import.meta.url)));
 for(const r of meta.rooms.filter(r=>r.navigable!==false)){await place(r.walk_start_m,r.viewTarget);expect((await state()).standing).toBe(true);}
 await place(variant==='basic'?[11.75,8.4]:[12.1,8.8],variant==='basic'?[11.828,11.0]:[12.9,11.2]);await page.screenshot({path:testInfo.outputPath(`${variant}-kitchen.png`)});
 expect(errors).toEqual([]);writeFileSync(testInfo.outputPath('verification.json'),JSON.stringify({variant,initial,body_width_m:.5,eye_height_m:1.6,door_cases:doorResults,continuous_paths:paths,room_starts_passed:meta.rooms.length,errors,environment:'Linux headless Chromium / SwiftShader; not Mac FPS or real-device perception validation'},null,2));
});
