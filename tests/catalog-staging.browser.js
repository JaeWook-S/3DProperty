import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import {mockMap} from '../apps/web/tests/map-fixtures.js';

const kind='catalog:modern-arm-chair-01';
const asset=JSON.parse(fs.readFileSync('assets/furniture/cc0/modern-arm-chair-01/manifest.json','utf8'));
const chairURL='**/assets/furniture/cc0/modern-arm-chair-01/model.glb';
const entry='/?studio=1&entry=overview&variant=168c-expanded-archisketch&room=bedroom-2&physicalRoom=bedroom-2&test=1&quality=light&finish=original';

async function instrument(page){
 await mockMap(page);
 // Read-only test access to the actual placed objects; no production inspection API changes.
 await page.route(/\/src\/walkthrough\/studio\.js(?:\?|$)/,async route=>{
  const response=await route.fetch(),source=await response.text(),needle='const current=()=>getActive();';
  expect(source.split(needle)).toHaveLength(2);
  await route.fulfill({response,body:source.replace(needle,`${needle}window.__catalogActive=getActive;window.__catalogThree=THREE;`)});
 });
}
async function openEditor(page){
 await page.goto(entry);
 await expect(page.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:90000});
 await expect(page.locator('#studio-room')).toHaveValue('bedroom-2');
 await page.locator('#room-edit').click();
 await expect(page.locator('body')).toHaveAttribute('data-studio-mode','edit');
}
async function chairs(page){
 return page.evaluate(kind=>{
  const a=window.__catalogActive(),T=window.__catalogThree;
  return a.staging.items.filter(i=>i.kind===kind&&!i.deleted).map(i=>{
   const materials=new Map();let triangles=0;
   i.group.traverse(o=>{if(!o.isMesh)return;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;
    for(const m of Array.isArray(o.material)?o.material:[o.material])materials.set(m.name,{name:m.name,policy:m.userData.appearance_policy,
     roughness:m.roughness,metalness:m.metalness,normalScale:m.normalScale.toArray(),maps:['map','normalMap','roughnessMap','metalnessMap','aoMap'].map(k=>m[k]?{uuid:m[k].uuid,colorSpace:m[k].colorSpace,channel:m[k].channel,flipY:m[k].flipY,matrix:m[k].matrix.toArray()}:null)});
   });
   return {id:i.id,width:i.width,depth:i.depth,height:i.height,x:i.x,z:i.z,angle:i.angle,scale:i.group.scale.toArray(),innerScale:i.group.children[0].scale.toArray(),innerRotation:i.group.children[0].rotation.toArray(),worldSize:new T.Box3().setFromObject(i.group).getSize(new T.Vector3()).toArray(),triangles,materials:[...materials.values()]};
  });
 },kind);
}
async function collides(page,point){
 return page.evaluate(async p=>{const {bodyAt}=await import('/src/walkthrough/movement.js');return Boolean(window.__catalogActive().staging.capsuleIntersect(bodyAt(p,1.6,.25)));},point);
}
const state=page=>page.evaluate(()=>window.__studio.inspect().items);
const saveEvidence=(info,name,data)=>fs.writeFileSync(info.outputPath(name),JSON.stringify(data,null,2)+'\n');
function checkOriginal(item){
 expect(item.width).toBe(asset.dimensions_m.width);expect(item.depth).toBe(asset.dimensions_m.depth);expect(item.height).toBe(asset.dimensions_m.height);
 expect(item.scale).toEqual([1,1,1]);expect(item.innerScale).toEqual([1,1,1]);expect(item.triangles).toBe(8916);
 expect(item.materials).toHaveLength(2);
 for(const material of item.materials){expect(material.policy).toBe('authored-pbr-v1');expect(material.normalScale).toEqual([1,-1]);expect(material.roughness).toBe(1);expect(material.metalness).toBe(1);expect(material.maps[0].colorSpace).toBe('srgb');expect(material.maps[1].colorSpace).toBe('');expect(material.maps[2]).not.toBeNull();expect(material.maps[3]).not.toBeNull();}
}

