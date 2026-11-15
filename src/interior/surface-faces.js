import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three';
import { bakedRenderData } from '../walkthrough/baked-lighting-geometry.js';
import { roomContains } from './wall-plan.js';

// Finish targets are semantic: "the wall plane facing room R" or "room R's
// floor". Keys survive structure edits, so a finish stays on the same wall
// after a neighbouring wall is demolished, and floor patches join their room.
const DIRECTIONS = { 'z+': '위쪽', 'z-': '아래쪽', 'x+': '왼쪽', 'x-': '오른쪽' };

function distanceToRoom(room, x, z) {
  const polygon = room.polygon_m ?? (() => { const [a, b, c, d] = room.bounds_m; return [[a, b], [c, b], [c, d], [a, d]]; })();
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, z1] = polygon[i], [x2, z2] = polygon[(i + 1) % polygon.length], dx = x2 - x1, dz = z2 - z1, len2 = dx * dx + dz * dz;
    const t = len2 ? Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / len2)) : 0;
    best = Math.min(best, Math.hypot(x - (x1 + t * dx), z - (z1 + t * dz)));
  }
  return best;
}
function roomFor(rooms, x, z) {
  const inside = rooms.find(r => roomContains(r, x, z)); if (inside) return inside;
  let best = null, distance = 0.35;
  for (const r of rooms) { const d = distanceToRoom(r, x, z); if (d < distance) { distance = d; best = r; } }
  return best;
}
const visibleInModel = (mesh, root) => {
  for (let o = mesh; o && o !== root; o = o.parent) if (!o.visible && !o.userData.renderBatched) return false;
  return true;
};

