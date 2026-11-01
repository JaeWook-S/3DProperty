import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inspectPose,inspectRoute} from '../src/floor-access/transport.js';
import {buildTransportEnvironment,inspectOpening,reviewPairedFloorTransport} from '../src/paired-floor/transport-review.js';

const fixture=JSON.parse(fs.readFileSync(new URL('../src/paired-floor/layout.json',import.meta.url)));
const layout=fixture.variants.expanded;
const chair={width:.5,depth:.5,height:.9,clearance:.02};
const pose=(x,z,yaw=0)=>({x,z,yaw,bottomY:0});
const review=(input={},source=layout)=>reviewPairedFloorTransport(source,{...chair,...input});
const copy=value=>structuredClone(value);

for(const [name,source] of Object.entries(fixture.variants))for(const targetUnitId of ['211a','168c'])test(`${name} ${targetUnitId}: small chair reaches the actual throat over continuously covered floor`,()=>{
  const result=review({targetUnitId},source);
  assert.equal(result.valid,true);assert.equal(result.elevator.status,'clear');assert.equal(result.route.status,'clear');
  assert.equal(result.route.valid,true);assert.equal(result.route.searchExhaustive,false);
  assert.equal(result.route.scope,'elevator-to-unit-threshold-approach');
  assert.equal(result.route.doorStateScope,'fully-open-reference-independent-of-live-doors');
  assert.ok(result.route.selectedCandidate.result.clearIntervals>0);
  const end=result.route.destination,opening=result.environment.openings.find(o=>o.id===targetUnitId);
  assert.equal(end.insideUnitChecked,false);assert.equal(end.leadingFaceAtThreshold,true);
  assert.ok(Math.abs(end.stopPose.x+chair.width/2-opening.center[0])<1e-8);
  assert.ok(Math.abs(end.stopPose.z-opening.center[1])<1e-8);
  assert.ok(result.environment.domainObstacles.length>0);
  assert.equal(result.environment.car.width,2.1);assert.equal(result.environment.car.depth,1.6);
});

test('static car containment never claims passage through narrower openings or a lower head',()=>{
  const wide=review({width:1.1,depth:1,height:1.8});
  assert.equal(wide.elevator.status,'clear');assert.equal(wide.openings.find(o=>o.id==='elevator').status,'blocked');
  assert.equal(wide.route.status,'blocked');assert.ok(wide.route.hitIds.some(id=>id.includes('jamb')));
  const tall=review({height:2.12});
  assert.equal(tall.elevator.status,'clear');assert.equal(tall.route.status,'blocked');
  assert.ok(tall.route.hitIds.includes('Elevator head'));
  assert.equal(review({width:8,depth:8,height:4}).elevator.status,'blocked');
  assert.notEqual(review({width:8,depth:8,height:4}).route.status,'clear');
});

test('opening checks use clear dimensions and padded upright orientation, with exact contact blocked',()=>{
  const env=buildTransportEnvironment(layout),lift=env.openings[0];
  assert.equal(env.openings.find(o=>o.id==='211a').width,1);
  assert.equal(env.openings.find(o=>o.id==='211a').height,2.3);
  assert.equal(env.openings.find(o=>o.id==='168c').width,.84);
  const exact=inspectOpening({width:1.4,depth:.86,height:1},lift,{clearance:.02});
  assert.equal(exact.orientations[0].fits,false);assert.equal(exact.status,'blocked');
  assert.equal(inspectOpening({width:1.4,depth:.858,height:1},lift,{clearance:.02}).orientations[0].fits,true);
  assert.equal(inspectOpening({width:.5,depth:.5,height:2.08},lift,{clearance:.02}).status,'blocked');
  const rotated=inspectOpening({width:.5,depth:1.2,height:1},lift,{clearance:.02});
  assert.equal(rotated.orientations[0].fits,false);assert.equal(rotated.orientations[1].fits,true);
  assert.equal(rotated.orientations[1].angleDegrees,90);
  assert.equal(inspectOpening(chair,lift,null).valid,false);
});

test('fixed caller-supplied closed doors block the otherwise clear fully-open reference',()=>{
  const door={id:'closed-elevator-leaf',title:'닫힌 엘리베이터 문',x:-2.3,z:0,width:.04,depth:.9,height:2.1,yaw:0,bottomY:0};
  assert.equal(review().route.status,'clear');
  const closed=review({doorMode:'supplied',doorObstacles:[door]});
  assert.equal(closed.route.status,'blocked');assert.ok(closed.route.hitIds.includes(door.id));
  assert.equal(closed.route.doorStateScope,'caller-supplied-fixed-door-obstacles');
  assert.equal(review({doorMode:'supplied'}).route.status,'unresolved');
  assert.equal(review({doorMode:'supplied',doorObstacles:[]}).route.status,'clear');
});