test('chair loads only on add, keeps real geometry/PBR, and supports edit/save/reload restore',async({page},info)=>{
 test.setTimeout(240000);await instrument(page);
 const requests=[],api=[],errors=[];page.on('request',r=>{if(r.url().includes('/modern-arm-chair-01/model.glb'))requests.push(r.url());if(/\/api\/.*(furniture|generation|measurement)/.test(r.url()))api.push(r.url());});page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5185/?test=1');await page.evaluate(()=>window.__mapService.ready);
 expect(requests).toEqual([]);await expect(page.locator('#service-viewer')).not.toHaveAttribute('src');
 await openEditor(page);expect(requests).toEqual([]);
 await page.locator('#add-kind').selectOption(kind);await expect(page.locator('#catalog-add-note')).toContainText('너비 82.0 × 깊이 98.7 × 높이 102.3 cm');await expect(page.locator('#catalog-add-note')).toContainText('제품 실측값은 확인되지 않았습니다');await expect(page.locator('#catalog-add-note a')).toHaveAttribute('href',asset.source.official_page);expect(requests).toEqual([]);
 await page.locator('#allow-overlap').uncheck();await page.locator('#add-item').click();await expect.poll(async()=> (await chairs(page)).length).toBe(1);await expect(page.locator('#add-item')).toBeEnabled();
 const added=(await chairs(page))[0];checkOriginal(added);expect(requests).toHaveLength(1);expect(added.angle).toBe(0);
 expect(added.worldSize[0]).toBeCloseTo(asset.dimensions_m.width,5);expect(added.worldSize[1]).toBeCloseTo(asset.dimensions_m.height,5);expect(added.worldSize[2]).toBeCloseTo(asset.dimensions_m.depth,5);
 expect(await collides(page,added)).toBe(true);await expect(page.locator('#item-size')).toContainText('모델 규격');await expect(page.locator('#item-size')).toContainText('제품 실측 미확인');
 await page.locator('#allow-overlap').check();await page.locator('#item-x').fill('6');await page.locator('#item-z').fill('8');await page.locator('#apply-position').click();
 const moved=(await chairs(page))[0];expect(moved.x).toBe(6);expect(moved.z).toBe(8);expect(await collides(page,moved)).toBe(true);expect(await collides(page,added)).toBe(false);
 const points=await page.evaluate(({x,z})=>{const m=document.getElementById('layout-plan').getScreenCTM();return [[x,z],[x+.2,z+.2]].map(([x,z])=>{const p=new DOMPoint(x,z).matrixTransform(m);return{x:p.x,y:p.y};});},moved);
 await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.mouse.move(points[1].x,points[1].y,{steps:5});await page.mouse.up();
 const dragged=(await chairs(page))[0];expect(dragged.x).toBeCloseTo(6.2,2);expect(dragged.z).toBeCloseTo(8.2,2);
 await page.locator('#rotate-item').click();const rotated=(await chairs(page))[0];expect(rotated.angle).toBeCloseTo(Math.PI/2,6);checkOriginal(rotated);expect(rotated.worldSize[0]).toBeCloseTo(asset.dimensions_m.depth,5);expect(rotated.worldSize[2]).toBeCloseTo(asset.dimensions_m.width,5);expect(rotated.innerRotation).toEqual(added.innerRotation);
 await page.locator('#save-layout').click();await page.locator('#remove-item').click();expect(await chairs(page)).toEqual([]);expect(await collides(page,rotated)).toBe(false);
 await page.locator('#restore-layout').click();await expect.poll(async()=> (await chairs(page)).length).toBe(1);expect((await chairs(page))[0]).toEqual(rotated);expect(requests).toHaveLength(1);
 await page.locator('#add-kind').selectOption(kind);await page.locator('#add-item').click();await expect.poll(async()=> (await chairs(page)).length).toBe(2);expect(requests).toHaveLength(1);
 await page.locator('#reset-layout').click();expect(await chairs(page)).toEqual([]);await page.locator('#restore-layout').click();await expect.poll(async()=> (await chairs(page)).length).toBe(1);
 for(const preset of ['oak','stone','original']){await page.locator('#finish').selectOption(preset,{force:true});await expect(page.locator('body')).toHaveAttribute('data-finish-state','ready');await expect.poll(()=>page.evaluate(()=>window.__walkthrough.getState().finish)).toBe(preset);}
 expect((await chairs(page))[0].materials).toEqual(added.materials);expect(requests).toHaveLength(1);
 await page.locator('#selected-item').selectOption(rotated.id);await page.evaluate(()=>window.__testFontReady);await page.screenshot({path:info.outputPath('chair-editor.png')});
 await page.reload();await expect(page.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:90000});await page.locator('#room-edit').click();expect(await chairs(page)).toEqual([]);expect(requests).toHaveLength(1);
 await page.locator('#restore-layout').click();await expect.poll(async()=> (await chairs(page)).length).toBe(1);const restored=(await chairs(page))[0];checkOriginal(restored);expect(restored.x).toBe(rotated.x);expect(restored.z).toBe(rotated.z);expect(restored.angle).toBe(rotated.angle);expect(requests).toHaveLength(2);expect(api).toEqual([]);expect(errors).toEqual([]);
 await page.locator('#selected-item').selectOption(restored.id);await page.locator('#add-kind').selectOption(kind);await page.evaluate(()=>window.__testFontReady);await page.screenshot({path:info.outputPath('chair-restored.png')});
 saveEvidence(info,'verification.json',{passed:true,added,rotated,restored,requests,first_page_downloads:1,reloaded_page_downloads:1,bytes_per_download:asset.model_bytes,api,errors});
});

