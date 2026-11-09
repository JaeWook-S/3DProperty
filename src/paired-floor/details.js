import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { floorSlabs } from './geometry.js';
import { pointInRoom } from '../walkthrough/minimap-geometry.js';

// Illustrative, removable finishes. Source models, dimensions, door geometry and
// authored materials remain intact. Every texture is generated locally on CPU.
const FINISH_OFFSET = .0015;
const GLYPHS = {
  '0':['01110','10001','10011','10101','11001','10001','01110'],
  '1':['00100','01100','00100','00100','00100','00100','01110'],
  '2':['01110','10001','00001','00010','00100','01000','11111'],
  '4':['00010','00110','01010','10010','11111','00010','00010'],
  '6':['00110','01000','10000','11110','10001','10001','01110'],
  '8':['01110','10001','10001','01110','10001','10001','01110'],
  A:['01110','10001','10001','11111','10001','10001','10001'],
  C:['01111','10000','10000','10000','10000','10000','01111'],
  F:['11111','10000','10000','11110','10000','10000','10000'],
  I:['11111','00100','00100','00100','00100','00100','11111'],
  L:['10000','10000','10000','10000','10000','10000','11111'],
  T:['11111','00100','00100','00100','00100','00100','00100'],
  '^':['00100','01110','10101','00100','00100','00100','00100'],
};

function noise(x, y, seed = 0) {
  let n = Math.imul(x + 173, 374761393) ^ Math.imul(y + 127, 668265263) ^ seed;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function texture(kind, size = 256) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, n = noise(x, y), index = (y * size + x) * 4;
    let rgb;
    if (kind === 'oak') {
      const row = Math.floor(v * 8), across = (v * 8) % 1;
      const joint = across < .018 || ((u + (row % 3) / 3) % 1) < .007;
      const grain = Math.sin(v * 700 + Math.sin(u * 12 + row) * 2) * 2.6;
      const tone = (noise(row, 19) - .5) * 18 + grain + (n - .5) * 5;
      rgb = joint ? [120, 102, 79] : [198 + tone, 173 + tone, 137 + tone];
    } else if (kind === 'metal') {
      const tone = (noise(x, 31) - .5) * 3 + (n - .5) * 1.5 + Math.sin(u * Math.PI * 2) * 2;
      rgb = [172 + tone, 175 + tone, 177 + tone];
    } else if (kind === 'plaster') {
      const tone = (n - .5) * 5 + Math.sin(u * 31) * Math.sin(v * 37) * 1.1;
      rgb = [231 + tone, 226 + tone, 215 + tone];
    } else {
      const grout = x < 2 || y < 2;
      const cloud = Math.sin(u * 13 + Math.cos(v * 7)) * 2.8 + Math.sin(v * 26 + u * 17) * 1.8;
      const tone = cloud + (n - .5) * 6 + (noise(x >> 3, y >> 3) - .5) * 2;
      const base = kind === 'dark-stone' ? [107, 108, 102] : [202, 195, 181];
      rgb = grout ? base.map(c => c - 17) : base.map(c => c + tone);
    }
    for (let channel = 0; channel < 3; channel++) data[index + channel] = Math.round(rgb[channel]);
    data[index + 3] = 255;
  }
  const result = new THREE.DataTexture(data, size, size);
  result.name = `Paired finish / ${kind}`;
  result.wrapS = result.wrapT = THREE.RepeatWrapping;
  result.colorSpace = THREE.SRGBColorSpace;
  result.magFilter = THREE.LinearFilter; result.minFilter = THREE.LinearMipmapLinearFilter;
  result.generateMipmaps = true; result.needsUpdate = true;
  return result;
}

