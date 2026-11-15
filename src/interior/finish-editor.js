import { FrontSide, Group, Mesh, MeshBasicMaterial, Raycaster, Vector2 } from 'three';
import { collectFaces, faceGeometry } from './surface-faces.js';
import { finishById, originalFinishKind } from './finish-catalog.js';

// Finish assignments per semantic face, rendered as thin overlays above the
// original surfaces. Hover previews never touch the committed state.
export function createFinishEditor({ library, invalidate = () => {}, onChange = () => {} }) {
  let active = null, registry = null, layer = null, previewLayer = null, highlightLayer = null;
  let assignments = new Map(), preview = null, highlightKeys = [], disposed = false;
  const overlays = new Map(), quickMaterials = new Set();
  const changed = () => { invalidate(); onChange(); };
  function ensureLayers() {
    if (!active) return;
    for (const [name, get, set] of [['Interior finishes', () => layer, v => { layer = v; }], ['Interior finish preview', () => previewLayer, v => { previewLayer = v; }], ['Interior selection', () => highlightLayer, v => { highlightLayer = v; }]]) {
      let group = get();
      if (!group || group.parent !== active.model) {
        group?.removeFromParent();
        group = new Group(); group.name = name; group.userData = { surfaceOverride: true, collisionDisabled: true, noBatch: true, interiorOverlay: true };
        active.model.add(group); set(group);
      }
    }
  }
  function quick(id) { const m = library.quick(id); quickMaterials.add(m); return m; }
  function disposeMesh(mesh) { if (!mesh) return; mesh.removeFromParent(); mesh.geometry.dispose(); if (quickMaterials.has(mesh.material)) { mesh.material.dispose(); quickMaterials.delete(mesh.material); } }
  function overlayMesh(face, assignment, layerGroup) {
    const { geometry, baked, bakedSource } = faceGeometry(face, { rotation: assignment.rotation ?? 0 });
    const material = library.material(assignment.finishId, baked ? bakedSource : null) ?? quick(assignment.finishId);
    if (!baked && geometry.attributes.uv1) geometry.deleteAttribute('uv1');
    const mesh = new Mesh(geometry, material);
    mesh.name = `Interior finish / ${face.key}`; mesh.receiveShadow = true; mesh.castShadow = false; mesh.renderOrder = 2;
    mesh.userData = { surfaceOverride: true, collisionDisabled: true, interiorOverlay: true, faceKey: face.key };
    layerGroup.add(mesh);
    if (!library.isReady(assignment.finishId)) library.load(assignment.finishId).then(() => {
      if (disposed) return;
      if (layerGroup === layer && overlays.get(face.key) === mesh) renderKey(face.key);
      if (layerGroup === previewLayer && preview?.meshes.includes(mesh)) setPreview(preview.keys, preview.finishId, preview.rotation, true);
    }).catch(() => {});
    return mesh;
  }
  function renderKey(key) {
    disposeMesh(overlays.get(key)); overlays.delete(key);
    const assignment = assignments.get(key), face = registry?.faces.get(key);
    if (!assignment || !face || !layer) return;
    const mesh = overlayMesh(face, assignment, layer);
    mesh.visible = !preview?.keys.includes(key);
    overlays.set(key, mesh); invalidate();
  }
  function renderAll() { for (const key of [...overlays.keys()]) { disposeMesh(overlays.get(key)); overlays.delete(key); } for (const key of assignments.keys()) renderKey(key); }
  function clearPreview(silent = false) {
    if (!preview) return;
    for (const mesh of preview.meshes) disposeMesh(mesh);
    for (const key of preview.keys) { const o = overlays.get(key); if (o) o.visible = true; }
    preview = null; if (!silent) changed();
  }
  function setPreview(keys, finishId, rotation = null, refresh = false) {
    if (!registry || !finishById(finishId)) return;
    if (!refresh && preview && preview.finishId === finishId && preview.rotation === rotation && preview.keys.join() === keys.join()) return;
    clearPreview(true);
    const meshes = [];
    for (const key of keys) {
      const face = registry.faces.get(key); if (!face) continue;
      meshes.push(overlayMesh(face, { finishId, rotation: rotation ?? assignments.get(key)?.rotation ?? 0 }, previewLayer));
      const o = overlays.get(key); if (o) o.visible = false;
    }
    preview = { keys: [...keys], finishId, rotation, meshes };
    changed();
  }
  function setHighlight(keys) {
    highlightKeys = [...keys];
    if (!highlightLayer) return;
    for (const child of [...highlightLayer.children]) { child.removeFromParent(); child.geometry.dispose(); child.material.dispose(); }
    for (const key of highlightKeys) {
      const face = registry?.faces.get(key); if (!face) continue;
      const { geometry } = faceGeometry(face);
      const material = new MeshBasicMaterial({ color: 0x2f9e7f, transparent: true, opacity: 0.2, depthWrite: false, side: FrontSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
      const mesh = new Mesh(geometry, material); mesh.renderOrder = 9; mesh.userData = { surfaceOverride: true, surfaceHighlight: true, collisionDisabled: true };
      highlightLayer.add(mesh);
    }
    invalidate();
  }
  const api = {
    bind(target) {
      if (active === target) return;
      clearPreview(true);
      for (const key of [...overlays.keys()]) { disposeMesh(overlays.get(key)); overlays.delete(key); }
      for (const g of [layer, previewLayer, highlightLayer]) g?.removeFromParent();
      layer = previewLayer = highlightLayer = null; active = target; registry = null; highlightKeys = [];
      if (active) { ensureLayers(); api.refresh(); }
    },
    // Structure or lighting changed: recompute faces, keep assignments by key.
    refresh() {
      if (!active) return;
      ensureLayers();
      registry = collectFaces(active.model, active.definition.info.rooms);
      const keys = preview?.keys, finishId = preview?.finishId, rotation = preview?.rotation;
      clearPreview(true); renderAll(); setHighlight(highlightKeys.filter(k => registry.faces.has(k)));
      if (keys) setPreview(keys.filter(k => registry.faces.has(k)), finishId, rotation);
      changed();
    },
    get faces() { return registry?.faces ?? new Map(); },
    face: key => registry?.faces.get(key) ?? null,
    roomFaces(roomId, kind = null) { return [...(registry?.faces.values() ?? [])].filter(f => f.roomId === roomId && (!kind || f.kind === kind)); },
    assignment: key => assignments.get(key) ?? null,
    apply(keys, finishId, { rotation = null } = {}) {
      const finish = finishById(finishId); if (!finish) return 0;
      let count = 0;
      for (const key of keys) {
        const face = registry?.faces.get(key); if (!face || !finish.surfaces.includes(face.kind)) continue;
        assignments.set(key, { finishId, rotation: rotation ?? assignments.get(key)?.rotation ?? 0 }); count++;
      }
      clearPreview(true); for (const key of keys) renderKey(key); changed(); return count;
    },
    rotate(keys, step = 90) {
      for (const key of keys) { const a = assignments.get(key); if (a) { a.rotation = ((a.rotation ?? 0) + step) % 180; renderKey(key); } }
      changed();
    },
    clear(keys) { for (const key of keys) { assignments.delete(key); renderKey(key); } clearPreview(true); changed(); },
    clearAll() { assignments.clear(); clearPreview(true); renderAll(); changed(); },
    setPreview, clearPreview: () => clearPreview(false), setHighlight,
    get previewing() { return preview ? { keys: preview.keys, finishId: preview.finishId } : null; },
    pick(camera, ndc, clippingPlanes = []) {
      if (!active || !registry) return null;
      const meshes = [];
      active.model.updateWorldMatrix(true, true);
      active.model.traverse(mesh => {
        if (!mesh.isMesh || mesh.userData.renderBatch || mesh.userData.surfaceOverride) return;
        for (let o = mesh; o; o = o.parent) { if (o.userData.surfaceOverride || o.userData.interiorOverlay) return; if (!o.visible && !o.userData.renderBatched) return; if (o === active.model) break; }
        meshes.push(mesh);
      });
      const ray = new Raycaster(); ray.setFromCamera(ndc instanceof Vector2 ? ndc : new Vector2(ndc.x, ndc.y), camera);
      const hits = ray.intersectObjects(meshes, false).filter(h => !clippingPlanes.some(p => p.distanceToPoint(h.point) < 0));
      const hit = hits[0]; if (!hit) return null;
      const key = registry.keyAt(hit.object, hit.faceIndex);
      if (!key) return { blocked: hit.object.userData.component ?? 'object', point: hit.point, object: hit.object };
      return { key, face: registry.faces.get(key), point: hit.point, object: hit.object };
    },
    quantities() {
      return [...assignments].flatMap(([key, a]) => {
        const face = registry?.faces.get(key); if (!face) return [];
        return [{ key, surface: face.kind, roomId: face.roomId, roomName: face.roomName, label: face.label, area: face.area, finishId: a.finishId, original: originalFinishKind(face.original, face.kind) }];
      });
    },
    snapshot() { return { version: 1, items: [...assignments].map(([key, a]) => ({ key, finish: a.finishId, rotation: a.rotation ?? 0 })) }; },
    restore(data) {
      if (data && (data.version !== 1 || !Array.isArray(data.items))) throw Error('저장된 마감 형식이 올바르지 않아요.');
      const next = new Map();
      for (const item of data?.items ?? []) if (typeof item?.key === 'string' && finishById(item.finish)) next.set(item.key, { finishId: item.finish, rotation: Number(item.rotation) || 0 });
      assignments = next; clearPreview(true); renderAll(); changed();
    },
    inspect: () => ({ faces: registry?.faces.size ?? 0, assignments: assignments.size, overlays: overlays.size, preview: preview ? { keys: preview.keys.length, finishId: preview.finishId } : null, library: library.inspect() }),
    dispose() { disposed = true; api.bind(null); for (const m of quickMaterials) m.dispose(); },
  };
  return api;
}
