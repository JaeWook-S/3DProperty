import {test,expect} from '@playwright/test';
import {mockMap} from './map-fixtures.js';
import fs from 'node:fs';
const start='/?test=1&locationId=acro-river-park&building=107&floor=11&unit=1104&sampleVariant=112a-basic-archisketch&serviceView=plan';
async function chooseRoom(page,id,touch=false){const target=page.locator(`#service-plan [data-room="${id}"]`);await target.scrollIntoViewIfNeeded();if(touch)await target.tap();else await target.click();}
async function checkSelection(page,id){
 expect(new URL(page.url()).searchParams.get('physicalRoom')).toBe(id);
 await expect(page.locator('#service-plan')).toHaveAttribute('data-measure-mode','select');
 await expect(page.locator('#plan-measure-overlay circle')).toHaveCount(0);
 await expect(page.locator('#plan-measure-overlay line')).toHaveCount(0);
 await expect(page.locator('#plan-open-3d')).toContainText('실내 3D 열기');
 const room=page.locator(`#service-plan [data-room="${id}"]`);
 expect(await room.evaluate(e=>getComputedStyle(e).webkitTapHighlightColor)).toBe('rgba(0, 0, 0, 0)');
 await expect(room).toHaveAttribute('aria-pressed','true');
}
test('107동 1104호 room selection has explicit 3D continuation and no measurement dot',async({page},info)=>{
 test.setTimeout(180000);const glbs=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/\.glb(?:\?|$)/.test(r.url()))glbs.push(r.url());});
 await mockMap(page);await page.goto(start);await expect(page.locator('#plan-name')).toContainText('107동 1104호');
 await expect(page.locator('#plan-stage')).toContainText('방 배치를 비교');
 await chooseRoom(page,'primary');await checkSelection(page,'primary');await expect(page.locator('#plan-open-3d')).toContainText('안방');
 await page.locator('#service-plan [data-room="living-kitchen-hall"]').focus();await page.keyboard.press('Enter');await checkSelection(page,'living-kitchen-hall');
 await expect(page.locator('#service-plan [data-room="living-kitchen-hall"]')).toBeFocused();
 await page.locator('#sample-variant').selectOption('112a-expanded-archisketch');await expect(page.locator('#plan-name')).toContainText('확장형');
 await chooseRoom(page,'primary');await checkSelection(page,'primary');expect(glbs).toEqual([]);
 await page.evaluate(()=>window.__testFontReady);await page.locator('#plan-open-3d').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('selected-room.png'),fullPage:true});
 await page.locator('#plan-open-3d').click();const interior=page.frameLocator('#service-viewer');
 await expect(interior.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:90000});await expect(interior.locator('#studio-room')).toHaveValue('primary');
 await expect(interior.locator('#studio-model')).toHaveValue('112a-expanded-archisketch');expect(glbs).toHaveLength(1);
 await page.locator('[data-service-view="plan"]').click();await expect(page.locator('#plan-open-3d')).toContainText('안방');await checkSelection(page,'primary');
 await page.locator('#plan-open-3d').click();await expect(interior.locator('#studio-room')).toHaveValue('primary');expect(glbs).toHaveLength(1);expect(errors).toEqual([]);
 fs.writeFileSync(info.outputPath('verification.json'),JSON.stringify({passed:true,glbs,errors,unit:'107/11/1104',variant:'112a-expanded-archisketch',room:'primary',ordinarySelectionCircles:0},null,2));
});
test.describe('mobile room selection',()=>{
 test.use({viewport:{width:390,height:844},hasTouch:true});
 test('touch selection and explicit measurements stay distinct at 390px',async({page},info)=>{
  const glbs=[],errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/\.glb(?:\?|$)/.test(r.url()))glbs.push(r.url());});
  await mockMap(page);await page.goto(start);await chooseRoom(page,'primary',true);await checkSelection(page,'primary');
  await page.locator('[data-measure-mode="axes"]').tap();await chooseRoom(page,'primary',true);
  await expect(page.locator('.measurement-values')).toContainText('모델 방 경계 간 거리');
  const point=await page.locator('.measurement-cursor').boundingBox();expect(point.width).toBeLessThan(12);expect(point.height).toBeLessThan(12);
  await page.locator('[data-measure-mode="select"]').tap();await checkSelection(page,'primary');
  await page.locator('#plan-open-3d').scrollIntoViewIfNeeded();await expect(page.locator('#plan-open-3d')).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.evaluate(()=>window.__testFontReady);await page.screenshot({path:info.outputPath('mobile-room-action.png'),fullPage:true});
  expect(glbs).toEqual([]);expect(errors).toEqual([]);
  fs.writeFileSync(info.outputPath('verification.json'),JSON.stringify({passed:true,glbs,errors,ordinarySelectionCircles:0,explicitMeasurementPointPixels:point},null,2));
 });
});
