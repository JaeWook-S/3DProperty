import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEstimate, koreanAmount, priceTable } from '../src/interior/estimate.js';
import { FINISHES, finishPriceCode, finishesFor, originalFinishKind } from '../src/interior/finish-catalog.js';
import { quoteCSV, quoteHTML } from '../src/interior/quote-document.js';

const db = JSON.parse(readFileSync(new URL('../src/interior/data/price-db.json', import.meta.url)));
const structure = {
  demolition: [{ id: 'iw-1', label: '거실 ↔ 침실', length: 3.2, thickness: 0.12, area: 8.32, volume: 1, doors: 1, sashes: 0, caution: null, rooms: ['a', 'b'] }],
  partitions: [{ id: 'pt-1', type: 'drywall', label: '경량 가벽', length: 2.4, height: 2.6, area: 6.24 - 1.89, door: true, movedFrom: null }],
};
const finishes = [
  { key: 'w|a|x|100', surface: 'wall', roomId: 'a', roomName: '거실', label: '위쪽 벽 1', area: 12.5, finishId: 'wp-silk-white', original: 'wallpaper' },
  { key: 'f|a', surface: 'floor', roomId: 'a', roomName: '거실', label: '바닥', area: 24, finishId: 'fl-herringbone-oak', original: 'floor' },
  { key: 'w|bath|z|10', surface: 'wall', roomId: 'bath', roomName: '욕실', label: '왼쪽 벽 1', area: 7, finishId: 'tl-subway-white', original: 'tile' },
];

test('every catalog finish has a price item for each surface it supports', () => {
  const codes = new Set(db.items.map(i => i.code));
  for (const f of FINISHES) for (const surface of f.surfaces) assert.ok(codes.has(finishPriceCode(f, surface)), `${f.id} ${surface}`);
  assert.ok(finishesFor('floor').every(f => f.surfaces.includes('floor')));
  assert.ok(finishesFor('wall', null, '헤링본').length >= 1);
  assert.equal(originalFinishKind('Bathroom tile', 'wall'), 'tile');
});

test('estimate totals follow the stated rates and truncation', () => {
  const e = buildEstimate({ db, structure, finishes, options: { tileMethod: 'overlay' } });
  const t = e.totals;
  assert.ok(e.lines.length >= 8);
  assert.equal(t.direct, e.lines.reduce((s, l) => s + l.amount, 0));
  assert.ok(Math.abs(t.overhead - t.direct * db.rates.overhead) <= 10);
  assert.equal(t.supply % db.rates.truncate, 0);
  assert.ok(Math.abs(t.vat - t.supply * db.rates.vat) <= 10);
  assert.equal(t.total, t.supply + t.vat);
  assert.ok(t.range[0] < t.total && t.total < t.range[1]);
  assert.ok(e.days >= 1);
  for (const l of e.lines) {
    assert.ok(Number.isFinite(l.amount) && l.amount >= 0, l.code);
    assert.equal(l.amount, l.materialAmount + l.laborAmount + l.expenseAmount, l.code);
  }
  assert.ok(e.lines.some(l => l.code === 'DM-WALL') && e.lines.some(l => l.code === 'PT-DRYWALL') && e.lines.some(l => l.code === 'FL-HERRINGBONE'));
});

test('tile method and price overrides change the estimate', () => {
  const overlay = buildEstimate({ db, structure, finishes, options: { tileMethod: 'overlay' } });
  const remove = buildEstimate({ db, structure, finishes, options: { tileMethod: 'remove' } });
  assert.notEqual(overlay.totals.total, remove.totals.total);
  assert.ok(remove.lines.some(l => l.code === 'DM-FIN-TILE'));
  const overrides = new Map([['PT-DRYWALL', { code: 'PT-DRYWALL', material: 1, labor: 1, expense: 0 }]]);
  const cheaper = buildEstimate({ db, overrides, structure, finishes });
  assert.ok(cheaper.totals.total < overlay.totals.total);
  assert.ok(cheaper.lines.find(l => l.code === 'PT-DRYWALL').overridden);
  assert.equal(priceTable(db, overrides).get('PT-DRYWALL').material, 1);
});

