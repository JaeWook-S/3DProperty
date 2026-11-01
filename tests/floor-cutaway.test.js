import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {floorCutawayState,createFloorCutaway} from '../src/walkthrough/floor-cutaway.js';
function fixture(id='104'){
 const texture=new THREE.Texture(),material=new THREE.MeshStandardMaterial({map:texture});
 return {id,floors:10,height_m:35,tower:new THREE.Group(),label:new THREE.Object3D(),
  cutawayMaterials:[material,new THREE.LineBasicMaterial()],parts:[{levels:10,height_m:35,footprint_m:[[0,0],[4,0],[4,3],[0,3]]},{levels:2,height_m:7,footprint_m:[[4,0],[6,0],[6,3],[4,3]]}]};
}
test('nominal source heights stay exact; clipping/plate have separate display offsets',()=>{
 const state=floorCutawayState(fixture(),7);
 assert.equal(state.nominalTop_m,24.5);assert.equal(state.bottom_m,21);assert.equal(state.clipTop_m,24.49);assert.equal(state.plateY_m,21.02);
});
test('no selection, invalid floor and beyond-envelope floors never clamp to a false floor',()=>{
 for(const n of [null,0,-1,11,NaN,2.5])assert.equal(floorCutawayState(fixture(),n).active,false);
 assert.equal(floorCutawayState(fixture(),3,{selected:false}).active,false);
 assert.equal(floorCutawayState(fixture(),11).requestedFloor,11);
});
test('only selected building is clipped; lower roof parts do not get invented plates',()=>{
 const a=fixture(),b=fixture('105'),controller=createFloorCutaway([a,b]);
 controller.update(a,7,{});
 assert.equal(a.cutawayMaterials[0].clippingPlanes.length,1);assert.equal(b.cutawayMaterials[0].clippingPlanes,null);
 assert.deepEqual(controller.inspect().buildings[0].plates.map(p=>p.visible),[true,false]);
 assert.ok(Math.abs(a.label.position.y-32.49)<1e-10);assert.equal(b.label.position.y,43);
 const plane=a.cutawayMaterials[0].clippingPlanes[0];assert.ok(plane.distanceToPoint(new THREE.Vector3(0,30,0))<0);assert.ok(plane.distanceToPoint(new THREE.Vector3(0,5,0))>0);
});
test('switch and toggle restore original material planes, shadow policy and labels',()=>{
 const a=fixture(),b=fixture('105');const plane=new THREE.Plane(new THREE.Vector3(1,0,0),10),original=[plane];
 a.cutawayMaterials[0].clippingPlanes=original;a.cutawayMaterials[0].clipIntersection=true;
 const c=createFloorCutaway([a,b]);c.update(a,7,{});c.update(b,3,{});
 assert.equal(a.cutawayMaterials[0].clippingPlanes,original);assert.equal(a.cutawayMaterials[0].clipShadows,false);assert.equal(a.cutawayMaterials[0].clipIntersection,true);assert.equal(a.label.position.y,43);
 c.update(b,3,{enabled:false});assert.equal(b.cutawayMaterials[0].clippingPlanes,null);assert.ok(c.inspect().buildings.every(r=>r.plates.every(p=>!p.visible)));
});
test('ray filtering rejects only removed surfaces and resumes when disabled',()=>{
 const a=fixture(),b=fixture('105'),c=createFloorCutaway([a,b]);c.update(a,3,{});
 const hit=(id,y)=>({object:{userData:{buildingId:id}},point:new THREE.Vector3(0,y,0)});
 assert.equal(c.acceptsHit(hit('104',20)),false);assert.equal(c.acceptsHit(hit('104',2)),true);assert.equal(c.acceptsHit(hit('105',20)),true);
 c.update(a,3,{enabled:false});assert.equal(c.acceptsHit(hit('104',20)),true);
});
test('top-floor roof is opened with a documented render offset; underlying assets are retained',()=>{
 const a=fixture(),c=createFloorCutaway([a]),map=a.cutawayMaterials[0].map,parts=JSON.stringify(a.parts);
 c.update(a,10,{});assert.equal(c.state.nominalTop_m,35);assert.equal(c.state.clipTop_m,34.99);
 assert.equal(a.cutawayMaterials[0].map,map);assert.equal(JSON.stringify(a.parts),parts);
 c.update(a,11,{});assert.equal(c.state.active,false);assert.equal(a.cutawayMaterials[0].clippingPlanes,null);
});
