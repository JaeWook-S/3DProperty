import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import layout from '../../assets/location/acro-river-park/floor-five-unit-layout.json' with {type: 'json'};
import {bindArchisketchModel} from './archisketch-model.js';
import {batchStaticMeshes} from './static-batches.js';
import {createBakedLighting,lightingModelId} from './baked-lighting.js';

export const FIVE_UNIT_LAYOUT = layout;
// Literal GLB URLs let Vite include reviewed assets. Source model-info files stay
// private: the sanitized layout JSON supplies only room IDs/names and revision.
export const FIVE_UNIT_MODEL_SOURCES = {
  '168c': {
    basic: {glb: new URL('../../assets/models/acro-river-park/168c/archisketch-details-v2/basic/acro168c-basic.glb', import.meta.url).href},
    expanded: {glb: new URL('../../assets/models/acro-river-park/168c/archisketch-metric-v1/expanded/acro168c-expanded.glb', import.meta.url).href},
  },
  '211a': {
    basic: {glb: new URL('../../assets/models/acro-river-park/211a/archisketch-structure-v1/basic/acro211a-basic-archisketch.glb', import.meta.url).href},
    expanded: {glb: new URL('../../assets/models/acro-river-park/211a/archisketch-structure-v1/expanded/acro211a-expanded-archisketch.glb', import.meta.url).href},
  },
  '145f': {
    basic: {glb: new URL('../../assets/models/acro-river-park/145f/archisketch-structure-v1/basic/acro145f-basic-archisketch.glb', import.meta.url).href},
    expanded: {glb: new URL('../../assets/models/acro-river-park/145f/archisketch-structure-v1/expanded/acro145f-expanded-archisketch.glb', import.meta.url).href},
  },
  '168d': {
    basic: {glb: new URL('../../assets/models/acro-river-park/168d/archisketch-structure-v1/basic/acro168d-basic-archisketch.glb', import.meta.url).href},
    expanded: {glb: new URL('../../assets/models/acro-river-park/168d/archisketch-structure-v1/expanded/acro168d-expanded-archisketch.glb', import.meta.url).href},
  },
};

export function fiveUnitSitePlacement(unit) {
  const a = layout.coordinateTransform.siteRotationYRadians;
  const [ox, oz] = layout.coordinateTransform.reviewDomainMin_m;
  const [tx, tz] = unit.reviewTranslation_m;
  const x = tx + ox, z = tz + oz, c = Math.cos(a), s = Math.sin(a);
  return {id: unit.id, type: unit.type, translation: [c * x + s * z, 0, -s * x + c * z],
    rotationYRadians: a + THREE.MathUtils.degToRad(unit.reviewYawDegrees), scale: 1,
    reviewTranslation_m: [...unit.reviewTranslation_m], reviewYawDegrees: unit.reviewYawDegrees};
}

// Cache source templates, not placed/batched instances. Two 145F units share a
// single download but own independent object transforms and render visibility.
export function createFiveUnitAssetCache({
  loadGLTF = url => new GLTFLoader().loadAsync(url),
  loadMetadata = async (_source, type, variant) => layout.sources[type][variant].metadata,
  prepare = gltf => bindArchisketchModel(gltf, {objects: {}}),
} = {}) {
  const pending = new Map();
  return {
    get(type, variant) {
      const source = FIVE_UNIT_MODEL_SOURCES[type]?.[variant];
      if (!source) return Promise.reject(new Error('지원하지 않는 층 검토 모델입니다.'));
      const key = source.glb;
      if (!pending.has(key)) {
        const promise = Promise.all([loadGLTF(source.glb), loadMetadata(source, type, variant)])
          .then(([gltf, metadata]) => { prepare(gltf); return {template: gltf.scene, gltf, metadata, source}; });
        pending.set(key, promise);
        promise.catch(() => { if (pending.get(key) === promise) pending.delete(key); });
      }
      return pending.get(key);
    },
    get size() { return pending.size; },
  };
}
const sourceCache = createFiveUnitAssetCache();

function makeLabel(text, position) {
  const canvas = document.createElement('canvas');
  let context = canvas.getContext('2d');
  context.font = '600 48px "Cortex Nanum", sans-serif';
  canvas.width = Math.ceil(context.measureText(text).width) + 48; canvas.height = 88;
  context = canvas.getContext('2d');
  context.fillStyle = 'rgba(250,249,243,.95)'; context.beginPath();
  context.roundRect(2, 2, canvas.width - 4, 84, 16); context.fill();
  context.strokeStyle = '#adb7a1'; context.lineWidth = 2; context.stroke();
  context.fillStyle = '#254737'; context.font = '600 48px "Cortex Nanum", sans-serif';
  context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, 44, canvas.width - 28);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map: texture, depthTest: false, depthWrite: false}));
  sprite.position.copy(position); sprite.scale.set(7.2, 7.2 * 88 / canvas.width, 1);
  sprite.name = text; sprite.renderOrder = 10; sprite.userData.collisionDisabled = true;
  return sprite;
}

