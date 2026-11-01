import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {archisketchWebData} from '../src/walkthrough/archisketch-model.js';
import {navigationRooms,navigationPlaces,pointInRoom,roomAt} from '../src/walkthrough/minimap-geometry.js';
const read=v=>JSON.parse(readFileSync(new URL(`../assets/models/acro-river-park/112a/archisketch-circulation-v5/${v}/model-info.json`,import.meta.url)));
for(const variant of ['basic','expanded']){
 test(`${variant}: entrance uses the1000mm instance, retaining side walls and a960mm modeled leaf`,()=>{
  const s=read(variant),o=s.openings.find(o=>o.id==='door-00'),e=s.entry_review;
  assert.equal(o.width_m,1);assert.equal(o.source_scaled_item_dimensions.width,1000);assert.equal(o.leaf_width_m,.96);
  assert.ok(Math.abs(e.gross_width_m-(e.door_review.left_wall_m+1+e.door_review.right_wall_m))<1e-6);
  if(variant==='basic'){assert.equal(e.door_review.left_wall_m,.479);assert.equal(e.door_review.right_wall_m,.503);}
  const door=archisketchWebData(s).doors.find(d=>d.sourceOpening==='door-00');assert.equal(door.width,.96);
  assert.ok(Math.abs(door.hinge[0]-(o.center_m[0]+.48))<1e-8);
 });
 test(`${variant}: destinations partition the original shared room without changing physical editing boundaries`,()=>{
  const {info}=archisketchWebData(read(variant)),before=JSON.stringify(info);
  const places=navigationPlaces(info),zones=places.filter(p=>p.source_room_id),shared=info.rooms.find(r=>r.id==='living-kitchen-hall');
  assert.deepEqual(zones.map(z=>z.id),['living','kitchen','corridor','entrance']);
  assert.ok(navigationRooms(info).some(r=>r.id===shared.id));assert.ok(!places.some(p=>p.id===shared.id));
  for(const zone of zones){const [x,z]=zone.walk_start_m;assert.equal(roomAt(places,x,z).id,zone.id);assert.ok(pointInRoom(shared,x,z));}
  // Independent point coverage across the open room; selection zones cannot erase floor space.
  const [a,b,c,d]=shared.bounds_m;
  for(let x=a+.037;x<c;x+=.073)for(let z=b+.043;z<d;z+=.079){
   const matches=zones.filter(zone=>pointInRoom(zone,x,z)).length;
   assert.equal(matches,pointInRoom(shared,x,z)?1:0,`${x},${z}`);
  }
  assert.equal(JSON.stringify(info),before);
 });
}