export function collectFaces(root, rooms) {
  root.updateWorldMatrix(true, true);
  const inverse = new Matrix4().copy(root.matrixWorld).invert(), faces = new Map(), lookup = new WeakMap();
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), e1 = new Vector3(), e2 = new Vector3(), n = new Vector3();
  root.traverse(mesh => {
    const kind = mesh.userData.component;
    if (!mesh.isMesh || !['wall', 'floor'].includes(kind) || mesh.userData.renderBatch || mesh.userData.surfaceOverride || mesh.userData.finishTarget === false) return;
    if (!visibleInModel(mesh, root)) return;
    const geometry = mesh.geometry, position = geometry.attributes.position; if (!position) return;
    const matrix = new Matrix4().multiplyMatrices(inverse, mesh.matrixWorld), index = geometry.index, count = index ? index.count : position.count;
    const baked = bakedRenderData(mesh), material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const partition = mesh.userData.partitionId ? mesh.parent : null;
    for (let offset = 0; offset + 2 < count; offset += 3) {
      a.fromBufferAttribute(position, index ? index.getX(offset) : offset).applyMatrix4(matrix);
      b.fromBufferAttribute(position, index ? index.getX(offset + 1) : offset + 1).applyMatrix4(matrix);
      c.fromBufferAttribute(position, index ? index.getX(offset + 2) : offset + 2).applyMatrix4(matrix);
      n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
      const area = n.length() / 2; if (area < 1e-6) continue;
      n.normalize();
      let key, roomId = null, label, axis = null, offsetCm = 0, side = null;
      if (kind === 'floor') {
        if (n.y < 0.9) continue;
        roomId = mesh.userData.room_id ?? roomFor(rooms, (a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3)?.id; if (!roomId) continue;
        key = `f|${roomId}`;
      } else {
        if (Math.abs(n.y) > 0.05) continue;
        // A wall face belongs to the room it faces into. Faces buried inside a
        // layered wall (or its far side) never qualify, even if they are close.
        const cx = (a.x + b.x + c.x) / 3, cz = (a.z + b.z + c.z) / 3;
        const room = partition ? roomFor(rooms, cx + n.x * 0.08, cz + n.z * 0.08) : rooms.find(r => roomContains(r, cx + n.x * 0.1, cz + n.z * 0.1)) ?? null;
        if (partition) {
          // Partition sides follow its local normal (local +Z is side A).
          const theta = partition.rotation.y, local = new Vector3(Math.sin(theta), 0, Math.cos(theta));
          side = n.dot(local) >= 0 ? 'A' : 'B';
          if (Math.abs(n.dot(local)) < 0.5) side = 'E';
          key = `p|${mesh.userData.partitionId}|${side === 'E' ? 'A' : side}`; roomId = room?.id ?? null;
        } else {
          if (!room) continue;
          roomId = room.id;
          axis = Math.abs(n.x) > 0.999 ? `x${n.x > 0 ? '+' : '-'}` : Math.abs(n.z) > 0.999 ? `z${n.z > 0 ? '+' : '-'}` : `a${Math.round(Math.atan2(n.z, n.x) * 180 / Math.PI)}`;
          offsetCm = Math.round(n.dot(a) * 100);
          key = `w|${roomId}|${axis}|${offsetCm}`;
        }
      }
      let face = faces.get(key);
      if (!face) {
        const room = rooms.find(r => r.id === roomId);
        face = { key, kind, roomId, roomName: room?.name_ko ?? room?.name ?? '', axis, offsetCm, partitionId: mesh.userData.partitionId ?? null,
          side: side === 'E' ? 'A' : side, normal: n.clone(), area: 0, tris: [], materialNames: new Map(), label };
        faces.set(key, face);
      }
      face.area += area;
      face.tris.push({ mesh, offset, points: [a.clone(), b.clone(), c.clone()], baked: Boolean(baked) });
      face.materialNames.set(material?.name ?? '', (face.materialNames.get(material?.name ?? '') ?? 0) + area);
      if (!lookup.has(mesh)) lookup.set(mesh, new Map());
      lookup.get(mesh).set(offset / 3, key);
    }
  });
  // Human labels: direction within the room, numbered by size.
  const groups = new Map();
  for (const face of faces.values()) {
    face.original = [...face.materialNames].sort((p, q) => q[1] - p[1])[0]?.[0] ?? '';
    if (face.kind === 'floor') { face.label = '바닥'; continue; }
    if (face.partitionId) { face.label = `가벽 ${face.side}면`; continue; }
    const k = `${face.roomId}|${face.axis}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(face);
  }
  for (const list of groups.values()) {
    list.sort((p, q) => q.area - p.area);
    list.forEach((face, i) => {
      const dir = DIRECTIONS[face.axis] ?? '사선';
      face.label = face.area < 0.8 ? `${dir} 개구부 옆면` : `${dir} 벽${i ? ` ${i + 1}` : ''}`;
    });
  }
  return { faces, keyAt: (mesh, faceIndex) => lookup.get(mesh)?.get(faceIndex) ?? null };
}

// Overlay geometry in model space with meter UVs (+ explicit tangents so the
// rasterizer and the path tracer agree on normal-map orientation).
export function faceGeometry(face, { rotation = 0, offset = [0, 0] } = {}) {
  const tris = face.tris, n = face.normal, count = tris.length * 3;
  const position = new Float32Array(count * 3), normal = new Float32Array(count * 3), uv = new Float32Array(count * 2), tangent = new Float32Array(count * 4);
  const baked = tris.every(t => t.baked) ? tris.map(t => bakedRenderData(t.mesh)) : null, uv1 = baked ? new Float32Array(count * 2) : null;
  // Planar basis: walls use (right, up) seen from inside the room, floors (x, z).
  let U, V;
  if (face.kind === 'floor') { U = new Vector3(1, 0, 0); V = new Vector3(0, 0, 1); }
  else { U = new Vector3(n.z, 0, -n.x).normalize(); V = new Vector3(0, 1, 0); }
  const r = rotation * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
  const RU = U.clone().multiplyScalar(cos).addScaledVector(V, sin), RV = U.clone().multiplyScalar(-sin).addScaledVector(V, cos);
  let minU = Infinity, minV = Infinity;
  for (const t of tris) for (const p of t.points) { minU = Math.min(minU, p.dot(RU)); minV = Math.min(minV, face.kind === 'floor' ? p.dot(RV) : (rotation ? p.dot(RV) : 0)); }
  if (face.kind !== 'floor' && !rotation) minV = 0; // wall courses start at the floor
  const w = Math.sign(new Vector3().crossVectors(n, RU).dot(RV)) || 1;
  tris.forEach((t, i) => t.points.forEach((p, k) => {
    const v = i * 3 + k;
    position.set([p.x, p.y, p.z], v * 3); normal.set([n.x, n.y, n.z], v * 3);
    uv.set([p.dot(RU) - minU + offset[0], p.dot(RV) - minV + offset[1]], v * 2);
    tangent.set([RU.x, RU.y, RU.z, w], v * 4);
    if (uv1) { const source = baked[i].geometry.attributes.uv1; uv1.set([source.getX(t.offset + k), source.getY(t.offset + k)], v * 2); }
  }));
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('normal', new BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  geometry.setAttribute('tangent', new BufferAttribute(tangent, 4));
  if (uv1) geometry.setAttribute('uv1', new BufferAttribute(uv1, 2));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return { geometry, baked: Boolean(uv1), bakedSource: baked?.[0]?.material ?? null };
}

// Plan-space outline of a face (for the 2D highlight): wall faces become a
// line along their plane, floors their triangle hull bounds.
export function facePlanSegment(face) {
  if (face.kind === 'floor') return null;
  const U = new Vector3(face.normal.z, 0, -face.normal.x).normalize();
  let lo = Infinity, hi = -Infinity, base = null;
  for (const t of face.tris) for (const p of t.points) { const s = p.dot(U); if (s < lo) { lo = s; } if (s > hi) hi = s; base ??= p; }
  const d = face.normal.x * base.x + face.normal.z * base.z;
  const point = s => [U.x * s + face.normal.x * d, U.z * s + face.normal.z * d];
  return [point(lo), point(hi)];
}
