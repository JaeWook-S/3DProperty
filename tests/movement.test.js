import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Mesh, BoxGeometry, Group } from 'three';
import { Octree } from 'three/addons/math/Octree.js';
import { movementVector, moveWithCollisions, canStand, BODY_RADIUS } from '../src/walkthrough/movement.js';

function box(group, x, z, width, depth, height = 2.7) {
  const mesh = new Mesh(new BoxGeometry(width, height, depth));
  mesh.position.set(x, height / 2, z);
  group.add(mesh);
}
function moveSeconds(world, p, forward, right, seconds, fps) {
  for (let n = 0; n < seconds * fps; n++) moveWithCollisions(world, p, movementVector(forward, right, 0, 1 / fps));
}
test('one second is 1.20 meters at 30/60/144 Hz, including diagonals', () => {
  for (const fps of [30, 60, 144]) {
    for (const [forward, right] of [[1, 0], [1, 1]]) {
      const p = new Vector3(0, 1.6, 0);
      const world = { capsuleIntersect: () => false };
      moveSeconds(world, p, forward, right, 1, fps);
      assert.ok(Math.abs(Math.hypot(p.x, p.z) - 1.2) < 1e-9);
      assert.equal(p.y, 1.6);
    }
  }
});
test('a long inactive frame cannot teleport the player', () => {
  assert.ok(movementVector(1, 0, 0, 10).length() <= 0.06);
});
test('closed thin wall stops movement, including a large requested delta', () => {
  const group = new Group();
  box(group, 0, -1, 6, 0.04);
  const world = new Octree().fromGraphNode(group);
  const p = new Vector3(0, 1.6, 0);
  moveWithCollisions(world, p, new Vector3(0, 0, -4));
  assert.ok(p.z >= -0.98 + BODY_RADIUS - 0.001);
  assert.ok(p.z < -0.7);
  assert.equal(p.y, 1.6);
  assert.ok(canStand(world, p));
});
test('a 90cm doorway remains passable between actual wall triangles', () => {
  const group = new Group();
  box(group, -1.225, -1, 1.55, 0.15);
  box(group, 1.225, -1, 1.55, 0.15);
  const world = new Octree().fromGraphNode(group);
  const p = new Vector3(0, 1.6, 0);
  moveSeconds(world, p, 1, 0, 2, 60);
  assert.ok(Math.abs(p.z + 2.4) < 1e-8);
});
test('diagonal movement slides along a wall without climbing or penetration', () => {
  const group = new Group();
  box(group, 1, 0, 0.15, 8);
  const world = new Octree().fromGraphNode(group);
  const p = new Vector3(0, 1.6, 0);
  moveSeconds(world, p, 1, 1, 2, 60);
  assert.ok(p.x < 0.71 && p.x > 0.69);
  assert.ok(p.z < -1.6);
  assert.equal(p.y, 1.6);
  assert.ok(canStand(world, p));
});
