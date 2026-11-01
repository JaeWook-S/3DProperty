import { Matrix4, Mesh, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Only the source's inferred structural layer prisms qualify. Material names alone
// also describe windowsills, furniture and correction strips, so are not evidence.
function wallLayer(object) {
  const data = object.userData;
  if (data.component !== 'wall' || data.inferred_wall !== true || data.collision !== true ||
      !Number.isFinite(data.layer_bottom_m)) return null;
  const match = /^Wall\/layer-(\d+)\/[^/]+(?:\/primitive-\d+)?$/.exec(data.object_id || '');
  if (!match) return null;
  const matrix = object.matrixWorld;
  // Tilted or mirrored structures require a different boundary proof. Keep them.
  if (matrix.elements[1] !== 0 || matrix.elements[9] !== 0 ||
      matrix.elements[5] <= 0 || matrix.determinant() <= 0) return null;
  return { id: data.object_id.replace(/\/primitive-\d+$/, ''),
    layer: Number(match[1]), bottom: data.layer_bottom_m };
}

function wallSources(objects) {
  const sources = new Map(), owners = new Map(), point = new Vector3();
  for (const object of objects) {
    const identity = wallLayer(object);
    if (!identity) continue;
    let source = sources.get(identity.id);
    if (!source) {
      source = {...identity, minY: Infinity, maxY: -Infinity};
      sources.set(identity.id, source);
    }
    // Multi-material GLB primitives share one source node; bounds cover them all.
    const positions = object.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
      source.minY = Math.min(source.minY, point.y);
      source.maxY = Math.max(source.maxY, point.y);
    }
    owners.set(object, source);
  }
  return owners;
}

function internalCaps(objects, owners) {
  const triangles = new Map(), removed = new Map();
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  for (const object of objects) {
    const owner = owners.get(object);
    if (!owner || !(owner.minY < owner.maxY)) continue;
    const geometry = object.geometry, positions = geometry.attributes.position;
    const index = geometry.index, count = index?.count ?? positions.count;
    for (let offset = 0; offset + 2 < count; offset += 3) {
      a.fromBufferAttribute(positions, index ? index.getX(offset) : offset).applyMatrix4(object.matrixWorld);
      b.fromBufferAttribute(positions, index ? index.getX(offset + 1) : offset + 1).applyMatrix4(object.matrixWorld);
      c.fromBufferAttribute(positions, index ? index.getX(offset + 2) : offset + 2).applyMatrix4(object.matrixWorld);
      if (a.y !== b.y || a.y !== c.y) continue;
      const normalY = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
      if (!Number.isFinite(normalY) || normalY === 0) continue;
      const top = normalY > 0;
      if (a.y !== (top ? owner.maxY : owner.minY)) continue;
      // Exact world vertices: do not round nearby planes or bridge real gaps.
      const key = [a, b, c].map(p => `${p.x},${p.y},${p.z}`).sort().join('|');
      if (!triangles.has(key)) triangles.set(key, []);
      triangles.get(key).push({object, owner, offset, top});
    }
  }
  for (const matches of triangles.values()) {
    // Ambiguous overlaps (3+), same-facing duplicates and nonadjacent layers stay.
    if (matches.length !== 2 || matches[0].top === matches[1].top) continue;
    const lower = matches.find(face => face.top), upper = matches.find(face => !face.top);
    if (lower.owner.layer + 1 !== upper.owner.layer || lower.owner.bottom >= upper.owner.bottom ||
        lower.owner.maxY !== upper.owner.minY || lower.owner.id === upper.owner.id) continue;
    for (const face of matches) {
      if (!removed.has(face.object)) removed.set(face.object, new Set());
      removed.get(face.object).add(face.offset);
    }
  }
  return removed;
}

function renderGeometry(object, inverse, removed) {
  let geometry = object.geometry.clone().applyMatrix4(new Matrix4().multiplyMatrices(inverse, object.matrixWorld));
  if (!removed?.size) return geometry;
  const index = geometry.index, count = index?.count ?? geometry.attributes.position.count, keep = [];
  for (let offset = 0; offset < count; offset += 3) {
    if (removed.has(offset)) continue;
    for (let i = 0; i < 3; i++) keep.push(index ? index.getX(offset + i) : offset + i);
  }
  geometry.setIndex(keep);
  if (!index) {
    const nonIndexed = geometry.toNonIndexed();
    geometry.dispose(); geometry = nonIndexed;
  }
  return geometry;
}

// Render-only batches. Logical meshes keep their meter-valued geometry and identity
// for picking, collision, wall sections and measurements. Doors/furniture stay separate.
export function batchStaticMeshes(root) {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert(), groups = new Map(), sourceObjects = [];
  root.traverse(object => {
    if (!object.isMesh || object.isSkinnedMesh || object.isInstancedMesh || !object.visible ||
        object.children.length || object.userData.renderBatch || object.morphTargetInfluences?.length ||
        Array.isArray(object.material) || object.material.transparent || object.material.transmission > 0) return;
    for (let p = object; p; p = p.parent) {
      if (!p.visible || p.userData.doorId || p.userData.stagingId) return;
      if (p === root) break;
    }
    const geometry = object.geometry;
    if (geometry.drawRange.start !== 0 || geometry.drawRange.count !== Infinity) return;
    const attributes = Object.entries(geometry.attributes).sort().map(([name,a]) =>
      [name,a.itemSize,a.normalized,a.array?.constructor.name||a.data?.array.constructor.name].join(':')).join('|');
    const key = [object.material.uuid,object.castShadow,object.receiveShadow,object.renderOrder,Boolean(geometry.index),attributes].join('/');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(object); sourceObjects.push(object);
  });
  const owners = wallSources(sourceObjects);
  let sourceMeshes = 0, drawMeshes = 0, removedInternalCapTriangles = 0;
  const batches = [];
  for (const objects of groups.values()) {
    if (objects.length < 2) continue;
    // Pair only within a compatible batch: both faces are removed atomically,
    // and a failed merge leaves both original prisms visible and intact.
    const removed = internalCaps(objects, owners);
    const geometries = objects.map(object => renderGeometry(object, inverse, removed.get(object)));
    const geometry = mergeGeometries(geometries);
    geometries.forEach(g => g.dispose());
    if (!geometry) continue;
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const first = objects[0], batch = new Mesh(geometry, first.material);
    batch.name = 'Static render batch / ' + first.material.name;
    batch.castShadow = first.castShadow; batch.receiveShadow = first.receiveShadow;
    batch.renderOrder = first.renderOrder;
    batch.userData.renderBatch = true; batch.userData.collisionDisabled = true;
    batch.matrixAutoUpdate = false;
    root.add(batch); batch.matrixWorldNeedsUpdate=true; batch.updateWorldMatrix(false,false); batches.push(batch);
    for (const object of objects) {
      object.visible = false; object.userData.renderBatched = true;
      object.matrixAutoUpdate = false;
    }
    sourceMeshes += objects.length; drawMeshes++;
    for (const offsets of removed.values()) removedInternalCapTriangles += offsets.size;
  }
  return { sourceMeshes, drawMeshes, savedDraws: sourceMeshes - drawMeshes, batches, removedInternalCapTriangles };
}
