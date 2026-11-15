import { BufferAttribute, BufferGeometry, Group, Matrix3, Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Vector3 } from 'three';
import { DOOR_OPENING, PARTITION_TYPES, partitionFrame, partitionPieces } from './wall-plan.js';

const EPS = 1e-7;
const getters = ['getX', 'getY', 'getZ', 'getW'];

// Keep-outside clipping of a mesh geometry against vertical removal boxes
// (world X/Z, full height). Attributes interpolate linearly; winding and
// material groups are preserved. Returns null when nothing intersects.
export function clipGeometryOutsideBoxes(geometry, matrixWorld, boxes) {
  const position = geometry.attributes.position; if (!position || !boxes.length) return null;
  const world = new Vector3(), names = Object.keys(geometry.attributes), attrs = names.map(n => geometry.attributes[n]);
  const sizes = attrs.map(a => a.itemSize), stride = sizes.reduce((s, n) => s + n, 0);
  const index = geometry.index, count = index ? index.count : position.count;
  const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count, materialIndex: 0 }];
  // Quick reject: geometry bounds vs boxes in world space.
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox.clone().applyMatrix4(matrixWorld);
  const relevant = boxes.filter(b => bb.max.x > b.minX + EPS && bb.min.x < b.maxX - EPS && bb.max.z > b.minZ + EPS && bb.min.z < b.maxZ - EPS);
  if (!relevant.length) return null;
  const vertex = i => {
    const values = new Float64Array(stride); let o = 0;
    attrs.forEach((a, k) => { for (let c = 0; c < sizes[k]; c++) values[o++] = a[getters[c]](i); });
    world.set(values[0], values[1], values[2]).applyMatrix4(matrixWorld);
    return { values, w: [world.x, world.z] };
  };
  const lerp = (a, b, t) => { const values = new Float64Array(stride); for (let k = 0; k < stride; k++) values[k] = a.values[k] + (b.values[k] - a.values[k]) * t; return { values, w: [a.w[0] + (b.w[0] - a.w[0]) * t, a.w[1] + (b.w[1] - a.w[1]) * t] }; };
  const split = (poly, axis, value, sign) => {
    const outside = [], inside = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], da = sign * (a.w[axis] - value), db = sign * (b.w[axis] - value);
      if (da >= -1e-9) outside.push(a); if (da <= 1e-9) inside.push(a);
      if ((da > 1e-9 && db < -1e-9) || (da < -1e-9 && db > 1e-9)) { const p = lerp(a, b, da / (da - db)); outside.push(p); inside.push(p); }
    }
    return [outside, inside];
  };
  const keepOutside = (poly, box) => {
    const kept = []; let rest = poly;
    for (const [axis, value, sign] of [[0, box.minX, -1], [0, box.maxX, 1], [1, box.minZ, -1], [1, box.maxZ, 1]]) {
      const [out, ins] = split(rest, axis, value, sign);
      if (out.length >= 3) kept.push(out);
      rest = ins; if (rest.length < 3) return kept;
    }
    return kept; // `rest` lies inside the box and is removed
  };
  const output = [], outGroups = []; let changed = false;
  for (const group of groups) {
    const startCount = output.length;
    for (let offset = group.start; offset + 2 < Math.min(count, group.start + group.count); offset += 3) {
      const tri = [0, 1, 2].map(k => vertex(index ? index.getX(offset + k) : offset + k));
      const minX = Math.min(...tri.map(v => v.w[0])), maxX = Math.max(...tri.map(v => v.w[0])), minZ = Math.min(...tri.map(v => v.w[1])), maxZ = Math.max(...tri.map(v => v.w[1]));
      let pieces = [tri];
      for (const box of relevant) {
        if (maxX <= box.minX + 1e-9 || minX >= box.maxX - 1e-9 || maxZ <= box.minZ + 1e-9 || minZ >= box.maxZ - 1e-9) continue;
        changed = true; pieces = pieces.flatMap(piece => keepOutside(piece, box));
      }
      for (const poly of pieces) for (let k = 1; k + 1 < poly.length; k++) {
        const a = poly[0].values, b = poly[k].values, c = poly[k + 1].values;
        const area = Math.hypot((b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
        if (area > 1e-10) output.push(a, b, c);
      }
    }
    outGroups.push({ start: startCount, count: output.length - startCount, materialIndex: group.materialIndex });
  }
  if (!changed) return null;
  const result = new BufferGeometry();
  let o = 0;
  names.forEach((name, k) => {
    const array = new Float32Array(output.length * sizes[k]);
    output.forEach((values, v) => { for (let c = 0; c < sizes[k]; c++) array[v * sizes[k] + c] = values[o + c]; });
    result.setAttribute(name, new BufferAttribute(array, sizes[k])); o += sizes[k];
  });
  if (geometry.groups.length) for (const g of outGroups) result.addGroup(g.start, g.count, g.materialIndex);
  result.computeBoundingBox(); result.computeBoundingSphere();
  return result;
}

// Horizontal faces of the original wall solids, in world space, for vertical
// line sampling (which heights are solid at a plan point).
export function horizontalTriangles(meshes) {
  const out = [], a = new Vector3(), b = new Vector3(), c = new Vector3();
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const g = mesh.geometry, p = g.attributes.position, index = g.index, count = index ? index.count : p.count;
    for (let i = 0; i + 2 < count; i += 3) {
      a.fromBufferAttribute(p, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(p, index ? index.getX(i + 1) : i + 1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(p, index ? index.getX(i + 2) : i + 2).applyMatrix4(mesh.matrixWorld);
      const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
      const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y), nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (Math.abs(ny) < 0.5 * Math.hypot(nx, ny, nz) || Math.abs(ny) < 1e-12) continue;
      out.push({ ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, cx: c.x, cy: c.y, cz: c.z, up: ny > 0,
        minX: Math.min(a.x, b.x, c.x), maxX: Math.max(a.x, b.x, c.x), minZ: Math.min(a.z, b.z, c.z), maxZ: Math.max(a.z, b.z, c.z) });
    }
  }
  return out;
}
export function solidIntervals(triangles, x, z) {
  const events = [];
  for (const t of triangles) {
    if (x < t.minX || x > t.maxX || z < t.minZ || z > t.maxZ) continue;
    const d = (t.bz - t.cz) * (t.ax - t.cx) + (t.cx - t.bx) * (t.az - t.cz);
    if (Math.abs(d) < 1e-14) continue;
    const l1 = ((t.bz - t.cz) * (x - t.cx) + (t.cx - t.bx) * (z - t.cz)) / d, l2 = ((t.cz - t.az) * (x - t.cx) + (t.ax - t.cx) * (z - t.cz)) / d, l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    events.push({ y: l1 * t.ay + l2 * t.by + l3 * t.cy, delta: t.up ? -1 : 1 });
  }
  events.sort((p, q) => p.y - q.y || q.delta - p.delta);
  const intervals = []; let depth = 0, start = 0;
  for (const e of events) {
    const before = depth; depth += e.delta;
    if (before <= 0 && depth > 0) start = e.y;
    if (before > 0 && depth <= 0) {
      const last = intervals.at(-1);
      if (last && e.y - last[1] < 1e-4 && start - last[1] < 1e-4) last[1] = e.y; else if (e.y - start > 1e-4) intervals.push([start, e.y]);
    }
  }
  return intervals;
}
export function intersectIntervals(a, b) {
  const out = [];
  for (const [a0, a1] of a) for (const [b0, b1] of b) { const lo = Math.max(a0, b0), hi = Math.min(a1, b1); if (hi - lo > 1e-3) out.push([lo, hi]); }
  return out;
}

// Least-squares affine map from world X/Z to the mesh's UV on its top faces,
// so floor patches continue the neighbouring plank or tile layout.
export function fitPlanarUV(mesh) {
  const g = mesh.geometry, p = g.attributes.position, uv = g.attributes.uv, n = g.attributes.normal;
  if (!p || !uv) return null;
  mesh.updateWorldMatrix(true, false);
  const m = new Float64Array(9), ru = new Float64Array(3), rv = new Float64Array(3), v = new Vector3();
  let used = 0;
  for (let i = 0; i < p.count; i++) {
    if (n && Math.abs(n.getY(i)) < 0.9) continue;
    v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
    const row = [v.x, v.z, 1];
    for (let r = 0; r < 3; r++) { for (let c = 0; c < 3; c++) m[r * 3 + c] += row[r] * row[c]; ru[r] += row[r] * uv.getX(i); rv[r] += row[r] * uv.getY(i); }
    used++;
  }
  if (used < 3) return null;
  const inv = new Matrix3().fromArray([...m]).transpose(); // symmetric; fromArray is column-major
  if (Math.abs(inv.determinant()) < 1e-12) return null;
  inv.invert();
  const e = inv.elements, solve = r => [0, 1, 2].map(row => e[row] * r[0] + e[3 + row] * r[1] + e[6 + row] * r[2]);
  return { u: solve(ru), v: solve(rv) };
}

function quadGeometry(corners, normal, uvs) {
  // Orient so the face's counter-clockwise winding agrees with `normal`.
  const [p0, p1, p2] = corners.map(c => new Vector3(...c));
  const face = new Vector3().subVectors(p1, p0).cross(new Vector3().subVectors(p2, p0));
  const order = face.dot(new Vector3(...normal)) >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(order.flatMap(i => corners[i])), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(order.flatMap(() => normal)), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(order.flatMap(i => uvs[i])), 2));
  return geometry;
}
export function capQuad(segment, end, interval, uvScale = 1) {
  const along = end === 0 ? segment.s0 : segment.s1, sign = end === 0 ? 1 : -1, [f0, f1] = segment.faces, [y0, y1] = interval;
  const corners = segment.axis === 'x'
    ? [[along, y0, f0], [along, y0, f1], [along, y1, f1], [along, y1, f0]]
    : [[f0, y0, along], [f1, y0, along], [f1, y1, along], [f0, y1, along]];
  const normal = segment.axis === 'x' ? [sign, 0, 0] : [0, 0, sign];
  return quadGeometry(corners, normal, [[f0 / uvScale, y0 / uvScale], [f1 / uvScale, y0 / uvScale], [f1 / uvScale, y1 / uvScale], [f0 / uvScale, y1 / uvScale]]);
}
// Horizontal patch [minX,maxX]×[minZ,maxZ] at height y. `down` faces the ceiling side.
export function patchQuad(rect, y, down, uvFit) {
  const corners = [[rect.minX, y, rect.minZ], [rect.maxX, y, rect.minZ], [rect.maxX, y, rect.maxZ], [rect.minX, y, rect.maxZ]];
  const uv = ([x, , z]) => uvFit ? [uvFit.u[0] * x + uvFit.u[1] * z + uvFit.u[2], uvFit.v[0] * x + uvFit.v[1] * z + uvFit.v[2]] : [x, z];
  return quadGeometry(corners, [0, down ? -1 : 1, 0], corners.map(uv));
}

