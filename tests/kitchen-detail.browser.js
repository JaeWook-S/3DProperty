import {test,expect} from '@playwright/test';
import fs from 'node:fs';

const parent='archisketch-pbr-candidate-v1',detail='archisketch-kitchen-detail-v1',activeRevision='archisketch-metric-v1';
const manifest=JSON.parse(fs.readFileSync(`assets/models/acro-river-park/168c/${detail}/expanded/detail-manifest.json`));
const circulation=JSON.parse(fs.readFileSync('tools/blender/specs/acro168c-details-v2-circulation.json')).expanded;
const modes=process.env.S3_KITCHEN_REVIEW==='1'?['before','candidate']:['active'];
const state=page=>page.evaluate(()=>window.__walkthrough.getState());
const settle=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const change=async(page,id,value)=>page.locator('#'+id).evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));},value);
const withoutIds=value=>Array.isArray(value)?value.map(withoutIds):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([k])=>k!=='uuid').map(([k,v])=>[k,withoutIds(v)])):value;

async function probe(page,mode){
  if(mode!=='active')await page.route('**/src/walkthrough/variants.js*',async route=>{
    const response=await route.fetch(),source=await response.text();
    const revision=mode==='active'?activeRevision:mode==='before'?parent:detail;
    await route.fulfill({response,body:source.replaceAll(/168c\/archisketch-(?:pbr-candidate-v1|kitchen-detail-v1|metric-v1)\/expanded/g,`168c/${revision}/expanded`)});
  });
  // Read-only capture of the actual include predicate used to build the collision trees.
  await page.route(/\/src\/walkthrough\/doors\.js(?:\?|$)/,async route=>{
    const response=await route.fetch(),source=await response.text(),needle='if (!object.isMesh || object.userData.renderBatch || !include(object)) return;';
    expect(source.split(needle)).toHaveLength(2);
    await route.fulfill({response,body:source.replace(needle,`if (!object.isMesh || object.userData.renderBatch) return;
      const included=include(object);
      (window.__detailCollision??=[]).push({id:object.userData.object_id??null,rootVariant:root.userData.variant??null,included});
      if(!included)return;`)});
  });
  await page.route(/\/src\/walkthrough\/main\.js(?:\?|$)/,async route=>{
    const response=await route.fetch();let source=await response.text();
    const needle='const batching = batchStaticMeshes(model);';expect(source.split(needle)).toHaveLength(2);
    source=source.replace(needle,`${needle}window.__detailProbe={model,scene,renderer,camera,appearance,definition,staging,batching};`);
    await route.fulfill({response,body:source});
  });
  await page.addInitScript(()=>{
    window.__detailMaterials=()=>{
      const found=new Map();window.__detailProbe.model.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material]){
        if(found.has(m.name))continue;
        found.set(m.name,{name:m.name,policy:m.userData.appearance_policy,roughness:m.roughness,metalness:m.metalness,color:m.color?.toArray(),normalScale:m.normalScale?.toArray(),aoMapIntensity:m.aoMapIntensity,emissive:m.emissive?.toArray(),emissiveIntensity:m.emissiveIntensity,maps:Object.fromEntries(['map','normalMap','roughnessMap','metalnessMap','aoMap'].map(k=>{const t=m[k];return [k,t?{uuid:t.uuid,name:t.name,channel:t.channel,colorSpace:t.colorSpace,flipY:t.flipY,wrapS:t.wrapS,wrapT:t.wrapT,repeat:t.repeat.toArray(),offset:t.offset.toArray(),rotation:t.rotation,matrix:t.matrix.toArray(),matrixAutoUpdate:t.matrixAutoUpdate}:null];}))});
      }});return JSON.parse(JSON.stringify([...found.values()].sort((a,b)=>a.name.localeCompare(b.name))));
    };
  });
}
async function capture(page,mode,info){
  const errors=[],loaded=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().includes('.glb'))loaded.push({url:r.url(),status:r.status()});});
  await probe(page,mode);
  await page.goto('/?studio=1&entry=overview&variant=168c-expanded-archisketch&test=1&quality=balanced&lighting=day&finish=original');
  await page.waitForFunction(()=>window.__studio&&document.body.dataset.loadState==='ready');
  await expect.poll(()=>page.evaluate(()=>window.__windowView.state().reference.status)).toBe('ready');
  const revision=mode==='active'?activeRevision:mode==='before'?parent:detail;
  expect(await page.evaluate(()=>window.__walkthrough.inspectInterior().finishRevision)).toBe(revision);
  expect(loaded.some(r=>r.status===200&&r.url.includes(`/${revision}/expanded/acro168c-expanded.glb`))).toBe(true);
  const overview={interior:await page.evaluate(()=>window.__walkthrough.inspectInterior()),studio:await page.evaluate(()=>window.__studio.inspect())};
  await page.locator('#studio-room').selectOption('living-kitchen-hall');await page.locator('#room-walk').click();
  await expect.poll(async()=>(await state(page)).locked).toBe(true);const tourEntry=await state(page);expect(Math.abs(tourEntry.pitch)).toBeLessThan(1e-7);
  await page.evaluate(()=>document.exitPointerLock());await expect.poll(async()=>(await state(page)).locked).toBe(false);
  const materials=await page.evaluate(()=>window.__detailMaterials());
  const authored=materials.filter(m=>m.policy==='authored-pbr-v1');expect(authored).toHaveLength(5);
  for(const m of authored){expect(m.roughness).toBe(1);expect(m.metalness).toBe(0);expect(m.normalScale).toEqual([1,-1]);expect(m.maps.normalMap).not.toBeNull();expect(m.maps.roughnessMap).not.toBeNull();}
  const runtime=await page.evaluate(()=>{
    const p=window.__detailProbe,gl=p.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
    const details=[];p.model.traverse(o=>{if(o.isMesh&&o.userData.object_id?.startsWith('Visual detail /')){
      const ownership=[];for(let a=o;a;a=a.parent)if(a.userData.doorId||a.userData.stagingId)ownership.push({door:a.userData.doorId,staging:a.userData.stagingId});
      details.push({id:o.userData.object_id,collision:o.userData.collision,collisionDisabled:o.userData.collisionDisabled,component:o.userData.component,category:p.definition.info.objects[o.userData.object_id]?.category,visible:o.visible,batched:o.userData.renderBatched===true,ownership});
    }});
    return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),details,batching:{sourceMeshes:p.batching.sourceMeshes,drawMeshes:p.batching.drawMeshes,savedDraws:p.batching.savedDraws},collision:window.__detailCollision.filter(x=>x.rootVariant===p.model.userData.variant),staging:p.staging.snapshot(),obstacles:p.staging.obstacles,templates:[...p.staging.templates.keys()],lighting:{exposure:p.renderer.toneMappingExposure,environmentIntensity:p.scene.environmentIntensity,lights:p.scene.children.filter(o=>o.isLight).map(o=>({type:o.type,intensity:o.intensity,color:o.color.toArray(),position:o.position.toArray()}))}};
  });
  expect(runtime.renderer).toContain('SwiftShader');
  expect(runtime.details).toHaveLength(mode==='before'?0:69);
  if(mode!=='before'){
    expect(runtime.details.map(d=>d.id).sort()).toEqual([...manifest.mesh_names].sort());
    for(const d of runtime.details){expect(d.collision).toBe(false);expect(d.collisionDisabled).toBe(true);expect(d.category).toBe('Reference');expect(d.ownership).toEqual([]);expect(d.visible||d.batched).toBe(true);}
    const checks=runtime.collision.filter(x=>manifest.mesh_names.includes(x.id));expect(checks.length).toBeGreaterThanOrEqual(69);expect(checks.every(x=>!x.included)).toBe(true);
  }
  const views=[];
  for(const view of [
    {name:'kitchen',from:[12.05,8.9],target:[12,1.6,11.8]},
    {name:'appliances',from:[12,7.5],target:[11.45,1.03,8.4]},
    {name:'hood',from:[12,8.3],target:[11.46,1.58,8.3]},
    {name:'window',from:[12,10.676],target:[12.277,1.5,12.251]},
    {name:'pantry-window',from:[13.75718,10.9074],target:[13.78,1.36,12.213]},
  ]){
    await page.evaluate(({from,target})=>{const w=window.__walkthrough;w.place(...from,target[0],target[2]);window.__detailProbe.camera.lookAt(...target);w.move(0,0);},view);await settle(page);
    const s=await state(page);expect(s.standing).toBe(true);expect(s.scale).toEqual([1,1,1]);expect(s.bodyRadius).toBe(.22);expect(s.eyeHeight).toBe(1.6);
    const path=info.outputPath(`${mode}-${view.name}.png`);await page.locator('#viewport canvas').screenshot({path});
    views.push({...view,state:s,file:path});
  }
  const result={mode,revision,overview,tourEntry,materials,runtime,views,errors,loaded,backdrop:await page.evaluate(()=>window.__windowView.state())};
  if(mode!=='before'){
    const original=await page.locator('#viewport canvas').screenshot();
    for(const finish of ['oak','stone','original']){await change(page,'finish',finish);await expect.poll(async()=>(await state(page)).finish).toBe(finish);await expect(page.locator('body')).toHaveAttribute('data-finish-state','ready');}
    expect(await page.evaluate(()=>window.__detailMaterials())).toEqual(materials);const restored=await page.locator('#viewport canvas').screenshot();expect(restored.equals(original)).toBe(true);
    fs.writeFileSync(info.outputPath(mode+'-finish-original.png'),original);fs.writeFileSync(info.outputPath(mode+'-finish-restored.png'),restored);result.finishRestore={materialValuesMapsUvIdentical:true,pngIdentical:true};
  }
  if(mode==='candidate'||(mode==='active'&&!process.env.S3_KITCHEN_SMOKE_ONLY)){
    await page.locator('#body-width').evaluate(el=>{el.value='50';el.dispatchEvent(new Event('input',{bubbles:true}));});
    const place=(p,c=p)=>page.evaluate(({p,c})=>{window.__walkthrough.place(...p,...c);if(p[0]!==c[0]||p[1]!==c[1])window.__walkthrough.look(Math.atan2(p[0]-c[0],p[1]-c[1]));},{p,c});
    const move=p=>page.evaluate(p=>{const w=window.__walkthrough,s=w.getState();w.move(p[0]-s.position[0],p[1]-s.position[2]);return w.getState();},p);
    const reached=(s,p)=>{expect(Math.hypot(s.position[0]-p[0],s.position[2]-p[1])).toBeLessThan(.015);expect(s.standing).toBe(true);};
    const c=circulation.door_cases.find(c=>c.id==='kitchen-pantry-door'),id='archisketch:expanded:'+c.id;
    await place(c.from,c.center);expect(await page.evaluate(()=>window.__walkthrough.pickDoor())).toBe(id);
    const closed=await move(c.to);expect(Math.hypot(closed.position[0]-c.to[0],closed.position[2]-c.to[1])).toBeGreaterThan(.25);
    await place(c.from,c.center);await page.evaluate(()=>window.__walkthrough.interact());await expect.poll(async()=>(await state(page)).doors.find(d=>d.id===id).progress).toBeCloseTo(1,3);
    reached(await move(c.to),c.to);reached(await move(c.from),c.from);
    const routes=circulation.routes.filter(r=>['kitchen-pantry','kitchen-full-route'].includes(r.room_id));
    for(const route of routes){await place(route.path[0],route.path[1]);for(const p of route.path.slice(1))reached(await move(p),p);for(const p of route.path.slice(0,-1).reverse())reached(await move(p),p);}
    result.circulation={bodyWidth_m:.5,door:id,closedBlocks:true,openBidirectional:true,roundTrips:routes};
    await page.locator('#body-width').evaluate(el=>{el.value='44';el.dispatchEvent(new Event('input',{bubbles:true}));});
  }
  expect(errors).toEqual([]);return result;
}