function materials() {
  const make = (name, options) => {
    const material = new THREE.MeshStandardMaterial(options);
    material.name = `Paired detail / ${name}`;
    return material;
  };
  const plaster = texture('plaster', 128), metal = texture('metal', 128);
  metal.repeat.set(4, 4);
  return {
    plaster: make('warm mineral plaster', {map: plaster, color: 0xd8d0c4, roughness: .93, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1}),
    stone: make('honed limestone 600 mm', {map: texture('stone'), roughness: .78}),
    darkStone: make('charcoal stone 600 mm', {map: texture('dark-stone'), roughness: .75}),
    oak: make('natural oak 180 mm boards', {map: texture('oak'), color: 0xd8ccba, roughness: .71}),
    metal: make('satin stainless steel', {map: metal, color: 0xe3e5e5, metalness: .68, roughness: .42}),
    brass: make('champagne anodized trim', {color: 0x9c8661, metalness: .58, roughness: .43}),
    trim: make('warm white skirting', {color: 0xd7d0c1, roughness: .72}),
    shadow: make('recessed shadow joint', {color: 0x494842, roughness: .9}),
    diffuser: make('warm LED diffuser', {color: 0xfff2d2, emissive: 0xffdca0, emissiveIntensity: .65, roughness: .6}),
    ceiling: make('ceiling white', {color: 0xf0ece3, roughness: .95}),
  };
}

function mesh(parent, name, geometry, material, component = 'decoration') {
  const object = new THREE.Mesh(geometry, material);
  object.name = name; object.receiveShadow = true;
  Object.assign(object.userData, {component, collisionDisabled: true, pairedFinish: true,
    detailBasis: 'illustrative removable finish; source meter geometry unchanged'});
  parent.add(object); return object;
}

function box(parent, name, center, size, material, component) {
  const object = mesh(parent, name, new THREE.BoxGeometry(...size), material, component);
  object.position.set(...center); return object;
}

function floor(parent, name, polygon, material, period = [.6, .6]) {
  const shape = new THREE.Shape(polygon.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position, uv = geometry.attributes.uv;
  for (let i = 0; i < position.count; i++) uv.setXY(i, position.getX(i) / period[0], position.getZ(i) / period[1]);
  const object = mesh(parent, name, geometry, material);
  object.position.y = FINISH_OFFSET;
  return object;
}

function rectangle(center, size) {
  return [[center[0] - size[0] / 2, center[1] - size[1] / 2],
    [center[0] + size[0] / 2, center[1] - size[1] / 2],
    [center[0] + size[0] / 2, center[1] + size[1] / 2],
    [center[0] - size[0] / 2, center[1] + size[1] / 2]];
}

function panel(parent, name, point, normal, width, height, material) {
  const object = mesh(parent, name, new THREE.PlaneGeometry(width, height), material);
  object.position.set(...point); object.rotation.y = Math.atan2(normal[0], normal[1]);
  return object;
}

function labelMaterial(text, led = false) {
  const width = 256, height = 96, data = new Uint8Array(width * height * 4);
  const background = led ? [28, 34, 32] : [67, 65, 58], foreground = led ? [241, 215, 152] : [232, 222, 200];
  for (let i = 0; i < width * height; i++) data.set([...background, 255], i * 4);
  const scale = Math.min(8, Math.floor((width - 32) / (text.length * 6)));
  const startX = Math.round((width - (text.length * 6 - 1) * scale) / 2), startY = Math.round((height - 7 * scale) / 2);
  [...text].forEach((character, index) => (GLYPHS[character] ?? []).forEach((row, y) => [...row].forEach((pixel, x) => {
    if (pixel !== '1') return;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const column = startX + (index * 6 + x) * scale + dx, line = height - 1 - startY - y * scale - dy;
      data.set([...foreground, 255], (line * width + column) * 4);
    }
  })));
  const map = new THREE.DataTexture(data, width, height);
  map.colorSpace = THREE.SRGBColorSpace; map.magFilter = THREE.LinearFilter; map.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({map, roughness: .6, emissive: led ? 0xffffff : 0x000000,
    emissiveMap: led ? map : null, emissiveIntensity: led ? .5 : 0});
  material.name = `Paired detail / sign ${text}`; return material;
}

