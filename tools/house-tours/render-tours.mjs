// Renders how each 집들이 theme looks in 우리 집, from the live 3D studio. A 집들이's own
// pictures are real photos (src/house-tours/tours.js); these renders are the previews of its
// theme laid out in each 112A plan:
//   <tour>/<plan>-living.webp    first-person view of the living room
//   <tour>/<plan>-overview.webp  cutaway of the whole unit from above
//   _home/<plan>.webp            cutaway of each plan as delivered (the home page's 우리 집 card)
//   _concepts/<concept>-<plan>.webp  living room of a concept no 집들이 uses (최근 적용한 테마)
// Run the viewer first (npm run dev), then:
//   node tools/house-tours/render-tours.mjs [tour-id ... | homes | concepts]
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { TOURS } from '../../src/house-tours/tours.js';
import { CONCEPTS } from '../../src/concepts/catalog.js';

const BASE = process.env.VIEWER_URL ?? 'http://127.0.0.1:5173/';
const OUT = new URL('../../assets/house-tours/', import.meta.url);
const SIZE = { width: 1440, height: 900 };
const only = new Set(process.argv.slice(2));

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: SIZE });
// Headless Chromium refuses Pointer Lock; pretend it succeeded so walking starts normally.
await page.addInitScript(() => {
  let locked = null;
  const change = () => queueMicrotask(() => document.dispatchEvent(new Event('pointerlockchange')));
  Object.defineProperty(Document.prototype, 'pointerLockElement', { configurable: true, get: () => locked });
  Element.prototype.requestPointerLock = function () { locked = this; change(); return Promise.resolve(); };
  Document.prototype.exitPointerLock = function () { if (locked) { locked = null; change(); } };
});

// Software WebGL can take seconds per ultra frame, and a screenshot shows the last finished
// frame. Wait until the picture differs from the one before the move and then holds still.
async function settle(before) {
  await page.waitForFunction(() => document.body.dataset.finishState !== 'loading', null, { timeout: 120000 });
  let previous = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    await page.waitForTimeout(1500);
    const shot = await page.screenshot({ type: 'png' });
    if (previous && shot.equals(previous) && !shot.equals(before)) return;
    previous = shot;
  }
  throw new Error('The view did not settle');
}
// Encode in the page: Chromium writes WebP, so no image tooling is needed here. Files are
// written after the browser closes: new images change the viewer's import.meta.glob and
// the dev server would reload the page mid-render.
const files = [];
async function save(dir, name, crop) {
  const png = await page.screenshot({ type: 'png' });
  const data = await page.evaluate(async ({ b64, crop }) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const [sx, sy, sw, sh, w, h] = crop ?? [0, 0, img.width, img.height, img.width, img.height];
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const context = canvas.getContext('2d'); context.imageSmoothingQuality = 'high';
    context.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.84));
    return new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(blob); });
  }, { b64: png.toString('base64'), crop });
  files.push([new URL(`${name}.webp`, dir), Buffer.from(data, 'base64')]);
  console.log(`  ${name}.webp`);
}

async function open(plan) {
  await page.goto(`${BASE}?studio=1&test=1&quality=ultra&variant=${plan}`);
  await page.waitForSelector('body[data-studio-mode]', { state: 'attached', timeout: 180000 });
  await page.waitForFunction(() => window.__tours, null, { timeout: 60000 });
  await page.waitForTimeout(1500); // let the studio finish its first frames before staging
  await page.evaluate(() => document.body.classList.add('tour-capture'));
}
// Photograph the living room from 1.35 m, as interior photographers do; walking keeps the
// viewer's own eye height.
async function living(label, dir, name) {
  await page.evaluate(() => { const eye = document.getElementById('eye'); eye.value = '1.35'; eye.dispatchEvent(new Event('input')); });
  const before = await page.screenshot({ type: 'png' });
  await page.evaluate(() => window.__tours.look('Living front'));
  await settle(before);
  const view = await page.evaluate(() => ({ mode: window.__studio.inspect().mode, standing: window.__walkthrough.getState().standing }));
  if (view.mode !== 'tour' || !view.standing) throw new Error(`${label}: not inside the living room (${JSON.stringify(view)})`);
  await save(dir, name);
}

for (const tour of TOURS) {
  if (only.size && !only.has(tour.id)) continue;
  for (const plan of ['expanded', 'basic']) {
    console.log(`${tour.id} · ${plan}`);
    const dir = new URL(`${tour.id}/`, OUT);
    await open(plan);
    if (!(await page.evaluate(([id, p]) => window.__tours.stage(id, p), [tour.id, plan]))) throw new Error(`Could not stage ${tour.id} on ${plan}`);
    await living(tour.id, dir, `${plan}-living`);
    const before = await page.screenshot({ type: 'png' });
    await page.evaluate(() => window.__tours.overview());
    await settle(before);
    await save(dir, `${plan}-overview`);
  }
}
if (!only.size || only.has('concepts')) {
  for (const concept of CONCEPTS.filter((c) => !TOURS.some((t) => t.concept === c.id))) {
    for (const plan of ['expanded', 'basic']) {
      console.log(`_concepts/${concept.id} · ${plan}`);
      await open(plan);
      if (!(await page.evaluate(([id, palette, p]) => window.__tours.stageConcept(id, palette, p), [concept.id, concept.palettes[0], plan]))) throw new Error(`Could not stage ${concept.id} on ${plan}`);
      await living(concept.id, new URL('_concepts/', OUT), `${concept.id}-${plan}`);
    }
  }
}
if (!only.size || only.has('homes')) {
  for (const plan of ['expanded', 'basic']) {
    console.log(`_home/${plan}`);
    await open(plan);
    const before = await page.screenshot({ type: 'png' });
    await page.evaluate(() => window.__tours.overview());
    await settle(before);
    await save(new URL('_home/', OUT), plan);
  }
}
await browser.close();
for (const [url, data] of files) {
  await mkdir(new URL('./', url), { recursive: true });
  await writeFile(url, data);
}
console.log(`wrote ${files.length} images`);
