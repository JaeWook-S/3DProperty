import { pointInRoom } from '../walkthrough/minimap-geometry.js';

export function transformPoint(point, unit) {
  const c = Math.cos(unit.rotationYRadians), s = Math.sin(unit.rotationYRadians);
  return [unit.translation[0] + c * point[0] + s * point[1], unit.translation[2] - s * point[0] + c * point[1]];
}
export function inversePoint(point, unit) {
  const c = Math.cos(unit.rotationYRadians), s = Math.sin(unit.rotationYRadians);
  const x = point[0] - unit.translation[0], z = point[1] - unit.translation[2];
  return [c * x - s * z, s * x + c * z];
}
export function floorSlabs(commonArea) {
  return commonArea.slabs ?? [commonArea.slab];
}
export function pointOnFloor(x, z, units, commonArea) {
  return floorSlabs(commonArea).some(slab => Math.abs(x - slab.center[0]) <= slab.size[0] / 2 + 1e-6 && Math.abs(z - slab.center[1]) <= slab.size[1] / 2 + 1e-6)
    || units.some(unit => {
      const local = inversePoint([x, z], unit.placement);
      return unit.info.rooms.some(room => pointInRoom(room, ...local));
    });
}
export function staticCollisionMesh(object) {
  let owner = object;
  while (owner) {
    if (owner.userData.doorId || owner.userData.collisionDisabled || owner.userData.collision === false) return false;
    owner = owner.parent;
  }
  return !['lighting', 'ceiling', 'base', 'decoration'].includes(object.userData.component);
}
