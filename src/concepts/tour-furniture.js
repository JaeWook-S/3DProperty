import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TOUR_FURNITURE_SPECS, tourPropModel } from './tour-furniture-spec.js';
import { buildDressing, buildTelevision } from './kit.js';

const glb = (tour, file) => new URL(`../../assets/house-tours/${tour}/${file}`, import.meta.url).href;

// Placeable set pieces. `root` names the assembly node of older exports; `prefix` selects the
// parts of baked exports that flattened the assembly. Without either, the whole file is the piece.
export const TOUR_MODELS = {
  mwSofa: { url: glb('mountain-white', 'sofa.glb'), root: 'SOFA_Assembly_ROOT', prefix: 'SOFA_' },
  mwRug: { url: glb('mountain-white', 'rug.glb'), prefix: 'TVR_' },
  mwCoffeeTable: { url: glb('mountain-white', 'short_table.glb'), root: 'STBL_Table_ROOT', prefix: 'STBL_' },
  mwTvConsole: { url: glb('mountain-white', 'tv_shelves.glb'), root: 'TVC_Cabinet_ROOT', prefix: 'TVC_' },
  mwFloorLamp: { url: glb('mountain-white', 'floor_stance.glb'), root: 'TPL_Lamp_ROOT', prefix: 'TPL_' },
  mwDiningTable: { url: glb('mountain-white', 'wood_table.glb'), root: 'RDT_Table_ROOT', prefix: 'RDT_' },
  mwChair: { url: glb('mountain-white', 'black_chair.glb') }, // six around mwDiningTable
  mwBed: { url: glb('mountain-white', 'bed.glb'), root: 'BED_Bed_ROOT', prefix: 'BED_' },
  mwArmchair: { url: glb('mountain-white', 'armchair.glb') },
  mwPlant: { url: glb('mountain-white', 'monstera.glb') },
  mwSmallRug: { url: glb('mountain-white', 'small_rug.glb') },
  mwSingleBed: { url: glb('mountain-white', 'small_oak_bed.glb') },
  mwLoftBed: { url: glb('mountain-white', 'loft_bed.glb') },
  mwBookcase: { url: glb('mountain-white', 'black_bookcase.glb') },
  swSofa: { url: glb('stone-walnut', 'orange_sofa.glb') },
  swRug: { url: glb('stone-walnut', 'white_rug.glb') },
  swCoffeeTable: { url: glb('stone-walnut', 'black_coffee_table.glb') },
  swSideTable: { url: glb('stone-walnut', 'dark_brown_circle_table.glb') },
  swSideboard: { url: glb('stone-walnut', 'walnut_sideboard.glb') },
  swFloorLamp: { url: glb('stone-walnut', 'black_lamp.glb') },
  swDiningTable: { url: glb('stone-walnut', 'oak_brown_table.glb') },
  swChair: { url: glb('stone-walnut', 'metal_black_chair.glb') }, // four at swDiningTable, one at swDesk
  swBed: { url: glb('stone-walnut', 'dark_brown_bed.glb') },
  swNightstand: { url: glb('stone-walnut', 'dark_brown_table.glb') },
  swGuestBed: { url: glb('stone-walnut', 'small_dark_brown_bed.glb') },
  swDesk: { url: glb('stone-walnut', 'dark_desk.glb') },
  swWardrobe: { url: glb('stone-walnut', 'small_black_wardrobe.glb') },
  swPlant: { url: glb('mountain-white', 'monstera.glb') }, // the same monstera, shared with mountain-white
};
// Parts that only appear as a styling prop (see `props` in the spec). `keepHeight` keeps a
// hanging piece at its modeled height instead of standing it on the floor. `title` names the
// prop on its product card (P); its product is looked up by the part name.
export const TOUR_PARTS = {
  mwSideTable: { url: glb('mountain-white', 'small_black_side_table.glb'), title: '화이트 오크 · 블랙 보조 테이블' },
  mwNightstand: { url: glb('mountain-white', 'small_white_nightstand.glb'), title: '화이트 오크 · 화이트 협탁' },
  swPendant: { url: glb('stone-walnut', 'small_black_pendant.glb'), keepHeight: true, title: '다크 스톤 · 블랙 펜던트 조명' },
  mwPendant: { url: glb('mountain-white', 'small_pendant_lamp.glb'), keepHeight: true, title: '화이트 오크 · 블랙 펜던트 조명' },
  tableLamp: { url: glb('mountain-white', 'small_table_lamp.glb'), title: '화이트 탁상 조명' }, // on every set side table and nightstand
  mwFrame: { url: glb('mountain-white', 'oak_frame.glb'), title: '화이트 오크 · 오크 액자' },
  swFrame: { url: glb('stone-walnut', 'small_black_frame.glb'), title: '다크 스톤 · 블랙 액자' },
  swTriptych: { url: glb('stone-walnut', 'three_picture_frames.glb'), title: '다크 스톤 · 세 폭 액자' },
  swShelf: { url: glb('stone-walnut', 'wall_shelf.glb'), title: '다크 스톤 · 벽 선반' },
};
const templates = new Map();
const parts = new Map();
let loading;
let loadError = null;

