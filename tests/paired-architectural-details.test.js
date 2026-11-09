import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Box3, Group, Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {archisketchWebData, bindArchisketchModel} from '../src/walkthrough/archisketch-model.js';
import {collisionTree, createDoors} from '../src/walkthrough/doors.js';
import {batchStaticMeshes} from '../src/walkthrough/static-batches.js';
import {staticCollisionMesh} from '../src/paired-floor/geometry.js';
import {createPairedArchitecturalDetails} from '../src/paired-floor/architectural-details.js';

async function load(variant) {
  const base = new URL(`../assets/models/acro-river-park/211a/archisketch-structure-v1/${variant}/`, import.meta.url);
  const metadata = JSON.parse(readFileSync(new URL('model-info.json', base)));
  const data = archisketchWebData(metadata);
  const bytes = readFileSync(new URL(`acro211a-${variant}-archisketch.glb`, base));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  bindArchisketchModel(gltf, data.info);
  const model = gltf.scene, doors = createDoors(model, data.doors);
  // Nonzero parent placement catches accidental use of world bounds as local
  // detail coordinates; hardware must remain attached through all transforms.
  const parent = new Group(); parent.position.set(7, 10.57, -13); parent.rotation.y = .37;
  parent.add(model); model.position.set(13.578, 0, -.059); model.rotation.y = Math.PI;
  parent.updateMatrixWorld(true);
  return {model, info: data.info, doors, metadata, parent};
}

function triangleSet(tree) {
  const triangles = new Set();
  const visit = node => {
    for (const triangle of node.triangles) triangles.add([triangle.a, triangle.b, triangle.c].map(p => p.toArray().join(',')).join('|'));
    for (const child of node.subTrees) visit(child);
  };
  visit(tree);
  return {count: triangles.size, sha256: createHash('sha256').update(JSON.stringify([...triangles].sort())).digest('hex')};
}

function sourceMeshes(model) {
  const meshes = [];
  model.traverse(object => { if (object.isMesh && !object.userData.pairedArchitecturalDetail && !object.userData.renderBatch) meshes.push(object); });
  return meshes;
}

// Transport uses each original mesh's geometry, never descendants of its leaf.
function transportBounds(door) {
  const bounds = [];
  door.moving.traverse(object => {
    if (!object.isMesh || object.userData.pairedArchitecturalDetail || object.userData.renderBatch) return;
    const box = new Box3().setFromBufferAttribute(object.geometry.attributes.position).applyMatrix4(object.matrixWorld);
    bounds.push([object.userData.object_id, box.min.toArray(), box.max.toArray()]);
  });
  return bounds;
}

