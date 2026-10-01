import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Mesh, BoxGeometry, Vector3 } from 'three';
import { BoundedOctree } from '../src/walkthrough/bounded-octree.js';
import { moveWithCollisions, canStand } from '../src/walkthrough/movement.js';

test('dense coplanar architectural geometry respects depth budget and still blocks the body', () => {
  const scene = new Group();
  const wall = new Mesh(new BoxGeometry(4, 2.7, 0.04, 32, 32, 1));
  wall.position.set(0, 1.35, -1); scene.add(wall);
  const tree = new BoundedOctree(); tree.maxLevel = 4;
  tree.fromGraphNode(scene);
  let depth = 0, nodes = 0;
  const inspect = (node, d = 0) => { depth = Math.max(depth, d); nodes++; node.subTrees.forEach((child) => inspect(child, d + 1)); };
  inspect(tree);
  assert.ok(depth <= 4); assert.ok(nodes < 5000);
  const player = new Vector3(0, 1.6, 0);
  moveWithCollisions(tree, player, new Vector3(0, 0, -2));
  assert.ok(player.z > -0.77 && player.z < -0.7);
  assert.ok(canStand(tree, player));
});