test('168C kitchen detail: real loader, visible decorations, collision exclusion, PBR restoration and kitchen routes',async({browser},info)=>{
  test.setTimeout(360000);const results=[];
  for(const mode of modes){
    const context=await browser.newContext({viewport:{width:1440,height:960},deviceScaleFactor:1}),page=await context.newPage();page.setDefaultTimeout(90000);
    try{const result=await capture(page,mode,info);results.push(result);fs.writeFileSync(info.outputPath(mode+'-verification.json'),JSON.stringify(result,null,2));}finally{await context.close();}
  }
  if(results.length===2){
    const [a,b]=results;expect(withoutIds(b.materials)).toEqual(withoutIds(a.materials));expect(b.runtime.lighting).toEqual(a.runtime.lighting);expect(b.runtime.staging).toEqual(a.runtime.staging);expect(b.runtime.obstacles).toEqual(a.runtime.obstacles);expect(b.runtime.templates).toEqual(a.runtime.templates);
    expect(b.tourEntry.doors).toEqual(a.tourEntry.doors);expect(b.runtime.collision.filter(x=>x.included)).toEqual(a.runtime.collision.filter(x=>x.included));
    // New decorative primitives should merge by unchanged material/attribute signatures.
    expect(b.runtime.batching.drawMeshes-a.runtime.batching.drawMeshes).toBeLessThanOrEqual(8);expect(b.runtime.details.filter(d=>d.batched).length).toBeGreaterThan(50);
    for(let i=0;i<a.views.length;i++)for(const key of ['position','yaw','pitch','fov','horizontalFov','eyeHeight','bodyRadius','quality','resolution','lighting'])expect(b.views[i].state[key]).toEqual(a.views[i].state[key]);
    fs.writeFileSync(info.outputPath('comparison.json'),JSON.stringify({materialsIdentical:true,lightingIdentical:true,cameraConditionsIdentical:true,stagingObstaclesTemplatesIdentical:true,staticAndStagingCollisionIncludedListsIdentical:true,batchingBefore:a.runtime.batching,batchingAfter:b.runtime.batching,views:a.views.map((v,i)=>({name:v.name,before:v.state.renderStats,after:b.views[i].state.renderStats}))},null,2));
  }
});
