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
export function placementError(item,room,others,obstacles) {
  if(![item.x,item.z,item.angle].every(Number.isFinite))return '위치와 회전값을 확인해 주세요.';
  const [x1,z1,x2,z2]=room.bounds_m;
  if(corners(item).some(([x,z])=>x<x1+.015||x>x2-.015||z<z1+.015||z>z2-.015))return '가구 전체가 선택한 공간 안에 있어야 해요.';
  if(others.some(o=>o.id!==item.id&&!o.deleted&&overlap(item,o)))return '다른 가구와 겹쳐요.';
  if(obstacles.some(o=>overlap(item,o)))return '벽이나 고정 집기와 겹쳐요.';
  return null;
}