function visibleMeshBounds(root) {
  const bounds = new THREE.Box3(); root.updateMatrixWorld(true);
  root.traverse(object => {
    if (!object.isMesh) return;
    for (let parent = object; parent; parent = parent.parent) if (!parent.visible) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
  });
  return bounds;
}

/** Static five-unit review for 100동 10층 only. All placements are existing site
 * X/Z meters; the caller alone applies selected-floor Y elevation. This does not
 * modify the OSM envelope or invent a corridor/elevator. Source doors stay in
 * their exported closed poses; no new walkability assertion is introduced.
 */
export async function loadFiveUnitFloor(variant = 'expanded', {
  assetCache = sourceCache, labelFactory = makeLabel,
} = {}) {
  if (!['basic', 'expanded'].includes(variant)) throw new Error('기본형 또는 확장형을 선택하세요.');
  const root = new THREE.Group(); root.name = `100동 10층 / five-unit review / ${variant}`;
  Object.assign(root.userData, {floorLayoutRevision: layout.revision, layoutVerified: false,
    actualCommonAreaVerified: false, collisionDisabled: true});
  const units = await Promise.all(layout.units.map(async item => {
    const {template, gltf, metadata, source} = await assetCache.get(item.type, variant);
    const model = template.clone(true), placement = fiveUnitSitePlacement(item);
    const bakedLighting = gltf?.parser?.associations ? createBakedLighting(gltf,lightingModelId(item.type,variant),{model}) : null;
    if(bakedLighting){bakedLighting.setEnabled(true);await bakedLighting.ensure();}
    model.name = `${item.id}호 / ${item.type.toUpperCase()} / ${variant}`;
    model.userData.floorUnitId = item.id; model.userData.floorUnitType = item.type;
    model.position.fromArray(placement.translation); model.rotation.y = placement.rotationYRadians;
    model.scale.set(1, 1, 1);
    model.traverse(object => {
      if (['ceiling', 'base', 'decoration'].includes(object.userData.component)) object.visible = false;
      if (object.isMesh) { object.receiveShadow = true; object.castShadow = false; }
    });
    root.add(model);
    return {id: item.id, type: item.type, placement, model, source, bakedLighting, doors: [],
      info: {rooms: metadata.rooms, unitType: metadata.unit_type, variant,
        structureRevision: metadata.revision, sourceMetadata: metadata}};
  }));
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3(), boundsByUnit = {};
  for (const unit of units) {
    const box = visibleMeshBounds(unit.model); boundsByUnit[unit.id] = box;
    (boundsByUnit[unit.type] ??= new THREE.Box3()).union(box); bounds.union(box);
    const center = box.getCenter(new THREE.Vector3()); center.y = box.max.y + .35;
    const sprite = labelFactory(`${unit.id}호 · ${unit.type.toUpperCase()}`, center);
    if (sprite) {
      sprite.userData.focus = unit.id; sprite.userData.unitType = unit.type;
      root.add(sprite);
    }
  }
  const batches = units.map(unit => batchStaticMeshes(unit.model));
  const commonGroup = new THREE.Group(); commonGroup.name = 'Common core / not modeled'; root.add(commonGroup);
  const common = {group: commonGroup, bounds: new THREE.Box3(), labels: [], stats: {
    revision: 'five-unit-no-common-core-v1', actualCommonAreaVerified: false,
    corridorPolygons: 0, corridorFloorArea_m2: 0, elevator: null, stairsModeled: false,
    meshCount: 0, newCollisionMeshes: 0, basis: 'No verified common-floor plan; no common geometry generated.',
  }};
  root.visible = false;
  return {variant, root, units, bounds, boundsByUnit, common,
    details: {revision: 'five-unit-source-models-v1', newGeometry: false}, architecture: [],
    layoutRevision: layout.revision, layoutBasis: layout.basis, sourceStatus: 'review_only_actual_floor_not_verified',
    overflowOSM_m2: layout.overflowOSM_m2[variant], unknownCommonArea: true,
    batching: {sourceMeshes: batches.reduce((n, b) => n + b.sourceMeshes, 0),
      drawMeshes: batches.reduce((n, b) => n + b.drawMeshes, 0),
      savedDraws: batches.reduce((n, b) => n + b.savedDraws, 0),
      removedInternalCapTriangles: batches.reduce((n, b) => n + b.removedInternalCapTriangles, 0)},
  };
}