// World-space unions of the actual fully open GLB leaf/accessory vertices.
// 211A has an outward leaf; 168C's inward leaf union includes both handles.
// The last six decimals are expanded outward to retain Float32 export bounds.
const openEntryLeaves=[
  {id:'fully-open-211a-leaf',x:-.48,z:-3.52,width:.960002,depth:.035002,height:2.280001,bottomY:0,yaw:0},
  {id:'fully-open-168c-leaf-and-handles',x:.4,z:3.6,width:.800002,depth:.112002,height:2.400001,bottomY:0,yaw:0},
];
const openDoors=[...openEntryLeaves,...[-1,1].map(side=>({
  id:`fully-open-elevator-leaf-${side}`,x:-2.3,z:side*.71,width:.04,depth:.45,height:2.1,bottomY:0,yaw:0,
}))];
for(const [name,source] of Object.entries(fixture.variants)) {
  test(`${name}: small cargo detours around the actual outward 211A leaf on supported floor`,()=>{
    const input={targetUnitId:'211a',doorMode:'supplied',doorObstacles:openDoors};
    const centered=review({targetUnitId:'211a'},source).route.poses;
    const obstruction=review({...input,poses:centered},source);
    assert.equal(obstruction.route.status,'blocked');
    assert.ok(obstruction.route.hitIds.includes('fully-open-211a-leaf'));
    const result=review(input,source),chosen=result.route.selectedCandidate;
    assert.equal(result.route.status,'clear');assert.equal(result.route.valid,true);
    assert.equal(result.route.doorStateScope,'caller-supplied-fixed-door-obstacles');
    assert.ok(Math.abs(chosen.laneX-(-1.41))<1e-8);
    assert.ok(chosen.laneX+chair.width/2+chair.clearance<-.960001);
    assert.ok(chosen.laneX-chair.width/2-chair.clearance>-1.7);
    assert.ok(chosen.result.clearIntervals>0);assert.deepEqual(chosen.result.hitIds,[]);
    assert.equal(result.route.destination.insideUnitChecked,false);
    // Independently re-run the returned full path, including its rotations.
    assert.equal(inspectRoute(chair,result.route.poses,result.environment.obstacles,{clearance:chair.clearance}).status,'clear');
  });
  test(`${name}: actual inward 168C leaf and handles leave the small-cargo threshold approach clear`,()=>{
    const result=review({targetUnitId:'168c',doorMode:'supplied',doorObstacles:openDoors},source);
    assert.equal(result.route.status,'clear');assert.equal(result.route.valid,true);
    assert.ok(Math.abs(result.route.destination.stopPose.x+chair.width/2)<1e-8);
    assert.equal(result.route.destination.insideUnitChecked,false);
  });
}

test('cargo that fits the car and openings can still be blocked by the open entrance leaf',()=>{
  const result=review({width:.8,depth:.8,targetUnitId:'211a',doorMode:'supplied',doorObstacles:openDoors});
  assert.equal(result.elevator.status,'clear');
  assert.equal(result.openings.find(o=>o.id==='elevator').status,'clear');
  assert.equal(result.openings.find(o=>o.id==='211a').status,'clear');
  assert.equal(result.route.status,'blocked');
  assert.ok(result.route.candidates.some(c=>c.hitIds?.includes('fully-open-211a-leaf')));
  assert.equal(result.route.searchExhaustive,false);
});

test('offset lane suggestions never certify a detour across missing floor coverage',()=>{
  const source=copy(layout);
  // Remove the only strip that could support a path west of the opened leaf.
  const corridor=source.commonArea.slabs.find(s=>s.size[1]===9.2);
  assert.ok(corridor);corridor.center[0]=-.5;corridor.size[0]=1;
  const result=review({targetUnitId:'211a',doorMode:'supplied',doorObstacles:openDoors},source);
  assert.notEqual(result.route.status,'clear');
  assert.ok(result.route.candidates.every(c=>c.status!=='clear'));
});

test('a clear wall-only detour through another unit is unresolved outside the known slab union',()=>{
  const tiny={width:.2,depth:.2,height:1};
  const poses=[pose(-3.35,0),pose(-.85,0),pose(-.85,-4),pose(1,-4),pose(1,4),pose(-.1,4)];
  const env=buildTransportEnvironment(layout);
  assert.equal(inspectRoute(tiny,poses,env.structuralObstacles,{clearance:.02}).status,'clear');
  const result=review({...tiny,poses});
  assert.equal(result.route.status,'unresolved');assert.equal(result.route.reason,'outside-modeled-floor');
  assert.deepEqual(result.route.hits,[]); // Virtual domain edges are not real walls.
});

test('the union has no artificial slab seams and checks edges, not only corners',()=>{
  const env=buildTransportEnvironment(layout);
  const centered={width:.3,depth:.3,height:1,x:-1.7,z:0,yaw:0,bottomY:0};
  assert.equal(inspectPose(centered,env.domainObstacles,{clearance:0}).clear,true);
  // Four corners land on the car/corridor, but the box spans unsupported space
  // beside the narrower connector between them.
  const bridge={width:2.4,depth:1.5,height:1,x:-2,z:0,yaw:0,bottomY:0};
  const onSlab=(x,z)=>env.slabs.some(s=>Math.abs(x-s.center[0])<=s.size[0]/2&&Math.abs(z-s.center[1])<=s.size[1]/2);
  assert.ok([[-3.2,-.75],[-3.2,.75],[-.8,-.75],[-.8,.75]].every(([x,z])=>onSlab(x,z)));
  const result=inspectPose(bridge,env.domainObstacles,{clearance:0});
  assert.equal(result.clear,false);assert.ok(result.hits.every(hit=>hit.id.startsWith('floor-domain:')));
});

