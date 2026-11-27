import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TOUR_FURNITURE_SPECS } from './tour-furniture-spec.js';
import { buildDiningTable, buildTelevision } from './kit.js';

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
  mwBed: { url: glb('mountain-white', 'bed.glb'), root: 'BED_Bed_ROOT', prefix: 'BED_' },
  mwArmchair: { url: glb('mountain-white', 'armchair.glb') },
  mwPlant: { url: glb('mountain-white', 'monstera.glb') },
  swSofa: { url: glb('stone-walnut', 'orange_sofa.glb') },
  swRug: { url: glb('stone-walnut', 'white_rug.glb') },
  swCoffeeTable: { url: glb('stone-walnut', 'black_coffee_table.glb') },
  swSideTable: { url: glb('stone-walnut', 'dark_brown_circle_table.glb') },
  swSideboard: { url: glb('stone-walnut', 'walnut_sideboard.glb') },
  swFloorLamp: { url: glb('stone-walnut', 'black_lamp.glb') },
  swDining: { url: null }, // a kit table with four GLB chairs (no table GLB was supplied)
  swBed: { url: glb('stone-walnut', 'dark_brown_bed.glb') },
  swNightstand: { url: glb('stone-walnut', 'dark_brown_table.glb') },
};
// Parts that only appear inside a placeable piece.
export const TOUR_PARTS = {
  mwChair: { url: glb('mountain-white', 'black_chair.glb') },
  swChair: { url: glb('stone-walnut', 'metal_black_chair.glb') },
};
// [x, z, facing]: where each chair stands around its table and the way its sitter looks.
const SIX_CHAIRS = [-0.72, 0, 0.72].flatMap((x) => [[x, -0.44, 0], [x, 0.44, Math.PI]]);
const FOUR_CHAIRS = [-0.35, 0.35].flatMap((x) => [[x, -0.62, 0], [x, 0.62, Math.PI]]);

const templates = new Map();
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
  object.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
  return object;
}

function chairsAround(chair, seats) {
  const group = new THREE.Group();
  group.name = 'Dining chairs';
  for (const [x, z, facing] of seats) {
    const seat = chair.clone(true);
    seat.position.set(x, 0, z);
    seat.rotation.y = facing;
    group.add(seat);
  }
  return group;
}

/**
 * One placeable set piece from its loaded GLB scene. `parts` holds the extracted chair
 * objects for the dining sets. The piece's own GLB (or the kit table) is the first child.
 */
export function prepareTourModel(kind, scene, parts = {}) {
  const definition = TOUR_MODELS[kind], spec = TOUR_FURNITURE_SPECS[kind];
  if (!definition || !spec) throw new Error(`Unknown tour furniture: ${kind}`);
  const group = new THREE.Group();
  if (kind === 'swDining') group.add(buildDiningTable(1.4, 0.8));
  else group.add(extract(definition, scene, kind));
  if (kind === 'mwTvConsole') group.add(buildTelevision(0.562));
  if (kind === 'mwDiningTable') group.add(chairsAround(parts.mwChair, SIX_CHAIRS));
  if (kind === 'swDining') group.add(chairsAround(parts.swChair, FOUR_CHAIRS));
  // Center the whole footprint (table and chairs) on the plan position.
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

/** Loads every set once; a failure names the file and the next call retries. */
export function loadTourFurniture(loader = new GLTFLoader()) {
  if (!loading) loading = (async () => {
    const parts = Object.fromEntries(await Promise.all(Object.entries(TOUR_PARTS).map(async ([name, definition]) =>
      [name, extract(definition, await loadScene(loader, definition.url), name)])));
    const entries = await Promise.all(Object.entries(TOUR_MODELS).map(async ([kind, definition]) =>
      [kind, prepareTourModel(kind, definition.url ? await loadScene(loader, definition.url) : null, parts)]));
    for (const [kind, group] of entries) templates.set(kind, group);
    loadError = null;
  })().catch(error => { loading = null; loadError = error; throw error; });
  return loading;
}

export function installTourTemplates(staging) {
  for (const [kind, group] of templates) {
    const spec = TOUR_FURNITURE_SPECS[kind];
    staging.addTemplate(kind, { title: spec.title, label: spec.label, group, width: spec.w, depth: spec.d, height: spec.h });
  }
}
