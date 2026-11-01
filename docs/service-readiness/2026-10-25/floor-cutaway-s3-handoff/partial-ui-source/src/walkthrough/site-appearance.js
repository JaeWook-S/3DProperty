import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const skyUrl = new URL('../../assets/location/environments/kloofendal_48d_partly_cloudy_puresky_1k.hdr', import.meta.url).href;

// Scope the outdoor look to one render call. Interior controls, model loading and
// quality changes always see their own original scene state between frames.
export function installSiteAppearance(scene, group, invalidate = () => {}) {
  let sky = null, state = 'loading';
  const fallback = new THREE.Color(0xb4cddd);
  const fog = new THREE.Fog(0xc5d5dc, 750, 1500);
  new HDRLoader().load(skyUrl, texture => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.name = 'Poly Haven / Kloofendal 48d Partly Cloudy Pure Sky / CC0';
    sky = texture; state = 'ready'; invalidate();
  }, undefined, () => { state = 'fallback'; invalidate(); });

  scene.userData.contextAppearance = renderer => {
    if (!group.visible) return null;
    const previous = {
      background: scene.background, environment: scene.environment, fog: scene.fog,
      backgroundIntensity: scene.backgroundIntensity, backgroundBlurriness: scene.backgroundBlurriness,
      environmentIntensity: scene.environmentIntensity, exposure: renderer.toneMappingExposure,
      localClippingEnabled: renderer.localClippingEnabled,
    };
    const lights = scene.children.filter(object => object.isLight).map(light => [light, light.visible]);
    lights.forEach(([light]) => { light.visible = false; });
    scene.background = sky || fallback;
    if (sky) scene.environment = sky;
    scene.backgroundIntensity = .8; scene.backgroundBlurriness = 0;
    scene.environmentIntensity = .75; scene.fog = fog; renderer.toneMappingExposure = .95;
    renderer.localClippingEnabled = true;
    return () => {
      scene.background = previous.background; scene.environment = previous.environment; scene.fog = previous.fog;
      scene.backgroundIntensity = previous.backgroundIntensity; scene.backgroundBlurriness = previous.backgroundBlurriness;
      scene.environmentIntensity = previous.environmentIntensity; renderer.toneMappingExposure = previous.exposure;
      renderer.localClippingEnabled = previous.localClippingEnabled;
      lights.forEach(([light, visible]) => { light.visible = visible; });
    };
  };
  return { get state() { return state; }, source: 'https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky' };
}
