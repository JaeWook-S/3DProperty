import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Mesh, BoxGeometry, MeshStandardMaterial } from 'three';
import { createSurfaceTargets, surfaceRenderParts } from '../src/walkthrough/surface-targets.js';
import { batchStaticMeshes } from '../src/walkthrough/static-batches.js';

const material = () => new MeshStandardMaterial();
function wall(root, id, x, bottom, width = 4, height = 1, mat = material()) {
  const geometry = new BoxGeometry(width, height, .2); geometry.translate(x, bottom + height / 2, 0);
  const mesh = new Mesh(geometry, mat);
  mesh.userData = { component: 'wall', object_id: id, inferred_wall: true, collision: true, layer_bottom_m: bottom };
  root.add(mesh); return mesh;
}
const front = registry => [...registry.targets.values()].filter(t => t.kind === 'wall' && t.normal.z > .99);
test('connected layers and partial shared edges form one wall side; opposite, corners and disconnected walls stay separate', () => {
  const root = new Group(), mat = material();
  wall(root, 'Wall/layer-00/a', 0, 0, 4, 1, mat);
  wall(root, 'Wall/layer-01/a', -1, 1, 2, 1, mat);
  wall(root, 'Wall/layer-01/b', 1, 1, 2, 1, mat);
  wall(root, 'Wall/layer-00/c', 8, 0, 2, 2, mat);
  const registry = createSurfaceTargets(root), sides = front(registry);
  assert.equal(sides.length, 2); const joined = sides.find(t => t.sourceIds.length === 3);
  assert.ok(joined); assert.equal(joined.faces.length, 6);
  assert.ok(joined.faces.every(t => t.normal.z > .99));
  assert.ok([...registry.targets.values()].some(t => t.normal.z < -.99 && t.id !== joined.id));
  assert.ok([...registry.targets.values()].every(t => Math.abs(t.normal.y) < .001));
  const parts = surfaceRenderParts(joined); assert.equal(parts.length, 1); assert.equal(parts[0].geometry.index.count, 18);
});
test('floor top spans the independent room, excludes bottom and sides, and furniture is unsupported', () => {
  const root = new Group(), mat = material();
  for (const [i, component] of ['floor', 'floor', 'kitchen_fixture', 'furniture'].entries()) {
    const mesh = new Mesh(new BoxGeometry(2, .1, 2), mat); mesh.position.x = i * 3;
    mesh.userData = { component, object_id: `${component}/${i}`, room_id: `room-${i}` }; root.add(mesh);
  }
  const registry = createSurfaceTargets(root), targets = [...registry.targets.values()];
  assert.equal(targets.length, 2); assert.ok(targets.every(t => t.faces.length === 2 && t.normal.y > .99));
  assert.notEqual(targets[0].id, targets[1].id);
});
test('surface identities do not depend on UUID, insertion order or render batching; source/cap buffers remain unchanged', () => {
  function build(reverse = false) {
    const root = new Group(), mat = material();
    for (const i of reverse ? [1, 0] : [0, 1]) wall(root, `Wall/layer-0${i}/00`, 0, i, 4, 1, mat);
    return root;
  }
  const a = build(), b = build(true);
  const before = a.children.map(m => ({ geometry: m.geometry, material: m.material, index: [...m.geometry.index.array], position: [...m.geometry.attributes.position.array] }));
  const ids = r => [...createSurfaceTargets(r).targets.keys()].sort();
  assert.deepEqual(ids(a), ids(b));
  const stats = batchStaticMeshes(a), afterBatch = a.children.filter(m => m.userData.renderBatch).map(m => [...m.geometry.index.array]);
  const first = ids(a); assert.deepEqual(first, ids(b));
  for (const t of createSurfaceTargets(a).targets.values()) surfaceRenderParts(t).forEach(p => p.geometry.dispose());
  assert.deepEqual(ids(a), first);
  before.forEach((saved, i) => { const m = a.children[i]; assert.equal(m.geometry, saved.geometry); assert.equal(m.material, saved.material); assert.deepEqual([...m.geometry.index.array], saved.index); assert.deepEqual([...m.geometry.attributes.position.array], saved.position); });
  assert.deepEqual(a.children.filter(m => m.userData.renderBatch).map(m => [...m.geometry.index.array]), afterBatch);
  assert.ok(stats);
});