// Box with meter UVs on every face (local frame: x along, y up, z across).
export function meterBox(x0, x1, y0, y1, z0, z1, uvScale = 1) {
  const faces = [
    { n: [0, 0, 1], c: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], uv: p => [p[0], p[1]] },
    { n: [0, 0, -1], c: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], uv: p => [-p[0], p[1]] },
    { n: [1, 0, 0], c: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], uv: p => [-p[2], p[1]] },
    { n: [-1, 0, 0], c: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], uv: p => [p[2], p[1]] },
    { n: [0, 1, 0], c: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], uv: p => [p[0], -p[2]] },
    { n: [0, -1, 0], c: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], uv: p => [p[0], p[2]] },
  ];
  const position = [], normal = [], uv = [];
  for (const f of faces) for (const i of [0, 1, 2, 0, 2, 3]) { position.push(...f.c[i]); normal.push(...f.n); const t = f.uv(f.c[i]); uv.push(t[0] / uvScale, t[1] / uvScale); }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(normal), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  return g;
}

export function partitionMaterials(plaster) {
  const wall = plaster?.clone() ?? new MeshStandardMaterial({ color: 0xe9e3d8, roughness: 0.9 });
  wall.name = 'Interior partition plaster'; wall.userData = { ...wall.userData, interiorPartition: true };
  return {
    wall,
    casing: new MeshStandardMaterial({ name: 'Interior partition casing', color: 0xf1eee8, roughness: 0.45 }),
    metal: new MeshStandardMaterial({ name: 'Interior partition black steel', color: 0x1d1f21, roughness: 0.38, metalness: 0.65 }),
    glass: new MeshPhysicalMaterial({ name: 'Interior partition glass', color: 0xf6faf8, roughness: 0.03, metalness: 0, transmission: 1, thickness: 0.01, ior: 1.5, specularIntensity: 1 }),
    cap: new MeshStandardMaterial({ name: 'Interior partition oak cap', color: 0xb38a5c, roughness: 0.52 }),
    dispose() { for (const m of [this.wall, this.casing, this.metal, this.glass, this.cap]) m.dispose(); },
  };
}

