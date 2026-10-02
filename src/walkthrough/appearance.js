import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const LIGHTING = {
  day: { label: '낮 · 자연광', sky: '#c5d9e1', sun: 3.1, sunColor: 0xfff0d5, position: [2, 7, 16], environment: 0.23, hemisphere: 0.25, indoor: 6, indoorColor: 0xffe9cc, exposure: 1.05 },
  sunset: { label: '해질녘 · 따뜻한 빛', sky: '#d5ad98', sun: 2.3, sunColor: 0xffad67, position: [-5, 3.5, 17], environment: 0.15, hemisphere: 0.16, indoor: 11, indoorColor: 0xffd7a3, exposure: 1.1 },
  night: { label: '밤 · 실내조명', sky: '#101c30', sun: 0.04, sunColor: 0x98b9ef, position: [2, 7, 16], environment: 0.09, hemisphere: 0.08, indoor: 22, indoorColor: 0xffddb1, exposure: 1.1 },
};

export function setupAppearance(renderer, scene, camera) {
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;
  room.dispose(); pmrem.dispose();
  const hemisphere = new THREE.HemisphereLight(0xe7efff, 0xb1a28b, 0.25);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xfff0d5, 3.1);
  sun.target.position.set(7, 0, 4.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 0.5, far: 35 });
  sun.shadow.normalBias = 0.012;
  sun.shadow.bias = -0.00005;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);
  const lights = [];
  for (const [x, z] of [[7.8, 7.2], [7.6, 3], [4.2, 7], [1.3, 7], [11.8, 6], [3.2, 4.8], [12.2, 2.7], [10.5, 3], [4.9, 3.4]]) {
    const light = new THREE.PointLight(0xffe9cc, 6, 6, 2);
    light.position.set(x, 2.4, z);
    scene.add(light); lights.push(light);
  }
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const ao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  ao.updateGtaoMaterial({ radius: 0.25, distanceExponent: 1.5, thickness: 0.8, distanceFallOff: 0.8, samples: 16 });
  ao.blendIntensity = 0.7;
  ao.updatePdMaterial({ radius: 6, samples: 24, lumaPhi: 2 });
  composer.addPass(ao);
  composer.addPass(new OutputPass());
  let quality = 'high', lighting = 'day';
  function resize() {
    const bounds=renderer.domElement.parentElement.getBoundingClientRect();
    const width=Math.max(1,bounds.width),height=Math.max(1,bounds.height);
    const requested = quality === 'ultra' ? 2 : quality === 'high' ? Math.min(devicePixelRatio, 1.5) : 1;
    const ratio = Math.min(requested, 3840 / Math.max(width, height));
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height);
    composer.setPixelRatio(ratio);
    composer.setSize(width, height);
    const aoRatio = quality === 'ultra' ? Math.min(ratio, 1.5) : Math.min(ratio, 1.25) * 0.7;
    ao.setSize(Math.round(width * aoRatio), Math.round(height * aoRatio));
  }
  function setLighting(value) {
    const p = LIGHTING[value];
    if (!p) throw new Error(`Unknown lighting: ${value}`);
    lighting = value;
    scene.background = new THREE.Color(p.sky);
    scene.environmentIntensity = p.environment;
    hemisphere.intensity = p.hemisphere;
    sun.intensity = p.sun; sun.color.setHex(p.sunColor); sun.position.set(...p.position);
    for (const light of lights) { light.intensity = p.indoor; light.color.setHex(p.indoorColor); }
    renderer.toneMappingExposure = p.exposure;
    renderer.shadowMap.needsUpdate = true;
  }
  function setQuality(value) {
    if (!['light', 'high', 'ultra'].includes(value)) throw new Error(`Unknown quality: ${value}`);
    quality = value;
    ao.enabled = value !== 'light';
    const shadowSize = value === 'ultra' ? 4096 : 2048;
    if (sun.shadow.mapSize.x !== shadowSize) {
      sun.shadow.map?.dispose(); sun.shadow.map = null;
      sun.shadow.mapSize.set(shadowSize, shadowSize);
    }
    renderer.shadowMap.needsUpdate = true;
    resize();
  }
  setLighting('day'); resize();
  return {
    render: (dt) => composer.render(dt), resize, setQuality, setLighting,
    invalidateShadows: () => { renderer.shadowMap.needsUpdate = true; },
    get quality() { return quality; }, get lighting() { return lighting; },
    get resolution() { return renderer.getDrawingBufferSize(new THREE.Vector2()).toArray(); },
  };
}

export function refineMaterials(model, renderer) {
  const seen = new Set();
  model.traverse((object) => {
    if (!object.isMesh) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (seen.has(material)) continue;
      seen.add(material);
      if (material.map) material.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      if (material.normalMap) material.normalScale.setScalar(0.45);
      if (material.name.includes('plaster')) material.roughness = 0.92;
      if (material.name.includes('Lacquer')) material.roughness = 0.48;
      if (material.name.includes('limestone')) { material.roughness = 0.52; material.normalScale.setScalar(0.2); }
      if (material.name.includes('Calacatta')) material.roughness = 0.34;
      if (material.name.includes('nickel')) material.roughness = 0.3;
      if (material.emissiveIntensity > 1) material.emissiveIntensity = 1.4;
      material.needsUpdate = true;
    }
  });
}
