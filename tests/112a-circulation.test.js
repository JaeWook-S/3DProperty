import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Group,Mesh,BoxGeometry,Vector3} from 'three';
import {archisketchWebData} from '../src/walkthrough/archisketch-model.js';
import {createDoors,combinedWorld} from '../src/walkthrough/doors.js';
import {canStand,bodyAt,moveWithCollisions} from '../src/walkthrough/movement.js';
const read=(v,r)=>JSON.parse(readFileSync(new URL(`../assets/models/acro-river-park/112a/${r}/${v}/model-info.json`,import.meta.url)));
for(const variant of ['basic','expanded'])test(`${variant}: circulation keeps architecture and dining sizes; low table uses explicit45cm design height`,()=>{
 const before=read(variant,'archisketch-entry-v4'),s=read(variant,'archisketch-circulation-v5');
 assert.deepEqual(s.rooms,before.rooms);assert.deepEqual(s.navigation_zones,before.navigation_zones);
 for(const o of s.openings){const old=before.openings.find(p=>p.id===o.id);for(const k of ['width_m','height_m','center_m','bottom_m'])assert.deepEqual(o[k],old[k]);}
 for(const f of s.fixtures.filter(f=>f.id.startsWith('dining-'))){const old=before.fixtures.find(x=>x.id===f.id);for(const [i,delta] of [[0,-.25],[1,.55],[2,-.25],[3,.55]])assert.ok(Math.abs(f.bounds_m[i]-old.bounds_m[i]-delta)<1e-5);assert.equal(f.top_m,old.top_m);}
 const coffee=s.fixtures.find(f=>f.id==='living-coffee-table');assert.ok(Math.abs(coffee.top_m-.45)<1e-5);assert.equal(coffee.height_revision.basis,'user_feedback_design_height_not_product_measurement');
 const reviewed=archisketchWebData(s).doors.filter(d=>d.panelGroups);assert.equal(reviewed.length,variant==='basic'?3:1);assert.ok(reviewed.every(d=>d.clearOpening>.5));
});
test('two exported leaves open in opposite directions and stop closing against a50cm occupant',()=>{
 const root=new Group();for(const [name,x] of [['left',-.2],['right',.2]]){const m=new Mesh(new BoxGeometry(.4,1.9,.02));m.position.set(x,.98,0);m.userData.object_id=name;root.add(m);}
 const [door]=createDoors(root,[{id:'test',name:'two leaves',adapter:'exported',type:'sliding',exportedPose:'closed',translationAxis:'x',panelGroups:[{objects:['left'],travel_m:-.43},{objects:['right'],travel_m:.43}]}]);
 const world=combinedWorld({capsuleIntersect:()=>false},[door]);const p=new Vector3(0,1.6,.7);
 assert.equal(canStand(world,new Vector3(0,1.6,.08),1.6,.25),false);
 moveWithCollisions(world,p,new Vector3(0,0,-1.4),1.6,.25);assert.ok(p.z>.25);p.set(0,1.6,.7);door.setProgress(1);
 moveWithCollisions(world,p,new Vector3(0,0,-1.4),1.6,.25);assert.ok(p.z<-.69);
 door.target=0;let blocked=false;for(let n=0;n<80;n++)blocked ||= door.update(1/30,bodyAt(new Vector3(0,1.6,.08),1.6,.25)).blocked;
 assert.ok(blocked);assert.ok(door.progress>0&&door.progress<1);assert.ok(canStand(world,new Vector3(0,1.6,.08),1.6,.25));
});
