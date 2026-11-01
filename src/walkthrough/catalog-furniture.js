import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import chair from '../../assets/furniture/cc0/modern-arm-chair-01/manifest.json' with { type: 'json' };
import sofa from '../../assets/furniture/cc0/sofa-02/manifest.json' with { type: 'json' };
import coffeeTable from '../../assets/furniture/cc0/modern-coffee-table-01/manifest.json' with { type: 'json' };
import diningChair from '../../assets/furniture/cc0/dining-chair-02/manifest.json' with { type: 'json' };

// Importing this module does not fetch/decode the model. Load only on explicit use.
export const CATALOG_FURNITURE = Object.freeze([Object.freeze({
  ...chair,
  modelUrl: new URL('../../assets/furniture/cc0/modern-arm-chair-01/model.glb', import.meta.url).href,
  previewUrl: new URL('../../assets/furniture/cc0/modern-arm-chair-01/preview.png', import.meta.url).href,
  label: '모델 규격 · CC0',
}), Object.freeze({
  ...sofa,
  modelUrl: new URL('../../assets/furniture/cc0/sofa-02/model.glb', import.meta.url).href,
  previewUrl: new URL('../../assets/furniture/cc0/sofa-02/preview.png', import.meta.url).href,
  label: '모델 규격 · CC0',
}), Object.freeze({
  ...coffeeTable,
  modelUrl: new URL('../../assets/furniture/cc0/modern-coffee-table-01/model.glb', import.meta.url).href,
  previewUrl: new URL('../../assets/furniture/cc0/modern-coffee-table-01/preview.png', import.meta.url).href,
  label: '모델 규격 · CC0',
}), Object.freeze({
  ...diningChair,
  modelUrl: new URL('../../assets/furniture/cc0/dining-chair-02/model.glb', import.meta.url).href,
  previewUrl: new URL('../../assets/furniture/cc0/dining-chair-02/preview.png', import.meta.url).href,
  label: '모델 규격 · CC0',
})]);
const cache = new Map();
const MAX_BYTES = 8 * 1024 * 1024;

export function catalogFurniture(id) {
  const asset = CATALOG_FURNITURE.find(item => item.id === id || item.kind === id);
  if (!asset) throw new Error('등록되지 않은 가구예요.');
  return asset;
}

export async function decodeCatalogFurniture(id, buffer, loader = new GLTFLoader()) {
  const asset = catalogFurniture(id);
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== asset.model_bytes || buffer.byteLength > MAX_BYTES) {
    throw new Error('가구 파일 크기가 일치하지 않습니다.');
  }
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength ||
      view.getUint32(16, true) !== 0x4e4f534a || view.getUint32(12, true) > buffer.byteLength - 20) {
    throw new Error('올바른 GLB 2.0 가구 파일이 아닙니다.');
  }
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== asset.model_sha256) throw new Error('가구 파일 해시가 일치하지 않습니다.');
  const doc = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, view.getUint32(12, true))));
  if ([...(doc.buffers || []), ...(doc.images || [])].some(value => 'uri' in value)) {
    throw new Error('외부 자료가 필요한 가구 파일은 사용할 수 없습니다.');
  }
  if (!doc.materials?.every(material => material.extras?.appearance_policy === 'authored-pbr-v1')) {
    throw new Error('가구 재질 보존 정보가 누락되었습니다.');
  }
  const { scene } = await loader.parseAsync(buffer, '');
  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(scene), size = bounds.getSize(new THREE.Vector3());
  const expected = [asset.dimensions_m.width, asset.dimensions_m.height, asset.dimensions_m.depth];
  if (bounds.isEmpty() || size.toArray().some((value, index) => !Number.isFinite(value) || Math.abs(value - expected[index]) > 1e-5)) {
    throw new Error('가구 모델의 규격이 등록 정보와 다릅니다.');
  }
  const center = bounds.getCenter(new THREE.Vector3());
  scene.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
  scene.traverse(object => {
    if (object.isMesh) {
      object.castShadow = true; object.receiveShadow = true;
      object.userData.dimension_basis = asset.dimension_basis;
    }
  });
  const group = new THREE.Group(); group.name = asset.title; group.add(scene);
  group.userData.catalog_id = asset.id;
  group.userData.dimension_basis = asset.dimension_basis;
  group.userData.source_url = asset.source.official_page;
  group.updateMatrixWorld(true);
  return group;
}

export async function loadCatalogFurniture(id) {
  const asset = catalogFurniture(id);
  if (!cache.has(asset.id)) {
    const pending = (async () => {
      const response = await fetch(asset.modelUrl, { redirect: 'error' });
      if (!response.ok) throw new Error('가구를 불러오지 못했습니다. 다시 시도해 주세요.');
      const length = Number(response.headers.get('content-length'));
      if (length > MAX_BYTES) throw new Error('가구 파일이 너무 큽니다.');
      return decodeCatalogFurniture(asset.id, await response.arrayBuffer());
    })();
    cache.set(asset.id, pending.catch(error => { cache.delete(asset.id); throw error; }));
  }
  return (await cache.get(asset.id)).clone(true);
}

export async function installCatalogTemplate(staging, id) {
  const asset = catalogFurniture(id);
  if (staging.templates.has(asset.kind)) return asset.kind;
  const group = await loadCatalogFurniture(asset.id);
  const { width, depth, height } = asset.dimensions_m;
  staging.addTemplate(asset.kind, { title: asset.title, label: asset.label, group, width, depth, height });
  return asset.kind;
}
