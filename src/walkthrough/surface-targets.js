import { Box3, BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three';
import { bakedRenderData } from './baked-lighting-geometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Logical source meshes remain closed and unchanged. A target is an oriented,
// connected plane, not a material, a draw batch, or an individual triangle.
const EPS = 1e-5;
const quant = n => Math.round(n / EPS);
const hash = text => {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
};
const materialAt = (mesh, offset) => Array.isArray(mesh.material)
  ? mesh.material[mesh.geometry.groups.find(g => offset >= g.start && offset < g.start + g.count)?.materialIndex ?? 0]
  : mesh.material;

function connected(triangles, normal) {
  const parent = triangles.map((_, i) => i);
  const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const join = (a, b) => { parent[find(a)] = find(b); };
  const tangent = new Vector3(normal.z, 0, -normal.x).normalize(), lines = new Map();
  triangles.forEach((triangle, i) => {
    const points = triangle.points.map(p => [p.dot(tangent), p.y]);
    for (let e = 0; e < 3; e++) {
      const a = points[e], b = points[(e + 1) % 3];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy); if (len < EPS) continue;
      dx /= len; dy /= len;
      if (dx < -EPS || (Math.abs(dx) < EPS && dy < 0)) { dx *= -1; dy *= -1; }
      const key = [dx, dy, -dy * a[0] + dx * a[1]].map(quant).join(',');
      const aa = dx * a[0] + dy * a[1], bb = dx * b[0] + dy * b[1];
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key).push({ i, lo: Math.min(aa, bb), hi: Math.max(aa, bb) });
    }
  });
  // Partial shared edges (layer T junctions) count; touching at one corner does
  // not join two independent wall faces. Horizontal caps never enter this set.
  for (const edges of lines.values()) {
    edges.sort((a, b) => a.lo - b.lo);
    for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length && edges[j].lo < edges[i].hi - EPS; j++) {
      if (Math.min(edges[i].hi, edges[j].hi) - Math.max(edges[i].lo, edges[j].lo) > EPS) join(edges[i].i, edges[j].i);
    }
  }
  const groups = new Map();
  triangles.forEach((t, i) => { const root = find(i); if (!groups.has(root)) groups.set(root, []); groups.get(root).push(t); });
  return [...groups.values()];
}

