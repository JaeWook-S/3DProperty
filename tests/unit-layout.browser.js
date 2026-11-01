import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import {mockMap} from '../apps/web/tests/map-fixtures.js';

const origin = 'http://127.0.0.1:5173';
const expanded168 = '168c-expanded-archisketch';
const basic168 = '168c-basic-archisketch';
const expanded112 = '112a-expanded-archisketch';
const basic112 = '112a-basic-archisketch';
const selection = (building, floor, unit, sampleVariant = expanded168) => ({
  locationId: 'acro-river-park', building, floor, unit, sampleVariant,
  serviceView: 'plan', room: 'bedroom-2', physicalRoom: 'bedroom-2',
});
const initial = selection('100', 3, '305');
const entry = new URL('/', origin);
for (const [key, value] of Object.entries({...initial, studio: 1, entry: 'overview', variant: expanded168, test: 1, quality: 'light', finish: 'original'})) entry.searchParams.set(key, value);
const inspect = frame => frame.evaluate(() => window.__studio.inspect());
const liveItems = async frame => (await inspect(frame)).items.filter(item => !item.deleted);

async function enterEdit(frame) {
  if ((await inspect(frame)).mode !== 'edit') await frame.locator('#mode-edit').click();
  await expect(frame.locator('body')).toHaveAttribute('data-studio-mode', 'edit');
}

async function expectVariants(frame, type) {
  const expected = type === '168C' ? [basic168, expanded168] : [basic112, expanded112];
  for (const id of ['studio-model', 'studio-variant', 'variant']) {
    expect(await frame.locator(`#${id} option`).evaluateAll(options => options.map(option => option.value))).toEqual(expected);
  }
  await expect(frame.locator('#studio-dimension-note')).toContainText('실제 확장 여부·좌우 반전·내부 시공 상태는 미확인');
}

async function parentSelect(page, frame, next, expectedVariant = next.sampleVariant) {
  const previousReady = await page.evaluate(() => window.__viewerMessages.filter(message => message.type === 'cortex:viewer-ready').length);
  await page.evaluate(next => document.querySelector('#viewer').contentWindow.postMessage({type: 'cortex:selection', selection: next}, location.origin), next);
  await expect.poll(() => page.evaluate(() => window.__viewerMessages.filter(message => message.type === 'cortex:viewer-ready').length), {timeout: 90000}).toBeGreaterThan(previousReady);
  await expect.poll(async () => {
    const state = await inspect(frame);
    return [state.serviceSelection.building, state.serviceSelection.floor, state.serviceSelection.unit, state.serviceSelection.sampleVariant];
  }).toEqual([next.building, next.floor, next.unit, expectedVariant]);
  await expect.poll(() => frame.evaluate(() => window.__walkthrough.getState().variant)).toBe(expectedVariant);
  expect(await frame.evaluate(() => window.__walkthrough.getState().visibleVariants)).toBe(1);
}

async function chooseVariant(frame, variant) {
  await frame.locator('#studio-model').selectOption(variant);
  await expect(frame.locator('body')).toHaveAttribute('data-load-state', 'ready', {timeout: 90000});
  await expect.poll(() => frame.evaluate(() => window.__walkthrough.getState().variant)).toBe(variant);
  await expect(frame.locator('#studio-model')).toBeEnabled();
  expect(await frame.evaluate(() => window.__walkthrough.getState().visibleVariants)).toBe(1);
}

