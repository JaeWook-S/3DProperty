import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {mockMap} from '../apps/web/tests/map-fixtures.js';

const slugs=['sofa-02','modern-coffee-table-01','dining-chair-02'];
const assets=slugs.map(slug=>{
 const path=`assets/furniture/cc0/${slug}`,manifest=JSON.parse(fs.readFileSync(`${path}/manifest.json`)),buffer=fs.readFileSync(`${path}/model.glb`);
 const gltf=JSON.parse(buffer.subarray(20,20+buffer.readUInt32LE(12)));
 return {...manifest,slug,expectedMaterials:gltf.materials.map(m=>({name:m.name,roughness:m.pbrMetallicRoughness?.roughnessFactor??1,metalness:m.pbrMetallicRoughness?.metallicFactor??1,normalScale:m.normalTexture?.scale??1}))};
});
const entry='/?studio=1&entry=overview&variant=168c-expanded-archisketch&room=bedroom-2&physicalRoom=bedroom-2&test=1&quality=light&finish=original';
const kindSet=assets.map(a=>a.kind);
async function items(page){
 return page.evaluate(kinds=>{
  const active=window.__diversityActive(),T=window.__diversityThree;
  return active.staging.items.filter(i=>kinds.includes(i.kind)&&!i.deleted).map(i=>{
   const materials=new Map();let triangles=0;const transforms=[];
   i.group.traverse(o=>{if(!o.isMesh)return;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;
    transforms.push({name:o.name,position:o.position.toArray(),rotation:o.quaternion.toArray(),scale:o.scale.toArray()});
    for(const m of Array.isArray(o.material)?o.material:[o.material])materials.set(m.name,{name:m.name,policy:m.userData.appearance_policy,color:m.color.toArray(),roughness:m.roughness,metalness:m.metalness,normalScale:m.normalScale.toArray(),maps:['map','normalMap','roughnessMap','metalnessMap','aoMap'].map(k=>m[k]?{uuid:m[k].uuid,colorSpace:m[k].colorSpace,channel:m[k].channel,flipY:m[k].flipY,matrix:m[k].matrix.toArray(),repeat:m[k].repeat.toArray(),offset:m[k].offset.toArray(),rotation:m[k].rotation}:null)});
   });
   return{id:i.id,kind:i.kind,width:i.width,depth:i.depth,height:i.height,x:i.x,z:i.z,angle:i.angle,scale:i.group.scale.toArray(),innerScale:i.group.children[0].scale.toArray(),innerRotation:i.group.children[0].rotation.toArray(),worldSize:new T.Box3().setFromObject(i.group).getSize(new T.Vector3()).toArray(),triangles,transforms,materials:[...materials.values()]};
  });
 },kindSet);
}
function checkOriginal(item,asset,angle=0){
 const d=asset.dimensions_m;
 expect([item.width,item.depth,item.height]).toEqual([d.width,d.depth,d.height]);expect(item.scale).toEqual([1,1,1]);expect(item.innerScale).toEqual([1,1,1]);expect(item.triangles).toBe(asset.triangles);expect(item.angle).toBeCloseTo(angle,6);
 expect(item.worldSize[0]).toBeCloseTo(angle===0?d.width:d.depth,5);expect(item.worldSize[1]).toBeCloseTo(d.height,5);expect(item.worldSize[2]).toBeCloseTo(angle===0?d.depth:d.width,5);
 expect(item.materials).toHaveLength(asset.expectedMaterials.length);
 for(const expected of asset.expectedMaterials){
  const m=item.materials.find(m=>m.name===expected.name);expect(m).toBeTruthy();expect(m.policy).toBe('authored-pbr-v1');expect(m.roughness).toBe(expected.roughness);expect(m.metalness).toBe(expected.metalness);expect(m.normalScale).toEqual([expected.normalScale,-expected.normalScale]);
  expect(m.maps[0].colorSpace).toBe('srgb');expect(m.maps[1].colorSpace).toBe('');expect(m.maps[2].colorSpace).toBe('');expect(m.maps[2].uuid).toBe(m.maps[3].uuid);
  for(const map of m.maps.filter(Boolean)){expect(map.flipY).toBe(false);expect(map.channel).toBe(0);}
 }
}
const withoutMapUUID=item=>JSON.parse(JSON.stringify(item,(key,value)=>key==='uuid'?undefined:value));

