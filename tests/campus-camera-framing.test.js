import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry, Group, Mesh, PerspectiveCamera, Vector3} from 'three';
import {fitPerspectiveEnvelope, meshEnvelopePoints} from '../src/campus/camera-framing.js';

function building() {
  const parent = new Group(), group = new Group();
  parent.position.set(58, 0, 92); parent.rotation.y = -.51;
  parent.add(group);
  const mesh = new Mesh(new BoxGeometry(110, 26, 42));
  mesh.position.set(0, 13, -21); group.add(mesh);
  return {parent, group, points:meshEnvelopePoints(group)};
}
function project(points, pose, aspect) {
  const camera = new PerspectiveCamera(43, aspect, 5, 5000);
  camera.position.fromArray(pose.position); camera.lookAt(...pose.target); camera.updateMatrixWorld();
  return points.map(p => new Vector3(...p).project(camera));
}
test('wide and portrait canvases fit a rotated building including near-side depth', () => {
  const {points} = building();
  for (const aspect of [1440/720, 390/594, 390/780, 780/390]) {
    const pose = fitPerspectiveEnvelope({points,target:[58,9,92],position:[7,13,184],fov:43,aspect});
    for (const p of project(points,pose,aspect)) {
      assert(Math.abs(p.x) <= .860000001);
      assert(Math.abs(p.y) <= .780000001);
      assert(p.z > -1 && p.z < 1);
    }
  }
});
test('fitted direction already respects the orbit polar constraint', () => {
  const {points} = building(),target=[58,9,92];
  const pose=fitPerspectiveEnvelope({points,target,position:[7,13,184],fov:43,aspect:390/594});
  const back=new Vector3(...pose.position).sub(new Vector3(...target)).normalize();
  assert(Math.acos(back.y)<=Math.PI*.47+1e-12);
  assert.deepEqual(pose.target,target);
});
test('envelope collection preserves geometry and ancestor transforms', () => {
  const {group,parent}=building(),mesh=group.children[0];
  const before=Array.from(mesh.geometry.attributes.position.array),matrix=parent.matrixWorld.clone();
  const points=meshEnvelopePoints(group);
  assert.equal(points.length,8);
  assert.deepEqual(Array.from(mesh.geometry.attributes.position.array),before);
  assert(parent.matrixWorld.equals(matrix));
  for(const p of points){const local=group.worldToLocal(new Vector3(...p));assert(Math.abs(local.x)<=55.000001);assert(local.y>=-1e-6&&local.y<=26.000001);}
});
test('zero-size/hidden canvas cannot produce a fit or invalid camera', () => {
  const {points}=building();
  assert.throws(()=>fitPerspectiveEnvelope({points,target:[0,0,0],position:[0,10,100],fov:43,aspect:0}),RangeError);
});
