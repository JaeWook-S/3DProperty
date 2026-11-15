import { Box3, Group, Mesh, Vector3 } from 'three';
import { bakedRenderData, clearBakedRenderData, setBakedRenderData } from '../walkthrough/baked-lighting-geometry.js';
import { emptyStructure, interiorWallSegments, normalizeStructure, removalBox, roomContains, structureQuantities } from './wall-plan.js';
import { buildPartition, capQuad, clipGeometryOutsideBoxes, fitPlanarUV, horizontalTriangles, intersectIntervals, partitionMaterials, patchQuad, solidIntervals } from './wall-geometry.js';

// Baked indirect light belongs to the original geometry. A clipped mesh must
// never render with the stale, unclipped baked copy.
const stashed = new WeakMap();
export function guardBakedGeometry(root) {
  root.traverse(o => {
    if (!o.userData.interiorGeometry) return;
    const baked = bakedRenderData(o); if (baked) { stashed.set(o, baked); clearBakedRenderData(o); }
  });
}

const HIDE_COMPONENTS = new Set(['opening_frame', 'door_leaf', 'sliding_panel', 'glass', 'door_accessory', 'kitchen_fixture', 'storage_fixture', 'bathroom_fixture', 'decoration']);

// Applies a plan-level structure state to the live model. Every application
// starts from the original geometry, so undo/redo is just apply(previous).
export function createStructureEditor({ onApplied = () => {} } = {}) {
  const states = new WeakMap();
  function state(active) {
    if (!states.has(active)) {
      const info = active.definition.info;
      states.set(active, { segments: interiorWallSegments(info), structure: emptyStructure(), originals: new Map(), hidden: new Map(), disabledDoors: new Set(),
        group: null, triangles: null, materials: null, ceiling: info.ceilingHeight_m ?? info.ceiling_m ?? 2.6 });
    }
    return states.get(active);
  }
  function wallMeshes(model) {
    const meshes = [];
    model.traverse(o => { if (o.isMesh && o.userData.component === 'wall' && !o.userData.interiorAdded && !o.userData.renderBatch && !o.userData.surfaceOverride) meshes.push(o); });
    return meshes;
  }
  function findMesh(model, test) { let found = null; model.traverse(o => { if (!found && o.isMesh && !o.userData.renderBatch && test(o)) found = o; }); return found; }
  function plasterOf(model) {
    const walls = wallMeshes(model);
    return (walls.find(m => /plaster/i.test(m.material?.name ?? '')) ?? walls[0])?.material ?? null;
  }
  function restore(s, active) {
    for (const [mesh, original] of s.originals) {
      const clipped = mesh.geometry; mesh.geometry = original.geometry; clipped.dispose();
      delete mesh.userData.interiorGeometry;
      const baked = stashed.get(mesh) ?? original.baked; if (baked) setBakedRenderData(mesh, baked); stashed.delete(mesh);
    }
    s.originals.clear();
    for (const [object, previous] of s.hidden) { object.visible = previous.visible; if (previous.collision) delete object.userData.collisionDisabled; }
    s.hidden.clear();
    for (const door of s.disabledDoors) { door.disabled = false; door.pivot.visible = true; }
    s.disabledDoors.clear();
    if (s.group) {
      s.group.removeFromParent();
      s.group.traverse(o => { if (o.isMesh) { o.geometry.dispose(); delete active.definition.info.objects[o.userData.object_id]; } });
      s.group = null;
    }
  }
  function hide(s, object) {
    if (s.hidden.has(object)) return;
    s.hidden.set(object, { visible: object.visible, collision: !object.userData.collisionDisabled });
    object.visible = false; object.userData.collisionDisabled = true;
  }
  function register(active, mesh, category) {
    active.definition.info.objects[mesh.userData.object_id] = { name: mesh.userData.object_id, component: mesh.userData.component, category };
  }
  function mutate(active, s, structure) {
    const model = active.model, info = active.definition.info, byId = new Map(s.segments.map(x => [x.id, x]));
    restore(s, active);
    model.updateMatrixWorld(true);
    const removed = structure.removed.map(id => byId.get(id)).filter(Boolean), boxes = removed.map(seg => removalBox(seg));
    s.triangles ??= horizontalTriangles(wallMeshes(model));
    s.materials ??= partitionMaterials(plasterOf(model));
    const group = new Group(); group.name = 'Interior structure'; group.userData = { interiorAdded: true };
    // 1. Clip original wall solids.
    for (const mesh of wallMeshes(model)) {
      const clipped = clipGeometryOutsideBoxes(mesh.geometry, mesh.matrixWorld, boxes);
      if (!clipped) continue;
      s.originals.set(mesh, { geometry: mesh.geometry, baked: bakedRenderData(mesh) });
      const baked = bakedRenderData(mesh); if (baked) { stashed.set(mesh, baked); clearBakedRenderData(mesh); }
      mesh.geometry = clipped; mesh.userData.interiorGeometry = true;
    }
    // 2. Doors, frames and built-ins standing in removed openings.
    const bounds = new Box3(), center = new Vector3();
    model.traverse(o => {
      if (!o.isMesh || o.userData.renderBatch || o.userData.interiorAdded || o.userData.surfaceOverride || !HIDE_COMPONENTS.has(o.userData.component)) return;
      bounds.setFromObject(o); bounds.getCenter(center);
      if (boxes.some(b => center.x > b.minX - 0.03 && center.x < b.maxX + 0.03 && center.z > b.minZ - 0.06 && center.z < b.maxZ + 0.06)) hide(s, o);
    });
    const openingIds = new Set(removed.flatMap(seg => seg.openings.map(o => o.id)));
    for (const door of active.doors) if (openingIds.has(door.definition.sourceOpening)) {
      door.disabled = true; door.setProgress(0); door.target = 0; door.pivot.visible = false; s.disabledDoors.add(door);
      door.pivot.traverse(o => { if (o.isMesh) hide(s, o); });
    }
    // 3. End caps, floor and ceiling patches for each removed run.
    const plaster = s.materials.wall;
    removed.forEach((seg, i) => {
      for (const end of [0, 1]) {
        const along = end === 0 ? seg.s0 : seg.s1, inward = end === 0 ? 0.012 : -0.012, across = seg.center + 0.00071;
        const at = d => seg.axis === 'x' ? [along + d + 0.00037, across] : [across, along + d + 0.00037];
        const outsidePoint = at(-inward * 1.5);
        if (boxes.some(b => outsidePoint[0] > b.minX && outsidePoint[0] < b.maxX && outsidePoint[1] > b.minZ && outsidePoint[1] < b.maxZ)) continue;
        const intervals = intersectIntervals(solidIntervals(s.triangles, ...at(inward)), solidIntervals(s.triangles, ...outsidePoint));
        intervals.forEach((interval, k) => {
          const mesh = new Mesh(capQuad(seg, end, interval), plaster);
          mesh.name = `Interior cap/${seg.id}/${end}-${k}`; mesh.castShadow = mesh.receiveShadow = true;
          mesh.userData = { component: 'wall', collision: true, interiorAdded: true, object_id: mesh.name };
          group.add(mesh); register(active, mesh, 'Structure');
        });
      }
      const [f0, f1] = seg.faces, mid = seg.center;
      seg.rooms.forEach((roomId, side) => {
        const lo = side === 0 ? f0 : mid, hi = side === 0 ? mid : f1;
        const rect = seg.axis === 'x' ? { minX: seg.s0, maxX: seg.s1, minZ: lo, maxZ: hi } : { minX: lo, maxX: hi, minZ: seg.s0, maxZ: seg.s1 };
        const floor = findMesh(model, o => o.userData.component === 'floor' && o.userData.room_id === roomId && !o.userData.interiorAdded);
        if (floor) {
          const top = new Box3().setFromObject(floor).max.y;
          const mesh = new Mesh(patchQuad(rect, top, false, fitPlanarUV(floor)), floor.material);
          mesh.name = `Interior floor patch/${seg.id}/${side}`; mesh.receiveShadow = true; mesh.castShadow = false;
          mesh.userData = { component: 'floor', room_id: roomId, interiorAdded: true, object_id: mesh.name };
          group.add(mesh); register(active, mesh, 'Floors');
        }
        const room = info.rooms.find(r => r.id === roomId), probe = seg.axis === 'x' ? [(seg.s0 + seg.s1) / 2, side === 0 ? f0 - 0.2 : f1 + 0.2] : [side === 0 ? f0 - 0.2 : f1 + 0.2, (seg.s0 + seg.s1) / 2];
        const ceiling = findMesh(model, o => {
          if (o.userData.component !== 'ceiling') return false;
          const b = new Box3().setFromObject(o); return probe[0] >= b.min.x && probe[0] <= b.max.x && probe[1] >= b.min.z && probe[1] <= b.max.z;
        }) ?? findMesh(model, o => o.userData.component === 'ceiling');
        if (ceiling && room) {
          const bottom = new Box3().setFromObject(ceiling).min.y;
          const mesh = new Mesh(patchQuad(rect, bottom, true, fitPlanarUV(ceiling)), ceiling.material);
          mesh.name = `Interior ceiling patch/${seg.id}/${side}`; mesh.receiveShadow = true; mesh.castShadow = true;
          mesh.userData = { component: 'ceiling', interiorAdded: true, object_id: mesh.name, collision: false };
          group.add(mesh); register(active, mesh, 'Ceilings');
        }
      });
      void i;
    });
    // 4. New partitions.
    for (const p of structure.partitions) {
      const object = buildPartition(p, s.materials, s.ceiling);
      object.traverse(o => { if (o.isMesh) register(active, o, 'Structure'); });
      group.add(object);
    }
    if (group.children.length) { model.add(group); s.group = group; }
    model.updateMatrixWorld(true);
  }
  return {
    segments: active => state(active).segments,
    structure: active => structuredClone(state(active).structure),
    edited: active => { const s = state(active).structure; return s.removed.length + s.partitions.length > 0; },
    quantities: active => { const s = state(active); return structureQuantities(s.structure, s.segments, s.ceiling); },
    normalize: (active, data) => normalizeStructure(data, state(active).segments),
    apply(active, next) {
      const s = state(active), structure = normalizeStructure(next, s.segments), started = performance.now();
      active.rebuildStructure(() => mutate(active, s, structure));
      s.structure = structure;
      const result = { ms: performance.now() - started, clippedMeshes: s.originals.size, hidden: s.hidden.size, disabledDoors: s.disabledDoors.size, added: s.group?.children.length ?? 0 };
      onApplied(active, structure, result);
      return result;
    },
    // Unclipped geometry for plan drawing (closed wall contours).
    originalGeometry: (active, mesh) => state(active).originals.get(mesh)?.geometry ?? null,
    hiddenOpenings(active) { const s = state(active), removed = new Set(s.structure.removed); return new Set(s.segments.filter(seg => removed.has(seg.id)).flatMap(seg => seg.openings.map(o => o.id))); },
    inspect(active) { const s = state(active); return { segments: s.segments.length, removed: s.structure.removed, partitions: s.structure.partitions.length, clippedMeshes: s.originals.size, hidden: s.hidden.size, disabledDoors: [...s.disabledDoors].map(d => d.definition.id) }; },
    roomAt(active, x, z) { return active.definition.info.rooms.find(r => roomContains(r, x, z)) ?? null; },
  };
}
