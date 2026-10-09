// Plan coordinates use the same meter-valued X/Z axes as Three.js.
export function corners(item) {
  const c=Math.cos(item.angle),s=Math.sin(item.angle);
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z])=>{
    x*=item.width/2;z*=item.depth/2;
    return [item.x+c*x+s*z,item.z-s*x+c*z];
  });
}
export function overlap(a,b,clearance=.015) {
  const ca=corners(a),cb=corners(b);
  for(const p of [ca,cb]) for(let i=0;i<2;i++) {
    const q=p[i],r=p[i+1],dx=r[0]-q[0],dz=r[1]-q[1],n=Math.hypot(dx,dz);
    const axis=[-dz/n,dx/n],pa=ca.map(v=>v[0]*axis[0]+v[1]*axis[1]),pb=cb.map(v=>v[0]*axis[0]+v[1]*axis[1]);
    if(Math.max(...pa)<=Math.min(...pb)+clearance||Math.max(...pb)<=Math.min(...pa)+clearance)return false;
  }
  return true;
}
// Rugs and play mats lie flat on the floor: furniture may stand on them and they do not
// narrow a passage, so they skip the furniture overlap and clearance checks.
const flat=o=>o.height<.05;
export function placementError(item,room,others,obstacles) {
  if(![item.x,item.z,item.angle].every(Number.isFinite))return '위치와 회전값을 확인해 주세요.';
  const [x1,z1,x2,z2]=room.bounds_m;
  if(corners(item).some(([x,z])=>x<x1+.015||x>x2-.015||z<z1+.015||z>z2-.015))return '가구 전체가 선택한 공간 안에 있어야 해요.';
  if(!flat(item)&&others.some(o=>o.id!==item.id&&!o.deleted&&!flat(o)&&overlap(item,o)))return '다른 가구와 겹쳐요.';
  if(obstacles.some(o=>overlap(item,o)))return '벽이나 고정 집기와 겹쳐요.';
  return null;
}

// Advisory footprints follow the viewer's inferred door hinges, not a survey.
export function doorFootprints(definitions) {
  return definitions.filter(d=>d.type==='hinged').flatMap(d=>
    Array.from({length:25},(_,i)=>{
      const angle=i*Math.PI/48*(d.hingeSide==='right'?-1:1),w=d.width,[x,,z]=d.hinge;
      return d.axis==='H'
        ? {x:x+Math.sin(angle)*w/2,z:z+Math.cos(angle)*w/2,width:.08,depth:w,angle,title:d.name}
        : {x:x-Math.cos(angle)*w/2,z:z+Math.sin(angle)*w/2,width:w,depth:.08,angle,title:d.name};
    }));
}

export function placementWarnings(item,room,others,obstacles,doors=[],clearance=.6) {
  if(![item.x,item.z,item.angle].every(Number.isFinite))return ['위치와 회전값을 확인해 주세요.'];
  const warnings=[], [x1,z1,x2,z2]=room.bounds_m;
  if(corners(item).some(([x,z])=>x<x1||x>x2||z<z1||z>z2))warnings.push('선택한 공간의 경계를 벗어났어요.');
  const furniture=flat(item)?[]:others.filter(o=>o.id!==item.id&&!o.deleted&&!flat(o));
  if(furniture.some(o=>overlap(item,o,0)))warnings.push('다른 가구와 겹쳐요.');
  if(obstacles.some(o=>overlap(item,o,0)))warnings.push('벽이나 고정 집기와 겹쳐요.');
  const hits=[...new Set(doors.filter(o=>overlap(item,o,0)).map(o=>o.title))];
  if(hits.length)warnings.push(`${hits.join(', ')} 개방 범위에 걸려요. (문 방향 가정)`);
  // Walls separate rooms, so only furniture standing in the same room narrows a passage.
  const sameRoom=o=>o.x>=x1&&o.x<=x2&&o.z>=z1&&o.z<=z2;
  const envelope={...item,width:item.width+2*clearance,depth:item.depth+2*clearance};
  if(furniture.some(o=>sameRoom(o)&&!overlap(item,o,0)&&overlap(envelope,o,0)))warnings.push('가구 사이 여유가 60cm 미만일 수 있어요.');
  return warnings;
}
