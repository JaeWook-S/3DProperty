import * as THREE from 'three';

const BASIS = 'illustrative circulation/core placement and dimensions; no surveyed common-floor plan';
const data = {component: 'decoration', collisionDisabled: true, inlineCommonDetail: true, detailBasis: BASIS};

function signedArea(ring) {
  return ring.reduce((sum, a, index) => {
    const b = ring[(index + 1) % ring.length]; return sum + a[0] * b[1] - b[0] * a[1];
  }, 0) / 2;
}
function polygonArea(polygon) {
  return Math.max(0, Math.abs(signedArea(polygon.outer)) - (polygon.holes ?? []).reduce((sum, ring) => sum + Math.abs(signedArea(ring)), 0));
}
function validRing(ring) {
  return Array.isArray(ring) && ring.length >= 3 && ring.every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite));
}
function polygonShape(polygon) {
  if (!validRing(polygon.outer) || !(polygon.holes ?? []).every(validRing)) throw new Error('Invalid inline common polygon.');
  const ringPath = (ring, Path) => {
    const path = new Path(); ring.forEach(([x, z], i) => i ? path.lineTo(x, -z) : path.moveTo(x, -z)); path.closePath(); return path;
  };
  const shape = ringPath(polygon.outer, THREE.Shape);
  shape.holes = (polygon.holes ?? []).map(ring => ringPath(ring, THREE.Path)); return shape;
}
function stoneTexture() {
  const side = 128, pixels = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const seam = x < 1 || y < 1, variation = ((x * 17 + y * 31 + x * y) % 19 - 9) * .4;
    const tone = seam ? -22 : variation + Math.sin(x * .11 + Math.cos(y * .08)) * 2;
    pixels.set([203 + tone, 199 + tone, 188 + tone, 255], (y * side + x) * 4);
  }
  const texture = new THREE.DataTexture(pixels, side, side);
  texture.name = 'Inline common / generated stone 600mm'; texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}
function mesh(parent, name, geometry, material) {
  const object = new THREE.Mesh(geometry, material); object.name = name;
  Object.assign(object.userData, data); object.receiveShadow = true; object.castShadow = false;
  parent.add(object); return object;
}
function box(parent, name, center, size, material) {
  const object = mesh(parent, name, new THREE.BoxGeometry(...size), material); object.position.set(...center); return object;
}
function floor(parent, name, polygon, material, y = 0) {
  const geometry = new THREE.ShapeGeometry(polygonShape(polygon)); geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position, uv = geometry.attributes.uv;
  for (let i = 0; i < positions.count; i++) uv.setXY(i, positions.getX(i) / .6, positions.getZ(i) / .6);
  const object = mesh(parent, name, geometry, material); object.position.y = y; return object;
}
function rectangle(width, depth) {
  return {outer: [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]]};
}

/** Render-only shared floor. All coordinates are world X/Z meters before the
 * caller adds its floor-height Y offset. A polygon is {outer:[[x,z],...],holes:[]}.
 * wallSegments must be supplied explicitly after excluding entrance/portal gaps;
 * the renderer never closes unknown areas with invented room partitions.
 *
 * Elevator clearSize is nominal inner wall spacing; dimensions/operation are
 * illustrative. Its local -Z face is the open door, transformed by Three.js yaw.
 * No collision, transport feasibility, stairs or vertical travel is introduced.
 * bounds covers modeled corridor/core only, excluding the gray unmodeled area.
 * An unmodeled polygon may carry maxFloor (for a shorter OSM building part);
 * the caller filters those meshes when changing the selected floor.
 */
