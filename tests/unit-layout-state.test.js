import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutScope, layoutStorageKey, createUnitLayoutState} from '../src/property/unit-layout-state.js';

const variant = '168c-expanded-archisketch';
const address = (building = '100', floor = 3, unit = '305') => ({locationId: 'acro-river-park', building, floor, unit});

test('real addresses have separate storage scopes even when they reuse one model', () => {
  const a = address(), b = address('100', 4, '405');
  assert.equal(layoutScope(a, variant), `unit:acro-river-park:100:3:305:${variant}:1`);
  assert.equal(layoutScope({...a, floor: '3'}, variant), layoutScope(a, variant));
  assert.notEqual(layoutScope(a, variant), layoutScope(b, variant));
  assert.notEqual(layoutStorageKey(a, variant), layoutStorageKey(b, variant));
  assert.equal(layoutStorageKey(a, variant), `cortex-layout-v4:unit:acro-river-park:100:3:305:${variant}:1`);
  assert.notEqual(layoutScope(a, variant, 2), layoutScope(a, variant));
  assert.notEqual(layoutScope(a, '168c-basic-archisketch'), layoutScope(a, variant));
});

test('catalogued unsupported households remain separate while fabricated selections stay samples', () => {
  // 101동 305호 is a real 110.66G unit, with no prepared 3D variant.
  assert.equal(layoutScope(address('101', 3, '305'), variant), `unit:acro-river-park:101:3:305:${variant}:1`);
  for (const selection of [undefined, null, {}, address('999'), address('100', 4, '305'),
    address('100', 3, '9999'), address(100), address('100', 3.5), address('100', 3, 305),
    {...address(), locationId: 'other-complex'}, {...address(), locationId: ''},
    {...address('101', 1, '103'), unitType: '168C', typeScope: 'unit_type'}]) {
    assert.equal(layoutScope(selection, variant, 'rev-2'), `sample:${variant}:rev-2`);
    assert.equal(layoutStorageKey(selection, variant, 'rev-2'), `cortex-layout-v3:${variant}:rev-2`);
  }
  assert.equal(layoutScope({...address(), unitType: 'forged-type'}, variant), layoutScope(address(), variant));
});

test('switching between households preserves independent drafts and room assignments', () => {
  const state = createUnitLayoutState();
  const a = layoutScope(address(), variant), b = layoutScope(address('100', 4, '405'), variant);
  let currentLayout = null;
  const hooks = {capture: () => currentLayout, restore: value => { currentLayout = value; }};
  assert.equal(state.current, null);
  assert.equal(state.epoch, 0);
  assert.equal(state.switchTo(a, hooks), true);
  assert.equal(currentLayout, null);
  const draftA = {items: [{id: 'added-1', x: 4, z: 6, angle: 0}], assignments: [['added-1', 'living']]};
  currentLayout = draftA;
  state.switchTo(b, hooks);
  assert.equal(currentLayout, null);
  currentLayout = {items: [{id: 'added-1', x: 9, z: 2, angle: Math.PI / 2}], assignments: [['added-1', 'bedroom-2']]};
  draftA.items[0].x = 999;
  draftA.assignments[0][1] = 'mutated-after-capture';
  state.switchTo(a, hooks);
  assert.deepEqual(currentLayout, {items: [{id: 'added-1', x: 4, z: 6, angle: 0}], assignments: [['added-1', 'living']]});
  state.switchTo(b, hooks);
  assert.equal(currentLayout.items[0].x, 9);
  assert.equal(currentLayout.assignments[0][1], 'bedroom-2');
});

test('restored snapshots do not alias stored data or another household', () => {
  const state = createUnitLayoutState();
  const saved = {items: [{id: 'chair', x: 1}], assignments: [['chair', 'living']]};
  let delivered;
  const capture = () => saved;
  const restore = value => { delivered = value; };
  state.switchTo('a', {capture, restore});
  state.switchTo('b', {capture, restore});
  state.switchTo('a', {capture, restore});
  assert.notStrictEqual(delivered, saved);
  delivered.items[0].x = 99;
  assert.equal(saved.items[0].x, 1);
  state.switchTo('b', {capture, restore});
  assert.equal(delivered.items[0].x, 1);
});

test('same-scope updates are no-ops and A to B to A invalidates old async tokens', () => {
  const state = createUnitLayoutState();
  let captures = 0, restores = 0;
  const hooks = {capture: () => { captures++; return {items: []}; }, restore: () => { restores++; }};
  state.switchTo('a', hooks);
  const firstA = state.token();
  assert.equal(state.isCurrent(firstA), true);
  assert.equal(state.switchTo('a', hooks), false);
  assert.deepEqual([captures, restores, state.epoch], [0, 1, 1]);
  assert.equal(state.isCurrent(firstA), true);
  state.switchTo('b', hooks);
  assert.equal(state.isCurrent(firstA), false);
  const b = state.token();
  state.switchTo('a', hooks);
  assert.equal(state.current, 'a');
  assert.equal(state.isCurrent(firstA), false);
  assert.equal(state.isCurrent(b), false);
  assert.equal(state.isCurrent(state.token()), true);
  for (const token of [undefined, null, {}, {scope: 'a', epoch: '3'}]) assert.equal(state.isCurrent(token), false);
});

test('a failed capture cannot discard the current household or change its token', () => {
  const state = createUnitLayoutState();
  state.switchTo('a', {capture: () => null, restore: () => {}});
  const before = state.token();
  assert.throws(() => state.switchTo('b', {capture: () => { throw Error('capture failed'); }, restore: () => assert.fail('must not restore')}), /capture failed/);
  assert.equal(state.isCurrent(before), true);
  assert.equal(state.current, 'a');
});
