import {test,expect} from '@playwright/test';
import {mockMap} from './map-fixtures.js';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const out=process.env.CORTEX_MEASUREMENT_EVIDENCE_DIR?pathToFileURL(process.env.CORTEX_MEASUREMENT_EVIDENCE_DIR+'/'):new URL('../../../runtime/service-map/2026-10-23/plan-measurements/',import.meta.url);fs.mkdirSync(out,{recursive:true});
const url='/?test=1&locationId=acro-river-park&building=100&floor=7&previewMode=sample&sampleVariant=168c-expanded-archisketch&serviceView=plan&room=bedroom-2&physicalRoom=bedroom-2';
async function screenPoint(page,x,z){return page.locator('#service-plan').evaluate((svg,[x,z])=>{const p=new DOMPoint(x,z).matrixTransform(svg.getScreenCTM());return{x:p.x,y:p.y};},[x,z]);}
async function pick(page,x,z,touch=false){await page.locator('#service-plan').scrollIntoViewIfNeeded();const p=await screenPoint(page,x,z);if(touch)await page.touchscreen.tap(p.x,p.y);else await page.mouse.click(p.x,p.y);}
async function open(page){await mockMap(page);await page.goto(url);await expect(page.locator('#plan-measure-output')).toContainText('최대 외곽 범위 2.744 m × 4.418 m');}
async function capture(page,name){await page.evaluate(()=>window.__testFontReady);await page.screenshot({path:new URL(name+'.png',out).pathname,fullPage:true});}

test('actual concave room widths differ from bounds and remain in meters after zoom; no 3D loads',async({page})=>{
 const heavy=[],errors=[];page.on('request',r=>{if(/\.(glb|hdr)(\?|$)/.test(r.url()))heavy.push(r.url());});page.on('pageerror',e=>errors.push(e.message));
 await open(page);await page.locator('button[data-measure-mode="axes"]').click();await pick(page,6,6.8);
 await expect(page.locator('.measurement-values')).toContainText('가로 2.310 m');await expect(page.locator('.measurement-values')).toContainText('세로 4.418 m');
 expect(Number(await page.locator('.measurement-values').getAttribute('data-x'))).toBeCloseTo(2.310,6);
 await expect(page.locator('.measurement-x')).toHaveCount(1);await expect(page.locator('.measurement-z')).toHaveCount(1);
 await expect(page.locator('.measurement-values')).toContainText('선택 위치의 모델 방 경계 간 거리');
 const readOverlay = () => page.locator('#plan-measure-overlay').evaluate(group => {
  const values = (selector, names) => names.map(name => Number(group.querySelector(selector).getAttribute(name)));
  return {point_m: values('.measurement-cursor', ['cx','cy']), x: values('.measurement-x', ['x1','y1','x2','y2']), z: values('.measurement-z', ['x1','y1','x2','y2'])};
 });
 // Real mouse clicks use integer client pixels. Check the actual selected point, not pretend micrometer pointer precision.
 const mouseOverlay = await readOverlay();
 const pointerErrorPixels = await page.locator('#service-plan').evaluate((svg,actual) => {
  const matrix=svg.getScreenCTM(), a=new DOMPoint(...actual).matrixTransform(matrix), b=new DOMPoint(6,6.8).matrixTransform(matrix);
  return [Math.abs(a.x-b.x),Math.abs(a.y-b.y)];
 }, mouseOverlay.point_m);
 for (const error of pointerErrorPixels) expect(error).toBeLessThanOrEqual(1);
 for (const [key, expected] of Object.entries({x:[4.849,mouseOverlay.point_m[1],7.159,mouseOverlay.point_m[1]], z:[mouseOverlay.point_m[0],6.479,mouseOverlay.point_m[0],10.897]})) {
  for (let i=0;i<expected.length;i++) expect(mouseOverlay[key][i], `mouse ${key}[${i}]`).toBeCloseTo(expected[i],6);
 }
 // Deterministic fractional DOM input separately verifies S1's exact [6,6.8] reference through the UI handler.
 await page.locator('#service-plan').evaluate(svg => {
  const p=new DOMPoint(6,6.8).matrixTransform(svg.getScreenCTM());
  const event=new MouseEvent('click',{bubbles:true});
  Object.defineProperties(event,{clientX:{value:p.x},clientY:{value:p.y}});
  svg.querySelector('[data-room="bedroom-2"]').dispatchEvent(event);
 });
 const overlay = await readOverlay();
 for (const [key, expected] of Object.entries({point_m:[6,6.8], x:[4.849,6.8,7.159,6.8], z:[6,6.479,6,10.897]})) {
  for (let i=0;i<expected.length;i++) expect(overlay[key][i], `reference ${key}[${i}]`).toBeCloseTo(expected[i],8);
 }
 await capture(page,'bedroom-local-width');
 await page.locator('#plan-zoom-in').click();await expect(page.locator('.measurement-values')).toContainText('2.310 m');
 await pick(page,6,8);await expect(page.locator('.measurement-values')).toContainText('가로 2.744 m');
 await pick(page,6,6.8);await expect(page.locator('.measurement-values')).toContainText('가로 2.310 m');
 await page.locator('#plan-fit').click();await expect(page.locator('.measurement-basis')).toContainText('가구·문짝·마감 두께와 통행 여유를 반영한 값이나 현장 실측값은 아닙니다');
 expect(heavy).toEqual([]);expect(errors).toEqual([]);
 fs.writeFileSync(new URL('axes.json',out),JSON.stringify({passed:true,heavy,errors,mouseOverlay,pointerErrorPixels,overlay,referenceInput:'fractional DOM event; real mouse input checked separately',narrow:2.310,wide:2.744,units:'m'},null,2));
});

