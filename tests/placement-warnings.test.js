import test from 'node:test';
import assert from 'node:assert/strict';
import {Group,Mesh,BoxGeometry} from 'three';
import {doorFootprints,placementWarnings} from '../src/walkthrough/layout.js';
import {stagingAssets} from '../src/walkthrough/staging-assets.js';

const room={bounds_m:[0,0,10,10]};
const item={id:'a',x:3,z:3,width:1,depth:1,angle:0};
test('warnings distinguish overlap, insufficient clearance, boundary and inferred door sweep',()=>{
 assert.deepEqual(placementWarnings(item,room,[],[]),[]);
 assert.ok(placementWarnings(item,room,[{...item,id:'b'}],[]).some(s=>s.includes('겹쳐')));
 assert.ok(placementWarnings(item,room,[{...item,id:'b',x:4.4}],[]).some(s=>s.includes('60cm')));
 assert.equal(placementWarnings(item,room,[{...item,id:'b',x:5}],[]).length,0);
 assert.ok(placementWarnings({...item,x:0},room,[],[]).some(s=>s.includes('경계')));
 for(const axis of ['H','V']){
   const footprints=doorFootprints([{name:'시험 문',type:'hinged',axis,width:1,hinge:[3,0,3]}]);
   assert.ok(placementWarnings(item,room,[],[],footprints).some(s=>s.includes('시험 문')));
   assert.equal(placementWarnings({...item,x:8,z:8},room,[],[],footprints).length,0);
 }
});
test('warning-mode moves preserve dimensions and collision; saved overlaps restore without order dependence',()=>{
 const root=new Group();
 for(const [id,x] of [['sofa',2],['stool',5]]){const m=new Mesh(new BoxGeometry(1,1,1));m.position.set(x,.5,3);m.userData.asset_id=id;root.add(m);}
 const s=stagingAssets(root,{objects:{}}),before=s.snapshot();
 assert.match(s.move('stool',{x:2,z:3},room),/겹쳐/);
 assert.equal(s.items[1].x,5);
 assert.equal(s.move('stool',{x:2,z:3},room,true,true),null);
 assert.equal(s.items[1].group.position.x,2);
 assert.equal(s.items[1].width,before[1].width);
 assert.match(s.move('stool',{x:NaN},room,true,true),/위치/);
 const saved=s.snapshot();s.reset();assert.equal(s.items[1].x,5);
 s.restore(saved,[room]);assert.equal(s.items[1].x,2);
 s.move('stool',{x:-1},room,true,true);const outside=s.snapshot();s.reset();s.restore(outside,[room]);assert.equal(s.items[1].x,-1);
});