// Partition → Group of logical meshes. Wall pieces are finish targets
// (component 'wall'); frames, casings and glass are not.
export function buildPartition(p, materials, ceiling = 2.6) {
  const group = new Group(), { length, angle } = partitionFrame(p), t = (p.thickness ?? PARTITION_TYPES[p.type].thickness) / 2;
  group.name = `Partition/${p.id}`; group.position.set(p.a[0], 0, p.a[1]); group.rotation.y = angle;
  group.userData = { interiorPartition: p.id, partitionType: p.type };
  const add = (geometry, material, component, k, extra = {}) => {
    const mesh = new Mesh(geometry, material);
    mesh.name = `Partition/${p.id}/${component}-${k}`; mesh.castShadow = !(material.transmission > 0); mesh.receiveShadow = true;
    mesh.userData = { component, collision: true, object_id: `Partition/${p.id}/${component}-${k}`, partitionId: p.id, interiorAdded: true, ...extra };
    group.add(mesh); return mesh;
  };
  const pieces = partitionPieces(p, ceiling);
  if (p.type === 'glass') {
    const height = Math.max(...pieces.map(q => q.top)), bar = 0.04, half = bar / 2;
    const posts = [0, length]; const bays = Math.max(1, Math.round(length / 0.95));
    for (let i = 1; i < bays; i++) posts.push(length * i / bays);
    let k = 0;
    const door = p.door ? pieces.find(q => q.bottom > 0) : null, doorSpan = door ? [door.from, door.to] : null, doorTop = door?.bottom ?? 0;
    const inDoor = x => doorSpan && x > doorSpan[0] - 1e-6 && x < doorSpan[1] + 1e-6;
    for (const x of [...posts, ...(doorSpan ?? [])]) if (!inDoor(x) || doorSpan.includes(x)) add(meterBox(Math.max(0, x - half), Math.min(length, x + half), 0, height, -half, half), materials.metal, 'frame', k++);
    add(meterBox(0, length, height - bar, height, -half, half), materials.metal, 'frame', k++);
    for (const span of doorSpan ? [[0, doorSpan[0]], [doorSpan[1], length]] : [[0, length]]) if (span[1] - span[0] > 0.01) add(meterBox(span[0], span[1], 0, bar, -half, half), materials.metal, 'frame', k++);
    if (height > 2.3) for (const span of doorSpan ? [[0, doorSpan[0]], [doorSpan[1], length]] : [[0, length]]) if (span[1] - span[0] > 0.01) add(meterBox(span[0], span[1], 2.1, 2.1 + bar, -half, half), materials.metal, 'frame', k++);
    if (door) add(meterBox(doorSpan[0], doorSpan[1], doorTop - bar, doorTop, -half, half), materials.metal, 'frame', k++);
    const edges = [...new Set([...posts, ...(doorSpan ?? [])])].sort((a, b) => a - b);
    let g = 0;
    for (let i = 0; i + 1 < edges.length; i++) {
      const x0 = edges[i] + half, x1 = edges[i + 1] - half; if (x1 - x0 < 0.02) continue;
      const mid = (x0 + x1) / 2;
      if (inDoor(mid)) { if (height - doorTop > 0.08) add(meterBox(x0, x1, doorTop, height - bar, -0.005, 0.005), materials.glass, 'glass', g++, { finishTarget: false }); continue; }
      add(meterBox(x0, x1, bar, height - bar, -0.005, 0.005), materials.glass, 'glass', g++, { finishTarget: false });
    }
    return group;
  }
  pieces.forEach((q, k) => add(meterBox(q.from, q.to, q.bottom, q.top, -t, t), materials.wall, 'wall', k, { inferred_wall: false }));
  if (p.type === 'half') {
    const top = Math.max(...pieces.map(q => q.top));
    add(meterBox(-0.012, length + 0.012, top, top + 0.035, -t - 0.015, t + 0.015), materials.cap, 'partition_cap', 0);
  }
  const door = p.door ? pieces.find(q => q.bottom > 0) : null;
  if (p.door) {
    const width = Math.min(p.door.width ?? DOOR_OPENING.width, length - 0.2);
    const center = Math.max(width / 2 + 0.1, Math.min(length - width / 2 - 0.1, p.door.offset ?? length / 2));
    const x0 = center - width / 2, x1 = center + width / 2, top = door?.bottom ?? Math.min(DOOR_OPENING.height, Math.max(...pieces.map(q => q.top))), c = 0.045, d = t + 0.012;
    add(meterBox(x0, x0 + c, 0, top, -d, d), materials.casing, 'casing', 0);
    add(meterBox(x1 - c, x1, 0, top, -d, d), materials.casing, 'casing', 1);
    add(meterBox(x0, x1, top - c, top, -d, d), materials.casing, 'casing', 2);
  }
  return group;
}
