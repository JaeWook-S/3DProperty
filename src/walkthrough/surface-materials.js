import { FrontSide, Group, Mesh, MeshBasicMaterial, Raycaster, Vector2 } from 'three';
import { createSurfaceTargets, surfaceRenderParts } from './surface-targets.js';
import { SurfaceMaterialLibrary, surfaceMaterial } from './surface-material-library.js';

const empty = () => ({ version: 1, surfaces: [] });
export function createSurfaceMaterials({ library = new SurfaceMaterialLibrary(), invalidate = () => {}, onChange = () => {} } = {}) {
  const registries = new WeakMap(), drafts = new Map();
  let active = null, scope = null, epoch = 0, selected = null, pending = false, editing = false, loading = false, error = '';
  let overlays = new Map(), highlight = null;
  const registry = () => {
    if (!active) return null;
    if (!registries.has(active.model)) registries.set(active.model, createSurfaceTargets(active.model, active.definition.info.rooms));
    return registries.get(active.model);
  };
  const changed = () => { invalidate(); onChange(); };
  function disposeLayer(layer) { if (!layer) return; layer.group.removeFromParent(); for (const dispose of layer.disposers) dispose(); }
  function clearHighlight() { disposeLayer(highlight); highlight = null; }
  function showHighlight() {
    clearHighlight(); if (!editing || !selected || !active) return;
    const group = new Group(), disposers = [];
    group.name = 'Selected structural surface'; group.userData = { surfaceOverride: true, collisionDisabled: true };
    for (const part of surfaceRenderParts(selected)) {
      const material = new MeshBasicMaterial({ color: 0x65b8a1, side: FrontSide, transparent: true, opacity: .18, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      const mesh = new Mesh(part.geometry, material); mesh.userData = { surfaceOverride: true, surfaceHighlight: true, collisionDisabled: true };
      mesh.renderOrder = 8; group.add(mesh); disposers.push(() => { part.geometry.dispose(); material.dispose(); });
    }
    active.model.add(group); highlight = { group, disposers };
  }
  function layer(target, asset) {
    const group = new Group(), disposers = [];
    group.name = `Surface finish / ${target.id}`; group.userData = { surfaceOverride: true, surfaceId: target.id, collisionDisabled: true };
    try {
      for (const part of surfaceRenderParts(target)) {
        const owned = library.material(asset, part.material, part.geometry);
        const mesh = new Mesh(part.geometry, owned.material);
        mesh.userData = { surfaceOverride: true, surfaceId: target.id, collisionDisabled: true };
        mesh.castShadow = false; mesh.receiveShadow = true; group.add(mesh);
        disposers.push(() => { owned.dispose(); part.geometry.dispose(); });
      }
      return { group, disposers };
    } catch (cause) { for (const dispose of disposers) dispose(); throw cause; }
  }
  const token = () => ({ epoch, active, scope });
  const current = t => t.epoch === epoch && t.active === active && t.scope === scope;
  function cancel() { epoch++; pending = false; error = ''; }
  function clearLayers() { clearHighlight(); for (const item of overlays.values()) disposeLayer(item); overlays = new Map(); }
  function validate(data) {
    if (!data) return empty();
    if (data.version !== 1 || !Array.isArray(data.surfaces) || data.surfaces.length > 500) throw Error('저장된 마감 형식이 올바르지 않습니다.');
    const ids = new Set();
    for (const item of data.surfaces) {
      if (!item || typeof item.id !== 'string' || ids.has(item.id) || !registry().targets.has(item.id) || !surfaceMaterial(item.material) || item.material === 'original') throw Error('현재 평면과 맞지 않는 마감이 있어 복원하지 않았어요.');
      ids.add(item.id);
    }
    return { version: 1, surfaces: data.surfaces.map(i => ({ id: i.id, material: i.material })) };
  }
  async function prepareRestore(data) {
    if (!active || loading) throw Error('공간을 불러온 뒤 다시 시도해 주세요.');
    cancel(); const t = token(), saved = validate(data); pending = true; changed();
    try {
      const assets = new Map(await Promise.all([...new Set(saved.surfaces.map(s => s.material))].map(async id => [id, await library.load(id)])));
      if (!current(t)) return null;
      const next = new Map();
      try { for (const entry of saved.surfaces) next.set(entry.id, layer(registry().targets.get(entry.id), assets.get(entry.material))); }
      catch (cause) { for (const item of next.values()) disposeLayer(item); throw cause; }
      // No changes yet. Caller commits only after its furniture/house token check.
      let used = false;
      return {
        commit() {
          if (used) return false; used = true;
          if (!current(t)) { for (const item of next.values()) disposeLayer(item); return false; }
          clearLayers(); overlays = next; for (const item of overlays.values()) active.model.add(item.group);
          drafts.set(scope, saved); pending = false; error = ''; showHighlight(); changed(); return true;
        },
        discard() { if (!used) { used = true; for (const item of next.values()) disposeLayer(item); if (current(t)) { pending = false; changed(); } } },
      };
    } catch (cause) { if (current(t)) { pending = false; error = '재질을 불러오지 못해 이전 마감을 유지했어요. 다시 선택해 주세요.'; changed(); } throw cause; }
  }
  const api = {
    get editing() { return editing; }, get pending() { return pending; }, get loading() { return loading; },
    beginLoad() { cancel(); loading = true; editing = false; selected = null; clearHighlight(); changed(); },
    async activate(target, nextScope) {
      loading = false;
      if (active === target && scope === nextScope) { changed(); return; }
      cancel(); clearLayers(); selected = null; active = target; scope = nextScope; changed();
      const saved = drafts.get(scope); if (!saved?.surfaces.length) return;
      try { (await prepareRestore(saved))?.commit(); } catch { /* Retry through explicit saved restore; other households remain untouched. */ }
    },
    setEditing(value) {
      const next = Boolean(value && active && !loading && (!pending || editing));
      if (next !== editing) cancel();
      editing = next; showHighlight(); changed();
    },
    select(targetId) {
      if (!editing || loading) return false;
      cancel(); selected = registry().targets.get(targetId) ?? null; showHighlight(); changed(); return Boolean(selected);
    },
    pick(camera, ndc, clippingPlanes = []) {
      if (!editing || !active || loading) return null;
      const meshes = []; active.model.updateWorldMatrix(true, true); camera.updateWorldMatrix(true, false);
      active.model.traverse(mesh => {
        if (!mesh.isMesh || mesh.userData.renderBatch || mesh.userData.surfaceOverride) return;
        for (let owner = mesh; owner; owner = owner.parent) if (owner.userData.surfaceOverride || (!owner.visible && !owner.userData.renderBatched)) return;
        meshes.push(mesh);
      });
      const ray = new Raycaster(); ray.setFromCamera(ndc instanceof Vector2 ? ndc : new Vector2(ndc.x, ndc.y), camera);
      const hits = ray.intersectObjects(meshes, false).filter(h => !clippingPlanes.some(p => p.distanceToPoint(h.point) < 0)
        && !h.object.material?.clippingPlanes?.some(p => p.distanceToPoint(h.point) < 0));
      // The nearest furniture/door/fixture blocks the click. Never select a wall
      // through a sofa, or fall back to changing a shared fixture material.
      const hit = hits[0], target = registry().fromHit(hit);
      api.select(target?.id);
      if (!target) { error = hit ? '이 부분은 아직 지원하지 않아요. 벽이나 바닥을 선택해 주세요.' : '3D 화면의 벽이나 바닥을 선택해 주세요.'; changed(); }
      return target?.id ?? null;
    },
    async apply(id) {
      if (!selected || !active || !editing || loading || !surfaceMaterial(id)) return false;
      cancel(); const t = token(), target = selected; pending = true; changed();
      try {
        const asset = id === 'original' ? null : await library.load(id);
        if (!current(t) || selected !== target) return false;
        const next = asset ? layer(target, asset) : null;
        disposeLayer(overlays.get(target.id)); overlays.delete(target.id);
        if (next) { overlays.set(target.id, next); active.model.add(next.group); }
        const entries = new Map((drafts.get(scope)?.surfaces ?? []).map(i => [i.id, i.material]));
        if (id === 'original') entries.delete(target.id); else entries.set(target.id, id);
        drafts.set(scope, { version: 1, surfaces: [...entries].map(([surfaceId, material]) => ({ id: surfaceId, material })) });
        pending = false; error = ''; changed(); return true;
      } catch (cause) { if (current(t)) { pending = false; error = '재질을 불러오지 못해 이전 마감을 유지했어요. 다시 선택해 주세요.'; changed(); } return false; }
    },
    prepareRestore,
    async refreshLighting() {
      if(!overlays.size || pending || loading) return;
      try { (await prepareRestore(api.snapshot()))?.commit(); } catch { /* Existing finish remains usable. */ }
    },
    snapshot() { return structuredClone(drafts.get(scope) ?? empty()); },
    state() { return { scope, editing, pending, loading, error, selected: selected ? { id: selected.id, kind: selected.kind, label: selected.label, sourceIds: selected.sourceIds } : null,
      material: drafts.get(scope)?.surfaces.find(s => s.id === selected?.id)?.material ?? 'original', count: overlays.size,
      drawMeshes: [...overlays.values()].reduce((n, o) => n + o.group.children.length, 0) }; },
    // Inspection is used by the scoped CPU browser checks, not by product flows.
    targets() { return registry()?.targets ?? new Map(); },
    overlayMaterials() { return [...overlays.values()].flatMap(o => o.group.children.map(m => m.material)); },
  };
  return api;
}
