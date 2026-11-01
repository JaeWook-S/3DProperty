import {inspectPose, fitsCar, inspectRoute} from '../floor-access/transport.js';
import {transformPoint} from './geometry.js';

/**
 * Pure paired-floor transport review. All dimensions/positions are meters; yaw
 * uses Three.js radians (local +X turns toward world -Z). The cargo stays upright
 * on Y=0. Width/depth are its full transport envelope, including packaging.
 *
 * @typedef {{width:number,depth:number,height:number}} Cargo
 * @typedef {{x:number,z:number,yaw:number,bottomY?:number}} Pose
 * @typedef {{id:string,title?:string,width:number,depth:number,height:number,
 *   x:number,z:number,yaw:number,bottomY?:number}} Obstacle
 * @typedef {'clear'|'blocked'|'unresolved'} ReviewStatus
 *
 * clear certifies only the supplied/candidate continuous common-area approach.
 * blocked means the tested candidate hits known geometry, not that every route
 * is impossible. Unknown floor coverage or exhausted subdivision is unresolved.
 * Door openings and car containment are independent static checks. No tilting,
 * disassembly, people, delivery equipment, moving doors, or unit interior review.
 */
const HALF_TURN = Math.PI / 2;
const YAWS = [0, HALF_TURN];
const EPS = 1e-8;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = value => Number.isFinite(value) && value > 0;
const point = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
const shapeOK = cargo => record(cargo) && ['width','depth','height'].every(key => positive(cargo[key]));
const clearanceOK = value => Number.isFinite(value) && value >= 0;
const rectOK = value => record(value) && point(value.center) && point(value.size) && value.size.every(positive);
const norm = vector => {const length = Math.hypot(...vector);return positive(length) ? vector.map(v => v / length) : null;};
const dot = (a,b) => a[0]*b[0] + a[1]*b[1];
const tangent = normal => [-normal[1],normal[0]];
const axisNormal = normal => point(normal) && Math.abs(Math.hypot(...normal)-1) < EPS && Math.min(Math.abs(normal[0]),Math.abs(normal[1])) < EPS;
const box = wall => ({id:wall.id,title:wall.id,x:wall.center[0],z:wall.center[1],width:wall.size[0],depth:wall.size[1],height:wall.height,bottomY:wall.bottom ?? 0,yaw:0});
const projection = (cargo,yaw,axis,pad=0) => Math.abs(Math.cos(yaw)*axis[0]-Math.sin(yaw)*axis[1])*(cargo.width/2+pad)
  + Math.abs(Math.sin(yaw)*axis[0]+Math.cos(yaw)*axis[1])*(cargo.depth/2+pad);
const unresolved = reason => ({valid:false,status:'unresolved',reason});

function floorDomain(slabs, height) {
  const rects = slabs.map(s => [s.center[0]-s.size[0]/2,s.center[1]-s.size[1]/2,s.center[0]+s.size[0]/2,s.center[1]+s.size[1]/2]);
  const xValues=rects.flatMap(r=>[r[0],r[2]]),zValues=rects.flatMap(r=>[r[1],r[3]]);
  const bounds=[Math.min(...xValues)-1,Math.min(...zValues)-1,Math.max(...xValues)+1,Math.max(...zValues)+1];
  const xs=[...new Set([...xValues,bounds[0],bounds[2]])].sort((a,b)=>a-b);
  const zs=[...new Set([...zValues,bounds[1],bounds[3]])].sort((a,b)=>a-b);
  const obstacles=[];
  // A rectangle partition gives the exact complement of the union. Shared slab
  // seams create no barriers. The existing continuous OBB engine certifies the
  // entire padded sweep against these virtual obstacles, including rotations.
  for(let ix=1;ix<xs.length;ix++)for(let iz=1;iz<zs.length;iz++){
    const x=(xs[ix-1]+xs[ix])/2,z=(zs[iz-1]+zs[iz])/2;
    if(rects.some(r=>x>=r[0]&&x<=r[2]&&z>=r[1]&&z<=r[3]))continue;
    obstacles.push({id:`floor-domain:${ix}:${iz}`,title:'검사 범위 밖 바닥',x,z,width:xs[ix]-xs[ix-1],depth:zs[iz]-zs[iz-1],height,bottomY:-1,yaw:0,virtual:true});
  }
  return {bounds,obstacles};
}

