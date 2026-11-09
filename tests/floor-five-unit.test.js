import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {FIVE_UNIT_LAYOUT as layout, FIVE_UNIT_MODEL_SOURCES as sources,
  fiveUnitSitePlacement, createFiveUnitAssetCache, loadFiveUnitFloor} from '../src/walkthrough/floor-five-unit.js';

const near = (actual, expected, epsilon = 1e-10) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
const metadata = {unit_type: 'fixture', revision: 'fixture', rooms: [{id: 'living-kitchen-hall'}]};

test('only 100동 10F; five distinct unit IDs map to four source types without scaling or reflection', () => {
  assert.equal(layout.building, '100'); assert.equal(layout.floor, 10);
  assert.deepEqual(layout.units.map(u => [u.id, u.type]), [
    ['1001', '168d'], ['1002', '145f'], ['1003', '145f'], ['1004', '211a'], ['1005', '168c'],
  ]);
  for (const unit of layout.units) { assert.deepEqual(unit.scale, [1, 1, 1]); assert.equal(unit.reflection, false); }
  assert.equal(layout.actualCommonAreaVerified, false); assert.equal(layout.actualFloorOutlineVerified, false);
  assert.ok(layout.overflowOSM_m2.expanded > 48 && layout.overflowOSM_m2.expanded < 49);
  assert.ok(!JSON.stringify(layout).includes('/home/'));
});

test('candidate poses transform to existing site XZ exactly, preserving local points and determinant', () => {
  const expected = {
    '1001': [15.510637697144752, 37.0250794715101, 5.215296562744542],
    '1002': [-4.604962240675135, 56.650604439717746, .502907582359852],
    '1003': [-19.346883129724983, 63.04792954486878, .502907582359852],
    '1004': [-37.54955433299548, 72.49052135614963, .502907582359852],
    '1005': [-18.36135685257343, 61.76467506690862, 3.644500235949645],
  };
  const a = layout.coordinateTransform.siteRotationYRadians;
  const [ox, oz] = layout.coordinateTransform.reviewDomainMin_m;
  for (const unit of layout.units) {
    const pose = fiveUnitSitePlacement(unit), [x, z, yaw] = expected[unit.id];
    near(pose.translation[0], x); near(pose.translation[2], z); near(pose.rotationYRadians, yaw);
    assert.equal(pose.translation[1], 0); assert.equal(pose.scale, 1);
    const direct = new THREE.Matrix4().makeTranslation(...pose.translation)
      .multiply(new THREE.Matrix4().makeRotationY(pose.rotationYRadians));
    const composed = new THREE.Matrix4().makeRotationY(a)
      .multiply(new THREE.Matrix4().makeTranslation(ox + unit.reviewTranslation_m[0], 0, oz + unit.reviewTranslation_m[1]))
      .multiply(new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(unit.reviewYawDegrees)));
    for (const local of [[0, 0, 0], [2.73, 2.3, 5.81], [-.1, .2, 12]]) {
      const p = new THREE.Vector3(...local).applyMatrix4(direct), q = new THREE.Vector3(...local).applyMatrix4(composed);
      near(p.distanceTo(q), 0);
    }
    near(direct.determinant(), 1);
  }
});

test('eight literal models and private metadata match review hashes; public metadata is reduced', async () => {
  assert.equal(Object.values(sources).reduce((n, variants) => n + Object.keys(variants).length, 0), 8);
  for (const [type, variants] of Object.entries(sources)) for (const [variant, source] of Object.entries(variants)) {
    const expected = layout.sources[type][variant];
    assert.equal(source.info, undefined);
    assert.deepEqual(Object.keys(expected.metadata).sort(), ['revision', 'rooms', 'unit_type', 'variant']);
    assert.ok(expected.metadata.rooms.every(room => Object.keys(room).every(key => ['id', 'name', 'kind'].includes(key))));
    for (const [key, hashKey] of [['glb', 'glbSha256'], ['info', 'metadataSha256']]) {
      const url = key === 'glb' ? new URL(source.glb) : new URL('./model-info.json', source.glb);
      const bytes = await readFile(url);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), expected[hashKey], `${type}/${variant}/${key}`);
    }
  }
});

