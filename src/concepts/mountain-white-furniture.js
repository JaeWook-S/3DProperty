import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MOUNTAIN_WHITE_SPECS } from './mountain-white-spec.js';
import { buildDiningChairs, buildTelevision } from './kit.js';

export const MOUNTAIN_WHITE_MODELS = {
  mwSofa: { url: new URL('../../assets/house-tours/mountain-white/sofa.glb', import.meta.url).href, root: 'SOFA_Assembly_ROOT', prefix: 'SOFA_' },
  mwRug: { url: new URL('../../assets/house-tours/mountain-white/rug.glb', import.meta.url).href, prefix: 'TVR_' },
  mwCoffeeTable: { url: new URL('../../assets/house-tours/mountain-white/short_table.glb', import.meta.url).href, root: 'STBL_Table_ROOT', prefix: 'STBL_' },
  mwTvConsole: { url: new URL('../../assets/house-tours/mountain-white/tv_shelves.glb', import.meta.url).href, root: 'TVC_Cabinet_ROOT', prefix: 'TVC_' },
  mwFloorLamp: { url: new URL('../../assets/house-tours/mountain-white/floor_stance.glb', import.meta.url).href, root: 'TPL_Lamp_ROOT', prefix: 'TPL_' },
  mwDiningTable: { url: new URL('../../assets/house-tours/mountain-white/wood_table.glb', import.meta.url).href, root: 'RDT_Table_ROOT', prefix: 'RDT_' },
  mwBed: { url: new URL('../../assets/house-tours/mountain-white/bed.glb', import.meta.url).href, root: 'BED_Bed_ROOT', prefix: 'BED_' },
};
const templates = new Map();
let loading;
let loadError = null;

const excludedPart = node => /^Cube(?:$|\.)/.test(node.name) || /^BED_Floor(?:$|[_.])/.test(node.name) || node.isCamera || node.isLight;

export function mountainWhiteLoadError() { return loadError; }

export function prepareMountainWhiteModel(kind, scene) {
  const definition = MOUNTAIN_WHITE_MODELS[kind], spec = MOUNTAIN_WHITE_SPECS[kind];
  if (!definition || !spec) throw new Error(`Unknown mountain-white furniture: ${kind}`);
  scene.updateMatrixWorld(true);
  const root = definition.root && scene.getObjectByName(definition.root);
  const sources = new Set();
  if (root) sources.add(root);
  // Baked exports flatten the original assembly into separate *_GLB meshes.
  // Select furniture parts by prefix so photography floors and lights stay out.
  else scene.traverse(node => { if (node.isMesh && node.name.startsWith(definition.prefix) && !excludedPart(node)) sources.add(node); });
  if (!sources.size) throw new Error(`${definition.prefix} 가구 부품을 찾을 수 없습니다.`);
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
  const group = new THREE.Group(); group.add(object);
  const bounds = new THREE.Box3().setFromObject(group);
  if (bounds.isEmpty()) throw new Error(`${kind}: 빈 가구 모델입니다.`);
  const center = bounds.getCenter(new THREE.Vector3());
  object.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
  if (kind === 'mwTvConsole') group.add(buildTelevision(0.562));
  if (kind === 'mwDiningTable') group.add(buildDiningChairs());
  group.name = spec.title;
  group.userData.furnitureSet = 'mountain-white';
  group.userData.baseKind = spec.baseKind;
  group.traverse(node => { if (node.isMesh) { node.castShadow = !spec.flat; node.receiveShadow = true; if (spec.flat) node.userData.collisionDisabled = true; } });
  group.updateMatrixWorld(true);
  return group;
}

export function loadMountainWhiteFurniture(loader = new GLTFLoader()) {
  if (!loading) loading = Promise.all(Object.entries(MOUNTAIN_WHITE_MODELS).map(async ([kind, definition]) => {
    try {
      const { scene } = await loader.loadAsync(definition.url);
      return [kind, prepareMountainWhiteModel(kind, scene)];
    } catch (error) {
      const file = new URL(definition.url).pathname.split('/').pop();
      throw new Error(`${file}: ${error.message}`, { cause: error });
    }
  })).then(entries => {
    for (const [kind, group] of entries) templates.set(kind, group);
    loadError = null;
  }).catch(error => { loading = null; loadError = error; throw error; });
  return loading;
}

export function installMountainWhiteTemplates(staging) {
  for (const [kind, group] of templates) {
    const spec = MOUNTAIN_WHITE_SPECS[kind];
    staging.addTemplate(kind, { title: spec.title, label: spec.label, group, width: spec.w, depth: spec.d, height: spec.h });
  }
}
