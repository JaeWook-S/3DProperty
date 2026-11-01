import {test, expect} from '@playwright/test';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {mockMap} from './map-fixtures.js';
import {containsLabelBox} from '../src/plan-room-labels.js';

const evidence = new URL('../../../runtime/plan-clarity/2026-10-26/browser/', import.meta.url);
mkdirSync(evidence, {recursive:true});
const variants = ['112a-basic', '112a-expanded', '168c-basic', '168c-expanded'];
const source = Object.fromEntries(variants.map(variant => [variant, JSON.parse(readFileSync(new URL(`../public/floorplans/${variant}-archisketch.json`, import.meta.url)))]));
const start = variant => `/?test=1&locationId=acro-river-park&${variant.startsWith('112') ? 'building=107&floor=11&unit=1104' : 'building=100&floor=7&previewMode=sample'}&sampleVariant=${variant}-archisketch&serviceView=plan`;

function observe(page) {
 const heavy = [], api = [], errors = [], requests = [];
 page.on('pageerror', error => errors.push(error.message));
 page.on('request', request => {
  const url = new URL(request.url()); requests.push(url.href);
  if (/\.(glb|hdr)(?:\?|$)/i.test(url.href)) heavy.push(url.href);
  if (/\/api(?:\/|$)/.test(url.pathname) || url.pathname === '/health') api.push(url.href);
 });
 return {heavy, api, errors, requests};
}

async function ready(page, variant) {
 await page.goto(start(variant));
 await expect(page.locator('#service-plan [data-room]')).toHaveCount(source[variant].rooms.length);
 await page.evaluate(async () => {await window.__testFontReady; await document.fonts.ready;});
 await expect(page.locator('#service-plan .plan-room-label')).not.toHaveCount(0);
}

async function readLabels(page) {
 return page.locator('#service-plan').evaluate(svg => {
  const matrix = svg.getScreenCTM(), scale = Math.min(Math.hypot(matrix.a,matrix.b),Math.hypot(matrix.c,matrix.d));
  const labels = [...svg.querySelectorAll('[data-room]')].map(group => {
   const text = group.querySelector('.plan-room-label'), polygon = group.querySelector('.plan-room-shape');
   const item = {id:group.dataset.room,number:group.dataset.roomNumber,mode:group.dataset.labelMode,name:group.getAttribute('aria-label'),title:group.querySelector('title')?.textContent,points:polygon.getAttribute('points')};
   if (!text) return item;
   const box = text.getBBox();
   let sampledInside = true;
   for(let x=0;x<=8;x++)for(let y=0;y<=8;y++)if(!polygon.isPointInFill(new DOMPoint(box.x+box.width*x/8,box.y+box.height*y/8)))sampledInside=false;
   return {...item,text:text.textContent,lines:[...text.querySelectorAll('tspan')].map(span=>span.textContent),bounds:{x:box.x,y:box.y,width:box.width,height:box.height},fontPixels:parseFloat(getComputedStyle(text).fontSize)*scale,sampledInside,visibility:getComputedStyle(text).visibility};
  });
  return {scale,viewBox:svg.getAttribute('viewBox'),labels,architecture:{walls:svg.querySelectorAll('.plan-wall').length,doors:svg.querySelectorAll('.plan-door').length,swings:svg.querySelectorAll('.plan-door-swing').length,windows:svg.querySelectorAll('.plan-window').length,sliding:svg.querySelectorAll('.plan-sliding').length},font:document.fonts.check('12px "Noto Sans KR"')};
 });
}