function commonDetails(group, area, placements, palette, commonGroup) {
  const stats = {floorSurfaces: 0, wallPanels: 0, lights: 0, signs: 0};
  const elevator = area.elevator, [ex, ez] = elevator.center;
  if (commonGroup) {
    const previous = new Set();
    commonGroup.traverse(object => {
      if (!object.isMesh) return;
      // Flush clickable panels below replace the old 100 mm decorative cubes.
      if (/^Elevator button /.test(object.name)) object.visible = false;
      let replacement;
      if (object.userData.component === 'ceiling') replacement = palette.ceiling;
      else if (object.userData.component === 'wall') replacement = /^Elevator (side|back|jamb|head)/.test(object.name) ? palette.metal : palette.plaster;
      else if (object.userData.component === 'floor') replacement = palette.stone;
      else if (/Elevator leaf/.test(object.name)) replacement = palette.metal;
      else if (/Elevator threshold/.test(object.name)) replacement = palette.metal;
      else if (/Elevator button/.test(object.name)) replacement = palette.brass;
      if (replacement) { for (const material of Array.isArray(object.material) ? object.material : [object.material]) previous.add(material); object.material = replacement; }
    });
    const retained = new Set();
    commonGroup.traverse(object => { if (object.isMesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) retained.add(material); });
    // Common meshes are created for this load; dispose only orphaned common materials.
    for (const material of previous) if (!retained.has(material)) material.dispose();
  }
  for (const [index, slab] of floorSlabs(area).entries()) {
    const isCar = Math.hypot(slab.center[0] - ex, slab.center[1] - ez) < .05;
    floor(group, `Common / ${isCar ? 'elevator' : 'hall'} stone ${index}`, rectangle(slab.center, slab.size), isCar ? palette.darkStone : palette.stone);
    stats.floorSurfaces++;
  }
  for (const wall of area.walls) {
    if (wall.component === 'ceiling' || (wall.bottom ?? 0) > .01) continue;
    const alongX = wall.size[0] > wall.size[1], length = Math.max(...wall.size);
    if (length < .25) continue;
    const car = /^Elevator (side|back)/.test(wall.id), target = car ? elevator.center : [floorSlabs(area)[0].center[0], 0];
    const normal = alongX ? [0, Math.sign(target[1] - wall.center[1]) || 1] : [Math.sign(target[0] - wall.center[0]) || 1, 0];
    const depth = Math.min(...wall.size) / 2;
    const face = [wall.center[0] + normal[0] * (depth + .001), wall.center[1] + normal[1] * (depth + .001)];
    const tangent = [normal[1], -normal[0]];
    const height = wall.height ?? 2.5;
    panel(group, `${wall.id} / stone skirting`, [face[0], .055, face[1]], normal, length, .11, car ? palette.metal : palette.darkStone);
    const count = Math.max(1, Math.floor(length / (car ? .65 : 1.25)));
    for (let i = 1; i < count; i++) {
      const offset = -length / 2 + length * i / count;
      panel(group, `${wall.id} / panel joint ${i}`, [face[0] + tangent[0] * offset, height / 2, face[1] + tangent[1] * offset], normal, .004, height - .14, palette.shadow);
      stats.wallPanels++;
    }
    if (car) panel(group, `${wall.id} / satin waist inlay`, [face[0] + normal[0] * .0005, .92, face[1] + normal[1] * .0005], normal, length - .08, .035, palette.brass);
    else if (length > 2) {
      panel(group, `${wall.id} / high warm light`, [face[0] + normal[0] * .001, height - .12, face[1] + normal[1] * .001], normal, length - .12, .018, palette.diffuser);
      stats.lights++;
    }
  }
  // Ceiling fixtures follow slab/ceiling metadata, never guessed room dimensions.
  for (const ceiling of area.walls.filter(wall => wall.component === 'ceiling')) {
    const car = /Elevator/.test(ceiling.id), [x, z] = ceiling.center;
    const longZ = ceiling.size[1] > ceiling.size[0], count = car ? 1 : Math.max(1, Math.floor(Math.max(...ceiling.size) / 2));
    for (let i = 0; i < count; i++) {
      const offset = (i - (count - 1) / 2) * 2;
      const center = [x + (longZ ? 0 : offset), ceiling.bottom - .009, z + (longZ ? offset : 0)];
      const size = car ? [ceiling.size[0] - .35, .014, ceiling.size[1] - .35] : [.38, .014, .65];
      box(group, `${ceiling.id} / light surround ${i}`, center, size, palette.brass, 'ceiling');
      box(group, `${ceiling.id} / luminous diffuser ${i}`, [center[0], center[1] - .008, center[2]], [size[0] - .055, .003, size[2] - .055], palette.diffuser, 'ceiling');
      stats.lights++;
    }
  }
  const [nx, nz] = elevator.doorNormal, tangent = [nz, -nx], [dx, dz] = elevator.doorCenter;
  const front = (offset, normalOffset, y) => [dx + tangent[0] * offset + nx * normalOffset, y, dz + tangent[1] * offset + nz * normalOffset];
  for (const side of [-1, 1]) {
    panel(group, `Elevator / brushed portal ${side}`, front(side * (elevator.doorWidth / 2 + .045), .061, 1.05), [nx, nz], .085, 2.1, palette.brass);
  }
  panel(group, 'Elevator / luminous header', front(0, .063, 2.18), [nx, nz], elevator.doorWidth + .17, .018, palette.diffuser);
  panel(group, 'Elevator / destination display', front(0, .064, 2.32), [nx, nz], .36, .13, labelMaterial('^ LIFT', true));
  stats.signs++;
  for (const side of [-1, 1]) {
    const normal = [nx * side, nz * side], offset = elevator.doorWidth / 2 + .15;
    const point = front(offset, side * .065, 1.22);
    const plate = panel(group, `Elevator / call panel ${side}`, point, normal, .14, .38, palette.metal);
    plate.userData.doorId = 'paired-floor:elevator';
    for (const [index, y] of [1.14, 1.29].entries()) {
      const button = mesh(group, `Elevator / call button ${side}:${index}`, new THREE.CircleGeometry(.025, 16), index ? palette.diffuser : palette.brass);
      button.position.set(point[0] + normal[0] * .001, y, point[2] + normal[1] * .001);
      button.rotation.y = Math.atan2(normal[0], normal[1]); button.userData.doorId = 'paired-floor:elevator';
    }
  }
  // Fine sill grooves remain within the existing threshold, at floor level.
  for (let index = -2; index <= 2; index++) {
    const center = front(0, index * .035, .017);
    box(group, `Elevator / threshold groove ${index}`, center, [Math.abs(tangent[0]) * elevator.doorWidth + Math.abs(nx) * .003, .001,
      Math.abs(tangent[1]) * elevator.doorWidth + Math.abs(nz) * .003], palette.shadow);
  }
  // Entrance labels are placed on the existing lintel, never in a doorway.
  for (const placement of placements) {
    const entry = placement.targetEntryWorld;
    if (!entry) continue;
    const lintel = area.walls.find(wall => /Entrance lintel/.test(wall.id) && Math.hypot(wall.center[0] - entry[0], wall.center[1] - entry[1]) < .25);
    if (!lintel) continue;
    const normal = [Math.sign(floorSlabs(area)[0].center[0] - lintel.center[0]), 0];
    panel(group, `Entrance / ${placement.id.toUpperCase()} type sign`, [lintel.center[0] + normal[0] * (lintel.size[0] / 2 + .002), lintel.bottom + lintel.height / 2, lintel.center[1]], normal,
      Math.min(.32, lintel.size[1] * .6), Math.min(.115, lintel.height * .8), labelMaterial(placement.id.toUpperCase()));
    stats.signs++;
  }
  return stats;
}

