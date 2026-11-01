import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Mesh, BoxGeometry, MeshStandardMaterial, Raycaster, Vector3, Box3 } from 'three';
import { batchStaticMeshes } from '../src/walkthrough/static-batches.js';
import { collisionTree } from '../src/walkthrough/doors.js';
import { canStand } from '../src/walkthrough/movement.js';

test('batching preserves world bounds and logical picking while leaving furniture/doors independent', () => {
  const root = new Group(); root.position.set(4,0,-2);
  const material = new MeshStandardMaterial();
  const a = new Mesh(new BoxGeometry(1,2,.1),material);
  a.position.set(0,1,0);a.userData.object_id='wall-a';
  const b = a.clone();b.position.x=2;b.userData.object_id='wall-b';
  root.add(a,b);
  const door = new Group();door.userData.doorId='door';door.position.x=4;
  const leaf=a.clone();door.add(leaf);root.add(door);
  const furniture=new Group();furniture.userData.stagingId='chair';furniture.position.x=6;
  const seat=a.clone();furniture.add(seat);root.add(furniture);
  root.updateMatrixWorld(true);
  const positions = Array.from(a.geometry.attributes.position.array);
  const bounds = new Box3().setFromObject(root).clone();
  const result = batchStaticMeshes(root);
  assert.equal(result.sourceMeshes,2);assert.equal(result.drawMeshes,1);
  assert.ok(new Box3().setFromObject(root).equals(bounds));
  assert.deepEqual(Array.from(a.geometry.attributes.position.array),positions);
  assert.equal(leaf.visible,true);assert.equal(seat.visible,true);
  const ray=new Raycaster(new Vector3(4,1,2),new Vector3(0,0,-1));
  assert.equal(ray.intersectObjects([a,b],false)[0].object.userData.object_id,'wall-a');
  assert.equal(result.batches[0].material,material);
  assert.equal(batchStaticMeshes(root).sourceMeshes,0);
  assert.equal(canStand(collisionTree(root),new Vector3(4,1.6,-1.8)),false);
});

test('transparent glass remains separate for correct sorting and does not join opaque batches', () => {
  const root=new Group(),glass=new MeshStandardMaterial({transparent:true,opacity:.3});
  root.add(new Mesh(new BoxGeometry(),glass),new Mesh(new BoxGeometry(),glass));
  assert.equal(batchStaticMeshes(root).savedDraws,0);
  assert.ok(root.children.every(o=>o.visible));
});