function unitOpening(unit,walls) {
  if(!record(unit)||typeof unit.id!=='string'||!point(unit.targetEntryWorld)||!point(unit.entryLocal)||!point(unit.spawnLocal)
    ||!Array.isArray(unit.translation)||unit.translation.length!==3||!unit.translation.every(Number.isFinite)
    ||!Number.isFinite(unit.rotationYRadians)||unit.scale!==1)return null;
  const center=transformPoint(unit.entryLocal,unit),inside=transformPoint(unit.spawnLocal,unit);
  if(Math.hypot(center[0]-unit.targetEntryWorld[0],center[1]-unit.targetEntryWorld[1])>EPS)return null;
  const normal=norm([inside[0]-center[0],inside[1]-center[1]]);
  if(!axisNormal(normal))return null;
  const axis=tangent(normal);
  const lintels=walls.filter(w=>w.component!=='ceiling'&&(w.bottom??0)>0
    && Math.abs(dot([w.center[0]-center[0],w.center[1]-center[1]],normal))<=dot(w.size,normal.map(Math.abs))/2+EPS
    && Math.abs(dot([w.center[0]-center[0],w.center[1]-center[1]],axis))<=dot(w.size,axis.map(Math.abs))/2+EPS);
  if(lintels.length!==1)return null;
  const lintel=lintels[0];
  return {id:unit.id,label:`${unit.label??unit.id} 현관`,center,normal,width:dot(lintel.size,axis.map(Math.abs)),height:lintel.bottom,basis:'common-area-lintel-assumption'};
}

/**
 * @param {object} layoutVariant One layout.json variants.basic/expanded object.
 * @param {{doorMode?:'fully-open'|'supplied',doorObstacles?:Obstacle[]}} options
 * fully-open is a reference with unobstructed portals, independent of live door
 * states. supplied requires the caller's COMPLETE fixed door OBB list (an explicit
 * [] means all leaves are recessed outside the tested floor). Opening leaf motion
 * and inside-unit geometry are not inferred. Missing/ambiguous geometry fails closed.
 */
export function buildTransportEnvironment(layoutVariant,options={}) {
  if(!record(layoutVariant)||!record(options))return unresolved('invalid-layout');
  const common=layoutVariant.commonArea,doorMode=options.doorMode===undefined?'fully-open':options.doorMode;
  if(!record(common)||!Array.isArray(common.walls)||!common.walls.length||!Array.isArray(common.slabs)||!common.slabs.length
    ||!common.slabs.every(rectOK)||!Array.isArray(layoutVariant.units)||!layoutVariant.units.length
    ||!point(layoutVariant.spawns?.hall)||!['fully-open','supplied'].includes(doorMode))return unresolved('invalid-layout');
  const walls=common.walls;
  if(!walls.every(w=>rectOK(w)&&typeof w.id==='string'&&w.id.trim()&&positive(w.height)&&Number.isFinite(w.bottom??0)))return unresolved('invalid-walls');
  const lift=common.elevator;
  if(!rectOK(lift)||!positive(lift.height)||!point(lift.doorCenter)||!positive(lift.doorWidth)||!positive(lift.doorHeight)||!axisNormal(lift.doorNormal))return unresolved('invalid-elevator');
  const entries=layoutVariant.units.map(unit=>unitOpening(unit,walls));
  if(entries.some(entry=>!entry)||new Set(entries.map(e=>e.id)).size!==entries.length)return unresolved('missing-or-ambiguous-entry');
  if(doorMode==='supplied'&&(!Object.hasOwn(options,'doorObstacles')||!Array.isArray(options.doorObstacles)))return unresolved('missing-door-obstacles');
  if(options.doorObstacles!==undefined&&!Array.isArray(options.doorObstacles))return unresolved('invalid-door-obstacles');
  const doors=doorMode==='supplied'?options.doorObstacles.map(o=>({...o})):[];
  const domain=floorDomain(common.slabs,Math.max(...walls.map(w=>(w.bottom??0)+w.height))+2);
  const structuralObstacles=walls.map(box),obstacles=[...structuralObstacles,...doors,...domain.obstacles];
  if(!inspectPose({width:.1,depth:.1,height:.1,x:lift.center[0],z:lift.center[1],yaw:0,bottomY:0},obstacles).valid)return unresolved('invalid-obstacles');
  const car={x:lift.center[0],z:lift.center[1],width:lift.size[0],depth:lift.size[1],height:lift.height,bottomY:0,yaw:0};
  return {valid:true,doorMode,doorStateScope:doorMode==='fully-open'?'fully-open-reference-independent-of-live-doors':'caller-supplied-fixed-door-obstacles',
    obstacles,structuralObstacles,domainObstacles:domain.obstacles,car,slabs:common.slabs.map(s=>({center:[...s.center],size:[...s.size]})),bounds:domain.bounds,
    hall:[...layoutVariant.spawns.hall],openings:[{id:'elevator',label:'엘리베이터 문',center:[...lift.doorCenter],normal:[...lift.doorNormal],width:lift.doorWidth,height:lift.doorHeight,basis:'common-area-assumption'},...entries],
    dimensionsBasis:common.dimensionsBasis??'assumed-common-area-geometry'};
}

