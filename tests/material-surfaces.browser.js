import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
const variants=['112a-basic-archisketch','112a-expanded-archisketch','168c-basic-archisketch','168c-expanded-archisketch'];
const state=page=>page.evaluate(()=>window.__surfaceMaterials.editor.state());
const ready=async page=>{await expect(page.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:120000});await page.waitForFunction(()=>window.__surfaceMaterials&&!window.__surfaceMaterials.editor.loading);};
async function stopWalking(page){await page.evaluate(()=>document.getElementById('pause').click());await page.waitForFunction(()=>!document.body.classList.contains('walking'));}
async function room(page){await page.locator('#studio-room').selectOption('bedroom-2');await page.locator('#room-walk').click();await stopWalking(page);await page.waitForTimeout(250);}
async function capture(page,info,name){return page.locator('#viewport canvas').screenshot({path:info.outputPath(name+'.png'),style:'#material-dock,#material-toggle,#walk-themes,#walk-minimap,#three-label,#common-area-start,#common-area-badge,#back-plan,#toast{visibility:hidden!important}'});}
async function chooseVisible(page,mouse,kind){
  const found=await page.evaluate(kind=>{
    const {editor,camera,renderer}=window.__surfaceMaterials,rect=renderer.domElement.getBoundingClientRect();
    // Probe actual ray intersections, then click that screen point through the DOM.
    // The probe does not bypass material, occlusion, or source-target lookup.
    for(const y of [.15,.3,0,.45,-.15,-.3,.6])for(const x of [0,-.15,-.3,.15,.3,-.45,.45,-.6,.6]){
      const id=editor.pick(camera,{x,y},renderer.clippingPlanes),target=editor.targets().get(id);
      if(target?.kind!==kind)continue;
      const px=rect.left+(x+1)*rect.width/2,py=rect.top+(1-y)*rect.height/2;
      if(document.elementFromPoint(px,py)!==renderer.domElement)continue;
      return {id,x:px,y:py,triangles:target.faces.length,normal:target.normal.toArray()};
    }
    return null;
  },kind);
  expect(found,`visible ${kind} surface`).toBeTruthy();
  await page.evaluate(()=>window.__surfaceMaterials.editor.select(null));
  await mouse.click(found.x,found.y); expect((await state(page)).selected.id).toBe(found.id);return found;
}
async function sourceSnapshot(page){return page.evaluate(()=>{
  const root=window.__surfaceMaterials.getActive().model,meshes=[],materials=new Map();
  const hash=array=>{let h=2166136261;const bytes=new Uint8Array(array.buffer,array.byteOffset,array.byteLength);for(const b of bytes)h=Math.imul(h^b,16777619);return (h>>>0).toString(16)};
  const maps=['map','normalMap','roughnessMap','metalnessMap','aoMap'];
  root.traverse(o=>{if(!o.isMesh||o.userData.surfaceOverride)return;
    meshes.push({id:o.userData.object_id??o.name,visible:o.visible,batched:o.userData.renderBatched??false,geometry:[o.geometry.index&&hash(o.geometry.index.array),...Object.entries(o.geometry.attributes).map(([n,a])=>[n,hash(a.array??a.data.array)])],matrix:o.matrix.toArray()});
    for(const m of [].concat(o.material)){if(materials.has(m.uuid))continue;materials.set(m.uuid,{id:m.uuid,color:m.color?.toArray(),roughness:m.roughness,metalness:m.metalness,normalScale:m.normalScale?.toArray(),ao:m.aoMapIntensity,maps:maps.map(k=>{const t=m[k];return [k,t?{uuid:t.uuid,channel:t.channel,flipY:t.flipY,colorSpace:t.colorSpace,repeat:t.repeat.toArray(),offset:t.offset.toArray(),rotation:t.rotation,matrix:t.matrix.toArray(),matrixAutoUpdate:t.matrixAutoUpdate}:null]})});}
  });return {meshes,materials:[...materials.values()]};
});}
async function apply(page,id){await page.locator(`[data-material="${id}"]`).click();await expect.poll(async()=>(await state(page)).pending).toBe(false);await expect(page.locator('body')).toHaveAttribute('data-material-state','ready');expect((await state(page)).material).toBe(id);}