test('minimum charges keep the line arithmetic exact', () => {
  const tiny = buildEstimate({ db, finishes: [{ ...finishes[0], area: 0.5 }] });
  const clean = tiny.lines.find(l => l.code === 'GN-CLEAN');
  assert.ok(clean.amount >= db.items.find(i => i.code === 'GN-CLEAN').minimum);
  for (const l of tiny.lines) assert.equal(l.amount, l.materialAmount + l.laborAmount + l.expenseAmount, l.code);
});

test('an empty design costs nothing', () => {
  const e = buildEstimate({ db, structure: { demolition: [], partitions: [] }, finishes: [] });
  assert.equal(e.lines.length, 0); assert.equal(e.totals.total, 0);
});

test('korean amount words and printable quote', () => {
  assert.equal(koreanAmount(8464500), '팔백사십육만사천오백');
  assert.equal(koreanAmount(100000000), '일억');
  const estimate = buildEstimate({ db, structure, finishes });
  const quote = { estimate, rates: db.rates, meta: { number: 'Q-20261115-1234', createdAt: '2026-11-15T09:00:00Z', customer: '<홍길동>', project: '테스트', scope: '벽 철거 1곳', image: null, plan: '' } };
  const html = quoteHTML(quote);
  assert.match(html, /견적서/); assert.match(html, /&lt;홍길동&gt; 귀하/); assert.doesNotMatch(html, /<홍길동>/);
  assert.match(html, new RegExp(estimate.totals.total.toLocaleString('ko-KR')));
  const csv = quoteCSV(quote);
  assert.equal(csv.split('\r\n').length, 1 + estimate.lines.length + 7);
});

test('finishes of the same grade are priced per product', () => {
  const price = id => buildEstimate({ db, finishes: [{ ...finishes[0], finishId: id }] }).totals.total;
  assert.ok(price('wp-silk-sage') > price('wp-silk-white'));
  assert.ok(price('wp-silk-linen') > price('wp-silk-sage'));
  const floor = id => buildEstimate({ db, finishes: [{ ...finishes[1], finishId: id }] }).totals.total;
  assert.ok(floor('fl-oak-gray') > floor('fl-oak-white'));
  assert.ok(floor('fl-walnut') > floor('fl-oak-natural'));
  for (const f of FINISHES) assert.ok(db.products[f.id]?.material > 0, `${f.id} has a product price`);
  const cheaper = buildEstimate({ db, overrides: new Map([['wp-silk-white', { material: 100 }]]), finishes: [finishes[0]] });
  const line = cheaper.lines.find(l => l.code === 'WP-SILK');
  assert.equal(line.material, 100); assert.ok(line.overridden);
  assert.ok(cheaper.totals.total < price('wp-silk-white'));
});

test('furniture is grouped by product and added on top of construction', () => {
  const furniture = [
    { key: 'queenBed', name: '퀸 침대', price: 890000, roomName: '침실 2' },
    { key: 'plant', name: '화분', price: 89000, roomName: '거실' },
    { key: 'plant', name: '화분', price: 89000, roomName: '침실 2' },
  ];
  const e = buildEstimate({ db, structure, finishes, furniture });
  assert.equal(e.furniture.length, 2);
  assert.deepEqual(e.furniture.map(l => [l.key, l.qty, l.amount]), [['queenBed', 1, 890000], ['plant', 2, 178000]]);
  assert.equal(e.totals.furniture, 1068000);
  assert.equal(e.totals.grand, e.totals.total + 1068000);
  const bare = buildEstimate({ db, structure, finishes });
  assert.equal(bare.totals.total, e.totals.total);
  assert.equal(bare.totals.grand, bare.totals.total);
  const sale = buildEstimate({ db, overrides: new Map([['FN:plant', { price: 50000 }]]), furniture });
  assert.equal(sale.totals.furniture, 990000);
  assert.ok(sale.furniture.find(l => l.key === 'plant').overridden);
  const quote = { estimate: e, rates: db.rates, meta: { number: 'Q-1', createdAt: '2026-11-15T09:00:00Z', customer: '', project: '', scope: '', image: null, plan: '' } };
  assert.match(quoteHTML(quote), /퀸 침대/);
  assert.match(quoteHTML(quote), new RegExp(e.totals.grand.toLocaleString('ko-KR')));
  assert.equal(quoteCSV(quote).split('\r\n').length, 1 + e.lines.length + e.furniture.length + 7 + 2);
});