/** Independent centered upright cross-section check at world yaw 0 / 90°.
 * Exact contact blocks. A clear opening is not a route certificate. */
export function inspectOpening(cargo,opening,options={}) {
  if(!record(options))return unresolved('invalid-opening-input');
  const clearance=options.clearance===undefined?.02:options.clearance;
  if(!shapeOK(cargo)||!record(opening)||!positive(opening.width)||!positive(opening.height)||!axisNormal(opening.normal)||!clearanceOK(clearance))return unresolved('invalid-opening-input');
  const orientations=YAWS.map(yaw=>{
    const projectedWidth_m=2*projection(cargo,yaw,tangent(opening.normal));
    const requiredWidth_m=2*projection(cargo,yaw,tangent(opening.normal),clearance);
    const widthMargin_m=opening.width-requiredWidth_m,heightMargin_m=opening.height-cargo.height-clearance;
    const epsilon=Number.EPSILON*64*Math.max(1,opening.width,opening.height,requiredWidth_m,cargo.height,clearance);
    return {yaw,angleDegrees:Math.round(yaw*180/Math.PI),projectedWidth_m,requiredWidth_m,heightRequired_m:cargo.height+clearance,widthMargin_m,heightMargin_m,fits:widthMargin_m>epsilon&&heightMargin_m>epsilon};
  });
  return {...opening,valid:true,status:orientations.some(o=>o.fits)?'clear':'blocked',orientations,scope:'opening-cross-section-only'};
}

