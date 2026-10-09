// Plan-up coordinates use the model's X/Z meters, not geographic north.
export function navigationRooms(info) {
  const labels = {'Living front':'거실','Bedroom west':'작은 방 1','Bedroom center':'작은 방 2','Common bathroom lower':'공용 욕실'};
  return [...info.rooms.filter(r => !r.id.includes('strip') && r.id !== 'Common shower')
    .map(r => ({...r, name_ko: labels[r.id] || r.name_ko})),
    {id:'Kitchen', name_ko:'주방', bounds_m:[6.9049,1.28,9.5642,4.0777]},
    {id:'Entry', name_ko:'현관', bounds_m:[2.0,2.6,4.15,4.05]}];
}
export function roomAt(rooms, x, z) {
  return rooms.find(({bounds_m:[x1,z1,x2,z2]}) => x >= x1 && x <= x2 && z >= z1 && z <= z2);
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
  const angle = (definition.hingeSide === 'right' ? -1 : 1) * (1-progress) * Math.PI/2;
  const w = definition.width;
  return definition.axis === 'H' ? [x,z,x+Math.sin(angle)*w,z+Math.cos(angle)*w]
    : [x,z,x-Math.cos(angle)*w,z+Math.sin(angle)*w];
}
