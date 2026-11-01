import test from 'node:test';
import assert from 'node:assert/strict';
import {Group,Mesh,BoxGeometry,MeshStandardMaterial,DoubleSide,Raycaster,Vector3} from 'three';
import {batchStaticMeshes} from '../src/walkthrough/static-batches.js';
import {collisionTree} from '../src/walkthrough/doors.js';
import {canStand} from '../src/walkthrough/movement.js';

function prism(bottom,layer,material,{indexed=true,matching=true,name=`Wall/layer-${String(layer).padStart(2,'0')}/00`}={}) {
 let geometry=new BoxGeometry(2,1,.2);
 if(matching){
  // Closed prism with the same cap diagonal on top and bottom, as in source walls.
  const pos=geometry.attributes.position,index=geometry.index;
  const bottomIndex=vertex=>[12,13,14,15].find(i=>pos.getX(i)===pos.getX(vertex)&&pos.getZ(i)===pos.getZ(vertex));
  for(let t=0;t<2;t++){const a=index.getX(12+t*3),b=index.getX(13+t*3),c=index.getX(14+t*3);index.setX(18+t*3,bottomIndex(a));index.setX(19+t*3,bottomIndex(c));index.setX(20+t*3,bottomIndex(b));}
 }
 geometry.translate(0,bottom+.5,0);if(!indexed)geometry=geometry.toNonIndexed();
 const mesh=new Mesh(geometry,material);mesh.userData={object_id:name,component:'wall',inferred_wall:true,collision:true,layer_bottom_m:bottom};return mesh;
}
function setup(options={}) {const root=new Group(),mat=new MeshStandardMaterial({side:DoubleSide});const a=prism(0,0,mat,options),b=prism(1,1,mat,options);root.add(a,b);return{root,a,b,mat};}
const triangles=g=>(g.index?.count??g.attributes.position.count)/3;
const snapshot=g=>JSON.stringify({index:g.index&&Array.from(g.index.array),attributes:Object.fromEntries(Object.entries(g.attributes).map(([k,a])=>[k,{array:Array.from(a.array),itemSize:a.itemSize,normalized:a.normalized}]))});

for(const indexed of [true,false])test(`exact opposing layer caps are render-only; indexed=${indexed}`,()=>{
 const {root,a,b,mat}=setup({indexed});root.position.set(5,0,-3);root.updateMatrixWorld(true);
 const original=[snapshot(a.geometry),snapshot(b.geometry)],ga=a.geometry,gb=b.geometry;
 const collision=collisionTree(root),sample=new Vector3(5,1.6,-2.85),standing=canStand(collision,sample);
 const result=batchStaticMeshes(root);assert.equal(result.removedInternalCapTriangles,4);assert.equal(result.sourceMeshes,2);assert.equal(result.drawMeshes,1);assert.equal(triangles(result.batches[0].geometry),20);assert.equal(result.batches[0].material,mat);
 assert.equal(a.geometry,ga);assert.equal(b.geometry,gb);assert.deepEqual([snapshot(a.geometry),snapshot(b.geometry)],original);
 assert.equal(canStand(collision,sample),standing);
 // Unpaired exterior top/bottom caps still render and remain ray-pickable.
 const upperRay=new Raycaster(new Vector3(5,3,-3),new Vector3(0,-1,0));const lowerRay=new Raycaster(new Vector3(5,-1,-3),new Vector3(0,1,0));
 assert.ok(upperRay.intersectObjects(result.batches).some(h=>h.point.y===2));assert.ok(lowerRay.intersectObjects(result.batches).some(h=>h.point.y===0));
 assert.equal(batchStaticMeshes(root).removedInternalCapTriangles,0);
});

test('a real gap, partial overlap and different cap triangulation are never welded',()=>{
 for(const mode of ['gap','partial','triangulation']){
  const {root,b}=setup({matching:mode!=='triangulation'});if(mode==='gap')b.position.y=1e-7;if(mode==='partial')b.position.x=.25;
  const result=batchStaticMeshes(root);assert.equal(result.removedInternalCapTriangles,0,mode);assert.equal(triangles(result.batches[0].geometry),24);
 }
});

test('source wall role, inferred closed-layer identity and adjacency are required',()=>{
 for(const change of [b=>{b.userData.component='window_frame';},b=>{b.userData.inferred_wall=false;},b=>{b.userData.collision=false;},b=>{delete b.userData.layer_bottom_m;},b=>{b.userData.object_id='Metric wall correction/door-07/00';},b=>{b.userData.object_id='Wall/layer-02/00';},b=>{b.userData.layer_bottom_m=0;}]){
  const {root,b}=setup();change(b);assert.equal(batchStaticMeshes(root).removedInternalCapTriangles,0);
 }
});

test('same-facing and ambiguous three-way duplicates remain intact',()=>{
 {const {root,a,b}=setup();b.position.y=-1;b.userData.layer_bottom_m=1;assert.equal(batchStaticMeshes(root).removedInternalCapTriangles,0);assert.equal(a.geometry.index.count,36);}
 {const {root,b}=setup();const duplicate=b.clone();duplicate.userData={...b.userData,object_id:'Wall/layer-01/01'};root.add(duplicate);assert.equal(batchStaticMeshes(root).removedInternalCapTriangles,0);}
});

test('doors, staging furniture, hidden sources and incompatible batches cannot lose half a pair',()=>{
 for(const mode of ['door','furniture','hidden','material','tilt','mirror']){
  const {root,b}=setup();
  if(mode==='hidden')b.visible=false;
  if(mode==='material')b.material=new MeshStandardMaterial();
  if(mode==='tilt')root.rotation.z=.1;
  if(mode==='mirror')root.scale.x=-1;
  if(mode==='door'||mode==='furniture'){root.remove(b);const group=new Group();group.userData[mode==='door'?'doorId':'stagingId']='dynamic';group.add(b);root.add(group);}
  assert.equal(batchStaticMeshes(root).removedInternalCapTriangles,0,mode);
 }
});

test('multi-material primitive source identity is grouped by the original structural node',()=>{
 const {root,a,b,mat}=setup();
 for(const object of [a,b]){
  root.remove(object);const parent=new Group();parent.name=object.userData.object_id;root.add(parent);
  const source=object.geometry,index=source.index;
  for(let primitive=0;primitive<2;primitive++){
   const g=source.clone(),keep=[];
   for(let i=0;i<index.count;i++)if((Math.floor(i/3)%2)===primitive)keep.push(index.getX(i));g.setIndex(keep);
   const mesh=new Mesh(g,mat);mesh.userData={...object.userData,object_id:`${object.userData.object_id}/primitive-${primitive}`};parent.add(mesh);
  }
 }
 const result=batchStaticMeshes(root);assert.equal(result.removedInternalCapTriangles,4);assert.equal(triangles(result.batches[0].geometry),20);
});
