import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Euler,Vector3} from 'three';
import {headingDegrees,hingedSegment,navigationRooms,planBounds,roomAt} from '../src/walkthrough/minimap-geometry.js';
const info=name=>JSON.parse(readFileSync(new URL(`../src/walkthrough/${name}`,import.meta.url)));

test('minimap headings follow Three.js forward on all cardinal and diagonal headings',()=>{
 for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2,.43]){
  const forward=new Vector3(0,0,-1).applyEuler(new Euler(0,yaw,0,'YXZ'));
  const angle=headingDegrees(yaw)*Math.PI/180;
  assert.ok(Math.abs(Math.sin(angle)-forward.x)<1e-12);
  assert.ok(Math.abs(-Math.cos(angle)-forward.z)<1e-12);
 }
});
test('actual basic/expanded room classification respects the measured expansion without mutation',()=>{
 const basic=info('basic-info.json'),expanded=info('model-info.json'),before=JSON.stringify([basic,expanded]);
 assert.equal(roomAt(navigationRooms(basic),4,8.6),undefined);
 assert.equal(roomAt(navigationRooms(expanded),4,8.6).id,'Bedroom center');
 assert.equal(roomAt(navigationRooms(basic),7.5,2).id,'Kitchen');
 assert.equal(roomAt(navigationRooms(basic),-20,-20),undefined);
 for(const rooms of [navigationRooms(basic),navigationRooms(expanded)]){
  const [x,z,w,d]=planBounds(rooms);
  for(const r of rooms){const [x1,z1,x2,z2]=r.bounds_m;assert.ok(x<x1&&z<z1&&x+w>x2&&z+d>z2);}
 }
 assert.equal(JSON.stringify([basic,expanded]),before);
});
test('door map endpoints retain hinge and leaf length through left/right and vertical swings',()=>{
 for(const axis of ['H','V'])for(const hingeSide of ['left','right'])for(const progress of [0,.4,1]){
  const [x,z,x2,z2]=hingedSegment({axis,hingeSide,hinge:[3,0,5],width:.82},progress);
  assert.deepEqual([x,z],[3,5]);assert.ok(Math.abs(Math.hypot(x2-x,z2-z)-.82)<1e-12);
 }
 assert.deepEqual(hingedSegment({axis:'H',hingeSide:'right',hinge:[.82,0,0],width:.82},0).slice(0,3),[.82,0,0]);
});