test('same-type units share pending source downloads and failed requests can retry', async () => {
  let glbCalls = 0, metadataCalls = 0, prepared = 0, fail = true;
  const cache = createFiveUnitAssetCache({
    loadGLTF: async () => { glbCalls++; if (fail) throw Error('fixture network failure'); return {scene: new THREE.Group()}; },
    loadMetadata: async () => { metadataCalls++; return metadata; },
    prepare: () => { prepared++; },
  });
  await assert.rejects(cache.get('145f', 'expanded'), /fixture network failure/);
  assert.equal(cache.size, 0); fail = false;
  const one = cache.get('145f', 'expanded'), two = cache.get('145f', 'expanded');
  assert.equal(one, two); assert.equal(await one, await two);
  await cache.get('145f', 'expanded');
  assert.equal(glbCalls, 2); assert.equal(metadataCalls, 2); assert.equal(prepared, 1);
  await cache.get('145f', 'basic'); assert.equal(glbCalls, 3);
  await assert.rejects(cache.get('unknown', 'expanded'), /지원하지/);
});

test('five independent placed clones retain source geometry and distinct bounds; common area stays empty', async () => {
  const template = new THREE.Group(), material = new THREE.MeshStandardMaterial();
  for (const x of [0, 2]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), material);
    mesh.position.set(x, 1, 0); mesh.userData.component = 'wall'; template.add(mesh);
  }
  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(100, 1, 100), material);
  ceiling.userData.component = 'ceiling'; ceiling.position.y = 40; template.add(ceiling);
  const positions = template.children[0].geometry.attributes.position.array.slice();
  let downloads = 0;
  const cache = createFiveUnitAssetCache({loadGLTF: async () => { downloads++; return {scene: template}; },
    loadMetadata: async () => metadata, prepare: () => {}});
  const labels = [];
  const result = await loadFiveUnitFloor('expanded', {assetCache: cache, labelFactory: (text, position) => {
    labels.push(text); const sprite = new THREE.Sprite(new THREE.SpriteMaterial()); sprite.name = text; sprite.position.copy(position); return sprite;
  }});
  assert.equal(downloads, 4); assert.equal(result.units.length, 5); assert.equal(result.root.visible, false);
  assert.equal(new Set(result.units.map(u => u.model.uuid)).size, 5);
  assert.deepEqual(labels, layout.units.map(u => `${u.id}호 · ${u.type.toUpperCase()}`));
  assert.equal(result.common.group.children.length, 0); assert.equal(result.common.stats.elevator, null);
  const expected = new THREE.Box3();
  for (const unit of result.units) {
    assert.deepEqual(unit.model.scale.toArray(), [1, 1, 1]); assert.equal(unit.doors.length, 0);
    const box = new THREE.Box3(new THREE.Vector3(-.5, 0, -.5), new THREE.Vector3(2.5, 2, .5))
      .applyMatrix4(unit.model.matrixWorld);
    expected.union(box);
    near(result.boundsByUnit[unit.id].min.distanceTo(box.min), 0);
    near(result.boundsByUnit[unit.id].max.distanceTo(box.max), 0);
  }
  near(result.bounds.min.distanceTo(expected.min), 0); near(result.bounds.max.distanceTo(expected.max), 0);
  const bothF = result.boundsByUnit['1002'].clone().union(result.boundsByUnit['1003']);
  assert.ok(result.boundsByUnit['145f'].equals(bothF));
  assert.ok(result.batching.sourceMeshes >= 10);
  assert.ok(template.children.every(n => n.visible));
  assert.deepEqual(template.children[0].geometry.attributes.position.array, positions);
  assert.deepEqual(template.position.toArray(), [0, 0, 0]);
  await assert.rejects(loadFiveUnitFloor('invalid'), /기본형/);
});
