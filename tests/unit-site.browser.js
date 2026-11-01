import {test,expect} from '@playwright/test';

async function host(page, query='') {
  const errors=[],glbs=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(/\.glb(?:\?|$)/.test(request.url()))glbs.push(request.url());});
  await page.route('**/__unit_site_test_host',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;display:block}</style></head><body><script>window.messages=[];addEventListener('message',e=>window.messages.push(e.data));</script><iframe id="site" src="/?serviceTour=1&test=1&locationId=acro-river-park&${query}"></iframe></body></html>`}));
  await page.goto('/__unit_site_test_host');
  const frame=page.frameLocator('#site');
  await expect(frame.locator('body')).toHaveAttribute('data-load-state','ready');
  const state=()=>frame.locator('body').evaluate(()=>window.__siteTour.state());
  const send=selection=>page.evaluate(selection=>document.querySelector('#site').contentWindow.postMessage({type:'cortex:selection',selection},location.origin),selection);
  return {frame,state,send,errors,glbs};
}

test('site selection exposes real households, guarded variants and consistent parent messages',async({page},testInfo)=>{
  const {frame,state,send,errors,glbs}=await host(page,'building=100&floor=3');
  await expect(frame.locator('#tour-plan')).toBeDisabled();
  await expect(frame.locator('#tour-unit option')).toHaveCount(6);
  await frame.locator('#tour-unit').selectOption('305');
  await expect(frame.locator('#tour-unit-note')).toContainText('168.95C');
  await expect(frame.locator('#tour-unit-note')).toContainText('129.96');
  await expect(frame.locator('#tour-unit-note')).toContainText('실제 확장 여부');
  await expect(frame.locator('#tour-variant option')).toHaveCount(2);
  await frame.locator('#tour-variant').selectOption('168c-basic-archisketch');
  await frame.locator('#tour-plan').click();
  await expect.poll(()=>page.evaluate(()=>window.messages.filter(m=>m.type==='cortex:open-plan').at(-1)?.selection)).toMatchObject({building:'100',floor:3,unit:'305',unitType:'168.95C',sampleVariant:'168c-basic-archisketch'});
  await frame.locator('#tour-floor-rail [data-floor="4"]').click();
  await expect(frame.locator('#tour-unit')).toHaveValue('');
  await expect(frame.locator('#tour-plan')).toBeDisabled();
  await expect.poll(async()=>(await state()).selection.unitType).toBe('unknown');
  await send({locationId:'acro-river-park',building:'101',floor:3,unit:'305',unitType:'168C',sampleVariant:'168c-expanded-archisketch'});
  await expect(frame.locator('#tour-unit')).toHaveValue('305');
  await expect(frame.locator('#tour-unit-note')).toContainText('110.66G');
  await expect(frame.locator('#tour-plan')).toBeDisabled();
  await expect(frame.locator('#tour-variant-step')).toBeHidden();
  await expect.poll(async()=>(await state()).selection.unitType).toBe('110.66G');
  await send({locationId:'acro-river-park',building:'100',floor:3,unit:'305',sampleVariant:'112a-basic-archisketch'});
  await expect(frame.locator('#tour-variant')).toHaveValue('168c-basic-archisketch');
  await expect(frame.locator('#tour-plan')).toBeEnabled();
  await frame.locator('body').screenshot({path:testInfo.outputPath('100-305-supported.png')});
  await send({locationId:'acro-river-park',building:'100',floor:4,unit:'305',unitType:'168C'});
  await expect(frame.locator('#tour-unit')).toHaveValue('');
  await expect(frame.locator('#tour-plan')).toBeDisabled();
  await frame.locator('#tour-building').selectOption('104');
  await expect(frame.locator('#tour-floor-value')).toHaveText('미선택');
  await frame.locator('#tour-floor-rail [data-floor="33"]').click();
  await expect(frame.locator('#tour-unit')).toBeDisabled();
  await expect(frame.locator('#tour-unit-note')).toContainText('이 층의 세대가 없습니다');
  expect(glbs).toEqual([]);expect(errors).toEqual([]);
});

test('catalog floors above the OSM shell remain selectable on a narrow screen',async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});
  const {frame,state,errors,glbs}=await host(page,'building=111&floor=22&unit=2201&sampleVariant=168c-expanded-archisketch');
  await expect(frame.locator('#tour-floor')).toHaveAttribute('max','22');
  await expect(frame.locator('#tour-floor-value')).toHaveText('22층');
  await expect(frame.locator('#tour-unit')).toHaveValue('2201');
  await expect(frame.locator('#tour-unit-note')).toContainText('271.16B');
  await expect(frame.locator('#tour-plan')).toBeDisabled();
  await expect(frame.locator('#tour-basis')).toContainText('OSM 외관 21층');
  await expect(frame.locator('#tour-basis')).toContainText('층 강조를 표시하지 않습니다');
  expect(await state()).toMatchObject({selectableMaxFloor:22,osmMaxFloor:21,selection:{building:'111',floor:22,unit:'2201',unitType:'271.16B'}});
  expect(await frame.locator('body').evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await frame.locator('#tour-unit').focus();await page.keyboard.press('ArrowDown');
  await expect(frame.locator('#tour-plan')).toBeDisabled();
  await frame.locator('body').screenshot({path:testInfo.outputPath('111-22-mobile.png')});
  expect(glbs).toEqual([]);expect(errors).toEqual([]);
});
