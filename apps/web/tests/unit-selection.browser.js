import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {mockMap} from './map-fixtures.js';

test('real unit choice separates expansion previews and reuses interior loads',async({page},info)=>{
 test.setTimeout(180000);const report={passed:false,requests:[],errors:[],stages:[]};
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('request',r=>{if(/\.(glb|hdr)(\?|$)/.test(r.url()))report.requests.push(r.url());});
 await mockMap(page);
 const modelCount=()=>report.requests.filter(u=>u.includes('/assets/models/')&&/\.glb/.test(u)).length;
 const state=()=>page.evaluate(()=>window.__mapService.state().selection);
 const viewer=()=>page.frames().find(f=>f.url().includes('studio=1')&&!f.url().includes('serviceTour'));
 const waitModel=async key=>{await expect.poll(async()=>viewer()?.evaluate(()=>window.__walkthrough?.getState().variant),{timeout:90000}).toBe(key);await expect.poll(async()=>viewer()?.evaluate(()=>window.__studio?.inspect().serviceSelection.unit)).toBe((await state()).unit);};
 try{
  await page.goto('/?test=1&locationId=acro-river-park&building=100&floor=3&serviceView=map');await page.evaluate(()=>window.__mapService.ready);
  await expect(page.locator('#selected-unit option[value="305"]')).toHaveCount(1);expect(report.requests).toEqual([]);
  await page.locator('#selected-unit').selectOption('305');await expect(page.locator('#unit-mapping')).toContainText('168.95C');await expect(page.locator('#sample-variant option')).toHaveCount(2);await expect(page.locator('#renovation-note')).toContainText('실제 확장 여부는 미확인');
  await page.locator('#open-plan').click();await expect(page.locator('#service-plan [data-room]')).not.toHaveCount(0);expect(report.requests).toEqual([]);report.stages.push({stage:'unit and 2D',heavyRequests:report.requests.length,selection:await state()});
  await page.locator('#open-3d').click();await waitModel('168c-expanded-archisketch');expect(modelCount()).toBe(1);
  const originalFrame=await page.locator('#service-viewer').getAttribute('src');
  await page.locator('#sample-variant').selectOption('168c-basic-archisketch');await waitModel('168c-basic-archisketch');expect(modelCount()).toBe(2);
  await page.locator('#sample-variant').selectOption('168c-expanded-archisketch');await waitModel('168c-expanded-archisketch');expect(modelCount()).toBe(2);expect(await page.locator('#service-viewer').getAttribute('src')).toBe(originalFrame);
  await page.locator('#selected-floor').selectOption('4');await page.locator('#selected-unit').selectOption('405');await page.locator('#open-3d').click();await waitModel('168c-expanded-archisketch');expect(modelCount()).toBe(2);
  await expect.poll(()=>viewer().evaluate(()=>window.__studio.inspect().layoutScope)).toContain('100:4:405');
  await page.locator('#open-plan').click();await expect(page.locator('#plan-name')).toContainText('405호');await page.locator('#open-3d').click();await waitModel('168c-expanded-archisketch');expect(modelCount()).toBe(2);
  report.stages.push({stage:'same type household and variant reuse',modelRequests:modelCount(),selection:await state()});await page.evaluate(()=>window.__testFontReady);await page.screenshot({path:info.outputPath('unit-405-interior.png')});
  await page.locator('#selected-building').selectOption('101');await page.locator('#selected-floor').selectOption('7');await page.locator('#selected-unit').selectOption('701');await expect(page.locator('#unit-mapping')).toContainText('79.24E');await expect(page.locator('#open-3d')).toBeDisabled();await expect(page.locator('#open-plan')).toBeDisabled();await expect(page.locator('#renovation-note')).toContainText('준비 중');expect(modelCount()).toBe(2);
  await page.locator('#sample-preview').click();await expect(page.locator('#sample-variant option')).toHaveCount(4);expect((await state()).unit).toBe('');expect((await state()).unitType).toBe('unknown');
  expect(report.errors).toEqual([]);report.passed=true;
 }finally{fs.writeFileSync(info.outputPath('verification.json'),JSON.stringify(report,null,2));}
});

test('site household selection opens the matching 112A plan and interior in the actual service',async({page},info)=>{
 test.setTimeout(150000);const glbs=[],errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/\.glb(\?|$)/.test(r.url()))glbs.push(r.url());});await mockMap(page);
 await page.goto('/?test=1');await page.evaluate(()=>window.__mapService.ready);await page.locator('#ready-place').click();
 const site=page.frameLocator('#site-tour-frame');await expect(site.locator('body')).toHaveAttribute('data-load-state','ready');
 await site.locator('#tour-building').selectOption('104');await site.locator('#tour-floor-rail [data-floor="16"]').click();await site.locator('#tour-unit').selectOption('1604');await site.locator('#tour-variant').selectOption('112a-basic-archisketch');
 await expect(page.locator('#selected-unit')).toHaveValue('1604');await expect(page.locator('#unit-mapping')).toContainText('112.74A');await site.locator('#tour-plan').click();
 await expect(page.locator('#plan-stage')).toBeVisible();await expect(page.locator('#plan-name')).toContainText('104동 1604호');await expect(page.locator('#service-plan [data-room]')).not.toHaveCount(0);expect(glbs).toEqual([]);
 await page.evaluate(()=>window.__testFontReady);await page.screenshot({path:info.outputPath('104-1604-basic-plan.png')});
 await page.locator('#open-3d').click();const interior=page.frameLocator('#service-viewer');await expect(interior.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:90000});await expect(interior.locator('#nav-plan')).toContainText('104동 1604호');await expect(interior.locator('#studio-model')).toHaveValue('112a-basic-archisketch');
 await expect(page.locator('#map-feedback')).toBeHidden();expect(glbs).toHaveLength(1);expect(glbs[0]).toContain('acro112a-basic.glb');expect(errors).toEqual([]);
 fs.writeFileSync(info.outputPath('verification.json'),JSON.stringify({passed:true,glbs,errors,selection:await page.evaluate(()=>window.__mapService.state().selection),actual_site_to_interior:true},null,2));
});
