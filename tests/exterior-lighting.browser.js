import {test,expect} from '@playwright/test';
import fs from 'node:fs';

const entry='/?studio=1&entry=overview&variant=168c-expanded-archisketch&test=1&quality=balanced&finish=original';
const changeLighting=(page,value)=>page.locator('#lighting').evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));},value);
const viewState=page=>page.evaluate(()=>window.__windowView.state());
async function installProbe(page){
  await page.route(/\/src\/walkthrough\/main\.js(?:\?|$)/,async route=>{
    const response=await route.fetch(),source=await response.text(),needle='refineMaterials(model, renderer);';
    expect(source.split(needle)).toHaveLength(2);
    await route.fulfill({response,body:source.replace(needle,`${needle}window.__backdropProbe={model,scene,renderer};`)});
  });
}
const materialState=page=>page.evaluate(()=>{
  const materials=new Map();window.__backdropProbe.model.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])materials.set(m.uuid,{name:m.name,roughness:m.roughness,metalness:m.metalness,normalScale:m.normalScale?.toArray(),color:m.color?.toArray(),maps:['map','normalMap','roughnessMap','metalnessMap','aoMap'].map(k=>{const t=m[k];return t?{uuid:t.uuid,channel:t.channel,colorSpace:t.colorSpace,matrix:t.matrix.toArray()}:null;})});});return JSON.parse(JSON.stringify([...materials.values()]));
});
const displayedPhoto=page=>page.evaluate(()=>{
  const photo=window.__backdropProbe.scene.getObjectByName('Uncalibrated ACRO exterior reference').children[0];
  return {visible:photo.visible,url:photo.material[0].map?.image?.src??null};
});
async function tour(page){
  await page.waitForFunction(()=>window.__studio&&document.body.dataset.loadState==='ready');
  await page.locator('#studio-room').selectOption('living-kitchen-hall');await page.locator('#room-walk').click();
  await page.waitForFunction(()=>window.__walkthrough.getState().locked);await page.evaluate(()=>document.exitPointerLock());
  await page.waitForFunction(()=>!window.__walkthrough.getState().locked);
  await page.evaluate(()=>{window.__walkthrough.place(12.05,8.9,12,11.8);window.__walkthrough.look(Math.atan2(.05,-2.9));});
}

test('official photo follows lighting while uploaded panoramas and authored PBR survive changes and site return',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await installProbe(page);
  await page.goto(entry+'&lighting=day');await tour(page);
  await expect.poll(async()=>(await viewState(page)).reference.status).toBe('ready');
  expect((await displayedPhoto(page)).url).toContain('official-riverside.jpg');
  const before=await materialState(page),walk=await page.evaluate(()=>window.__walkthrough.getState());
  await page.locator('#viewport canvas').screenshot({path:info.outputPath('day.png')});
  await changeLighting(page,'night');
  await expect.poll(async()=>(await viewState(page)).reference.status).toBe('ready');
  expect((await displayedPhoto(page)).url).toContain('official-night.jpg');
  await expect(page.locator('#exterior-note')).toContainText('밤 참고 사진');
  await page.locator('#viewport canvas').screenshot({path:info.outputPath('night.png')});
  await changeLighting(page,'sunset');expect((await displayedPhoto(page)).url).toContain('official-riverside.jpg');
  await expect(page.locator('#exterior-note')).toContainText('저녁 촬영본 없음');
  await page.locator('#window-view summary').click();
  // Existing local image used only as an upload fixture, not as a new panorama asset.
  await page.locator('#wv-file').setInputFiles('assets/location/acro-river-park/official-riverside.jpg');
  await expect.poll(async()=>(await viewState(page)).custom).toBe(true);
  await page.locator('#wv-photo-heading').fill('137');
  const custom=await viewState(page);
  for(const lighting of ['day','night','sunset']){
    await changeLighting(page,lighting);const state=await viewState(page);
    expect(state.sphereVisible).toBe(true);expect(state.photoVisible).toBe(false);expect(state.rotation).toBe(custom.rotation);expect(state.badge).toContain('직접 불러온');
  }
  await page.locator('#wv-reset').click();
  expect((await viewState(page)).custom).toBe(false);expect((await displayedPhoto(page)).url).toContain('official-riverside.jpg');
  await expect(page.locator('#exterior-note')).toContainText('저녁 촬영본 없음');
  await changeLighting(page,'night');await page.locator('#nav-complex').click();
  await page.locator('#select-building').click();await page.locator('#open-unit').click();await tour(page);
  expect((await displayedPhoto(page)).url).toContain('official-night.jpg');
  await page.locator('#exterior-enabled').uncheck();expect((await page.evaluate(()=>window.__studio.inspect())).exteriorVisible).toBe(false);
  await page.locator('#exterior-enabled').check();expect((await page.evaluate(()=>window.__studio.inspect())).exteriorVisible).toBe(true);
  const after=await materialState(page),end=await page.evaluate(()=>window.__walkthrough.getState());
  expect(after).toEqual(before);expect(end.doors).toEqual(walk.doors);expect(end.scale).toEqual([1,1,1]);expect(end.standing).toBe(true);expect(end.pitch).toBe(0);expect(errors).toEqual([]);
  fs.writeFileSync(info.outputPath('verification.json'),JSON.stringify({switching:['day','night','sunset'],customPanoramaPreserved:true,siteReturn:true,materialsUnchanged:true,before,after,errors},null,2));
});

test('initial night, delayed night completion and missing day image never replace a custom panorama or show a stale photo',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await installProbe(page);
  let releaseNight;const pendingNight=new Promise(resolve=>{releaseNight=resolve;});
  await page.route('**/official-night.jpg*',async route=>{await pendingNight;await route.continue();});
  await page.route('**/official-riverside.jpg*',route=>route.fulfill({status:404,body:'missing reference fixture'}));
  await page.goto(entry+'&lighting=night',{waitUntil:'domcontentloaded'});await tour(page);
  expect((await viewState(page)).reference).toMatchObject({lighting:'night',reference:'night',status:'loading'});
  expect((await displayedPhoto(page)).visible).toBe(false);
  await page.locator('#window-view summary').click();await page.locator('#wv-file').setInputFiles('assets/location/acro-river-park/official-riverside.jpg');
  await expect.poll(async()=>(await viewState(page)).custom).toBe(true);
  await changeLighting(page,'day');
  await expect.poll(async()=>(await viewState(page)).reference.status).toBe('error');
  releaseNight();await expect.poll(()=>page.evaluate(()=>Array.from(document.images).find(im=>im.src.includes('official-night.jpg'))?.complete)).toBe(true);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect((await viewState(page)).reference).toMatchObject({lighting:'day',reference:'day',status:'error',custom:true});
  await expect(page.locator('#exterior-note')).toContainText('직접 불러온');expect((await displayedPhoto(page)).visible).toBe(false);
  await page.locator('#wv-reset').click();await expect(page.locator('#exterior-note')).toContainText('하늘 배경');
  expect((await displayedPhoto(page)).visible).toBe(false);
  await changeLighting(page,'night');await expect.poll(async()=>(await viewState(page)).reference.status).toBe('ready');
  expect((await displayedPhoto(page)).url).toContain('official-night.jpg');expect((await displayedPhoto(page)).visible).toBe(true);expect(errors).toEqual([]);
  fs.writeFileSync(info.outputPath('verification.json'),JSON.stringify({initialNight:true,delayedResponseCannotOverwriteDay:true,customLabelPreserved:true,failedPhotoHidden:true,nightRecovery:true,errors},null,2));
});