async function checkPlan(page, variant, stage) {
 const result = await readLabels(page);
 expect(result.font,`${variant}/${stage} Korean font is loaded`).toBe(true);
 expect(result.labels).toHaveLength(source[variant].rooms.length);
 let visible = 0;
 result.labels.forEach((label,index) => {
  const room = source[variant].rooms[index];
  expect(label.id).toBe(room.id); expect(label.number).toBe(String(index+1));
  expect(label.name).toBe(room.name); expect(label.title).toBe(room.name);
  expect(label.points).toBe(room.polygon_m.map(point=>point.join(',')).join(' '));
  if(label.mode === 'hidden'){expect(label.bounds).toBeUndefined();return;}
  visible++;
  expect(['name','number']).toContain(label.mode);
  expect(label.visibility).toBe('visible');
  expect(label.fontPixels,`${variant}/${room.id}/${stage} readable pixels`).toBeGreaterThanOrEqual(9.999);
  expect(label.sampledInside,`${variant}/${room.id}/${stage} actual SVG fill samples`).toBe(true);
  expect(containsLabelBox(room.polygon_m,label.bounds),`${variant}/${room.id}/${stage} complete actual glyph bbox`).toBe(true);
  if(label.mode==='number')expect(label.text).toBe(String(index+1));
 });
 expect(visible).toBeGreaterThan(source[variant].rooms.length/2);
 expect(result.architecture.walls).toBeGreaterThan(0);
 expect(result.architecture.doors).toBeGreaterThan(0);
 expect(result.architecture.windows).toBeGreaterThan(0);
 await expect(page.locator('#service-plan .plan-architecture')).toHaveAttribute('pointer-events','none');
 await expect(page.locator('#plan-room-select option')).toHaveCount(source[variant].rooms.length+1);
 const options = await page.locator('#plan-room-select option').allTextContents();
 expect(options.slice(1)).toEqual(source[variant].rooms.map((room,index)=>`${index+1}. ${room.name}`));
 await expect(page.locator('#plan-measure-overlay circle')).toHaveCount(0);
 return {variant,stage,...result};
}

async function clickInterior(page, id, touch=false) {
 await page.locator('#service-plan').scrollIntoViewIfNeeded();
 const position = await page.locator(`#service-plan [data-room="${id}"] .plan-room-label`).evaluate(text => {
  const box=text.getBBox(), point=new DOMPoint(box.x+box.width/2,box.y+box.height/2).matrixTransform(text.getScreenCTM());
  return {x:point.x,y:point.y};
 });
 if(touch)await page.touchscreen.tap(position.x,position.y);else await page.mouse.click(position.x,position.y);
}

async function checkSelected(page, id, name) {
 const group = page.locator(`#service-plan [data-room="${id}"]`);
 await expect(group).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#plan-room-select')).toHaveValue(id);
 await expect(page.locator('#plan-room-note')).toContainText(name);
 await expect(page.locator('#plan-open-3d')).toContainText(name);
 await expect(page.locator('#plan-measure-overlay circle')).toHaveCount(0);
 await expect(page.locator('#plan-measure-overlay line')).toHaveCount(0);
 expect(new URL(page.url()).searchParams.get('physicalRoom')).toBe(id);
 expect(await group.evaluate(node=>getComputedStyle(node).outlineStyle)).toBe('none');
 expect(await group.evaluate(node=>getComputedStyle(node).webkitTapHighlightColor)).toBe('rgba(0, 0, 0, 0)');
}

async function capture(page, name) {
 await page.locator('#plan-stage').screenshot({path:new URL(`${name}.png`,evidence).pathname,animations:'disabled'});
}

async function zoomChecks(page, variant, records) {
 await page.locator('#plan-zoom-out').click();records.push(await checkPlan(page,variant,'zoom-0.8'));
 await page.locator('#plan-fit').click();
 await page.locator('#plan-zoom-in').click();records.push(await checkPlan(page,variant,'zoom-1.25'));
 for(let i=0;i<3;i++)await page.locator('#plan-zoom-in').click();
 records.push(await checkPlan(page,variant,'zoom-2.44'));
 await page.locator('#plan-fit').click();
}