export function createSurfaceTargets(root, rooms = []) {
  root.updateWorldMatrix(true, true);
  const inverse = new Matrix4().copy(root.matrixWorld).invert(), buckets = new Map(), lookup = new WeakMap();
  root.traverse(mesh => {
    const kind = mesh.userData.component, sourceId = mesh.userData.object_id;
    if (!mesh.isMesh || mesh.userData.renderBatch || mesh.userData.surfaceOverride || !['wall', 'floor'].includes(kind) || typeof sourceId !== 'string') return;
    if (mesh.isSkinnedMesh || mesh.isInstancedMesh || mesh.morphTargetInfluences?.length) return;
    const geometry = mesh.geometry, position = geometry.attributes.position;
    if (!position || !geometry.attributes.uv) return;
    const matrix = new Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
    const count = geometry.index?.count ?? position.count;
    for (let offset = 0; offset + 2 < count; offset += 3) {
      const vertices = [0, 1, 2].map(k => geometry.index ? geometry.index.getX(offset + k) : offset + k);
      const points = vertices.map(i => new Vector3().fromBufferAttribute(position, i).applyMatrix4(matrix));
      const cross = new Vector3().subVectors(points[1], points[0]).cross(new Vector3().subVectors(points[2], points[0]));
      if (cross.lengthSq() < 1e-16) continue;
      const normal = cross.normalize();
      if (kind === 'wall' ? Math.abs(normal.y) > 1e-4 : normal.y < .9999) continue;
      const material = materialAt(mesh, offset); if (!material?.isMeshStandardMaterial) continue;
      const plane = [...normal.toArray(), normal.dot(points[0])].map(quant).join(',');
      const key = kind === 'floor' ? `floor:${sourceId.replace(/\/primitive-\d+$/, '')}:${plane}` : `wall:${plane}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ mesh, sourceId, offset, vertices, points, normal, matrix, material, kind });
    }
  });
  const targets = new Map();
  for (const [plane, triangles] of buckets) {
    const groups = triangles[0].kind === 'wall' ? connected(triangles, triangles[0].normal) : [triangles];
    for (const faces of groups) {
      const bounds = new Box3(); faces.forEach(t => t.points.forEach(p => bounds.expandByPoint(p)));
      const sourceIds = [...new Set(faces.map(t => t.sourceId))].sort();
      const identity = JSON.stringify([plane, sourceIds, bounds.min.toArray().map(quant), bounds.max.toArray().map(quant)]);
      const id = `surface-v1-${faces[0].kind}-${hash(identity)}`;
      if (targets.has(id)) throw Error('Duplicate structural surface identity');
      const roomId = faces[0].mesh.userData.room_id;
      const room = rooms.find(r => r.id === roomId);
      const target = { id, kind: faces[0].kind, label: faces[0].kind === 'wall' ? '벽 한쪽 면' : `${room?.name_ko || room?.name || '선택한 공간'} 바닥`,
        sourceIds, normal: faces[0].normal.clone(), bounds, faces, roomId };
      targets.set(id, target);
      for (const face of faces) {
        if (!lookup.has(face.mesh)) lookup.set(face.mesh, new Map());
        lookup.get(face.mesh).set(face.offset / 3, target);
      }
    }
  }
  return { targets, fromHit: hit => lookup.get(hit?.object)?.get(hit?.faceIndex) ?? null };
}

// Small render copies own their buffers. No changes to source vertices, UVs,
// materials, batch visibility, collision octrees, or the internal-cap filter.
export function surfaceRenderParts(target) {
  const byMesh = new Map();
  for (const face of target.faces) {
    let parts = byMesh.get(face.mesh); if (!parts) byMesh.set(face.mesh, parts = new Map());
    if (!parts.has(face.material)) parts.set(face.material, []);
    parts.get(face.material).push(face);
  }
  const merge = new Map();
  for (const [mesh, materials] of byMesh) for (const [sourceMaterial, faces] of materials) {
    const baked = bakedRenderData(mesh), sourceGeometry = baked?.geometry ?? mesh.geometry;
    const material = baked?.material ?? sourceMaterial;
    const vertices = face => baked ? [face.offset, face.offset + 1, face.offset + 2] : face.vertices;
    const used = [...new Set(faces.flatMap(vertices))], indices = new Map(used.map((v, i) => [v, i]));
    const geometry = new BufferGeometry();
    for (const [name, attr] of Object.entries(sourceGeometry.attributes)) {
      const array = new Float32Array(used.length * attr.itemSize);
      used.forEach((source, i) => { for (let k = 0; k < attr.itemSize; k++) array[i * attr.itemSize + k] = attr.getComponent(source, k); });
      geometry.setAttribute(name, new BufferAttribute(array, attr.itemSize));
    }
    geometry.setIndex(faces.flatMap(f => vertices(f).map(v => indices.get(v))));
    geometry.applyMatrix4(faces[0].matrix);
    const key = `${material.uuid}:${Object.keys(geometry.attributes).sort().join(',')}`;
    if (!merge.has(key)) merge.set(key, { material, geometries: [] });
    merge.get(key).geometries.push(geometry);
  }
  return [...merge.values()].map(({ material, geometries }) => {
    if (geometries.length === 1) return { material, geometry: geometries[0] };
    const geometry = mergeGeometries(geometries, false);
    geometries.forEach(g => g.dispose());
    if (!geometry) throw Error('Cannot isolate this structural surface');
    return { material, geometry };
  });
}
