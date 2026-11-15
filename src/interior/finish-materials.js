import { Color, DataTexture, LinearMipmapLinearFilter, LinearFilter, MeshPhysicalMaterial, MeshStandardMaterial, NoColorSpace, RepeatWrapping, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three';
import { inheritBakedLightingPolicy, releaseBakedLightingPolicy } from '../walkthrough/baked-lighting-policy.js';
import { generateMaps, swatchPixels } from './procedural-textures.js';
import { finishById } from './finish-catalog.js';

// Procedural PBR finishes. Textures are synthesized in a Worker on demand and
// kept for a few recently used finishes; nothing is downloaded.
const HIGH = new Set(['tile', 'wood']);
export function createFinishLibrary({ anisotropy = 8, keep = 8 } = {}) {
  let worker = null, serial = 0;
  const waiting = new Map(), entries = new Map(), thumbs = new Map(), recent = [], quickColors = new Map();
  function ensureWorker() {
    if (worker !== null) return worker;
    try {
      worker = new Worker(new URL('./texture-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => { const job = waiting.get(data.id); if (!job) return; waiting.delete(data.id); data.ok ? job.resolve(data) : job.reject(Error(data.error)); };
      worker.onerror = event => { console.warn('Texture worker unavailable; generating on the main thread.', event.message); worker.terminate(); worker = false; for (const job of waiting.values()) job.fallback(); waiting.clear(); };
    } catch { worker = false; }
    return worker;
  }
  function synthesize(recipe, size, swatch = 0) {
    const local = () => { const maps = generateMaps(recipe, size); return { maps, swatch: swatch ? swatchPixels(maps, swatch) : null }; };
    const w = ensureWorker();
    if (!w) return new Promise(resolve => setTimeout(() => resolve(local()), 0));
    return new Promise((resolve, reject) => {
      const id = ++serial;
      waiting.set(id, { resolve, reject, fallback: () => resolve(local()) });
      w.postMessage({ id, recipe: { ...recipe, id: recipe.id }, size, swatch });
    });
  }
  function texture(data, n, srgb, size) {
    const t = new DataTexture(data, n, n, RGBAFormat, UnsignedByteType);
    t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace; t.wrapS = t.wrapT = RepeatWrapping;
    t.generateMipmaps = true; t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter; t.anisotropy = anisotropy;
    t.repeat.set(1 / size[0], 1 / size[1]); t.needsUpdate = true; t.name = 'interior-procedural';
    return t;
  }
  function touch(id) { const i = recent.indexOf(id); if (i >= 0) recent.splice(i, 1); recent.unshift(id); }
  function evict(inUse) {
    for (const id of [...recent].reverse()) {
      if (recent.length <= keep) break;
      if (inUse.has(id)) continue;
      const entry = entries.get(id); if (!entry?.ready) continue;
      for (const m of entry.materials.values()) { releaseBakedLightingPolicy(m); m.dispose(); }
      for (const t of entry.textures) t.dispose();
      entries.delete(id); recent.splice(recent.indexOf(id), 1);
    }
  }
  // Instant stand-in while full-resolution maps are being synthesized.
  function quick(id) {
    const finish = finishById(id), color = entries.get(id)?.average ?? quickColors.get(id) ?? null;
    const m = new MeshStandardMaterial({ color: color ? new Color().setRGB(...color, SRGBColorSpace) : new Color(finish?.recipe.color ?? '#cccccc'), roughness: 0.7 });
    m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; m.name = `interior-quick:${id}`;
    return m;
  }
  function load(id) {
    const finish = finishById(id); if (!finish) return Promise.reject(Error('지원하지 않는 마감이에요.'));
    let entry = entries.get(id);
    if (!entry) {
      entry = { ready: false, materials: new Map(), textures: [], average: null };
      entry.promise = synthesize({ ...finish.recipe, id: finish.id }, HIGH.has(finish.recipe.kind) ? 1024 : 512).then(({ maps }) => {
        entry.textures = [texture(maps.albedo, maps.n, true, maps.size), texture(maps.normal, maps.n, false, maps.size), texture(maps.orm, maps.n, false, maps.size)];
        entry.average = maps.average; entry.size = maps.size; entry.ready = true; return entry;
      }).catch(error => { entries.delete(id); throw error; });
      entries.set(id, entry);
    }
    touch(id); return entry.promise;
  }
  function material(id, bakedSource = null) {
    const entry = entries.get(id); if (!entry?.ready) return null;
    const key = bakedSource ? `baked:${bakedSource.uuid}` : 'plain';
    if (!entry.materials.has(key)) {
      const finish = finishById(id), [map, normalMap, orm] = entry.textures, physical = finish.physical ?? {};
      const m = new MeshPhysicalMaterial({ name: `interior:${id}`, map, normalMap, roughnessMap: orm, aoMap: orm, aoMapIntensity: 1, roughness: 1, metalness: 0,
        clearcoat: physical.clearcoat ?? 0, clearcoatRoughness: 0.06, sheen: physical.sheen ?? 0, sheenRoughness: 0.55, sheenColor: new Color(physical.sheenColor ?? '#ffffff'),
        specularIntensity: finish.category === 'tile' ? 0.7 : 0.45 });
      m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
      m.userData = { interiorFinish: id, appearance_policy: 'authored-pbr-v1' };
      if (bakedSource) inheritBakedLightingPolicy(bakedSource, m);
      entry.materials.set(key, m);
    }
    return entry.materials.get(key);
  }
  async function thumbnail(id) {
    if (thumbs.has(id)) return thumbs.get(id);
    const finish = finishById(id);
    const promise = synthesize({ ...finish.recipe, id: finish.id }, 256, 132).then(({ swatch, maps }) => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 132;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(swatch), 132, 132), 0, 0);
      const url = canvas.toDataURL('image/jpeg', 0.86);
      quickColors.set(id, maps.average);
      return url;
    }).catch(() => null);
    thumbs.set(id, promise); return promise;
  }
  return { load, material, quick, thumbnail, evict, isReady: id => Boolean(entries.get(id)?.ready), averageColor: id => entries.get(id)?.average ?? quickColors.get(id) ?? null,
    inspect: () => ({ cached: [...entries.keys()], ready: [...entries.values()].filter(e => e.ready).length, worker: worker ? 'worker' : worker === false ? 'main-thread' : 'idle' }),
    dispose() { worker?.terminate?.(); for (const e of entries.values()) { for (const m of e.materials.values()) m.dispose(); for (const t of e.textures) t.dispose(); } entries.clear(); } };
}