test('three CC0 assets retain native size/PBR through explicit add, edit, delete, cache and reload restore',async({page},info)=>{
 test.setTimeout(300000);
 const report={passed:false,assets:[],requests:[],responses:[],errors:[],API:[],stages:[]};
 const responseWork=[];let stage='map';
 const count=slug=>report.requests.filter(r=>r.slug===slug).length;
 const counts=()=>Object.fromEntries(slugs.map(slug=>[slug,count(slug)]));
 const recordStage=()=>report.stages.push({stage,counts:counts()});
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('request',r=>{
  const m=r.url().match(/\/assets\/furniture\/cc0\/([^/]+)\/model\.glb/);
  if(m)report.requests.push({slug:m[1],url:r.url(),stage});
  if(/\/api\/.*(furniture|generation|measurement)/.test(r.url()))report.API.push(r.url());
  if(stage==='map'&&/\.(glb|hdr)(\?|$)/.test(r.url()))throw Error('Heavy model/environment loaded on map');
 });
 page.on('response',r=>{const m=r.url().match(/\/assets\/furniture\/cc0\/([^/]+)\/model\.glb/);if(m)responseWork.push((async()=>{const b=await r.body();report.responses.push({slug:m[1],status:r.status(),bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')});})());});
 await mockMap(page);
 await page.route(/\/src\/walkthrough\/studio\.js(?:\?|$)/,async route=>{
  const response=await route.fetch(),source=await response.text(),needle='const current=()=>getActive();';expect(source.split(needle)).toHaveLength(2);
  await route.fulfill({response,body:source.replace(needle,`${needle}window.__diversityActive=getActive;window.__diversityThree=THREE;`)});
 });
 try{
  await page.goto('http://127.0.0.1:5185/?test=1');await page.evaluate(()=>window.__mapService.ready);await expect(page.locator('#service-viewer')).not.toHaveAttribute('src');expect(report.requests).toEqual([]);recordStage();
  stage='initial-indoor';await page.goto(entry);await expect(page.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:90000});await page.locator('#room-edit').click();await expect(page.locator('body')).toHaveAttribute('data-studio-mode','edit');expect(report.requests).toEqual([]);recordStage();
  stage='selection-only';
  for(const asset of assets){
   await page.locator('#add-kind').selectOption(asset.kind);const d=asset.dimensions_m;
   await expect(page.locator('#catalog-add-note')).toContainText(`너비 ${(d.width*100).toFixed(1)} × 깊이 ${(d.depth*100).toFixed(1)} × 높이 ${(d.height*100).toFixed(1)} cm`);
   await expect(page.locator('#catalog-add-note')).toContainText('제품 실측값은 확인되지 않았습니다');await expect(page.locator('#catalog-add-note a')).toHaveAttribute('href',asset.source.official_page);
  }
  expect(report.requests).toEqual([]);recordStage();
  await page.locator('#allow-overlap').check();
  // Keep intentional overlaps in this isolated test browser; product defaults/layouts are untouched.
  const positions=[[5.95,8.3],[6.15,9.6],[5.6,10.15]];
  for(const [index,asset] of assets.entries()){
   stage=`add-${asset.slug}`;await page.locator('#add-kind').selectOption(asset.kind);await page.locator('#add-item').click();await expect.poll(async()=>(await items(page)).filter(i=>i.kind===asset.kind).length).toBe(1);await expect(page.locator('#add-item')).toBeEnabled();
   const added=(await items(page)).find(i=>i.kind===asset.kind);checkOriginal(added,asset);expect(count(asset.slug)).toBe(1);await expect(page.locator('#item-size')).toContainText('제품 실측 미확인');
   await page.locator('#item-x').fill(String(positions[index][0]));await page.locator('#item-z').fill(String(positions[index][1]));await page.locator('#apply-position').click();
   const moved=(await items(page)).find(i=>i.kind===asset.kind);expect([moved.x,moved.z]).toEqual(positions[index]);
   await page.locator('#rotate-item').click();const rotated=(await items(page)).find(i=>i.kind===asset.kind);checkOriginal(rotated,asset,Math.PI/2);expect(rotated.transforms).toEqual(added.transforms);expect(rotated.innerRotation).toEqual(added.innerRotation);expect(rotated.materials).toEqual(added.materials);
   // The original asset is still a single cached download even when added again.
   stage=`cached-add-${asset.slug}`;await page.locator('#add-kind').selectOption(asset.kind);await page.locator('#add-item').click();await expect.poll(async()=>(await items(page)).filter(i=>i.kind===asset.kind).length).toBe(2);expect(count(asset.slug)).toBe(1);
   await page.locator('#remove-item').click();expect((await items(page)).filter(i=>i.kind===asset.kind)).toEqual([rotated]);
   await page.locator('#selected-item').selectOption(rotated.id);await page.evaluate(()=>window.__testFontReady);await page.screenshot({path:info.outputPath(`${asset.slug}-editor.png`)});
   report.assets.push({id:asset.id,slug:asset.slug,added,moved,rotated,duplicate_delete_passed:true});recordStage();
  }
  // A deliberately overlapping move retains the warning and preserves exact dimensions.
  const originals=await items(page),sofa=originals.find(i=>i.kind===assets[0].kind),table=originals.find(i=>i.kind===assets[1].kind);
  await page.locator('#selected-item').selectOption(table.id);await page.locator('#item-x').fill(String(sofa.x));await page.locator('#item-z').fill(String(sofa.z));await page.locator('#apply-position').click();
  const warnings=await page.evaluate(id=>window.__studio.inspect().warnings.find(w=>w.id===id)?.messages,table.id);expect(warnings.some(w=>/겹/.test(w))).toBe(true);report.overlap_warning=warnings;
  await page.locator('#item-x').fill(String(table.x));await page.locator('#item-z').fill(String(table.z));await page.locator('#apply-position').click();
  const saved=await items(page);await page.locator('#save-layout').click();
  stage='delete-and-restore';for(const i of saved){await page.locator('#selected-item').selectOption(i.id);await page.locator('#remove-item').click();}expect(await items(page)).toEqual([]);
  await page.locator('#restore-layout').click();await expect.poll(async()=>(await items(page)).length).toBe(3);expect(await items(page)).toEqual(saved);expect(counts()).toEqual(Object.fromEntries(slugs.map(s=>[s,1])));recordStage();
  for(const preset of ['oak','stone','original']){await page.locator('#finish').selectOption(preset,{force:true});await expect(page.locator('body')).toHaveAttribute('data-finish-state','ready');await expect.poll(()=>page.evaluate(()=>window.__walkthrough.getState().finish)).toBe(preset);expect(await items(page)).toEqual(saved);}
  report.finishes=['original','oak','stone','original'];
  stage='reload-idle';await page.reload();await expect(page.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:90000});await page.locator('#room-edit').click();expect(await items(page)).toEqual([]);expect(counts()).toEqual(Object.fromEntries(slugs.map(s=>[s,1])));recordStage();
  stage='reload-explicit-restore';await page.locator('#restore-layout').click();await expect.poll(async()=>(await items(page)).length,{timeout:60000}).toBe(3);const restored=await items(page);
  expect(restored.map(withoutMapUUID)).toEqual(saved.map(withoutMapUUID));for(const asset of assets)checkOriginal(restored.find(i=>i.kind===asset.kind),asset,Math.PI/2);expect(counts()).toEqual(Object.fromEntries(slugs.map(s=>[s,2])));recordStage();
  await page.locator('#selected-item').selectOption(restored.find(i=>i.kind===assets[2].kind).id);await page.locator('#add-kind').selectOption(assets[2].kind);await page.evaluate(()=>window.__testFontReady);await page.screenshot({path:info.outputPath('three-assets-restored.png')});
  await Promise.all(responseWork);for(const response of report.responses){const asset=assets.find(a=>a.slug===response.slug);expect(asset).toBeTruthy();expect(response.status).toBe(200);expect(response.bytes).toBe(asset.model_bytes);expect(response.sha256).toBe(asset.model_sha256);}
  expect(report.responses).toHaveLength(6);expect(report.errors).toEqual([]);expect(report.API).toEqual([]);report.restored=restored;report.passed=true;
 }finally{fs.writeFileSync(info.outputPath('verification.json'),JSON.stringify(report,null,2)+'\n');}
});
