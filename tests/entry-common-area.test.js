import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Box3,Raycaster,ShapeUtils,Vector2,Vector3} from 'three';
import {entryCommonAreaLayout,createEntryCommonArea} from '../src/walkthrough/entry-common-area.js';
import {canStand,moveWithCollisions} from '../src/walkthrough/movement.js';

const models=[['112a','basic','archisketch-metric-v1'],['112a','expanded','archisketch-metric-v1'],['168c','basic','archisketch-details-v2'],['168c','expanded','archisketch-metric-v1']];
const signedArea=p=>p.reduce((sum,a,i)=>{const b=p[(i+1)%p.length];return sum+a[0]*b[1]-b[0]*a[1];},0)/2;
const area=p=>p.length<3?0:Math.abs(signedArea(p));
const triangles=points=>{const p=points.filter((v,i)=>!i||Math.hypot(v[0]-points[i-1][0],v[1]-points[i-1][1])>1e-10);return ShapeUtils.triangulateShape(p.map(v=>new Vector2(...v)),[]).map(t=>t.map(i=>p[i]));};
function clip(polygon,boundary){let p=polygon;const sign=signedArea(boundary)>=0?1:-1;for(let i=0;i<boundary.length;i++){const a=boundary[i],b=boundary[(i+1)%boundary.length],distance=v=>sign*((b[0]-a[0])*(v[1]-a[1])-(b[1]-a[1])*(v[0]-a[0])),next=[];for(let j=0;j<p.length;j++){const f=p[j],t=p[(j+1)%p.length],df=distance(f),dt=distance(t),fi=df>=-1e-10,ti=dt>=-1e-10;if(fi!==ti){const k=df/(df-dt);next.push([f[0]+k*(t[0]-f[0]),f[1]+k*(t[1]-f[1])]);}if(ti)next.push(t);}p=next;if(!p.length)break;}return p;}

for(const [kind,form,revision] of models)test(`${kind} ${form}: source-preserving common area, exterior footprint and capsule route`,()=>{
 const info=JSON.parse(fs.readFileSync(new URL(`../assets/models/acro-river-park/${kind}/${revision}/${form}/model-info.json`,import.meta.url))),before=JSON.stringify(info);
 const common=createEntryCommonArea(info),{layout,world}=common;assert(common);assert.equal(JSON.stringify(info),before);assert.deepEqual(common.group.scale.toArray(),[1,1,1]);
 assert.deepEqual(layout.outward,kind==='112a'?[0,-1]:[-1,0]);
 const source=info.rooms.map(r=>({id:r.id,triangles:triangles(r.polygon_m)}));
 common.group.updateMatrixWorld(true);
 common.group.traverse(mesh=>{if(!mesh.isMesh)return;const b=new Box3().setFromObject(mesh),rect=[[b.min.x,b.min.z],[b.max.x,b.min.z],[b.max.x,b.max.z],[b.min.x,b.max.z]];for(const room of source){const overlap=room.triangles.reduce((n,t)=>n+area(clip(rect,t)),0);assert(overlap<1e-8,`${mesh.name} overlaps ${room.id}: ${overlap}m²`);}});
 const pos=(t,s)=>{const [x,z]=layout.point(t,s);return new Vector3(x,1.6,z);};
 // Real users can aim at the exact seam from either side, including while
 // stopped against the closed door. The invisible pick surface must disappear
 // when open, while body collisions remain the original moving leaves.
 const door=common.doors[0];
 for(const progress of [-2.7755575615628914e-17,0,2.7755575615628914e-17]){
  door.setProgress(progress);
  for(const s of [2.5,3.38751,4.3]){
   const origin=pos(-.35,s),direction=pos(-.35,3.15).sub(origin).normalize();
   const hit=new Raycaster(origin,direction,0,2.2).intersectObjects(common.pickMeshes,false)[0];
   assert.equal(hit?.object.userData.doorId,'common-area:elevator',`closed center seam pick from ${s}`);
  }
 }
 door.setProgress(1);
 for(const s of [2.5,3.38751,4.3]){
  const origin=pos(-.35,s),direction=pos(-.35,3.15).sub(origin).normalize();
  const hit=new Raycaster(origin,direction,0,2.2).intersectObjects(common.pickMeshes,false)[0];
  assert.notEqual(hit?.object.userData.doorId,'common-area:elevator','open doorway must have no center pick surface');
 }
 door.setProgress(0);
 const position=pos(0,.7),walk=(t,s)=>{const target=pos(t,s);moveWithCollisions(world,position,target.clone().sub(position),1.6,.22);assert(canStand(world,position,1.6,.22));return position.distanceTo(target);};
 assert(walk(-.35,2.65)<.001);assert(walk(-.35,4.3)>.8,'closed elevator must stop walking');
 common.doors[0].setProgress(1);common.doors[0].target=1;
 assert(walk(-.35,4.3)<.001,'open elevator must admit the unchanged 44cm body');assert(walk(-.35,2.65)<.001);assert(walk(0,.7)<.001);
 const target=pos(.9,1.5);moveWithCollisions(world,position,target.clone().sub(position),1.6,.22);assert(layout.local(position.x,position.z)[0]<.3,'corridor wall blocks the body');
 assert(!canStand(world,pos(-.35,4.3),2.3,.22),'car ceiling blocks an over-height body');
 common.dispose();assert.equal(JSON.stringify(info),before);
});

test('ambiguous/missing entrance cannot silently create a landing',()=>{
 assert.equal(entryCommonAreaLayout({openings:[],rooms:[]}),null);
 assert.equal(entryCommonAreaLayout({openings:[{id:'door-00',kind:'door',axis:'x',center_m:[0,0]}],rooms:[]}),null);
});