test('real iframe scopes unit layouts and saved state while reusing four prepared model assets', async ({page}, info) => {
  test.setTimeout(360000);
  const report = {passed: false, environment: {CUDA_VISIBLE_DEVICES: process.env.CUDA_VISIBLE_DEVICES, renderer: null}, errors: [], consoleErrors: [], API: [], modelRequests: [], catalogRequests: [], stages: []};
  let stage = 'initial', frame, releaseChair;
  const modelCounts = () => report.modelRequests.reduce((counts, request) => {
    counts[request.model] = (counts[request.model] || 0) + 1;
    return counts;
  }, {});
  const recordStage = async () => {
    const state = await inspect(frame), view = await frame.evaluate(() => window.__walkthrough.getState());
    report.stages.push({stage, selection: state.serviceSelection, scope: state.layoutScope, storageKey: state.storageKey,
      items: state.items, visibleVariants: view.visibleVariants, modelCounts: modelCounts()});
  };
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => {if (message.type() === 'error') report.consoleErrors.push(message.text());});
  page.on('request', request => {
    const model = request.url().match(/\/assets\/models\/acro-river-park\/(112a|168c)\/[^/]+\/(basic|expanded)\/[^/?]+\.glb(?:\?|$)/);
    if (model) report.modelRequests.push({model: `${model[1]}-${model[2]}`, url: request.url(), stage});
    if (/\/assets\/furniture\/cc0\/[^/]+\/model\.glb/.test(request.url())) report.catalogRequests.push({url: request.url(), stage});
    if (/\/api\/.*(furniture|generation|measurement)/.test(request.url())) report.API.push(request.url());
  });
  await mockMap(page);
  await page.route(`${origin}/__unit-layout-parent.html`, route => route.fulfill({contentType: 'text/html', body:
    `<!doctype html><meta charset="utf-8"><title>Unit layout iframe audit</title><style>html,body{margin:0;width:100%;height:100%}iframe{border:0;width:100%;height:100%}</style><script>window.__viewerMessages=[];addEventListener('message',event=>{if(event.origin===location.origin&&event.source===document.querySelector('#viewer')?.contentWindow)window.__viewerMessages.push(event.data)});</script><iframe id="viewer" src="${entry.href.replaceAll('&', '&amp;')}"></iframe>`}));
  try {
    await page.goto(`${origin}/__unit-layout-parent.html`);
    await expect(page.frameLocator('#viewer').locator('body')).toHaveAttribute('data-load-state', 'ready', {timeout: 90000});
    frame = page.frames().find(candidate => candidate.url().startsWith(`${origin}/?`));
    expect(frame).toBeTruthy();
    await expect.poll(() => frame.evaluate(() => Boolean(window.__studio))).toBe(true);
    expect(await frame.evaluate(() => new URL(document.referrer).origin)).toBe(origin);
    expect(await frame.evaluate(() => window.__walkthrough.getState().visibleVariants)).toBe(1);
    await expectVariants(frame, '168C');
    const original = await liveItems(frame);
    expect(modelCounts()).toEqual({'168c-expanded': 1});
    await recordStage();

    stage = '305-edit-save';
    await enterEdit(frame);
    await frame.locator('#allow-overlap').check();
    const kind = await frame.locator('#add-kind option').evaluateAll(options => options.map(option => option.value).find(value => !value.startsWith('catalog:') && !value.startsWith('generated:')));
    expect(kind).toBeTruthy();
    await frame.locator('#add-kind').selectOption(kind);
    await frame.locator('#add-item').click();
    await expect.poll(async () => (await liveItems(frame)).length).toBe(original.length + 1);
    const added = (await liveItems(frame)).find(item => !original.some(previous => previous.id === item.id));
    expect(added).toBeTruthy();
    const position = {x: Number((added.x + 0.2).toFixed(3)), z: Number((added.z + 0.1).toFixed(3))};
    await frame.locator('#item-x').fill(String(position.x));
    await frame.locator('#item-z').fill(String(position.z));
    await frame.locator('#apply-position').click();
    await frame.locator('#rotate-item').click();
    const edited305 = await liveItems(frame);
    const moved = edited305.find(item => item.id === added.id);
    expect([moved.x, moved.z, moved.angle]).toEqual([position.x, position.z, Math.PI / 2]);
    await frame.locator('#save-layout').click();
    const key305 = (await inspect(frame)).storageKey;
    expect(key305).toContain(':100:3:305:168c-expanded-archisketch:');
    expect(await frame.evaluate(key => Boolean(localStorage.getItem(key)), key305)).toBe(true);
    await recordStage();

    stage = '405-initial';
    await parentSelect(page, frame, selection('100', 4, '405'));
    expect(await liveItems(frame)).toEqual(original);
    expect(modelCounts()).toEqual({'168c-expanded': 1});
    await enterEdit(frame);
    const key405 = (await inspect(frame)).storageKey;
    expect(key405).not.toBe(key305);
    expect(await frame.evaluate(key => localStorage.getItem(key), key405)).toBe(null);
    await frame.locator('#restore-layout').click();
    await expect(frame.locator('#restore-layout')).toBeEnabled();
    expect(await liveItems(frame)).toEqual(original);
    await frame.locator('#save-layout').click();
    expect(await frame.evaluate(keys => keys.every(key => Boolean(localStorage.getItem(key))), [key305, key405])).toBe(true);
    await recordStage();

    stage = '405-delayed-chair-switch';
    let intercepted = false;
    const gate = new Promise(resolve => {releaseChair = resolve;});
    await page.route('**/assets/furniture/cc0/dining-chair-02/model.glb', async route => {intercepted = true; await gate; await route.continue();});
    await frame.locator('#add-kind').selectOption('catalog:dining-chair-02');
    await frame.locator('#add-item').click();
    await expect.poll(() => intercepted).toBe(true);
    await parentSelect(page, frame, initial);
    releaseChair();
    await expect(frame.locator('#add-item')).toBeEnabled({timeout: 60000});
    expect(await liveItems(frame)).toEqual(edited305);
    expect((await liveItems(frame)).some(item => item.kind === 'catalog:dining-chair-02')).toBe(false);
    await parentSelect(page, frame, selection('100', 4, '405'));
    expect(await liveItems(frame)).toEqual(original);
    await parentSelect(page, frame, initial);
    expect(await liveItems(frame)).toEqual(edited305);
    report.delayed_catalog_add_canceled_on_unit_change = true;
    await recordStage();

    stage = '305-explicit-reset-restore';
    await enterEdit(frame);
    await frame.locator('#reset-layout').click();
    expect(await liveItems(frame)).toEqual(original);
    await frame.locator('#restore-layout').click();
    await expect(frame.locator('#restore-layout')).toBeEnabled();
    expect(await liveItems(frame)).toEqual(edited305);
    await recordStage();
    await page.screenshot({path: info.outputPath('305-restored.png')});

    stage = '168C-basic-expanded-cache';
    await chooseVariant(frame, basic168);
    expect((await inspect(frame)).storageKey).not.toBe(key305);
    expect((await liveItems(frame)).some(item => item.id === added.id)).toBe(false);
    await expectVariants(frame, '168C');
    await chooseVariant(frame, expanded168);
    expect(await liveItems(frame)).toEqual(edited305);
    await chooseVariant(frame, basic168);
    await chooseVariant(frame, expanded168);
    expect(await liveItems(frame)).toEqual(edited305);
    expect(modelCounts()).toEqual({'168c-expanded': 1, '168c-basic': 1});
    await recordStage();

    stage = '104-1604-112A-model-switch';
    await parentSelect(page, frame, selection('104', 16, '1604'), expanded112);
    await expectVariants(frame, '112A');
    expect((await inspect(frame)).layoutScope).toContain(':104:16:1604:112a-expanded-archisketch:');
    await chooseVariant(frame, basic112);
    await expectVariants(frame, '112A');
    await chooseVariant(frame, expanded112);
    await recordStage();
    await page.screenshot({path: info.outputPath('104-1604-112A.png')});

    stage = '305-return-after-other-type';
    await parentSelect(page, frame, initial);
    expect(await liveItems(frame)).toEqual(edited305);
    expect(modelCounts()).toEqual({'168c-expanded': 1, '168c-basic': 1, '112a-expanded': 1, '112a-basic': 1});
    await expectVariants(frame, '168C');
    await recordStage();
    report.environment.renderer = await frame.evaluate(() => {
      const gl = document.querySelector('#viewport canvas')?.getContext('webgl2');
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null;
    });
    expect(report.environment.CUDA_VISIBLE_DEVICES).toBe('');
    expect(report.environment.renderer).toMatch(/SwiftShader/i);
    expect(report.errors).toEqual([]);
    expect(report.consoleErrors).toEqual([]);
    expect(report.API).toEqual([]);
    expect(await page.evaluate(() => window.__viewerMessages.filter(message => message.type === 'cortex:viewer-error'))).toEqual([]);
    report.passed = true;
  } finally {
    releaseChair?.();
    report.failed_or_final_stage = stage;
    fs.writeFileSync(info.outputPath('verification.json'), JSON.stringify(report, null, 2) + '\n');
  }
});

