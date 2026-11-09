import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Vector3 } from 'three';
import { AUTHORED_168C_INTERIOR_LIGHTS, createInteriorLightRig } from '../src/walkthrough/interior-light-rig.js';

const model = { unitType: '168C', variant: 'expanded', bounds_m: [0, 0, 21.482, 12.351], ceilingHeight_m: 2.5 };
test('reference source transforms retain Blender coordinates and downward AREA emission', () => {
  const rig = createInteriorLightRig({ maxLights: 13 }); rig.setModel(model);
  assert.equal(rig.inspect().sourceCount, 13); assert.equal(rig.group.visible, false);
  const expected = AUTHORED_168C_INTERIOR_LIGHTS.find(x => x.name === 'Kitchen task light');
  const light = rig.group.children.find(x => x.name === expected.name);
  assert.deepEqual(light.position.toArray(), [11.949999809265137, 2.390000104904175, 9.399999618530273]);
  assert.equal(light.width, 2); assert.equal(light.height, 2);
  const direction = new Vector3(0, 0, -1).applyQuaternion(light.quaternion);
  assert.ok(direction.distanceTo(new Vector3(0, -1, 0)) < 1e-12);
  assert.equal(rig.inspect().sources.some(x => x.name === 'Sky'), false);
  assert.equal(light.castShadow, false); rig.dispose();
});
test('bounded focus pool, explicit enable, presets and calibration do not mutate input metadata', () => {
  const info = structuredClone(model), initial = JSON.stringify(info), rig = createInteriorLightRig();
  rig.setModel(info); rig.updateFocus([19, 1.6, 6.4]); rig.setEnabled(true);
  const before = rig.inspect(); assert.equal(before.activeCount, 6); assert.equal(before.visible, true);
  assert.ok(before.sources.some(x => x.name === 'Living fill'));
  rig.setLighting('night'); const night = rig.inspect();
  assert.deepEqual(night.sources.map(x => x.position), before.sources.map(x => x.position));
  assert.ok(night.sources[0].intensity > before.sources[0].intensity);
  rig.setGain(0); assert.ok(rig.inspect().sources.every(x => x.intensity === 0));
  rig.setEnabled(false); assert.equal(rig.group.visible, false); assert.equal(JSON.stringify(info), initial);
  assert.throws(() => rig.setLighting('bad')); assert.throws(() => rig.updateFocus([NaN, 0, 0])); rig.dispose();
});
test('variant switch replaces authored coordinates with bounded fallback and disposes cleanly', () => {
  const rig = createInteriorLightRig(), scene = new Scene(); scene.add(rig.group); rig.setModel(model); rig.setEnabled(true);
  rig.setModel({ unitType: '112A', variant: 'basic', ceilingHeight_m: 2.6, bounds_m: [0, 0, 14, 9], lightPositions: [[3, 4], [8, 7]] });
  const state = rig.inspect(); assert.equal(state.sourceCount, 2); assert.equal(state.activeCount, 2);
  assert.ok(state.sources.every(x => x.sourceBasis === 'room_representative_point_appearance_assumption'));
  assert.ok(state.sources.every(x => Math.abs(x.position[1] - 2.48) < 1e-12));
  rig.dispose(); assert.equal(scene.children.length, 0); assert.equal(rig.group.children.length, 0);
  assert.throws(() => rig.setModel(model)); rig.dispose();
});

test('reference camera keeps kitchen/living in raster six while PT snapshot includes all thirteen independently', () => {
  const rig = createInteriorLightRig(); rig.setModel(model); rig.updateFocus([19, 1.6, 6.4]);
  const raster = rig.inspect(), rasterNames = raster.sources.map(x => x.name);
  assert.ok(rasterNames.includes('Kitchen task light')); assert.ok(rasterNames.includes('Living fill'));
  const before = JSON.stringify(raster), snapshot = rig.createPathtraceLights();
  assert.equal(snapshot.length, 13); assert.equal(rig.group.children.length, 6);
  assert.deepEqual(snapshot.map(x => x.name).sort(), AUTHORED_168C_INTERIOR_LIGHTS.map(x => x.name).sort());
  assert.ok(snapshot.every(x => x.parent === null && x.visible && x.userData.pathtraceSnapshot));
  for (const light of snapshot) {
    const ref = AUTHORED_168C_INTERIOR_LIGHTS.find(x => x.name === light.name);
    assert.deepEqual(light.position.toArray(), ref.position); assert.equal(light.width, ref.width); assert.equal(light.height, ref.height);
    const pooled = rig.group.children.find(x => x.name === light.name);
    if (pooled) { assert.notEqual(light, pooled); assert.notEqual(light.color, pooled.color); assert.notEqual(light.userData, pooled.userData); assert.equal(light.intensity, pooled.intensity); }
  }
  snapshot[0].position.set(90, 90, 90); snapshot[0].color.setRGB(0, 0, 0);
  assert.equal(JSON.stringify(rig.inspect()), before);
  const originalIntensity = snapshot[1].intensity;
  rig.setLighting('night'); assert.equal(snapshot[1].intensity, originalIntensity);
  const night = rig.createPathtraceLights(); assert.ok(night[1].intensity > originalIntensity);
  rig.dispose(); assert.throws(() => rig.createPathtraceLights());
});
test('PT snapshot uses current fallback model after switching variants, not old 168C sources', () => {
  const rig = createInteriorLightRig({ maxLights: 1 }); rig.setModel(model);
  rig.setModel({ unitType: '168C', variant: 'basic', ceilingHeight_m: 2.5, lightPositions: [[2, 3], [5, 6]] });
  const snapshot = rig.createPathtraceLights(); assert.equal(snapshot.length, 2); assert.equal(rig.inspect().activeCount, 1);
  assert.ok(snapshot.every(x => x.userData.sourceBasis === 'room_representative_point_appearance_assumption'));
  assert.deepEqual(snapshot.map(x => [x.position.x, x.position.z]), [[2, 3], [5, 6]]);
  rig.dispose();
});
