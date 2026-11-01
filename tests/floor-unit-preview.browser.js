import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import {mockMap} from '../apps/web/tests/map-fixtures.js';

for(const width of [1440,390])test(`floor unit previews, state and on-demand navigation ${width}`,async({page},info)=>{
 test.setTimeout(300000);await page.setViewportSize({width,height:width===390?844:1000});await mockMap(page);
 const report={passed:false,width,renderer:'SwiftShader CPU',glbs:[],api:[],errors:[],examples:[]};
 page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(/\.glb(?:\?|$)/.test(r.url()))report.glbs.push(r.url());if(/\/api\//.test(r.url()))report.api.push(r.url());});
 const site=page.frameLocator('#site-tour-frame'), card=unit=>site.locator(`.floor-unit-card[data-unit="${unit}"]`);
 const serviceState=()=>page.evaluate(()=>window.__mapService.state().selection);
 const siteFrame=()=>page.frames().find(f=>new URL(f.url()).searchParams.has('serviceTour'));
 const viewer=()=>page.frames().find(f=>f.url().includes('studio=1')&&!f.url().includes('serviceTour'));
 const waitModel=async(key,unit)=>{await expect.poll(()=>viewer()?.evaluate(()=>window.__walkthrough?.getState().variant),{timeout:90000}).toBe(key);await expect.poll(()=>viewer()?.evaluate(()=>window.__studio?.inspect().serviceSelection.unit)).toBe(unit);expect(await viewer().evaluate(()=>window.__walkthrough.getState().visibleVariants)).toBe(1);};
 try{
  await page.goto('http://127.0.0.1:5185/?test=1&locationId=acro-river-park&building=105&floor=3&serviceView=site');
  await expect(site.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:90000});
  for(const [building,floor,total,units] of [['105',3,7,['302','303']],['112',3,6,['302','304','305','306']],['104',16,6,['1604']],['100',3,5,['305']]]){
   await site.locator('#tour-building').selectOption(building);await site.locator('#floor-preview-jump').selectOption(String(floor));
   await expect(site.locator('#floor-units-count')).toHaveText(`${total}호 중 ${units.length}호 평면 준비`);
   expect(await site.locator('.floor-unit-card.ready').evaluateAll(cards=>cards.map(c=>c.dataset.unit))).toEqual(units);
   await expect(site.locator('.floor-unit-card')).toHaveCount(total);await expect(site.locator('#tour-unit')).toHaveValue('');
   await expect(site.locator(`#tour-floor-rail [data-floor="${floor}"]`)).toHaveClass(/has-preview/);
   const state=await siteFrame().evaluate(()=>window.__siteTour.state());expect(state.visibleBuildings).toBe(15);expect(state.cutaway.active).toBe(true);report.examples.push({building,floor,total,ready:units});
  }
  await card('305').locator('.floor-unit-variants button').filter({hasText:'기본형'}).click();
  await expect(site.locator('#tour-unit')).toHaveValue('305');await expect(site.locator('#tour-variant')).toHaveValue('168c-basic-archisketch');await expect(page.locator('#selected-unit')).toHaveValue('305');
  const image=card('305').locator('img');await image.scrollIntoViewIfNeeded();await expect.poll(()=>image.evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);await expect(image).toHaveAttribute('alt','168C 기본형 비교 평면');
  await page.screenshot({path:info.outputPath('100-305-basic-card.png')});
  await card('305').locator('[data-open="plan"]').click();await expect(page.locator('#plan-name')).toContainText('100동 305호');await expect(page.locator('#service-plan [data-room]')).not.toHaveCount(0);expect(report.glbs).toEqual([]);report.beforeInteriorGLB=0;
  await page.locator('[data-service-view="site"]').click();await expect(card('305')).toHaveAttribute('data-selected','true');
  await site.locator('#tour-cutaway').click();await expect(site.locator('#tour-cutaway')).toHaveAttribute('aria-pressed','false');await site.locator('#tour-cutaway').click();
  if(width===1440){
   await card('305').locator('[data-open="3d"]').click();await waitModel('168c-basic-archisketch','305');expect(report.glbs).toHaveLength(1);
   const frameSrc=await page.locator('#service-viewer').getAttribute('src');
   await page.locator('[data-service-view="site"]').click();await card('305').locator('.floor-unit-variants button').filter({hasText:'확장형'}).click();expect(report.glbs).toHaveLength(1);
   await card('305').locator('[data-open="3d"]').click();await waitModel('168c-expanded-archisketch','305');expect(report.glbs).toHaveLength(2);
   await page.locator('[data-service-view="site"]').click();await site.locator('#floor-preview-jump').selectOption('4');await expect(site.locator('#tour-unit')).toHaveValue('');await expect(site.locator('.floor-unit-card[data-selected="true"]')).toHaveCount(0);
   await card('405').locator('.floor-unit-variants button').filter({hasText:'기본형'}).click();await card('405').locator('[data-open="3d"]').click();await waitModel('168c-basic-archisketch','405');expect(report.glbs).toHaveLength(2);expect(await page.locator('#service-viewer').getAttribute('src')).toBe(frameSrc);
   report.sameIframe=true;report.variantCacheFetches=2;
   await page.locator('[data-service-view="site"]').click();
  }
  await site.locator('#tour-building').selectOption('105');await site.locator('#floor-preview-jump').selectOption('3');
  await card('302').locator('.floor-unit-variants button').filter({hasText:'기본형'}).click();await card('302').locator('[data-open="plan"]').click();await expect(page.locator('#plan-name')).toContainText('105동 302호');await expect(page.locator('#sample-variant')).toHaveValue('112a-basic-archisketch');
  await page.locator('[data-service-view="site"]').click();await card('303').locator('.floor-unit-select').click();await expect(page.locator('#selected-unit')).toHaveValue('303');await expect(site.locator('#tour-variant')).toHaveValue('112a-basic-archisketch');
  await card('301').locator('.floor-unit-select').click();await expect(site.locator('#tour-plan')).toBeDisabled();await expect(card('301').locator('[data-open]')).toHaveCount(0);await expect(page.locator('#open-3d')).toBeDisabled();
  await site.locator('#tour-building').selectOption('101');await expect(site.locator('#floor-preview-jump')).toBeDisabled();await site.locator('#tour-floor-rail [data-floor="7"]').click();await expect(site.locator('.floor-unit-card.ready')).toHaveCount(0);await expect(site.locator('.floor-unit-card.pending')).not.toHaveCount(0);
  await site.locator('#tour-building').selectOption('112');await site.locator('#floor-preview-jump').selectOption('3');await site.locator('#tour-floor-units').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('112-floor3-all-households.png')});
  expect(await siteFrame().evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  report.selection=await serviceState();expect(report.selection.renovationState).toBe('unknown');expect(report.errors).toEqual([]);expect(report.api).toEqual([]);report.passed=true;
 }finally{await fs.writeFile(info.outputPath('verification.json'),JSON.stringify(report,null,2));}
});

test('thumbnail failure keeps the actual household and 2D path available',async({page},info)=>{
 await mockMap(page);await page.route('**/previews/*.png',r=>r.fulfill({status:404,body:'test missing preview'}));
 const glbs=[];page.on('request',r=>{if(/\.glb(?:\?|$)/.test(r.url()))glbs.push(r.url());});
 await page.goto('http://127.0.0.1:5185/?locationId=acro-river-park&building=104&floor=16&serviceView=site');const site=page.frameLocator('#site-tour-frame');
 await expect(site.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:90000});const card=site.locator('.floor-unit-card[data-unit="1604"]');await card.scrollIntoViewIfNeeded();await expect(card.locator('.floor-preview-error')).toBeVisible();await card.locator('.floor-unit-select').click();await card.locator('[data-open="plan"]').click();await expect(page.locator('#plan-name')).toContainText('104동 1604호');await expect(page.locator('#service-plan [data-room]')).not.toHaveCount(0);expect(glbs).toEqual([]);
 await fs.writeFile(info.outputPath('verification.json'),JSON.stringify({passed:true,expectedPreview404:true,household:'104/16/1604',GLB:0},null,2));
});