test('failed add and failed restore preserve the current layout and allow an explicit retry',async({page},info)=>{
 test.setTimeout(180000);await instrument(page);let fail=true,requests=0;
 await page.route(chairURL,route=>{requests++;return fail?route.fulfill({status:503,body:'test failure'}):route.continue();});
 await openEditor(page);const initial=await state(page);await page.locator('#add-kind').selectOption(kind);await page.locator('#add-item').click();await expect(page.locator('#studio-status')).toContainText('가구를 추가하지 못했어요');await expect(page.locator('#add-item')).toBeEnabled();expect(await state(page)).toEqual(initial);expect(requests).toBe(1);
 fail=false;await page.locator('#add-item').click();await expect.poll(async()=> (await chairs(page)).length).toBe(1);await page.locator('#save-layout').click();expect(requests).toBe(2);
 await page.reload();await expect(page.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:90000});await page.locator('#room-edit').click();const beforeRestore=await state(page);fail=true;
 await page.locator('#restore-layout').click();await expect(page.locator('#studio-status')).toContainText('배치를 복원하지 않았어요');await expect(page.locator('#restore-layout')).toBeEnabled();expect(await state(page)).toEqual(beforeRestore);expect(requests).toBe(3);
 fail=false;await page.locator('#restore-layout').click();await expect.poll(async()=> (await chairs(page)).length).toBe(1);expect(requests).toBe(4);
 const restored=await state(page);
 await page.evaluate(()=>{const key=Object.keys(localStorage).find(k=>k.startsWith('cortex-layout-v3:168c-expanded-archisketch:'));const data=JSON.parse(localStorage.getItem(key));data.items.push({id:'added-999',kind:'catalog:missing',x:6,z:8,angle:0});localStorage.setItem(key,JSON.stringify(data));});
 await page.locator('#restore-layout').click();await expect(page.locator('#studio-status')).toContainText('등록되지 않은 가구');expect(await state(page)).toEqual(restored);expect(requests).toBe(4);
 saveEvidence(info,'failure-verification.json',{passed:true,requests,add_failure_preserved:true,restore_failure_preserved:true,unknown_catalog_preserved:true});
});

test('a delayed chair cannot appear in a different unit; the loaded template can be reused without another download',async({page},info)=>{
 test.setTimeout(180000);await instrument(page);let release,requested,requests=0;
 const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>requested=resolve);
 await page.route(chairURL,async route=>{requests++;requested();await gate;await route.continue();});
 await openEditor(page);await page.locator('#add-kind').selectOption(kind);await page.locator('#add-item').click();await started;await expect(page.locator('#add-item')).toBeDisabled();
 try{await page.locator('#studio-model').selectOption('112a-expanded-archisketch');await expect.poll(()=>page.evaluate(()=>window.__walkthrough.getState().variant),{timeout:90000}).toBe('112a-expanded-archisketch');}finally{release();}
 await expect(page.locator('#add-item')).toBeEnabled({timeout:90000});await expect(page.locator('#studio-status')).toContainText('선택한 공간이 바뀌어 추가하지 않았어요');expect(await chairs(page)).toEqual([]);
 await page.locator('#studio-room').selectOption('living');await expect(page.locator('body')).toHaveAttribute('data-studio-mode','edit');await page.locator('#add-kind').selectOption(kind);await page.locator('#add-item').click();await expect.poll(async()=> (await chairs(page)).length).toBe(1);checkOriginal((await chairs(page))[0]);expect(requests).toBe(1);
 saveEvidence(info,'switch-verification.json',{passed:true,requests,cancelled_wrong_unit:true,reused_cached_template:true});
});
