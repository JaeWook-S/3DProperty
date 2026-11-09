import { ShaderChunk } from 'three';

const policies = new WeakMap();
const decodedLightMap = range => `
ivec2 lmSize=textureSize(lightMap,0); vec2 lmPos=vLightMapUv*vec2(lmSize)-0.5;
ivec2 lmBase=ivec2(floor(lmPos));vec2 lmFrac=fract(lmPos);
vec4 lmA=texelFetch(lightMap,clamp(lmBase,ivec2(0),lmSize-1),0);
vec4 lmB=texelFetch(lightMap,clamp(lmBase+ivec2(1,0),ivec2(0),lmSize-1),0);
vec4 lmC=texelFetch(lightMap,clamp(lmBase+ivec2(0,1),ivec2(0),lmSize-1),0);
vec4 lmD=texelFetch(lightMap,clamp(lmBase+ivec2(1,1),ivec2(0),lmSize-1),0);
vec4 lightMapTexel=vec4(mix(mix(lmA.rgb*lmA.a,lmB.rgb*lmB.a,lmFrac.x),mix(lmC.rgb*lmC.a,lmD.rgb*lmD.a,lmFrac.x),lmFrac.y)*${Number(range).toFixed(4)},1.0);`;

/** Indirect diffuse only. Realtime direct light and specular stay interactive.
 * This bake does not re-solve colour bleeding when a user changes a finish. */
export function applyBakedLightingPolicy(material, state) {
  policies.set(material, state); state.materials.add(material);
  material.onBeforeCompile = shader => {
    const baked = ShaderChunk.lights_fragment_maps
      .replace('iblIrradiance += getIBLIrradiance( geometryNormal );', '// Baked diffuse replaces uniform ambient diffuse.')
      .replace('vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );', decodedLightMap(state.range));
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_maps>',
      '#ifdef USE_LIGHTMAP\nirradiance=vec3(0.0);\n'+baked+'\n#else\n'+ShaderChunk.lights_fragment_maps+'\n#endif');
  };
  material.customProgramCacheKey = () => `cortex-indirect-rgbm-v1:${state.range}`;
  syncBakedLightingPolicy(material);
  return material;
}
export function inheritBakedLightingPolicy(source, target) {
  const state = policies.get(source); if (state) applyBakedLightingPolicy(target, state);
  return target;
}
export function syncBakedLightingPolicy(material) {
  const state = policies.get(material); if (!state) return;
  const map = state.enabled ? state.atlas : null;
  if (material.lightMap !== map) { material.lightMap = map; material.needsUpdate = true; }
  material.lightMapIntensity = Math.PI;
}
export function bakedLightingPolicy(material) { return policies.get(material); }
export function releaseBakedLightingPolicy(material) { const state=policies.get(material); state?.materials.delete(material); policies.delete(material); }
