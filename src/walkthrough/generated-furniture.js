import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { validateFurniture } from '../../apps/web/src/furniture.js';

const cache = new Map();
const MAX_GLB_BYTES = 10 * 1024 * 1024;

export function validateGeneratedAsset(asset) {
  const parsed = validateFurniture(asset);
  if (!parsed.metricReady || !/^[a-f0-9]{32}-[0-9]{3}$/.test(asset?.asset_id) ||
      asset.geometry_kind !== 'glb' || !/^[a-f0-9]{64}$/.test(asset.model_sha256) ||
      asset.model_uri !== `/api/furniture/assets/${asset.asset_id}/model.glb` ||
      asset.manifest_uri !== `/api/furniture/assets/${asset.asset_id}/asset.json` ||
      Object.values(asset.dimensions_m).some(value => value > 50)) {
    throw new Error('생성된 가구의 치수·GLB 주소·해시 형식이 올바르지 않습니다.');
  }
  return asset;
}

export function generatedKind(asset) { return `generated:${validateGeneratedAsset(asset).asset_id}`; }

export function generatedViewerUrl(viewerBase, asset, variant = 'expanded') {
  validateGeneratedAsset(asset);
  const url = new URL(viewerBase);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('3D 뷰어 주소가 올바르지 않습니다.');
  url.searchParams.set('studio', '1');
  url.searchParams.set('variant', variant === 'basic' ? 'basic' : 'expanded');
  url.searchParams.set('furnitureAsset', asset.asset_id);
  return url.href;
}

export async function fetchGeneratedAssets() {
  const response = await fetch('/api/furniture/assets', { cache: 'no-store' });
  if (response.status === 404) return []; // Old measurement-only API; existing web remains usable.
  if (!response.ok) throw new Error('생성된 가구 목록을 불러오지 못했습니다. 서버 API를 확인하세요.');
  const body = await response.json();
  if (!Array.isArray(body.assets)) throw new Error('생성된 가구 목록 형식이 올바르지 않습니다.');
  return body.assets.map(validateGeneratedAsset);
}

export async function decodeGeneratedModel(asset, buffer, loader = new GLTFLoader()) {
  validateGeneratedAsset(asset);
  if (buffer.byteLength < 28 || buffer.byteLength > MAX_GLB_BYTES) throw new Error('GLB 파일 크기가 올바르지 않습니다.');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 ||
      view.getUint32(8, true) !== buffer.byteLength || view.getUint32(16, true) !== 0x4e4f534a ||
      view.getUint32(12, true) > buffer.byteLength - 20) throw new Error('올바른 GLB 2.0 파일이 아닙니다.');
  const document = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, view.getUint32(12, true))));
  if ([...(document.buffers || []), ...(document.images || [])].some(value => 'uri' in value)) {
    throw new Error('외부 파일이 필요한 GLB는 사용할 수 없습니다.');
  }
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== asset.model_sha256) throw new Error('GLB 해시가 일치하지 않습니다. 파일 전송을 확인하세요.');
  const { scene } = await loader.parseAsync(buffer, '');
  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(scene), size = bounds.getSize(new THREE.Vector3());
  const expected = [asset.dimensions_m.width, asset.dimensions_m.height, asset.dimensions_m.depth];
  if (bounds.isEmpty() || size.toArray().some((value, index) => !Number.isFinite(value) || value <= 0 ||
      Math.abs(value - expected[index]) > Math.max(1e-5, expected[index] * 1e-4))) {
    throw new Error('GLB 크기가 측정 치수와 다릅니다. 임의로 크기를 보정하지 않았습니다.');
  }
  const center = bounds.getCenter(new THREE.Vector3());
  scene.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
  scene.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
  const group = new THREE.Group();
  group.name = asset.title || '생성된 테스트 가구';
  group.add(scene);
  group.updateMatrixWorld(true);
  return group;
}

export async function loadGeneratedModel(asset) {
  validateGeneratedAsset(asset);
  const key = `${asset.asset_id}:${asset.model_sha256}`;
  if (!cache.has(key)) {
    const pending = (async () => {
      const response = await fetch(asset.model_uri, { redirect: 'error' });
      if (!response.ok) throw new Error('GLB를 불러오지 못했습니다. 서버와 SSH 터널을 확인하세요.');
      if (Number(response.headers.get('content-length')) > MAX_GLB_BYTES) throw new Error('GLB 파일이 너무 큽니다.');
      return decodeGeneratedModel(asset, await response.arrayBuffer());
    })();
    cache.set(key, pending.catch(error => { cache.delete(key); throw error; }));
  }
  return (await cache.get(key)).clone(true);
}

export function installGeneratedTemplate(staging, asset, group) {
  const { width, depth, height } = validateGeneratedAsset(asset).dimensions_m;
  const kind = generatedKind(asset);
  staging.addTemplate(kind, { title: asset.title || '테스트 생성 가구', label: '테스트', group, width, depth, height });
  return kind;
}