test('two points inside a notched room expose outside intervals; second point cannot change the reference room',async({page})=>{
 await open(page);await page.locator('button[data-measure-mode="segment"]').click();await pick(page,4.6,8);await expect(page.locator('#measurement-instruction')).toContainText('끝점');await pick(page,4.6,10.6);
 await expect(page.locator('.measurement-values')).toContainText('방 밖 구간 포함');await expect(page.locator('.measurement-values')).toHaveAttribute('data-outside','true');await expect(page.locator('.measurement-outside')).toHaveCount(1);
 expect(Number(await page.locator('.measurement-values').getAttribute('data-length'))).toBeCloseTo(2.6,1);
 await capture(page,'outside-interval');
 // A new measurement starts; its second endpoint is inside the adjacent hall.
 await pick(page,6,8);await pick(page,6,5.8);await expect(page.locator('.measurement-values')).toHaveAttribute('data-outside','true');
 expect(new URL(page.url()).searchParams.get('physicalRoom')).toBe('bedroom-2');await expect(page.locator('.measurement-bounds')).toContainText('침실 2');
 await page.locator('#clear-plan-measurement').click();await expect(page.locator('.measurement-values')).toHaveCount(0);await expect(page.locator('#plan-measure-overlay line')).toHaveCount(0);
 await pick(page,6,8);await pick(page,6,9);await expect(page.locator('.measurement-values')).toHaveAttribute('data-outside','false');await expect(page.locator('.measurement-values')).toContainText('측정선 전체가 선택한 방 안');
 // Returning to ordinary room selection still updates URL/3D continuation state.
 await page.locator('button[data-measure-mode="select"]').click();await page.locator('[data-room="primary"]').focus();await page.keyboard.press('Enter');expect(new URL(page.url()).searchParams.get('physicalRoom')).toBe('primary');await expect(page.locator('.measurement-values')).toHaveCount(0);
});

test.describe('mobile touch and keyboard',()=>{
 test.use({viewport:{width:390,height:844},hasTouch:true});
 test('touch coordinates, keyboard point placement, and variant reset remain usable',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page);
  await page.locator('button[data-measure-mode="axes"]').tap();await pick(page,6,6.8,true);await expect(page.locator('.measurement-values')).toContainText('가로 2.310 m');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await capture(page,'mobile-measurement');
  await page.locator('button[data-measure-mode="segment"]').tap();await page.locator('#service-plan').focus();await page.keyboard.press('Enter');await page.keyboard.press('ArrowRight');await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('Enter');
  await expect(page.locator('.measurement-values')).toContainText('두 점 거리 0.060 m');await page.keyboard.press('Escape');await expect(page.locator('.measurement-values')).toHaveCount(0);
  await page.locator('#sample-variant').selectOption('112a-basic-archisketch');await expect(page.locator('#plan-name')).toContainText('112A');await expect(page.locator('button[data-measure-mode="select"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('button[data-measure-mode="select"]')).toBeEnabled();await expect(page.locator('.measurement-bounds')).toHaveCount(0);await expect(page.locator('#plan-measure-overlay line')).toHaveCount(0);expect(errors).toEqual([]);
 });
});

test('measurement room continues into indoor 3D and returns without stale points or a second GLB',async({page})=>{
 const glbs=[],errors=[];page.on('request',r=>{if(/\.glb(\?|$)/.test(r.url()))glbs.push(r.url());});page.on('pageerror',e=>errors.push(e.message));
 await open(page);await page.locator('button[data-measure-mode="axes"]').click();await pick(page,6,6.8);await expect(page.locator('.measurement-values')).toContainText('2.310 m');expect(glbs).toEqual([]);
 await page.locator('[data-service-view="3d"]').click();const viewer=page.frameLocator('#service-viewer');await expect(viewer.locator('body')).toHaveAttribute('data-load-state','ready',{timeout:90000});await expect(viewer.locator('#studio-room')).toHaveValue('bedroom-2');expect(glbs).toHaveLength(1);
 await page.locator('[data-service-view="plan"]').click();await expect(page.locator('.measurement-bounds')).toContainText('침실 2');await expect(page.locator('button[data-measure-mode="select"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('.measurement-values')).toHaveCount(0);await expect(page.locator('#plan-measure-overlay line')).toHaveCount(0);
 await page.locator('button[data-measure-mode="axes"]').click();await pick(page,6,8);await expect(page.locator('.measurement-values')).toContainText('가로 2.744 m');await page.locator('[data-service-view="3d"]').click();await expect(viewer.locator('#studio-room')).toHaveValue('bedroom-2');expect(glbs).toHaveLength(1);
 const selection=new URL(page.url()).searchParams;expect(selection.get('floor')).toBe('7');expect(selection.get('unitType')).toBe('unknown');expect(errors).toEqual([]);
 fs.writeFileSync(new URL('roundtrip.json',out),JSON.stringify({passed:true,glbs,errors,room:selection.get('physicalRoom'),floor:selection.get('floor'),unitType:selection.get('unitType')},null,2));
});