function destinationFor(cargo,opening,yaw) {
  const reach=projection(cargo,yaw,opening.normal);
  const stopPose={x:opening.center[0]-opening.normal[0]*reach,z:opening.center[1]-opening.normal[1]*reach,yaw,bottomY:0};
  return {unitId:opening.id,entryPoint:[...opening.center],entryNormal:[...opening.normal],stopPose,leadingFaceAtThreshold:true,insideUnitChecked:false};
}
function corridorLanes(cargo,yaw,clearance,env,target) {
  const lanes=[env.hall[0]],radius=projection(cargo,yaw,[1,0],clearance);
  // Candidate offsets come from a modeled slab spanning the hallway approach.
  // The inset includes the requested local-face clearance and 2 cm planning
  // slack. Slab bounds only propose lanes: walls, opened leaves, all rotations,
  // and the complete swept floor-domain coverage remain authoritative below.
  for(const slab of env.slabs) {
    const [x,z]=slab.center,[width,depth]=slab.size;
    if(Math.abs(env.hall[0]-x)>width/2+EPS||Math.abs(env.hall[1]-z)>depth/2+EPS
      ||Math.abs(target.center[1]-z)>depth/2+EPS)continue;
    const west=x-width/2+radius+.02,east=x+width/2-radius-.02;
    if(west>east)continue;
    lanes.push(west,east,(west+east)/2,west+(east-west)/4,east-(east-west)/4);
  }
  return lanes.filter((x,i)=>lanes.findIndex(other=>Math.abs(x-other)<EPS)===i);
}
function candidatePaths(cargo,clearance,env,target) {
  const doorway=env.openings[0];
  if(Math.abs(doorway.normal[0])<1-EPS||Math.abs(target.normal[0])<1-EPS)return [];
  const pose=(p,yaw)=>({x:p[0],z:p[1],yaw,bottomY:0});
  return YAWS.flatMap(initialYaw=>YAWS.flatMap(travelYaw=>corridorLanes(cargo,travelYaw,clearance,env,target).flatMap((laneX,laneIndex)=>YAWS.map(finalYaw=>{
    const hall=[laneX,env.hall[1]],destination=destinationFor(cargo,target,finalYaw),turn=[laneX,target.center[1]];
    const poses=[pose([env.car.x,env.car.z],initialYaw),pose(doorway.center,initialYaw),pose(hall,initialYaw),pose(hall,travelYaw),pose(turn,travelYaw),pose(turn,finalYaw),destination.stopPose];
    return {id:`${Math.round(initialYaw*180/Math.PI)}-${Math.round(travelYaw*180/Math.PI)}-${Math.round(finalYaw*180/Math.PI)}-lane-${laneIndex}`,initialYaw,travelYaw,finalYaw,laneX,destination,
      poses:poses.filter((p,i)=>!i||p.x!==poses[i-1].x||p.z!==poses[i-1].z||p.yaw!==poses[i-1].yaw)};
  }))));
}
function evaluateCandidate(cargo,clearance,candidate,env,target,routeOptions) {
  const poses=candidate.poses;
  const invalid=reason=>({...candidate,valid:false,status:'unresolved',reason,result:unresolved(reason)});
  if(!Array.isArray(poses)||poses.length<2||poses.some(p=>!record(p)||![p.x,p.z,p.yaw,p.bottomY??0].every(Number.isFinite)))return invalid('invalid-poses');
  if(poses.some(p=>(p.bottomY??0)!==0))return invalid('vertical-motion-not-supported');
  if(poses.some(p=>p.x<env.bounds[0]||p.x>env.bounds[2]||p.z<env.bounds[1]||p.z>env.bounds[3]))return invalid('outside-modeled-floor');
  const first=poses[0],last=poses.at(-1),destination=destinationFor(cargo,target,last.yaw);
  const containment=fitsCar({...cargo,...first},env.car,{clearance});
  if(!containment.valid||!containment.fits)return invalid('start-not-contained-in-elevator');
  if(Math.hypot(last.x-destination.stopPose.x,last.z-destination.stopPose.z)>EPS)return invalid('endpoint-not-at-threshold-approach');
  const result=inspectRoute(cargo,poses,env.obstacles,{...routeOptions,clearance});
  const physicalHits=result.hits.filter(hit=>!hit.id.startsWith('floor-domain:'));
  // Unknown floor is a scope gap, not a real wall. Preserve the raw certificate
  // for debugging, but never present its virtual boundary as a physical collision.
  const outside=result.hitIds.some(id=>id.startsWith('floor-domain:'));
  const status=outside&&!physicalHits.length?'unresolved':result.status;
  return {...candidate,destination,valid:result.valid,status,reason:outside&&!physicalHits.length?'outside-modeled-floor':result.reason,
    result,hitIds:physicalHits.map(hit=>hit.id),hits:physicalHits,
    poseChecks:{start:inspectPose({...cargo,...first},env.obstacles,{clearance}),end:inspectPose({...cargo,...last},env.obstacles,{clearance})}};
}

