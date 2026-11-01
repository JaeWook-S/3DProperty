import {test,expect} from '@playwright/test';
import fs from 'node:fs';

const originalPath='assets/models/acro-river-park/168c/archisketch-metric-v1/expanded/acro168c-expanded.glb';
const markedNames=['168C / Warm ivory plaster','168C / VR polished stone floor','168C / VR beige stone wall','Draft kitchen / stone','Draft kitchen / front','Catalog charcoal leather'];
function markedFixture(){
 const original=fs.readFileSync(originalPath),jsonLength=original.readUInt32LE(12);
 const gltf=JSON.parse(original.subarray(20,20+jsonLength));
 for(const m of gltf.materials)if(markedNames.includes(m.name))m.extras={...m.extras,appearance_policy:'authored-pbr-v1'};
 const json=Buffer.from(JSON.stringify(gltf)),padded=Buffer.alloc(Math.ceil(json.length/4)*4,32);json.copy(padded);
 const remaining=original.subarray(20+jsonLength),result=Buffer.alloc(20+padded.length+remaining.length);
 original.copy(result,0,0,20);result.writeUInt32LE(result.length,8);result.writeUInt32LE(padded.length,12);padded.copy(result,20);remaining.copy(result,20+padded.length);
 return result;
}
test('authored material extras survive GLTFLoader, runtime refinement and original finish restoration',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // Contract fixture only: keep all geometry and texture BIN bytes; add material extras in this browser.
 await page.route('**/'+originalPath,route=>route.fulfill({status:200,contentType:'model/gltf-binary',body:markedFixture()}));
 await page.addInitScript(()=>{
  window.__authoredSnapshot=model=>{
   const materials=new Map();model.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material]){
    if(materials.has(m.name))continue;
    materials.set(m.name,{name:m.name,policy:m.userData.appearance_policy,roughness:m.roughness,metalness:m.metalness,normalScale:m.normalScale.toArray(),emissiveIntensity:m.emissiveIntensity,
     maps:['map','normalMap','roughnessMap','metalnessMap','aoMap'].map(k=>{const t=m[k];return t?{uuid:t.uuid,channel:t.channel,colorSpace:t.colorSpace,flipY:t.flipY,matrix:t.matrix.toArray()}:null;})});
   }});// Normalize signed zero in UV matrices; 0 and -0 produce the same transform.
   return JSON.parse(JSON.stringify([...materials.values()]));
  };
 });
 await page.route(/\/src\/walkthrough\/main\.js(?:\?|$)/,async route=>{
  const response=await route.fetch(),source=await response.text(),needle='refineMaterials(model, renderer);';
  expect(source.split(needle)).toHaveLength(2);
  await route.fulfill({response,body:source.replace(needle,`window.__authoredModel=model;window.__authoredLoaded=window.__authoredSnapshot(model);${needle}window.__authoredRefined=window.__authoredSnapshot(model);`)});
 });
 await page.goto('/?studio=0&variant=168c-expanded-archisketch&test=1&quality=light&finish=original');
 await expect(page.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:90000});
 const capture=()=>page.evaluate(()=>({loaded:window.__authoredLoaded,refined:window.__authoredRefined,current:window.__authoredSnapshot(window.__authoredModel),state:window.__walkthrough.getState()}));
 const before=await capture();
 for(const name of markedNames){
  const a=before.loaded.find(m=>m.name===name),b=before.refined.find(m=>m.name===name);expect(a.policy).toBe('authored-pbr-v1');expect(b).toEqual(a);
 }
 expect(before.loaded.find(m=>m.name==='Catalog charcoal leather').normalScale).toEqual([.25,-.25]);
 expect(before.refined.find(m=>m.name==='Catalog charcoal PVC').normalScale).toEqual([.45,.45]);
 await page.locator('#view-settings summary').click();
 await page.evaluate(()=>{window.__walkthrough.place(12.05,8.9,12,11.8);window.__walkthrough.look(Math.atan2(.05,-2.9));});
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const state=await page.evaluate(()=>window.__walkthrough.getState());
 const canvas=page.locator('#viewport canvas');
 const first=await canvas.screenshot({path:info.outputPath('authored-before.png'),mask:[page.locator('#status')]});
 for(const preset of ['oak','stone','original']){
  await page.locator('#finish').selectOption(preset);
  await expect.poll(async()=>page.evaluate(()=>window.__walkthrough.getState().finish)).toBe(preset);
  await expect(page.locator('body')).toHaveAttribute('data-finish-state','ready');
 }
 const after=await capture();expect(after.current).toEqual(before.current);
 expect(after.state.position).toEqual(state.position);expect(after.state.doors).toEqual(state.doors);expect(after.state.scale).toEqual([1,1,1]);expect(after.state.standing).toBe(true);
 const restored=await canvas.screenshot({path:info.outputPath('authored-restored.png'),mask:[page.locator('#status')]});expect(restored.equals(first)).toBe(true);
 expect(errors).toEqual([]);
 fs.writeFileSync(info.outputPath('verification.json'),JSON.stringify({scope:'material-extras-only browser fixture; not a new appearance asset',markedNames,before,after,restoredPixelsIdentical:true,errors},null,2));
});