for(const variant of variants)test(`${variant}: real face click, wall/floor isolation, original pixels and explicit save`,async({page},info)=>{
  test.setTimeout(240000);const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await page.goto(`/?studio=1&entry=overview&variant=${variant}&test=1&quality=light`);await ready(page);await room(page);
  const source=await sourceSnapshot(page),beforeState=await page.evaluate(()=>window.__walkthrough.getState());
  await page.locator('#material-toggle').click();expect(requests.filter(u=>/\/maps\/(plaster|counter)-/.test(u))).toHaveLength(0);
  const wall=await chooseVisible(page,page.mouse,'wall');expect(wall.triangles).toBeGreaterThanOrEqual(2);
  await page.locator('#material-close').click();const before=await capture(page,info,'wall-original');
  await page.locator('#material-toggle').click();await apply(page,'greige-plaster-v1');const changed=await state(page);expect(changed.count).toBe(1);
  expect(await sourceSnapshot(page)).toEqual(source);
  const maps=await page.evaluate(()=>window.__surfaceMaterials.editor.overlayMaterials().map(m=>({roughness:m.roughness,metalness:m.metalness,normalScale:m.normalScale.toArray(),MRsame:m.roughnessMap===m.metalnessMap,normalColorSpace:m.normalMap.colorSpace})));
  expect(maps.every(m=>m.roughness===1&&m.metalness===0&&m.MRsame&&m.normalScale[1]===-1&&m.normalColorSpace==='')).toBe(true);
  await page.locator('#material-close').click();const after=await capture(page,info,'wall-after');expect(after.equals(before)).toBe(false);
  const afterState=await page.evaluate(()=>window.__walkthrough.getState());expect(afterState.batching).toEqual(beforeState.batching);expect(afterState.doors).toEqual(beforeState.doors);
  await page.locator('#material-toggle').click();await apply(page,'original');await page.locator('#material-close').click();const restored=await capture(page,info,'wall-restored');expect(restored.equals(before),'restored canvas pixels').toBe(true);
  await page.locator('#back-plan').click();await page.waitForTimeout(350);await page.locator('#material-toggle').click();const floor=await chooseVisible(page,page.mouse,'floor');await apply(page,'warm-stone-v1');
  expect((await state(page)).count).toBe(1);expect(await sourceSnapshot(page)).toEqual(source);
  await page.locator('#material-save').click();const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem(window.__studio.inspect().storageKey)));expect(saved.revision).toBe(2);expect(saved.surfaceFinishes.surfaces).toEqual([{id:floor.id,material:'warm-stone-v1'}]);
  await apply(page,'original');await page.locator('#material-restore').click();await expect.poll(async()=>(await state(page)).count).toBe(1);
  await page.screenshot({path:info.outputPath('floor-material-dock.png')});
  const current=await page.evaluate(()=>window.__walkthrough.getState());
  if(variant==='168c-expanded-archisketch'){
    const material=await page.evaluate(()=>window.__surfaceMaterials.editor.overlayMaterials().map(m=>({uuid:m.uuid,color:m.color.toArray(),map:m.map.uuid,normal:m.normalMap.uuid,normalScale:m.normalScale.toArray()})));
    await page.locator('#material-close').click();
    await page.evaluate(()=>window.__concepts.apply('family-lounge','walnut-navy'));await expect(page.locator('body')).toHaveAttribute('data-finish-state','ready',{timeout:60000});
    expect(await page.evaluate(()=>window.__surfaceMaterials.editor.overlayMaterials().map(m=>({uuid:m.uuid,color:m.color.toArray(),map:m.map.uuid,normal:m.normalMap.uuid,normalScale:m.normalScale.toArray()})))).toEqual(material);
    await page.evaluate(()=>window.__concepts.clear());await expect(page.locator('body')).toHaveAttribute('data-finish-state','ready');
    // Legacy revision-1 layouts still restore and clear only the added manual finish layer.
    await page.evaluate(()=>{const key=window.__studio.inspect().storageKey,d=JSON.parse(localStorage.getItem(key));delete d.surfaceFinishes;d.revision=1;localStorage.setItem(key,JSON.stringify(d));});
    await page.locator('#material-toggle').click();await page.locator('#material-restore').click();await expect.poll(async()=>(await state(page)).count).toBe(0);
  }
  const mapRequests=requests.filter(u=>/\/maps\/(plaster|counter)-/.test(u));expect(mapRequests).toHaveLength(5);expect(new Set(mapRequests).size).toBe(5);expect(errors).toEqual([]);
  await fs.writeFile(info.outputPath('verification.json'),JSON.stringify({variant,wall,floor,originalPixelsEqual:true,sourceBuffersMaterialsUnchanged:true,batchingUnchanged:true,maps,beforeCalls:beforeState.renderStats.calls,wallCalls:afterState.renderStats.calls,floorCalls:current.renderStats.calls,mapRequests,errors},null,2));
});