test('four desktop plans keep measured labels inside rooms, display architecture and preserve keyboard selection', async({page}) => {
 const network=observe(page),records=[];await mockMap(page);
 for(const variant of variants){
  await ready(page,variant);
  records.push(await checkPlan(page,variant,'fit'));
  if(variant.startsWith('112'))await expect(page.locator('#plan-name')).toContainText('107동 1104호');
  await capture(page,`${variant}-desktop`);
  await zoomChecks(page,variant,records);
 }
 await ready(page,'112a-basic');
 await clickInterior(page,'primary');await checkSelected(page,'primary','안방');
 const living=page.locator('#service-plan [data-room="living-kitchen-hall"]');
 await living.focus();await page.keyboard.press('Enter');
 await checkSelected(page,'living-kitchen-hall','거실 · 주방 · 복도');await expect(living).toBeFocused();
 expect(await living.evaluate(node=>node.matches(':focus-visible'))).toBe(true);
 expect(await living.locator('.plan-room-shape').evaluate(node=>getComputedStyle(node).strokeDasharray)).not.toBe('none');
 await capture(page,'112a-basic-keyboard-selected');
 await page.locator('#sample-variant').selectOption('112a-expanded-archisketch');
 await expect(page.locator('#service-plan [data-room]')).toHaveCount(12);
 await expect(page.locator('#plan-name')).toContainText('107동 1104호');
 records.push(await checkPlan(page,'112a-expanded','unit-variant-switch'));
 // Resize the existing SVG so ResizeObserver, rather than a fresh page load,
 // must recalculate the fonts and fit choices.
 await page.setViewportSize({width:390,height:844});
 await expect.poll(async()=>{const values=await readLabels(page);return Math.min(...values.labels.filter(label=>label.fontPixels).map(label=>label.fontPixels));}).toBeGreaterThanOrEqual(9.999);
 records.push(await checkPlan(page,'112a-expanded','desktop-to-mobile-resize'));
 await page.setViewportSize({width:1440,height:1000});
 await expect.poll(async()=>{const values=await readLabels(page);return Math.max(...values.labels.filter(label=>label.fontPixels).map(label=>label.fontPixels));}).toBeLessThanOrEqual(12.001);
 records.push(await checkPlan(page,'112a-expanded','mobile-to-desktop-resize'));
 expect(network.heavy).toEqual([]);expect(network.api).toEqual([]);expect(network.errors).toEqual([]);
 writeFileSync(new URL('desktop-verification.json',evidence),JSON.stringify({passed:true,cpuOnly:true,...network,records},null,2));
});

test.describe('390px touch plan clarity',()=>{
 test.use({viewport:{width:390,height:844},hasTouch:true});
 test('all four mobile plans fit labels and keep numbered or omitted rooms selectable by full name',async({page})=>{
  const network=observe(page),records=[];await mockMap(page);
  for(const variant of variants){
   await ready(page,variant);const fitted=await checkPlan(page,variant,'mobile-fit');records.push(fitted);
   await capture(page,`${variant}-mobile`);
   const compact=fitted.labels.find(label=>label.mode==='number')||fitted.labels.find(label=>label.mode==='hidden');
   expect(compact,`${variant} has a usable compact fallback`).toBeTruthy();
   await page.locator('#plan-room-select').selectOption(compact.id);await checkSelected(page,compact.id,compact.name);
   await clickInterior(page,'primary',true);await checkSelected(page,'primary','안방');
   await zoomChecks(page,variant,records);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await ready(page,'112a-basic');
  await page.locator('#plan-room-select').selectOption('bedroom-1-strip');await checkSelected(page,'bedroom-1-strip','침실 1 창가 발코니');
  await capture(page,'112a-basic-mobile-narrow-room-selected');
  expect(network.heavy).toEqual([]);expect(network.api).toEqual([]);expect(network.errors).toEqual([]);
  writeFileSync(new URL('mobile-verification.json',evidence),JSON.stringify({passed:true,cpuOnly:true,...network,records},null,2));
 });
});
