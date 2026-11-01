// Plan-up coordinates use the model's X/Z meters, not geographic north.
export function navigationRooms(info) {
  if (info.navigationReady) return info.rooms.filter(r => r.navigable !== false);
  const labels = {'Living front':'거실','Bedroom west':'작은 방 1','Bedroom center':'작은 방 2','Common bathroom lower':'공용 욕실'};
  return [...info.rooms.filter(r => !r.id.includes('strip') && r.id !== 'Common shower')
    .map(r => ({...r, name_ko: labels[r.id] || r.name_ko})),
    {id:'Kitchen', name_ko:'주방', bounds_m:[6.9049,1.28,9.5642,4.0777]},
    {id:'Entry', name_ko:'현관', bounds_m:[2.0,2.6,4.15,4.05]}];
}
// Walkthrough destinations can subdivide an open room without changing its
// physical polygon, floor area, furniture placement boundary or collision mesh.
const placeCache = new WeakMap();
export function navigationPlaces(info) {
  if (!info.navigationZones?.length) return navigationRooms(info);
  if (!placeCache.has(info)) {
    const split = new Set(info.navigationZones.map(zone => zone.source_room_id));
    placeCache.set(info, [...info.navigationZones, ...navigationRooms(info).filter(room => !split.has(room.id))]);
  }
  return placeCache.get(info);
}
export function roomAt(rooms, x, z) {
  return rooms.find(room => pointInRoom(room,x,z));
}
export function planBounds(rooms, padding = .4) {
  const x = Math.min(...rooms.map(r => r.bounds_m[0])) - padding;
  const z = Math.min(...rooms.map(r => r.bounds_m[1])) - padding;
  return [x, z, Math.max(...rooms.map(r => r.bounds_m[2])) + padding - x,
    Math.max(...rooms.map(r => r.bounds_m[3])) + padding - z];
}
export function headingDegrees(yaw) { return -yaw * 180 / Math.PI; }
export function viewSector(horizontalDegrees, radius = 1.35) {
  const half = horizontalDegrees * Math.PI / 360;
  const x = radius * Math.sin(half), z = -radius * Math.cos(half);
  return `M 0 0 L ${-x} ${z} A ${radius} ${radius} 0 0 1 ${x} ${z} Z`;
}
export function hingedSegment(definition, progress) {
  const [x,,z] = definition.hinge;
  if(definition.adapter==='exported') {
    const [dx,dz]=definition.closedDirection,a=definition.swingRadians*progress,c=Math.cos(a),s=Math.sin(a);
    return [x,z,x+(c*dx+s*dz)*definition.width,z+(-s*dx+c*dz)*definition.width];
  }
  const angle = (definition.hingeSide === 'right' ? -1 : 1) * (1-progress) * Math.PI/2;
  const w = definition.width;
  return definition.axis === 'H' ? [x,z,x+Math.sin(angle)*w,z+Math.cos(angle)*w]
    : [x,z,x-Math.cos(angle)*w,z+Math.sin(angle)*w];
}

// Inclusive polygon containment for L-shaped rooms; rectangles remain compatible.
export function pointInRoom(room,x,z) {
  const [a,b,c,d]=room.bounds_m;
  if(x<a-1e-7||x>c+1e-7||z<b-1e-7||z>d+1e-7)return false;
  if(!room.polygon_m)return true;
  let inside=false;const p=room.polygon_m;
  for(let i=0,j=p.length-1;i<p.length;j=i++) {
    const [x1,z1]=p[j],[x2,z2]=p[i];
    const cross=(x-x1)*(z2-z1)-(z-z1)*(x2-x1);
    if(Math.abs(cross)<1e-7&&x>=Math.min(x1,x2)-1e-7&&x<=Math.max(x1,x2)+1e-7&&z>=Math.min(z1,z2)-1e-7&&z<=Math.max(z1,z2)+1e-7)return true;
    if((z1>z)!==(z2>z)&&x<(x2-x1)*(z-z1)/(z2-z1)+x1)inside=!inside;
  }
  return inside;
}
