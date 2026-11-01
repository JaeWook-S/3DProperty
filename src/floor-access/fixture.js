import source from '../../assets/models/acro-river-park/168c/archisketch-metric-v1/expanded/model-info.json' with {type:'json'};

export const UNIT_MODEL_URL = new URL('../../assets/models/acro-river-park/168c/archisketch-metric-v1/expanded/acro168c-expanded.glb', import.meta.url).href;
export const UNIT_SOURCE = source;
export const DEFAULTS = Object.freeze({hallWidth:4.8,hallDepth:6,carWidth:1.6,carDepth:2.1,carHeight:2.3,doorWidth:.9,doorHeight:2.1,clearance:.02,doorOpen:true});
export const LIMITS = Object.freeze({hallWidth:[3,8],hallDepth:[5,10],carWidth:[1,3],carDepth:[1,2.5],carHeight:[1.8,3],doorWidth:[.5,2.8],doorHeight:[1.6,2.8],clearance:[0,.15]});
export function checkedConfig(input={}) {
  const p={...DEFAULTS,...input};
  for(const [key,[lo,hi]] of Object.entries(LIMITS)) if(!Number.isFinite(p[key])||p[key]<lo||p[key]>hi) throw new Error(`${key}: ${lo}–${hi} m 범위로 입력해 주세요.`);
  if(p.doorWidth>p.carWidth-.1) throw new Error('엘리베이터 문 폭은 내부 폭보다 최소 0.10m 작아야 합니다.');
  if(p.doorHeight>p.carHeight) throw new Error('엘리베이터 문 높이는 내부 높이를 넘을 수 없습니다.');
  if(p.hallWidth<p.carWidth+1.6) throw new Error('양쪽 통로를 남기려면 공용 홀 폭을 카 내부 폭보다 1.60m 이상 크게 설정해 주세요.');
  if(p.carHeight>2.5) throw new Error('이 원형의 공용 홀 천장은 2.50m입니다. 엘리베이터 높이도 2.50m 이하로 설정해 주세요.');
  if(typeof p.doorOpen!=='boolean') throw new Error('문 상태가 올바르지 않습니다.');
  return p;
}
export function transformPoint([x,z], t) { const c=Math.cos(t.yaw),s=Math.sin(t.yaw);return [t.x+c*x+s*z,t.z-s*x+c*z]; }
export function buildFloor(input={}) {
  const p=checkedConfig(input), w=p.hallWidth/2,d=p.hallDepth/2,t=.2, height=2.5;
  const entry=source.openings.find(o=>o.id==='door-00');
  const entryOffset=d-.6;
  const units=[{id:'study-unit-1',label:'1라인 · 168C 확장형',anchor:[w+t/2,entryOffset],yaw:0},{id:'study-unit-2',label:'2라인 · 168C 확장형',anchor:[-w-t/2,-entryOffset],yaw:Math.PI}].map(u=>{
    const [ex,ez]=transformPoint(entry.center_m,{x:0,z:0,yaw:u.yaw});return {...u,x:u.anchor[0]-ex,z:u.anchor[1]-ez,scale:1,sourceEntrance:entry.id};
  });
  const car={id:'car',x:0,z:-d+t+p.carDepth/2,yaw:0,width:p.carWidth,depth:p.carDepth,height:p.carHeight,bottomY:0};
  const obstacles=[];
  const box=(id,title,x,z,width,depth,h=height,bottomY=0,kind='wall',yaw=0)=>{if(width>1e-8&&depth>1e-8&&h>1e-8)obstacles.push({id,title,x,z,width,depth,height:h,bottomY,yaw,kind});};
  box('hall-south','공용 홀 끝 벽',0,d+t/2,2*w+2*t,t);
  for(const side of [-1,1]) {
    const z=side*entryOffset,opening=entry.width_m,a=-d,b=z-opening/2,c=z+opening/2,e=d;
    box(`hall-side-${side}-before`,'현관 옆 벽',side*(w+t/2),(a+b)/2,t,b-a);
    box(`hall-side-${side}-after`,'현관 옆 벽',side*(w+t/2),(c+e)/2,t,e-c);
    box(`unit-door-${side}`,'세대 현관문 · 내부 경로는 미검사',side*(w+t/2),z,t,opening,entry.height_m,0,'unit-door');
    box(`unit-head-${side}`,'세대 현관 상부',side*(w+t/2),z,t,opening,height-entry.height_m,entry.height_m);
  }
  box('hall-north','공용 홀 북쪽 벽',0,-d-t/2,2*w+2*t,t);
  const gap=p.doorWidth/2, carFront=-d+t+p.carDepth, outerCar=p.carWidth/2+t;
  for(const side of [-1,1]) {
    box(`lift-front-${side}`,'엘리베이터 문틀 옆 벽',side*(outerCar+gap)/2,carFront+t/2,outerCar-gap,t);
    box(`car-side-${side}`,'엘리베이터 내벽',side*(p.carWidth/2+t/2),car.z,t,p.carDepth+2*t,p.carHeight);
  }
  box('lift-lintel','엘리베이터 문 상부',0,carFront+t/2,p.doorWidth,t,height-p.doorHeight,p.doorHeight,'lintel');
  box('car-back','엘리베이터 뒷벽',0,car.z-p.carDepth/2-t/2,p.carWidth+2*t,t,p.carHeight);
  box('hall-ceiling','공용 홀 천장',0,0,2*w,2*d,.18,height,'ceiling');
  box('car-ceiling','엘리베이터 천장',car.x,car.z,p.carWidth,p.carDepth,.18,p.carHeight,'ceiling');
  if(!p.doorOpen)box('lift-door','닫힌 엘리베이터 문',0,carFront+t/2,p.doorWidth,.04,p.doorHeight,0,'lift-door');
  const zones=[{id:'hall',x:0,z:0,width:p.hallWidth,depth:p.hallDepth},{...car},{id:'threshold',x:0,z:carFront+t/2,width:p.doorWidth,depth:t}];
  const destinations=units.map((u,i)=>({id:u.id,label:`${i+1}라인 현관 앞`,x:(i===0?1:-1)*(w-1),z:(i===0?1:-1)*entryOffset,yaw:Math.PI/2}));
  return {config:p,units,car,obstacles,zones,destinations,sourceEntrance:entry,doorZ:carFront+t/2,
    provenance:{units:'Archisketch metric-v1 source coordinates; rigid copies, scale 1',commonArea:'illustrative_editable_assumption_not_actual_acro_floor',buildingAndFloor:null,entryClearPassageVerified:false}};
}
export function classifyEndpoint(pose,floor) {
  if(Math.abs(pose.x-floor.car.x)<floor.car.width/2 && Math.abs(pose.z-floor.car.z)<floor.car.depth/2)return 'car';
  const found=floor.destinations.find(d=>Math.hypot(pose.x-d.x,pose.z-d.z)<.7);
  return found?.id ?? 'other';
}