const excludedPart = node => /^Cube(?:$|\.)/.test(node.name) || /^BED_Floor(?:$|[_.])/.test(node.name) || node.isCamera || node.isLight;

export function tourFurnitureLoadError() { return loadError; }

/** The file's furniture as one object centered on its footprint, standing on y = 0. */
function extract(definition, scene, label) {
  scene.updateMatrixWorld(true);
  const root = definition.root && scene.getObjectByName(definition.root);
  const sources = new Set();
  if (root) sources.add(root);
  // Baked exports flatten the original assembly into separate *_GLB meshes.
  // Select furniture parts by prefix so photography floors and lights stay out.
  else if (definition.prefix) scene.traverse(node => { if (node.isMesh && node.name.startsWith(definition.prefix) && !excludedPart(node)) sources.add(node); });
  else for (const node of scene.children) if (!excludedPart(node)) sources.add(node);
  if (!sources.size) throw new Error(`${definition.prefix ?? label} 가구 부품을 찾을 수 없습니다.`);
  const object = new THREE.Group();
  for (const source of sources) {
    let nested = false;
    for (let parent = source.parent; parent; parent = parent.parent) if (sources.has(parent)) { nested = true; break; }
    if (nested) continue;
    const clone = source.clone(true);
    source.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
    const excluded = [];
    clone.traverse(node => { if (excludedPart(node)) excluded.push(node); });
    for (const node of excluded) node.removeFromParent();
    object.add(clone);
  }
  const bounds = new THREE.Box3().setFromObject(object);
  if (bounds.isEmpty()) throw new Error(`${label}: 빈 가구 모델입니다.`);
  const center = bounds.getCenter(new THREE.Vector3());
  object.position.sub(new THREE.Vector3(center.x, definition.keepHeight ? 0 : bounds.min.y, center.z));
  // Dressing props reuse these meshes; their geometry and textures belong to the template.
  object.traverse(node => { if (node.isMesh) node.userData.sharedAsset = true; });
  return object;
}

/**
 * One placeable set piece from its loaded GLB scene: the GLB is the first child. Tables, desks
 * and chairs are separate pieces (TOUR_PIECES places the chairs of a *Set kind).
 */
export function prepareTourModel(kind, scene) {
  const definition = TOUR_MODELS[kind], spec = TOUR_FURNITURE_SPECS[kind];
  if (!definition || !spec) throw new Error(`Unknown tour furniture: ${kind}`);
  const group = new THREE.Group();
  group.add(extract(definition, scene, kind));
  if (kind === 'mwTvConsole') group.add(buildTelevision(0.562));
  // Center the whole footprint (the console and its TV) on the plan position.
  const bounds = new THREE.Box3().setFromObject(group), center = bounds.getCenter(new THREE.Vector3());
  for (const child of group.children) child.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
  group.name = spec.title;
  group.userData.furnitureSet = spec.set;
  group.userData.baseKind = spec.baseKind;
  group.traverse(node => { if (node.isMesh) { node.castShadow = !spec.flat; node.receiveShadow = true; if (spec.flat) node.userData.collisionDisabled = true; } });
  group.updateMatrixWorld(true);
  return group;
}

