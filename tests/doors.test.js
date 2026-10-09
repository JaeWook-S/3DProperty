import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, Mesh, Vector3 } from 'three';
import { createDoors, combinedWorld, collisionTree } from '../src/walkthrough/doors.js';
import { bodyAt, canStand, moveWithCollisions } from '../src/walkthrough/movement.js';

function hinge(axis) {
  const model = new Group();
  const mesh = new Mesh(new BoxGeometry(...(axis === 'H' ? [0.04, 2.13, 0.88] : [0.88, 2.13, 0.04])));
  mesh.position.set(axis === 'H' ? 0 : -0.45, 1.075, axis === 'H' ? 0.45 : 0);
  mesh.userData.object_id = 'leaf';
  model.add(mesh);
  const [door] = createDoors(model, [{ id: 'leaf', name: 'test', type: 'hinged', axis, width: 0.9, height: 2.15, hinge: [0, 0, 0] }]);
  return door;
}
for (const axis of ['H', 'V']) {
  test(`${axis} door blocks closed and clears passage when open, with hinge fixed`, () => {
    const door = hinge(axis);
    const passage = axis === 'H' ? new Vector3(0.45, 1.6, -0.1) : new Vector3(-0.1, 1.6, 0.45);
    const world = combinedWorld({ capsuleIntersect: () => false }, [door]);
    assert.equal(canStand(world, passage), false);
    const approach = axis === 'H' ? new Vector3(0.45, 1.6, -0.8) : new Vector3(-0.8, 1.6, 0.45);
    const delta = axis === 'H' ? new Vector3(0, 0, 1.6) : new Vector3(1.6, 0, 0);
    moveWithCollisions(world, approach, delta);
    assert.ok((axis === 'H' ? approach.z : approach.x) < -0.23);
    door.setProgress(1);
    assert.equal(canStand(world, passage), true);
    moveWithCollisions(world, approach, delta);
    assert.ok((axis === 'H' ? approach.z : approach.x) > 0.8);
    assert.deepEqual(door.pivot.position.toArray(), [0, 0, 0]);
    door.setProgress(0);
    assert.equal(canStand(world, passage), false);
  });
}
test('right-hinged bedroom door blocks the mirrored opening and keeps its hinge fixed', () => {
  const model = new Group();
  const mesh = new Mesh(new BoxGeometry(0.04, 2.13, 0.80));
  mesh.position.set(0.82, 1.075, 0.41);
  mesh.userData.object_id = 'right-leaf'; model.add(mesh);
  const [door] = createDoors(model, [{id: 'right-leaf', name: 'right', type: 'hinged', axis: 'H', hingeSide: 'right', width: 0.82, hinge: [0.82, 0, 0]}]);
  const world = combinedWorld({capsuleIntersect: () => false}, [door]);
  const passage = new Vector3(0.41, 1.6, 0);
  assert.equal(canStand(world, passage), false);
  door.setProgress(1);
  assert.equal(canStand(world, passage), true);
  const occupant = new Vector3(0.41, 1.6, -0.6);
  moveWithCollisions(world, occupant, new Vector3(0, 0, 1.2));
  assert.ok(occupant.z > 0.59);
  assert.deepEqual(door.pivot.position.toArray(), [0.82, 0, 0]);
  assert.equal(canStand(world, new Vector3(0.82, 1.6, 0.5)), false);
});
test('a closing leaf stops before intersecting the occupant and can reverse', () => {
  const door = hinge('H');
  door.setProgress(1);
  door.target = 0;
  const body = bodyAt(new Vector3(0.45, 1.6, 0.35));
  let blocked = false;
  for (let i = 0; i < 100; i++) {
    blocked ||= door.update(1 / 60, body).blocked;
  }
  assert.equal(blocked, true);
  assert.ok(door.progress > 0 && door.progress < 1);
  const hit = door.tree.capsuleIntersect(body);
  assert.ok(!hit || hit.depth < 0.0001);
  const stopped = door.progress;
  door.toggle();
  assert.notEqual(door.target, stopped);
});
test('two-panel balcony door opens a traversable half-width and retains the fixed half', () => {
  const model = new Group();
  const glass = new Mesh(new BoxGeometry(1.562, 2.24, 0.012));
  glass.position.set(0.781, 1.18, 0);
  glass.userData.object_id = 'glass';
  model.add(glass);
  const [door] = createDoors(model, [{ id: 'glass', name: 'balcony', type: 'sliding', width: 1.562, sourceObject: 'Balcony glazing' }]);
  const staticTree = collisionTree(model, (object) => !object.userData.collisionDisabled && !object.userData.doorId);
  const world = combinedWorld(staticTree, [door]);
  const left = new Vector3(0.36, 1.6, 0);
  assert.equal(canStand(world, left), false);
  door.setProgress(1);
  assert.equal(canStand(world, left), true);
  assert.equal(canStand(world, new Vector3(1.15, 1.6, 0)), false);
});