for (const variant of ['basic', 'expanded']) {
  test(`211A ${variant}: source bounds, materials, moving collisions and transport volumes survive hardware`, async () => {
    const fixture = await load(variant), {model, doors, info, metadata, parent} = fixture;
    const source = sourceMeshes(model), metadataBefore = JSON.stringify(metadata), infoBefore = JSON.stringify(info);
    const snapshots = source.map(object => ({object, geometry: object.geometry, material: object.material,
      positions: object.geometry.attributes.position.array.slice(), transform: object.matrix.clone(), parent: object.parent,
      data: JSON.stringify(object.userData)}));
    const staticBefore = triangleSet(collisionTree(model, staticCollisionMesh));
    const movingBefore = new Map();
    for (const door of doors) {
      movingBefore.set(door, [0, .37, 1].map(progress => {
        door.setProgress(progress);
        return {triangles: triangleSet(door.tree), bounds: transportBounds(door)};
      }));
      door.setProgress(0);
    }
    const details = createPairedArchitecturalDetails(fixture);
    assert.equal(details.stats.hingedDoors, metadata.openings.filter(opening => opening.kind === 'door').length);
    assert.equal(details.stats.glazingPanels, metadata.openings.filter(opening => ['window', 'sliding'].includes(opening.kind)).length * 2);
    assert.deepEqual(details.stats.skipped, []);
    assert.ok(details.stats.triangleCount > 3000 && details.stats.triangleCount < 5000);
    assert.ok(details.stats.meshCount < 100);
    assert.equal(details.stats.newCollisionMeshes, 0); assert.equal(details.stats.ceilingMeshes, 0);
    assert.deepEqual(details.collisionMeshes, []);
    assert.equal(JSON.stringify(info), infoBefore); assert.equal(JSON.stringify(metadata), metadataBefore);
    assert.deepEqual(model.scale.toArray(), [1, 1, 1]);
    assert.equal(createPairedArchitecturalDetails(fixture), details, 'repeat installation must not duplicate hardware');
    for (const record of details.attachments) {
      assert.equal(record.group.parent, record.sourceObject);
      assert.ok(source.includes(record.sourceObject));
      assert.deepEqual(record.group.scale.toArray(), [1, 1, 1]);
      record.group.traverse(object => {
        assert.equal(object.userData.collisionDisabled, true);
        assert.equal(object.userData.pairedArchitecturalDetail, true);
        if (object.isMesh) {
          assert.equal(staticCollisionMesh(object), false);
          assert.ok([...object.geometry.attributes.position.array].every(Number.isFinite));
          assert.equal(object.userData.component, 'decoration');
        }
      });
    }
    assert.deepEqual(triangleSet(collisionTree(model, staticCollisionMesh)), staticBefore);
    for (const door of doors) {
      for (const [index, progress] of [0, .37, 1].entries()) {
        door.setProgress(progress);
        assert.deepEqual(triangleSet(door.tree), movingBefore.get(door)[index].triangles,
          `${door.definition.sourceOpening} collision at ${progress} must exclude visual descendants`);
        assert.deepEqual(transportBounds(door), movingBefore.get(door)[index].bounds);
      }
      door.setProgress(0);
    }
    parent.updateMatrixWorld(true);
    for (const before of snapshots) {
      assert.equal(before.object.geometry, before.geometry); assert.equal(before.object.material, before.material);
      assert.deepEqual(before.object.geometry.attributes.position.array, before.positions);
      assert.deepEqual(before.object.matrix.elements, before.transform.elements);
      assert.equal(before.object.parent, before.parent); assert.equal(JSON.stringify(before.object.userData), before.data);
    }
    details.dispose();
    assert.equal(sourceMeshes(model).length, source.length);
    assert.ok(details.attachments.every(record => !record.group.parent));
    assert.equal(model.getObjectsByProperty('isMesh', true).length, source.length);
  });

  test(`211A ${variant}: hinges and sliding pulls follow their actual carrier, including after batching`, async () => {
    const fixture = await load(variant), {doors, model, parent} = fixture;
    // Installing while partly open must still use the original local geometry.
    for (const door of doors) door.setProgress(.23);
    const details = createPairedArchitecturalDetails(fixture);
    const movingRecords = details.attachments.filter(record => record.moving);
    assert.ok(movingRecords.some(record => record.kind.startsWith('leaf')));
    assert.ok(movingRecords.some(record => record.kind.startsWith('panel')));
    const samples = movingRecords.map(record => {
      const mesh = record.group.children[0];
      const vertex = new Vector3().fromBufferAttribute(mesh.geometry.attributes.position, 0);
      const door = doors.find(candidate => candidate.definition.id === record.group.userData.doorId);
      return {record, mesh, vertex, door, before: vertex.clone().applyMatrix4(record.sourceObject.matrixWorld)};
    });
    batchStaticMeshes(model);
    for (const door of doors) door.setProgress(.81);
    parent.updateMatrixWorld(true);
    for (const {record, mesh, vertex, before} of samples) {
      assert.equal(mesh.visible, true, 'moving detail must not enter static render batches');
      assert.ok(!mesh.userData.renderBatched);
      const expected = vertex.clone().applyMatrix4(record.sourceObject.matrixWorld);
      assert.ok(expected.distanceTo(before) > .01, record.sourceObjectId);
      assert.ok(vertex.clone().applyMatrix4(mesh.matrixWorld).distanceTo(expected) < 1e-9);
    }
    details.dispose();
  });
}

test('unknown identities, missing carriers, malformed metadata and scaled models are skipped safely', async () => {
  const fixture = await load('expanded'), {model, info} = fixture;
  const source = sourceMeshes(model), leaf = source.find(object => object.userData.object_id === 'door-00/leaf');
  leaf.userData.object_id = 'unknown/leaf';
  const window = info.openings.find(opening => opening.kind === 'window');
  source.find(object => object.userData.object_id === `${window.id}/frame-top`).userData.object_id = 'unknown/frame';
  const malformed = info.openings.find(opening => opening.kind === 'door' && opening.id !== 'door-00');
  malformed.axis = 'diagonal';
  const details = createPairedArchitecturalDetails({...fixture, doors: []});
  assert.equal(details.stats.hingedDoors, 0);
  assert.ok(!details.attachments.some(record => record.openingId === window.id));
  assert.ok(details.stats.skipped.some(item => item.reason === 'invalid_opening_metadata'));
  assert.ok(details.stats.skipped.some(item => item.reason === 'unresolved_leaf_bounds_or_moving_door'));
  details.dispose();
  model.scale.setScalar(.8);
  const scaled = createPairedArchitecturalDetails(fixture);
  assert.equal(scaled.attachments.length, 0);
  assert.equal(scaled.stats.skipped[0].reason, 'requires_211a_source_model_at_scale_one');
  assert.deepEqual(model.scale.toArray(), [.8, .8, .8]);
  model.scale.setScalar(1);
  const unrelated = createPairedArchitecturalDetails({...fixture, info: {...info, unitType: '168C'}});
  assert.equal(unrelated.attachments.length, 0);
});