function projectedGeometry(source, matrix) {
  const geometry = source.clone().applyMatrix4(matrix);
  const positions = geometry.attributes.position, normals = geometry.attributes.normal;
  const uv = new Float32Array(positions.count * 2);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const nx = Math.abs(normals?.getX(i) ?? 0), ny = Math.abs(normals?.getY(i) ?? 0), nz = Math.abs(normals?.getZ(i) ?? 0);
    uv[i * 2] = nx > nz ? z : x; uv[i * 2 + 1] = ny > .8 ? z : y;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  // Source exporters can carry additional attributes. Normalize only the clone
  // so independently exported wall primitives can share one render-only mesh.
  for (const attribute of Object.keys(geometry.attributes)) if (!['position', 'normal', 'uv'].includes(attribute)) geometry.deleteAttribute(attribute);
  if (!normals) geometry.computeVertexNormals();
  const expanded = geometry.index ? geometry.toNonIndexed() : geometry;
  if (expanded !== geometry) geometry.dispose();
  // Source render batches remove shared horizontal wall-layer caps. Copying
  // them here reintroduces dark seams; plaster needs only vertical faces.
  // Original wall top caps continue to render in the source model.
  const keep = [], position = expanded.attributes.position;
  for (let i = 0; i < position.count; i += 3) {
    if (Math.abs(position.getY(i) - position.getY(i + 1)) < 1e-6 &&
        Math.abs(position.getY(i) - position.getY(i + 2)) < 1e-6) continue;
    keep.push(i, i + 1, i + 2);
  }
  const result = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(expanded.attributes)) {
    const data = new Float32Array(keep.length * attribute.itemSize);
    for (const [index, vertex] of keep.entries()) for (let component = 0; component < attribute.itemSize; component++) {
      data[index * attribute.itemSize + component] = attribute.array[vertex * attribute.itemSize + component];
    }
    result.setAttribute(name, new THREE.BufferAttribute(data, attribute.itemSize));
  }
  expanded.dispose();
  return result;
}