async function loadScene(loader, url) {
  try {
    return (await loader.loadAsync(url)).scene;
  } catch (error) {
    const file = new URL(url).pathname.split('/').pop();
    throw new Error(`${file}: ${error.message}`, { cause: error });
  }
}

/** Loads every set once (each file once, even when two pieces share it); a failure names the file and the next call retries. */
export function loadTourFurniture(loader = new GLTFLoader()) {
  if (!loading) loading = (async () => {
    const files = new Map();
    const scene = (url) => { if (!files.has(url)) files.set(url, loadScene(loader, url)); return files.get(url); };
    const loaded = Object.fromEntries(await Promise.all(Object.entries(TOUR_PARTS).map(async ([name, definition]) =>
      [name, extract(definition, await scene(definition.url), name)])));
    const entries = await Promise.all(Object.entries(TOUR_MODELS).map(async ([kind, definition]) =>
      [kind, prepareTourModel(kind, await scene(definition.url))]));
    for (const [name, object] of Object.entries(loaded)) parts.set(name, object);
    for (const [kind, group] of entries) templates.set(kind, group);
    loadError = null;
  })().catch(error => { loading = null; loadError = error; throw error; });
  return loading;
}

/**
 * The set's own model for a styling prop of a 집들이 (see `props` in the spec), placed the way
 * the kit prop would be, or null to keep the kit prop:
 *   sideLamp / nightLamp  the table with the set's table lamp on top
 *   art                   centered on the prop's height; small frames repeat to fill the planned width
 *   wallShelf             board level with the prop's origin, back against the wall
 *   pendant               as modeled, hanging from the ceiling
 */
export function tourProp(tour, kind, prop = {}) {
  const name = tourPropModel(tour, kind, prop.options?.over);
  const source = name && (parts.get(name) ?? templates.get(name));
  if (!source) return null;
  const group = new THREE.Group(), box = new THREE.Box3().setFromObject(source), size = box.getSize(new THREE.Vector3());
  if (kind === 'art') {
    const gap = 0.12, width = prop.options?.w ?? size.x;
    const count = Math.max(1, Math.min(3, Math.floor((width + gap) / (size.x + gap))));
    for (let i = 0; i < count; i++) {
      const frame = source.clone(true);
      frame.position.set((i - (count - 1) / 2) * (size.x + gap), -size.y / 2, 0);
      group.add(frame);
    }
  } else if (kind === 'wallShelf') {
    const shelf = source.clone(true);
    shelf.position.set(0, -box.max.y + 0.0125, -0.03 - box.min.z);
    group.add(shelf);
  } else {
    group.add(source.clone(true));
  }
  // The table and the lamp on it are separate products, each with its own card.
  if (kind === 'sideLamp' || kind === 'nightLamp') {
    const lamp = parts.get('tableLamp');
    const placed = lamp ? lamp.clone(true) : buildDressing('tableLamp', { height: box.max.y });
    if (lamp) placed.position.y = box.max.y;
    placed.userData.furnitureInfo = { kind: 'tableLamp', title: TOUR_PARTS.tableLamp.title };
    group.add(placed);
  }
  group.name = `Dressing ${kind} · ${name}`;
  group.userData.dressing = kind;
  group.userData.furnitureInfo = { kind: name, title: TOUR_PARTS[name]?.title ?? TOUR_FURNITURE_SPECS[name]?.title ?? name };
  return group;
}

export function installTourTemplates(staging) {
  for (const [kind, group] of templates) {
    const spec = TOUR_FURNITURE_SPECS[kind];
    staging.addTemplate(kind, { title: spec.title, label: spec.label, group, width: spec.w, depth: spec.d, height: spec.h, chair: spec.chair, table: spec.table });
  }
}
