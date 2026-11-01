import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CONCEPTS} from '../src/concepts/catalog.js';
import {coordinateConceptInput,conceptRoomId} from '../src/concepts/coordinate-plan.js';
import {FURNITURE} from '../src/concepts/furniture-spec.js';
import {planDressing} from '../src/concepts/dressing.js';
import {planConcept,CLEARANCE_WARNING} from '../src/concepts/planner.js';
import {archisketchWebData} from '../src/walkthrough/archisketch-model.js';
import {placementWarnings,doorFootprints} from '../src/walkthrough/layout.js';
for(const variant of ['basic','expanded']){
 const source=JSON.parse(readFileSync(new URL('../assets/models/acro-river-park/112a/archisketch-metric-v1/'+variant+'/model-info.json',import.meta.url)));
 const {info,doors}=archisketchWebData(source);
 const make=f=>{const [x,z,x2,z2]=f.bounds_m;return {id:f.id,kind:'king',x:(x+x2)/2,z:(z+z2)/2,width:x2-x,depth:z2-z,height:f.top_m,angle:0};};
 const existing=[make(source.fixtures.find(f=>f.id==='primary-king'))];
 const obstacles=source.fixtures.filter(f=>!f.movable&&f.bottom_m<=1.4&&f.top_m>=.1).flatMap(f=>(f.collision_footprints_m||[f.bounds_m]).map(bounds_m=>make({...f,bounds_m})));
 for(const concept of CONCEPTS)test(variant+' '+concept.id+': current polygons, fixed fittings and hinges bound the concept',()=>{
  const original=JSON.stringify(source),adapted=coordinateConceptInput(concept,info);
  const plan=planConcept(adapted.concept,{...adapted,existing,obstacles,doors});
  assert.ok(plan.placements.length>=5,'must contain a useful layout');
  assert.ok(plan.placements.some(p=>p.kind.startsWith('sofa')||p.kind==='loveseat'));
  assert.ok(plan.placements.some(p=>p.kind.startsWith('dining')));
  assert.ok(plan.placements.every(p=>[p.x,p.z,p.width,p.depth].every(Number.isFinite)));
  for(const p of plan.placements){
    assert.equal(p.width,FURNITURE[p.kind].w,'catalog width must not be rescaled');
    assert.equal(p.depth,FURNITURE[p.kind].d,'catalog depth must not be rescaled');
    assert.equal(p.height,FURNITURE[p.kind].h,'catalog height must not be rescaled');
    assert.ok(Number.isInteger(p.index)&&Number.isInteger(p.option),'house-tour comparison provenance is preserved');
    assert.ok(info.rooms.some(r=>r.id===conceptRoomId(p.room,info)),'semantic room maps to an actual metric room');
  }
  const props=planDressing(plan.placements.map(p=>({...p,room:conceptRoomId(p.room,info)})),info.rooms,{kept:existing,doors});
  assert.ok(props.some(p=>p.kind==='pendant'),'coordinate dining placements keep upstream dressing');
  assert.ok(props.every(p=>[p.x,p.y,p.z,p.angle].every(Number.isFinite)));
  const placed=[...existing,...plan.placements];
  for(const p of plan.placements){
    const room=adapted.rooms.find(r=>r.id===p.room);
    const issues=placementWarnings(p,room.validationRoom,placed,obstacles,doorFootprints(doors)).filter(m=>m!==CLEARANCE_WARNING);
    assert.deepEqual(issues,[],p.kind+' '+p.room);
  }
  assert.equal(JSON.stringify(source),original);
 });
}
