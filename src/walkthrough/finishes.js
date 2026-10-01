import { RepeatWrapping, SRGBColorSpace, TextureLoader } from 'three';

export const FINISHES = { original: '원본 마감', oak: '라이트 오크', stone: '웜 스톤' };
const urls = {
  limestone: new URL('../../assets/materials/generated-v1/limestone.png', import.meta.url).href,
  oak: new URL('../../assets/materials/generated-v1/oak.png', import.meta.url).href,
};

export class FinishLibrary {
  constructor(renderer) {
    this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.originals = new WeakMap();
    this.maps = new Map();
    this.assets = null;
  }
  async preload() {
    if (!this.assets) {
      this.assets = Promise.all(Object.entries(urls).map(async ([key, url]) => {
        const map = await new TextureLoader().loadAsync(url);
        map.name = `generated-${key}`;
        map.colorSpace = SRGBColorSpace;
        map.wrapS = map.wrapT = RepeatWrapping;
        map.anisotropy = this.anisotropy;
        return [key, map];
      })).then(Object.fromEntries).catch((error) => { this.assets = null; throw error; });
    }
    return this.assets;
  }
  texture(assets, key, previousRepeat = 1) {
    const id = `${key}:${previousRepeat}`;
    if (!this.maps.has(id)) {
      const map = assets[key].clone();
      // Existing Blender UVs are meters / texture_repeat_m. New samples span 1.2m.
      map.repeat.setScalar(previousRepeat / 1.2);
      map.needsUpdate = true;
      this.maps.set(id, map);
    }
    return this.maps.get(id);
  }
  async apply(model, preset) {
    if (!Object.hasOwn(FINISHES, preset)) throw new Error(`Unknown finish: ${preset}`);
    // Resolve every asset before mutating any material; failures leave the old look intact.
    const assets = preset === 'original' ? null : await this.preload();
    const seen = new Set();
    model.traverse((object) => {
      if (!object.isMesh) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (seen.has(material)) continue;
        seen.add(material);
        if (!this.originals.has(material)) this.originals.set(material, {
          color: material.color.clone(), map: material.map, normalMap: material.normalMap,
          roughness: material.roughness, normalScale: material.normalScale?.clone(),
        });
        const saved = this.originals.get(material);
        material.color.copy(saved.color); material.map = saved.map;
        material.normalMap = saved.normalMap; material.roughness = saved.roughness;
        if (saved.normalScale) material.normalScale.copy(saved.normalScale);
        if (assets) {
          const name = material.name;
          let texture;
          if (/limestone floor|Bedroom light oak/.test(name)) texture = preset === 'oak' ? 'oak' : 'limestone';
          if (/Smoked oak cabinet/.test(name)) texture = 'oak';
          if (/Calacatta bronze stone|Travertine bathroom/.test(name)) texture = 'limestone';
          if (texture) {
            material.map = this.texture(assets, texture, material.userData.texture_repeat_m ?? 1);
            material.color.setHex(0xffffff);
            material.normalMap = null; // the old procedural normals do not describe these images
            material.roughness = texture === 'oak' ? 0.58 : /stone/.test(name) ? 0.4 : 0.65;
          }
          if (/Warm ivory plaster/.test(name)) material.color.setHex(preset === 'oak' ? 0xeee8dd : 0xded8cc);
          if (/Lacquer warm white/.test(name)) material.color.setHex(preset === 'oak' ? 0xe9e5dc : 0xe7e2d9);
        }
        material.needsUpdate = true;
      }
    });
    model.userData.finish = preset;
  }
}