export function createFloorInteriorCommon({corridorPolygons = [], entryPaths = [], wallSegments = [], elevator = null, unmodelledPolygons = []} = {}) {
  const group = new THREE.Group(); group.name = 'Selected floor / illustrative common area'; Object.assign(group.userData, data);
  const modeled = new THREE.Group(); modeled.name = 'Modeled corridor and open elevator'; Object.assign(modeled.userData, data); group.add(modeled);
  const unknown = new THREE.Group(); unknown.name = 'Unmodeled remainder / ground only'; Object.assign(unknown.userData, data); group.add(unknown);
  const stone = stoneTexture();
  const palette = {
    stone: new THREE.MeshStandardMaterial({map: stone, roughness: .8, side: THREE.DoubleSide}),
    darkStone: new THREE.MeshStandardMaterial({map: stone, color: 0x646864, roughness: .78, side: THREE.DoubleSide}),
    unknown: new THREE.MeshBasicMaterial({color: 0xbec7bc, side: THREE.DoubleSide}),
    wall: new THREE.MeshStandardMaterial({color: 0xd8d4ca, roughness: .86}),
    metal: new THREE.MeshStandardMaterial({color: 0x9ea6a7, metalness: .72, roughness: .36}),
    trim: new THREE.MeshStandardMaterial({color: 0xb3a489, metalness: .55, roughness: .4}),
    seam: new THREE.MeshStandardMaterial({color: 0x404744, roughness: .85}),
    light: new THREE.MeshStandardMaterial({color: 0xffedcf, emissive: 0xffe1a6, emissiveIntensity: .45, roughness: .6}),
  };
  for (const [name, material] of Object.entries(palette)) material.name = `Inline common / ${name}`;
  const labels = [];
  corridorPolygons.forEach((polygon, index) => floor(modeled, `Corridor stone floor ${index}`, polygon, palette.stone, .002));
  unmodelledPolygons.forEach((polygon, index) => {
    const object = floor(unknown, `Unmodeled gray floor ${index}`, polygon, palette.unknown, -.001);
    if (Number.isInteger(polygon.maxFloor) && polygon.maxFloor > 0) object.userData.maxFloor = polygon.maxFloor;
  });
  for (const [index, segment] of wallSegments.entries()) {
    const {a, b} = segment, height = segment.height ?? .45, thickness = segment.thickness ?? .07;
    if (!a?.every(Number.isFinite) || !b?.every(Number.isFinite) || a.length !== 2 || b.length !== 2 ||
        !Number.isFinite(height) || height <= 0 || height > 1.05 || !Number.isFinite(thickness) || thickness <= 0) throw new Error('Invalid low corridor side wall.');
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz); if (length < .05) continue;
    const center = [(a[0] + b[0]) / 2, height / 2, (a[1] + b[1]) / 2];
    const wall = box(modeled, `Low corridor side wall ${index}`, center, [length, height, thickness], palette.wall);
    wall.rotation.y = -Math.atan2(dz, dx);
    const trim = box(modeled, `Low corridor metal cap ${index}`, [center[0], height + .006, center[2]], [length, .012, thickness + .008], palette.trim);
    trim.rotation.y = wall.rotation.y;
  }
  let elevatorStats = null;
  if (elevator) {
    const [width, depth] = elevator.clearSize ?? [2.1, 1.6], height = elevator.height ?? 2.3;
    const thickness = elevator.wallThickness ?? .1, opening = elevator.doorWidth ?? .9, doorHeight = elevator.doorHeight ?? 2.1;
    if (!elevator.center?.every(Number.isFinite) || elevator.center.length !== 2 ||
        ![width, depth, height, thickness, opening, doorHeight, elevator.rotationYRadians ?? 0].every(Number.isFinite) ||
        Math.min(width, depth, height, thickness, opening, doorHeight) <= 0 || opening >= width || doorHeight >= height) throw new Error('Invalid illustrative elevator dimensions.');
    const cab = new THREE.Group(); cab.name = 'Illustrative elevator / open cab'; Object.assign(cab.userData, data);
    cab.position.set(elevator.center[0], 0, elevator.center[1]); cab.rotation.y = elevator.rotationYRadians ?? 0; modeled.add(cab);
    floor(cab, 'Elevator stone floor', rectangle(width, depth), palette.darkStone, .006);
    box(cab, 'Elevator back wall', [0, height / 2, (depth + thickness) / 2], [width + 2 * thickness, height, thickness], palette.metal);
    for (const side of [-1, 1]) {
      box(cab, `Elevator side wall ${side}`, [side * (width + thickness) / 2, height / 2, 0], [thickness, height, depth], palette.metal);
      const jambWidth = (width - opening) / 2;
      box(cab, `Elevator front jamb ${side}`, [side * (opening + jambWidth) / 2, doorHeight / 2, -(depth + thickness) / 2], [jambWidth, doorHeight, thickness], palette.metal);
      // Both leaves are parked outside the clear portal; no animation/collision.
      const panel = box(cab, `Elevator parked open leaf ${side}`, [side * opening * .75, doorHeight / 2, -depth / 2 - .026], [opening / 2, doorHeight, .035], palette.trim);
      panel.userData.doorState = 'fully-open-illustrative';
      box(cab, `Elevator side handrail ${side}`, [side * (width / 2 - .035), .93, .07], [.026, .028, depth - .3], palette.trim);
      box(cab, `Elevator back panel seam ${side}`, [side * width / 6, height / 2, depth / 2 - .001], [.004, height - .08, .002], palette.seam);
    }
    box(cab, 'Elevator portal header', [0, (height + doorHeight) / 2, -(depth + thickness) / 2], [width + 2 * thickness, height - doorHeight, thickness], palette.metal);
    box(cab, 'Elevator threshold', [0, .008, -depth / 2], [opening, .016, .2], palette.trim);
    box(cab, 'Elevator back handrail', [0, .93, depth / 2 - .035], [width - .18, .028, .026], palette.trim);
    box(cab, 'Elevator warm header light', [0, height - .06, depth / 2 - .009], [width - .18, .014, .016], palette.light);
    labels.push({text: '엘리베이터 · 배치 가정', position: [elevator.center[0], height + .18, elevator.center[1]]});
    elevatorStats = {clearSize: [width, depth], height, outerSize: [width + 2 * thickness, depth + 2 * thickness],
      doorWidth: opening, doorHeight, doorState: 'fully-open-illustrative', roof: false};
  }
  for (const entry of entryPaths) {
    const point = entry.points?.[0];
    if (point?.length === 2 && point.every(Number.isFinite)) labels.push({text: `${String(entry.unitId ?? '').toUpperCase()} 현관`, position: [point[0], .12, point[1]]});
  }
  group.updateMatrixWorld(true);
  let meshCount = 0, triangleCount = 0;
  group.traverse(object => { if (object.isMesh) { meshCount++; triangleCount += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3; } });
  const bounds = new THREE.Box3().setFromObject(modeled);
  const stats = {revision: 'inline-common-v1', basis: BASIS, corridorPolygons: corridorPolygons.length,
    corridorFloorArea_m2: corridorPolygons.reduce((sum, polygon) => sum + polygonArea(polygon), 0),
    unmodelledFloorArea_m2: unmodelledPolygons.reduce((sum, polygon) => sum + polygonArea(polygon), 0),
    lowWallSegments: wallSegments.length, elevator: elevatorStats, stairsModeled: false,
    sourceUnitGeometryChanged: false, newCollisionMeshes: 0, generatedTextureBytes: stone.image.data.byteLength, meshCount, triangleCount};
  group.userData.detailStats = stats;
  return {group, bounds, stats, labels};
}