test('turning a long box catches the intermediate corridor corner sweep',()=>{
  const env=buildTransportEnvironment(layout),long={width:1.6,depth:1,height:1};
  const first=pose(-.85,2),last=pose(-.85,2,Math.PI/2);
  assert.equal(inspectPose({...long,...first},env.obstacles,{clearance:0}).clear,true);
  assert.equal(inspectPose({...long,...last},env.obstacles,{clearance:0}).clear,true);
  const turn=inspectRoute(long,[first,last],env.obstacles,{clearance:0});
  assert.equal(turn.status,'blocked');assert.ok(turn.hits.some(hit=>hit.id.includes('Corridor')));
  assert.ok(turn.firstCollision.t>0&&turn.firstCollision.t<1);
});

test('supplied routes must begin in the car and finish with the leading face at the requested threshold',()=>{
  const generated=review().route.poses;
  assert.equal(review({poses:generated}).route.status,'clear');
  assert.equal(review({poses:generated.slice(1)}).route.reason,'start-not-contained-in-elevator');
  assert.equal(review({poses:generated.slice(0,-1)}).route.reason,'endpoint-not-at-threshold-approach');
  const centerAtDoor=copy(generated);centerAtDoor.at(-1).x=0;
  assert.equal(review({poses:centerAtDoor}).route.status,'unresolved');
  const lifted=copy(generated);lifted[1].bottomY=.1;
  assert.equal(review({poses:lifted}).route.reason,'vertical-motion-not-supported');
});

test('a subdivision limit remains unresolved rather than claiming a blocked or clear route',()=>{
  const result=review({routeOptions:{maxDepth:0}});
  assert.equal(result.route.status,'unresolved');assert.equal(result.route.reason,'subdivision-limit');
  assert.equal(result.route.selectedCandidate.result.hitIds.length,0);
  assert.ok(result.route.selectedCandidate.result.potentialHitIds.length>0);
});

test('invalid dimensions, missing portals and malformed geometry never certify clearance',()=>{
  for(const patch of [{width:0},{depth:-1},{height:NaN},{width:Infinity},{clearance:-.1},{clearance:NaN},{clearance:null},{targetUnitId:'no-unit'},{targetUnitId:null},{doorMode:'closed'},{doorMode:null},{routeOptions:null},{routeOptions:{maxDepth:50}},{poses:[]},{poses:[pose(0,0)]}]){
    assert.equal(review(patch).route.status,'unresolved',JSON.stringify(patch));
  }
  for(const source of [null,{}, {...layout,commonArea:{...layout.commonArea,slabs:[]}}, {...layout,commonArea:{...layout.commonArea,walls:[]}}])assert.equal(review({},source).valid,false);
  const absent=copy(layout);absent.commonArea.walls=absent.commonArea.walls.filter(w=>w.id!=='Entrance lintel 4');
  assert.equal(review({},absent).reason,'missing-or-ambiguous-entry');
  const ambiguous=copy(layout);ambiguous.commonArea.walls.push({...ambiguous.commonArea.walls.find(w=>w.id==='Entrance lintel 4'),id:'second lintel'});
  assert.equal(review({},ambiguous).reason,'missing-or-ambiguous-entry');
  assert.equal(review({doorMode:'supplied',doorObstacles:[{}]}).valid,false);
});

test('review is pure and cannot silently use a smaller clearance from route options',()=>{
  const before=JSON.stringify(layout),input={...chair,routeOptions:{clearance:0}},snapshot=JSON.stringify(input);
  const result=reviewPairedFloorTransport(layout,input);
  assert.equal(JSON.stringify(layout),before);assert.equal(JSON.stringify(input),snapshot);
  const exact=review({width:1.4,depth:.86,clearance:.02,routeOptions:{clearance:0}});
  assert.equal(exact.openings[0].status,'blocked');assert.notEqual(exact.route.status,'clear');
  assert.equal(result.clearance,.02);
});

// A failed alternative orientation does not invalidate an independently certified one.
test('selected clear route remains valid when the alternate orientation cannot fit the car',()=>{
  const result=review({width:1.6,depth:.5,height:1});
  assert.deepEqual(result.elevator.orientations.map(o=>o.fits),[true,false]);
  assert.equal(result.route.status,'clear');assert.equal(result.route.valid,true);
  assert.equal(result.route.selectedOrientation,0);
  assert.ok(result.route.candidates.some(candidate=>candidate.reason==='start-not-contained-in-elevator'));
});