function finishStructuralDoors(model) {
  const cache = new Map();
  let count = 0;
  model.traverse(object => {
    if (!object.isMesh || !/^door-\d+\/leaf(?:\/primitive-\d+)?$/.test(object.userData.object_id ?? object.name)) return;
    const entrance = (object.userData.object_id ?? object.name).startsWith('door-00/');
    const finish = original => {
      const key = `${original.uuid}:${entrance}`;
      if (!cache.has(key)) {
        const material = original.clone();
        material.name = `Paired detail / ${entrance ? 'walnut entrance' : 'warm oak door'}`;
        material.color.setHex(entrance ? 0x71604c : 0xb6a084);
        material.roughness = .72; material.metalness = 0;
        cache.set(key, material);
      }
      return cache.get(key);
    };
    // Clone material only: leaf vertices, MovingDoor hierarchy, source material
    // definitions and the exported GLB are unchanged.
    object.material = Array.isArray(object.material) ? object.material.map(finish) : finish(object.material);
    object.userData.pairedDoorFinish = true; count++;
  });
  return count;
}

function segmentsOutsideOpenings(a, b, openings) {
  const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
  if (length < .08) return [];
  const tangent = [dx / length, dz / length];
  let spans = [[0, length]];
  for (const opening of openings) {
    if ((opening.bottom_m ?? 0) > .14) continue;
    const axis = opening.axis === 'x' ? [1, 0] : [0, 1];
    if (Math.abs(tangent[0] * axis[0] + tangent[1] * axis[1]) < .98) continue;
    const offset = [opening.center_m[0] - a[0], opening.center_m[1] - a[1]];
    if (Math.abs(offset[0] * tangent[1] - offset[1] * tangent[0]) > .32) continue;
    const center = offset[0] * tangent[0] + offset[1] * tangent[1], half = opening.width_m / 2 + .08;
    spans = spans.flatMap(([start, end]) => end < center - half || start > center + half ? [[start, end]] :
      [[start, Math.min(end, center - half)], [Math.max(start, center + half), end]].filter(([s, e]) => e - s > .08));
  }
  return spans.filter(([start, end]) => end - start > .08).map(([start, end]) => ({
    a: [a[0] + tangent[0] * start, a[1] + tangent[1] * start],
    b: [a[0] + tangent[0] * end, a[1] + tangent[1] * end],
  }));
}