/**
 * @param {object} layoutVariant The selected meter layout (NOT the whole manifest).
 * @param {{width:number,depth:number,height:number,clearance?:number,targetUnitId?:string,
 *   doorMode?:'fully-open'|'supplied',doorObstacles?:Obstacle[],poses?:Pose[],
 *   routeOptions?:{maxDepth?:number,minStep?:number}}} input
 * @returns {object} independent openings/elevator checks and a candidate route.
 * route.selectedCandidate/poses/cargo/environment are suitable for rendering.
 * Stop pose is on the COMMON side with cargo's leading face at the actual entry
 * plane. It does not move the center into unmodeled unit space or certify delivery.
 */
export function reviewPairedFloorTransport(layoutVariant,input={}) {
  if(!record(input))return {...unresolved('invalid-input'),route:unresolved('invalid-input')};
  const cargo={width:input.width,depth:input.depth,height:input.height},clearance=input.clearance===undefined?.02:input.clearance;
  if(!shapeOK(cargo)||!clearanceOK(clearance)||input.routeOptions!==undefined&&!record(input.routeOptions))return {...unresolved('invalid-input'),cargo,clearance,route:unresolved('invalid-input')};
  const environment=buildTransportEnvironment(layoutVariant,input);
  if(!environment.valid)return {...unresolved(environment.reason),cargo,clearance,environment,route:unresolved(environment.reason)};
  const target=environment.openings.find(o=>o.id===(input.targetUnitId===undefined?'168c':input.targetUnitId));
  if(!target||target.id==='elevator')return {...unresolved('unknown-target-unit'),cargo,clearance,environment,route:unresolved('unknown-target-unit')};
  const orientations=YAWS.map(yaw=>({yaw,angleDegrees:Math.round(yaw*180/Math.PI),...fitsCar({...cargo,x:environment.car.x,z:environment.car.z,yaw,bottomY:0},environment.car,{clearance})}));
  const elevator={valid:orientations.every(o=>o.valid),status:orientations.some(o=>o.fits)?'clear':orientations.every(o=>o.valid)?'blocked':'unresolved',orientations,car:environment.car,scope:'static-centered-containment-at-0-or-90-degrees'};
  const openings=environment.openings.map(o=>inspectOpening(cargo,o,{clearance}));
  const paths=input.poses===undefined?candidatePaths(cargo,clearance,environment,target):[{id:'supplied-route',poses:input.poses}];
  const candidates=paths.map(path=>evaluateCandidate(cargo,clearance,path,environment,target,input.routeOptions??{}));
  const selectedCandidate=candidates.find(c=>c.status==='clear')??candidates.find(c=>c.status==='unresolved')??candidates[0]??null;
  const route={valid:selectedCandidate?.valid??false,status:selectedCandidate?.status??'unresolved',reason:selectedCandidate?.reason??(candidates.length?undefined:'unsupported-route-axes'),
    scope:'elevator-to-unit-threshold-approach',doorStateScope:environment.doorStateScope,searchExhaustive:false,
    selectedCandidate,poses:selectedCandidate?.poses??[],selectedOrientation:selectedCandidate?.poses?.[0]?.yaw??null,destination:selectedCandidate?.destination??null,
    candidates,hitIds:selectedCandidate?.hitIds??[],hits:selectedCandidate?.hits??[]};
  return {valid:true,cargo,clearance,targetUnitId:target.id,environment,openings,elevator,route,
    assumptions:['공용부 치수와 배치는 가정입니다. 실제 건물 실측에 의한 운반 보증이 아닙니다.',
      environment.doorMode==='fully-open'?'문짝을 제외한 개구부 기준 경로이며 화면의 현재 문 상태와 별개입니다.':'입력한 문 위치를 고정해 검사했습니다. 문을 움직이는 과정은 검사하지 않습니다.',
      '세워서 이동하는 외곽 상자를 검사합니다. 기울이기·분해·사람·운반 장비는 포함하지 않습니다.',
      '경로는 가구 앞면이 현관 개구부에 도착하는 공용부 구간까지입니다. 세대 내부 진입·회전은 검사하지 않습니다.',
      '문 개구부, 엘리베이터 내부 수용, 시험 경로 결과는 별개의 검사입니다. 막힌 시험 경로가 모든 운반 방법의 불가능을 뜻하지 않습니다.']};
}