test('targeted races keep the latest unit when a model or finish completes late and preserve selection on failure', async ({page}, info) => {
  test.setTimeout(180000);
  const report = {passed: false, environment: {CUDA_VISIBLE_DEVICES: process.env.CUDA_VISIBLE_DEVICES, renderer: null},
    errors: [], consoleErrors: [], requestFailures: [], stages: []};
  let stage = 'initial', frame, releaseModel, releaseOak;
  const messageCount = type => page.evaluate(type => window.__viewerMessages.filter(message => message.type === type).length, type);
  const post = next => page.evaluate(next => document.querySelector('#viewer').contentWindow.postMessage({type: 'cortex:selection', selection: next}, location.origin), next);
  const capture = async () => {
    const value = await frame.evaluate(() => {
      const studio = window.__studio.inspect(), view = window.__walkthrough.getState();
      return {selection: studio.serviceSelection, pendingOrCurrent: window.__studio.getSelection(),
        scope: studio.layoutScope, storageKey: studio.storageKey, items: studio.items,
        variant: view.variant, finish: view.finish, loadingStage: view.loadingStage,
        visibleVariants: view.visibleVariants, finishSelect: document.querySelector('#finish').value};
    });
    report.stages.push({stage, ...value});
    return value;
  };
  const expectAddress = (state, unit, floor) => {
    for (const value of [state.selection, state.pendingOrCurrent]) {
      expect([value.building, value.floor, value.unit, value.sampleVariant]).toEqual(['100', floor, unit, expanded168]);
    }
    expect(state.variant).toBe(expanded168);
    expect(state.scope).toContain(`:100:${floor}:${unit}:${expanded168}:`);
    expect(state.storageKey).toContain(`:100:${floor}:${unit}:${expanded168}:`);
    expect(state.visibleVariants).toBe(1);
  };
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => {if (message.type() === 'error') report.consoleErrors.push({stage, text: message.text()});});
  page.on('requestfailed', request => report.requestFailures.push({stage, url: request.url(), error: request.failure()?.errorText}));
  await mockMap(page);
  await page.route(`${origin}/__unit-layout-race-parent.html`, route => route.fulfill({contentType: 'text/html', body:
    `<!doctype html><meta charset="utf-8"><title>Unit transition race audit</title><style>html,body{margin:0;width:100%;height:100%}iframe{border:0;width:100%;height:100%}</style><script>window.__viewerMessages=[];addEventListener('message',event=>{if(event.origin===location.origin&&event.source===document.querySelector('#viewer')?.contentWindow)window.__viewerMessages.push(event.data)});</script><iframe id="viewer" src="${entry.href.replaceAll('&', '&amp;')}"></iframe>`}));
  try {
    await page.goto(`${origin}/__unit-layout-race-parent.html`);
    await expect(page.frameLocator('#viewer').locator('body')).toHaveAttribute('data-load-state', 'ready', {timeout: 90000});
    frame = page.frames().find(candidate => candidate.url().startsWith(`${origin}/?`));
    await expect.poll(() => frame.evaluate(() => Boolean(window.__studio))).toBe(true);
    const original = await capture();
    expectAddress(original, '305', 3);
    const originalInterior = await frame.evaluate(() => window.__walkthrough.inspectInterior());
    const originalTextures = await frame.evaluate(() => window.__walkthrough.textureInfo());

    stage = '112A-basic-pending';
    let modelIntercepted = false;
    const modelGate = new Promise(resolve => {releaseModel = resolve;});
    await page.route('**/assets/models/acro-river-park/112a/archisketch-metric-v1/basic/acro112a-basic.glb', async route => {
      modelIntercepted = true; await modelGate; await route.continue();
    });
    await post(selection('104', 16, '1604', basic112));
    await expect.poll(() => modelIntercepted).toBe(true);
    const pending = await capture();
    expect(pending.selection.unit).toBe('305');
    expect(pending.pendingOrCurrent.unit).toBe('1604');
    expect(pending.variant).toBe(expanded168);
    expect(pending.storageKey).toBe(original.storageKey);

    stage = 'latest-405-before-delayed-model';
    await parentSelect(page, frame, selection('100', 4, '405'));
    const committed405 = await capture();
    expectAddress(committed405, '405', 4);
    await enterEdit(frame);
    await frame.locator('#save-layout').click();
    const saved405 = await frame.evaluate(key => localStorage.getItem(key), committed405.storageKey);
    expect(saved405).toBeTruthy();
    const beforeLateReady = await messageCount('cortex:viewer-ready');
    releaseModel();
    // The prepare stage is written after GLTFLoader has decoded its embedded
    // images. The rest of preparation is synchronous, so observing it and then
    // draining a frame also observes the stale load's completion, not just HTTP.
    await expect.poll(() => frame.evaluate(() => {
      const state = window.__walkthrough.getState();
      return state.loadingStage === 'prepare:112a-basic-archisketch' || state.variant === '112a-basic-archisketch';
    }), {timeout: 60000}).toBe(true);
    await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    stage = 'latest-405-after-delayed-model';
    const afterLate = await capture();
    expectAddress(afterLate, '405', 4);
    expect(afterLate.storageKey).toBe(committed405.storageKey);
    expect(afterLate.items).toEqual(committed405.items);
    expect(await messageCount('cortex:viewer-ready')).toBe(beforeLateReady);
    expect(await messageCount('cortex:viewer-error')).toBe(0);

    stage = 'failed-model';
    let aborted = false;
    await page.route('**/assets/models/acro-river-park/112a/archisketch-metric-v1/expanded/acro112a-expanded.glb', async route => {
      aborted = true; await route.abort('failed');
    });
    const beforeError = await messageCount('cortex:viewer-error');
    await post(selection('104', 16, '1604', expanded112));
    await expect.poll(() => aborted).toBe(true);
    await expect.poll(() => messageCount('cortex:viewer-error')).toBe(beforeError + 1);
    await expect(frame.locator('body')).toHaveAttribute('data-load-state', 'ready');
    const afterFailure = await capture();
    expectAddress(afterFailure, '405', 4);
    expect(afterFailure.storageKey).toBe(committed405.storageKey);
    expect(afterFailure.items).toEqual(committed405.items);
    expect(await frame.evaluate(key => localStorage.getItem(key), committed405.storageKey)).toBe(saved405);
    expect(await frame.locator('#studio-model').inputValue()).toBe(expanded168);
    await expect(frame.locator('#status')).toContainText('이전 공간을 유지');

    stage = 'oak-pending-405-to-305';
    let oakIntercepted = false;
    const oakGate = new Promise(resolve => {releaseOak = resolve;});
    await page.route('**/assets/materials/generated-v1/oak.png', async route => {
      oakIntercepted = true; await oakGate; await route.continue();
    });
    await frame.locator('#finish').selectOption('oak', {force: true});
    await expect.poll(() => oakIntercepted).toBe(true);
    await expect(frame.locator('body')).toHaveAttribute('data-finish-state', 'loading');
    const beforeFinishReady = await messageCount('cortex:viewer-ready');
    await post(initial);
    await expect.poll(() => frame.evaluate(() => window.__studio.getSelection().unit)).toBe('305');
    expect((await capture()).selection.unit).toBe('405');
    releaseOak();
    await expect.poll(() => messageCount('cortex:viewer-ready'), {timeout: 60000}).toBeGreaterThan(beforeFinishReady);
    await expect(frame.locator('body')).toHaveAttribute('data-load-state', 'ready');
    await expect(frame.locator('body')).toHaveAttribute('data-finish-state', 'ready');
    stage = '305-original-after-late-oak';
    const finalState = await capture();
    expectAddress(finalState, '305', 3);
    expect(finalState.finish).toBe('original');
    expect(finalState.finishSelect).toBe('original');
    expect(finalState.storageKey).toBe(original.storageKey);
    expect(finalState.items).toEqual(original.items);
    expect(await frame.evaluate(() => window.__walkthrough.inspectInterior())).toEqual(originalInterior);
    expect(await frame.evaluate(() => window.__walkthrough.textureInfo())).toEqual(originalTextures);
    await page.screenshot({path: info.outputPath('late-load-and-finish-preserved.png')});
    report.environment.renderer = await frame.evaluate(() => {
      const gl = document.querySelector('#viewport canvas').getContext('webgl2');
      return gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);
    });
    expect(report.environment.CUDA_VISIBLE_DEVICES).toBe('');
    expect(report.environment.renderer).toMatch(/SwiftShader/i);
    expect(report.errors).toEqual([]);
    expect(report.requestFailures).toHaveLength(1);
    expect(report.requestFailures[0].url).toContain('/expanded/acro112a-expanded.glb');
    for (const error of report.consoleErrors) {
      expect(error.stage).toBe('failed-model');
      expect(error.text).toMatch(/Failed to fetch|Failed to load resource|ERR_FAILED/i);
    }
    report.passed = true;
  } finally {
    releaseModel?.(); releaseOak?.();
    report.failed_or_final_stage = stage;
    if (frame) report.lastObserved = await capture().catch(() => null);
    fs.writeFileSync(info.outputPath('race-verification.json'), JSON.stringify(report, null, 2) + '\n');
  }
});
