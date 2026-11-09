import { inheritBakedLightingPolicy, releaseBakedLightingPolicy } from './baked-lighting-policy.js';
import { FrontSide, NoColorSpace, RepeatWrapping, SRGBColorSpace, TangentSpaceNormalMap, TextureLoader } from 'three';

// Existing project-authored CPU PBR samples. No API, inference or first-map load.
const urls = {
  plasterMR: new URL('../../assets/models/acro-river-park/168c/archisketch-pbr-candidate-v1/expanded/maps/plaster-metallicRoughness.png', import.meta.url).href,
  plasterNormal: new URL('../../assets/models/acro-river-park/168c/archisketch-pbr-candidate-v1/expanded/maps/plaster-normal.png', import.meta.url).href,
  stoneColor: new URL('../../assets/models/acro-river-park/168c/archisketch-pbr-candidate-v1/expanded/maps/counter-basecolor.png', import.meta.url).href,
  stoneMR: new URL('../../assets/models/acro-river-park/168c/archisketch-pbr-candidate-v1/expanded/maps/counter-metallicRoughness.png', import.meta.url).href,
  stoneNormal: new URL('../../assets/models/acro-river-park/168c/archisketch-pbr-candidate-v1/expanded/maps/counter-normal.png', import.meta.url).href,
};
export const SURFACE_MATERIALS = Object.freeze([
  { id: 'original', name: '원본', detail: '선택한 면 복원', swatch: 'original', maps: [] },
  { id: 'ivory-plaster-v1', name: '아이보리 미장', detail: '부드러운 무광', swatch: 'ivory', maps: ['plasterMR', 'plasterNormal'], color: [.78, .755, .70] },
  { id: 'greige-plaster-v1', name: '그레이지 미장', detail: '차분한 무광', swatch: 'greige', maps: ['plasterMR', 'plasterNormal'], color: [.42, .395, .36] },
  { id: 'warm-stone-v1', name: '웜 스톤', detail: '은은한 석재결', swatch: 'stone', maps: ['stoneColor', 'stoneMR', 'stoneNormal'], color: [1, 1, 1] },
]);
export const surfaceMaterial = id => SURFACE_MATERIALS.find(m => m.id === id);

export class SurfaceMaterialLibrary {
  constructor({ anisotropy = 4, loadTexture = url => new TextureLoader().loadAsync(url) } = {}) {
    this.anisotropy = anisotropy; this.loadTexture = loadTexture; this.cache = new Map();
  }
  async load(id) {
    const preset = surfaceMaterial(id); if (!preset) throw Error('지원하지 않는 마감입니다.');
    const entries = await Promise.all(preset.maps.map(async key => {
      if (!this.cache.has(key)) {
        const pending = this.loadTexture(urls[key]).then(texture => {
          texture.name = `surface-sample:${key}`;
          texture.colorSpace = key === 'stoneColor' ? SRGBColorSpace : NoColorSpace;
          texture.flipY = false; texture.wrapS = texture.wrapT = RepeatWrapping; texture.anisotropy = this.anisotropy;
          texture.needsUpdate = true; return texture;
        }).catch(error => { this.cache.delete(key); throw error; });
        this.cache.set(key, pending);
      }
      return [key, await this.cache.get(key)];
    }));
    return { preset, maps: Object.fromEntries(entries) };
  }
  material(asset, source, geometry) {
    const material = source.clone(), textures = new Map();
    const tile = Number(source.userData.texture_repeat_m) || 1.2;
    const sample = key => {
      const base = asset.maps[key]; if (!base) return null;
      if (!textures.has(base)) {
        const texture = base.clone(); texture.repeat.setScalar(tile / 1.2); texture.channel = 0;
        texture.needsUpdate = true; textures.set(base, texture);
      }
      return textures.get(base);
    };
    material.color.setRGB(...asset.preset.color); // declared linear factors
    material.map = sample('stoneColor');
    material.roughnessMap = material.metalnessMap = sample(asset.maps.stoneMR ? 'stoneMR' : 'plasterMR');
    material.normalMap = sample(asset.maps.stoneNormal ? 'stoneNormal' : 'plasterNormal');
    material.aoMap = null; material.aoMapIntensity = 1;
    material.roughness = 1; material.metalness = 0; // roughness is already baked in MR.G
    material.normalMapType = TangentSpaceNormalMap;
    // Match GLTFLoader's basis for these OpenGL +Y samples. Original materials
    // and their signed normalScale are never edited or forced to (1,1).
    material.normalScale.set(1, geometry.hasAttribute('tangent') ? 1 : -1);
    material.side = FrontSide; material.transparent = false; material.opacity = 1;
    material.polygonOffset = true; material.polygonOffsetFactor = -2; material.polygonOffsetUnits = -2;
    material.userData = { ...source.userData, appearance_policy: 'authored-pbr-v1', surfaceMaterial: asset.preset.id };
    inheritBakedLightingPolicy(source, material);
    material.needsUpdate = true;
    return { material, dispose() { releaseBakedLightingPolicy(material); material.dispose(); for (const texture of textures.values()) texture.dispose(); } };
  }
}
