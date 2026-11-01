import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {archisketchWebData} from '../src/walkthrough/archisketch-model.js';
const read=v=>JSON.parse(readFileSync(new URL(`../assets/models/acro-river-park/112a/archisketch-circulation-v5/${v}/model-info.json`,import.meta.url)));
for(const variant of ['basic','expanded']) {
 test(`${variant}: source-sized foyer storage distinguishes entrance from hall`,()=>{
  const s=read(variant),e=s.entry_review;
  assert.equal(e.hall_is_not_foyer,true);
  assert.ok(e.gross_depth_m<1.8);
  assert.ok(Math.abs(e.clear_width_between_storage_m-(variant==='basic'?1.527:1.139))<.005);
  assert.equal(s.fixtures.filter(f=>f.title==='현관 신발장').length,variant==='basic'?2:3);
  assert.ok(s.fixtures.every(f=>f.outside_room_m2<=.001));
 });
 test(`${variant}: image-aligned furnishing has four dining seats and a west-facing study`,()=>{
  const s=read(variant),f=id=>s.fixtures.find(f=>f.id===id);
  assert.equal(s.fixtures.filter(f=>f.id.startsWith('dining-chair-')).length,4);
  const sofa=f('living-sofa').bounds_m;
  assert.ok(Math.abs(sofa[2]-sofa[0]-1.17)<.002);
  assert.ok(Math.abs(sofa[3]-sofa[1]-2.79)<.002);
  const desk=f('study-desk').bounds_m,chair=f('study-chair').bounds_m;
  assert.ok(Math.abs(desk[2]-desk[0]-.6)<.002);assert.ok(Math.abs(desk[3]-desk[1]-1.2)<.002);
  assert.ok(chair[0]>desk[2]);
  const dining=s.fixtures.filter(f=>f.id.startsWith('dining-'));
  const kitchen=s.fixtures.filter(f=>f.component==='kitchen_fixture');
  for(const a of dining)for(const b of kitchen) {
   for(const ar of a.collision_footprints_m)for(const br of b.collision_footprints_m) {
    const overlap=Math.max(0,Math.min(ar[2],br[2])-Math.max(ar[0],br[0]))*Math.max(0,Math.min(ar[3],br[3])-Math.max(ar[1],br[1]));
    assert.ok(overlap<.001,`${a.id} intersects ${b.id}: ${overlap}`);
   }
  }
 });
 test(`${variant}: entrance opens out; small bedrooms pivot on the right into the room`,()=>{
  const s=read(variant),{doors}=archisketchWebData(s);
  const entry=doors.find(d=>d.sourceOpening==='door-00');assert.deepEqual(entry.closedDirection,[-1,0]);assert.equal(entry.swingRadians,-Math.PI/2);
  for(const d of doors.filter(d=>d.type==='hinged'&&d.axis==='H'&&d.hinge[2]>5)){
   assert.deepEqual(d.closedDirection,[-1,0]);assert.equal(d.swingRadians,Math.PI/2);assert.equal(d.operationBasis,'furnished_reference_plan_image');
   const opening=s.openings.find(o=>o.id===d.sourceOpening);assert.ok(Math.abs(d.hinge[0]-(opening.center_m[0]+d.width/2))<1e-8);
  }
 });
}