function unitDetails(group, unit, palette) {
  const local = new THREE.Group(); local.name = '211A / removable finish layer';
  local.position.set(...unit.placement.translation); local.rotation.y = unit.placement.rotationYRadians;
  group.add(local);
  const stats = {floorSurfaces: 0, skirtingSegments: 0, wallSurfaces: 0, lights: 0, doorFinishes: 0};
  const rooms = unit.info.rooms, openings = unit.info.openings ?? [];
  for (const room of rooms) {
    if (room.navigable === false || !room.polygon_m?.length) continue;
    const wood = ['bedroom', 'living', 'storage'].includes(room.kind), wet = room.kind === 'wet';
    const finish = floor(local, `211A / ${room.id} / ${wood ? 'oak' : 'stone'} finish`, room.polygon_m,
      wood ? palette.oak : wet ? palette.darkStone : palette.stone, wood ? [2.4, 1.44] : [.6, .6]);
    Object.assign(finish.userData, {room_id: room.id, sourceRoomPolygon: true}); stats.floorSurfaces++;
    for (let i = 0; i < room.polygon_m.length; i++) {
      const a = room.polygon_m[i], b = room.polygon_m[(i + 1) % room.polygon_m.length];
      const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
      if (length < .08) continue;
      let outward = [-dz / length, dx / length];
      const middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (pointInRoom(room, middle[0] + outward[0] * .015, middle[1] + outward[1] * .015)) outward = outward.map(v => -v);
      if (rooms.some(other => other !== room && pointInRoom(other, middle[0] + outward[0] * .015, middle[1] + outward[1] * .015))) continue;
      for (const [index, span] of segmentsOutsideOpenings(a, b, openings).entries()) {
        const object = box(local, `211A / ${room.id} / skirting ${i}:${index}`,
          [(span.a[0] + span.b[0]) / 2 + outward[0] * .001, .04, (span.a[1] + span.b[1]) / 2 + outward[1] * .001],
          [Math.hypot(span.b[0] - span.a[0], span.b[1] - span.a[1]), .075, .004], wet ? palette.darkStone : palette.trim);
        object.rotation.y = -Math.atan2(dz, dx); object.userData.room_id = room.id; stats.skirtingSegments++;
      }
    }
    const point = room.representative_point_m, ceiling = room.ceiling_height_m;
    if (point && Number.isFinite(ceiling) && (room.polygon_area_m2 ?? 0) > 2) {
      const width = ['living', 'bedroom'].includes(room.kind) ? .48 : .22;
      box(local, `211A / ${room.id} / ceiling light rim`, [point[0], ceiling - .007, point[1]], [width, .012, width], palette.trim, 'ceiling');
      box(local, `211A / ${room.id} / ceiling diffuser`, [point[0], ceiling - .014, point[1]], [width - .04, .002, width - .04], palette.diffuser, 'ceiling');
      stats.lights++;
    }
  }
  if (unit.model) {
    stats.doorFinishes = finishStructuralDoors(unit.model);
    unit.model.updateWorldMatrix(true, true);
    const inverse = unit.model.matrixWorld.clone().invert(), geometry = [];
    unit.model.traverse(object => {
      if (!object.isMesh || object.userData.component !== 'wall') return;
      geometry.push(projectedGeometry(object.geometry, new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld)));
    });
    if (geometry.length) {
      const merged = mergeGeometries(geometry);
      for (const item of geometry) item.dispose();
      if (merged) { mesh(local, '211A / mineral plaster on source wall surfaces', merged, palette.plaster); stats.wallSurfaces = geometry.length; }
    }
  }
  return stats;
}

/** Call before scene batching. Source geometry/material definitions stay intact;
 * 211A structural door leaves receive warm runtime material clones.
 * commonGroup is optional; only its newly authored placeholder materials change.
 * There are no new obstacles: floor/wall finishes are flush, skirting projects
 * at most 1 mm inside source rooms, fixtures stay on existing ceilings.
 */
export function createPairedDetails({layout, units = [], commonGroup = null, includeCommon = true}) {
  const area = layout.commonArea ?? layout, group = new THREE.Group();
  group.name = 'Paired floor / illustrative finish details';
  group.userData.collisionDisabled = true;
  const palette = materials();
  const common = includeCommon ? commonDetails(group, area, layout.units ?? units.map(unit => unit.placement), palette, commonGroup) : null;
  const interiors = units.filter(unit => unit.id === '211a').map(unit => unitDetails(group, unit, palette));
  group.updateMatrixWorld(true);
  let meshCount = 0, triangleCount = 0;
  group.traverse(object => { if (object.isMesh) { meshCount++; triangleCount += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3; } });
  const stats = {revision: 'paired-finishes-v1', common, interiors, meshCount, triangleCount,
    generatedTextureBytes: 0, newCollisionMeshes: 0, floorOffset_m: FINISH_OFFSET,
    sourceGeometryChanged: false, sourceUnitMaterialsChanged: interiors.some(item => item.doorFinishes > 0),
    sourceMaterialDefinitionsChanged: false};
  const textures = new Set();
  group.traverse(object => { if (object.isMesh) for (const value of Object.values(object.material)) if (value?.isTexture) textures.add(value); });
  for (const map of textures) stats.generatedTextureBytes += map.image?.data?.byteLength ?? 0;
  group.userData.detailStats = stats;
  return {group, collisionMeshes: [], stats};
}