test('same-model households, delayed textures, variant cache and saved restore after reload',async({page},info)=>{
  test.setTimeout(300000);const errors=[],glbs=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/\.glb(?:\?|$)/.test(r.url()))glbs.push(r.url())});
  const query='/?studio=1&entry=overview&variant=168c-expanded-archisketch&sampleVariant=168c-expanded-archisketch&locationId=acro-river-park&building=100&floor=3&unit=305&test=1&quality=light';
  await page.route('**/surface-test-host',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><style>body{margin:0}iframe{width:100vw;height:100vh;border:0}</style><iframe src="${query}"></iframe>`}));
  await page.goto('/surface-test-host');let frame=await (await page.locator('iframe').elementHandle()).contentFrame();await ready(frame);await frame.locator('#material-toggle').click();const floor=await chooseVisible(frame,page.mouse,'floor');
  let release;const held=new Promise(r=>release=r);await page.route('**/plaster-normal.png',async route=>{await held;await route.continue()});
  await frame.locator('[data-material="ivory-plaster-v1"]').click();await expect.poll(async()=>(await state(frame)).pending).toBe(true);
  const send=async(unit,floor,variant='168c-expanded-archisketch')=>{await page.evaluate(({unit,floor,variant})=>document.querySelector('iframe').contentWindow.postMessage({type:'cortex:selection',selection:{locationId:'acro-river-park',building:'100',floor,unit,sampleVariant:variant}},location.origin),{unit,floor,variant});await expect.poll(()=>frame.evaluate(()=>window.__studio.inspect().serviceSelection.unit)).toBe(unit);await expect.poll(()=>frame.evaluate(()=>window.__walkthrough.getState().variant)).toBe(variant);await ready(frame);await expect.poll(async()=>(await state(frame)).pending).toBe(false);};
  await send('405',4);release();await page.unroute('**/plaster-normal.png');await frame.waitForTimeout(700);expect((await state(frame)).count).toBe(0);
  await send('305',3);expect((await state(frame)).count).toBe(0);await frame.locator('#material-toggle').click();await chooseVisible(frame,page.mouse,'floor');await apply(frame,'ivory-plaster-v1');await frame.locator('#material-save').click();const saved=await frame.evaluate(()=>window.__surfaceMaterials.editor.snapshot());
  await send('405',4);expect((await state(frame)).count).toBe(0);await send('305',3);expect((await state(frame)).count).toBe(1);expect(await frame.evaluate(()=>window.__surfaceMaterials.editor.snapshot())).toEqual(saved);expect(glbs).toHaveLength(1);
  await send('305',3,'168c-basic-archisketch');expect((await state(frame)).count).toBe(0);await send('305',3);expect((await state(frame)).count).toBe(1);expect(glbs).toHaveLength(2);expect(await frame.evaluate(()=>window.__walkthrough.getState().visibleVariants)).toBe(1);
  await page.reload();frame=await (await page.locator('iframe').elementHandle()).contentFrame();await ready(frame);expect((await state(frame)).count).toBe(0);await frame.locator('#material-toggle').click();await frame.locator('#material-restore').click();await expect.poll(async()=>(await state(frame)).count).toBe(1);expect(await frame.evaluate(()=>window.__surfaceMaterials.editor.snapshot())).toEqual(saved);expect(errors).toEqual([]);
  await page.screenshot({path:info.outputPath('saved-household-restored.png')});await fs.writeFile(info.outputPath('verification.json'),JSON.stringify({delayedLoadCancelled:true,households:['100/3/305','100/4/405'],variantCacheGlbsBeforeReload:2,legacySaveTestInExpandedCase:true,saved,errors},null,2));
});

test('390px touch cards, explicit original, keyboard focus and door action separated from finish mode',async({browser},info)=>{
  test.setTimeout(240000);const context=await browser.newContext({viewport:{width:390,height:1040},hasTouch:true,isMobile:true}),page=await context.newPage(),errors=[];
  try{
    page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:5294/?studio=1&entry=overview&variant=168c-expanded-archisketch&test=1&quality=light');await ready(page);await room(page);
    await page.locator('#material-toggle').tap();const target=await chooseVisible(page,page.mouse,'wall');await page.locator('[data-material="greige-plaster-v1"]').tap();await expect.poll(async()=>(await state(page)).pending).toBe(false);expect((await state(page)).count).toBe(1);
    const rect=await page.locator('#material-dock').boundingBox();expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.x+rect.width).toBeLessThanOrEqual(390);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
    await page.locator('[data-material="warm-stone-v1"]').scrollIntoViewIfNeeded();await page.locator('[data-material="warm-stone-v1"]').tap();await expect.poll(async()=>(await state(page)).pending).toBe(false);
    await page.screenshot({path:info.outputPath('mobile-material-cards.png')});await page.locator('[data-material="original"]').scrollIntoViewIfNeeded();await page.locator('[data-material="original"]').tap();await expect.poll(async()=>(await state(page)).count).toBe(0);
    await page.locator('#material-close').focus();await page.keyboard.press('Enter');expect((await state(page)).editing).toBe(false);
    // Position the unchanged body at a valid side of a source doorway. Camera
    // setup is test-only; both interactions below are actual canvas taps.
    const door=await page.evaluate(()=>{const api=window.__surfaceMaterials,a=api.getActive();for(const o of a.definition.info.openings.filter(o=>o.kind==='door'))for(const sign of[-1,1])for(const dist of[.8,1,1.3]){const[x,z]=o.center_m,px=x+(o.axis==='z'?sign*dist:0),pz=z+(o.axis==='x'?sign*dist:0);try{window.__walkthrough.place(px,pz,x,z);const s=window.__walkthrough.getState();window.__walkthrough.look(s.yaw,0);const id=window.__walkthrough.pickDoor();if(id){const r=api.renderer.domElement.getBoundingClientRect();return{id,x:r.left+r.width/2,y:r.top+r.height/2};}}catch{}}return null;});expect(door).toBeTruthy();
    await page.locator('#material-toggle').tap();const before=await page.evaluate(()=>window.__walkthrough.getState().doors);await page.touchscreen.tap(door.x,door.y);expect(await page.evaluate(()=>window.__walkthrough.getState().doors)).toEqual(before);expect((await state(page)).selected).toBeNull();
    await page.locator('#material-close').tap();await page.touchscreen.tap(door.x,door.y);await expect.poll(()=>page.evaluate(id=>window.__walkthrough.getState().doors.find(d=>d.id===id).target,door.id)).toBe(1);expect(errors).toEqual([]);
    await fs.writeFile(info.outputPath('verification.json'),JSON.stringify({width:390,target,door,canvasTapDuringEditDidNotOpenDoor:true,canvasTapAfterCloseOpenedDoor:true,errors},null,2));
  }finally{await context.close();}
});
