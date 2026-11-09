import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { createInteriorLightRig } from './interior-light-rig.js';

export const LIGHTING = {
  day: { label: '낮 · 자연광', sky: '#c5d9e1', sun: 3.1, sunColor: 0xfff0d5, position: [2, 7, 16], environment: 0.23, hemisphere: 0.25, indoor: 6, indoorColor: 0xffe9cc, exposure: 1.05 },
  sunset: { label: '해질녘 · 따뜻한 빛', sky: '#d5ad98', sun: 2.3, sunColor: 0xffad67, position: [-5, 3.5, 17], environment: 0.15, hemisphere: 0.16, indoor: 11, indoorColor: 0xffd7a3, exposure: 1.1 },
  night: { label: '밤 · 실내조명', sky: '#101c30', sun: 0.04, sunColor: 0x98b9ef, position: [2, 7, 16], environment: 0.09, hemisphere: 0.08, indoor: 22, indoorColor: 0xffddb1, exposure: 1.1 },
};

export function setupAppearance(renderer, scene, camera) {
  RectAreaLightUniformsLib.init();
  const interiorRig=createInteriorLightRig();scene.add(interiorRig.group);
  let mode='overview',activeLightCount=9;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  const softSky=new THREE.Scene();softSky.background=new THREE.Color().setRGB(.72,.78,.83);
  const interiorEnvironment=pmrem.fromScene(softSky,.04);
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
  const defaultLightPositions = [[7.8, 7.2], [7.6, 3], [4.2, 7], [1.3, 7], [11.8, 6], [3.2, 4.8], [12.2, 2.7], [10.5, 3], [4.9, 3.4]];
  for (const [x, z] of defaultLightPositions) {
    const light = new THREE.PointLight(0xffe9cc, 6, 6, 2);
    light.position.set(x, 2.4, z);
    scene.add(light); lights.push(light);
  }
  // The default path renders directly. Allocate AO/MSAA buffers only on request.
  let composer=null,ao=null,quality='balanced',lighting='day',resizeKey='';
  const usesAO=()=>quality==='high'||quality==='ultra'||(quality==='balanced'&&mode==='tour');
  const stats={frames:0,calls:0,triangles:0,shadowUpdates:0,cpuMs:0};
  renderer.info.autoReset=false;
  function ensureComposer(){
    if(composer)return;
    const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples:4});
    composer=new EffectComposer(renderer,target);
    composer.addPass(new RenderPass(scene,camera));
    ao=new GTAOPass(scene,camera,1,1);
    ao.updateGtaoMaterial({radius:.32,distanceExponent:1.5,thickness:.3,distanceFallOff:.8,samples:12});
    ao.blendIntensity=.65;ao.updatePdMaterial({radius:4,samples:12,lumaPhi:2});
    composer.addPass(ao);composer.addPass(new OutputPass());
    resizeKey='';
  }
  function resize() {
    const bounds=renderer.domElement.parentElement.getBoundingClientRect();
    const width=Math.max(1,Math.round(bounds.width)),height=Math.max(1,Math.round(bounds.height));
    const requested=quality==='ultra'?2:quality==='high'?Math.min(devicePixelRatio,1.5):quality==='balanced'?Math.min(devicePixelRatio,1.25):1;
    const ratio=Math.min(requested,3840/Math.max(width,height));
    const key=[width,height,ratio,quality,mode].join(':');
    if(key===resizeKey)return;resizeKey=key;
    renderer.setPixelRatio(ratio);renderer.setSize(width,height);
    if(usesAO()){
      ensureComposer();
      composer.setPixelRatio(ratio);composer.setSize(width,height);
      const aoRatio=quality==='ultra'?Math.min(ratio,1.5):quality==='balanced'?.5:Math.min(ratio,1.25)*.7;
      ao.setSize(Math.round(width*aoRatio),Math.round(height*aoRatio));
    }
  }
  let modelOffset=[0,0];
  function setModel(info) {
    interiorRig.setModel(info);
    const positions=info.lightPositions || defaultLightPositions;activeLightCount=positions.length;
    while(lights.length<positions.length){const light=new THREE.PointLight(0xffe9cc,6,7,2);scene.add(light);lights.push(light);}
    lights.forEach((light,i)=>{light.visible=i<positions.length;if(light.visible)light.position.set(positions[i][0],(info.ceilingHeight_m??2.6)-.2,positions[i][1]);});
    const b=info.bounds_m || [0,0,14,9],cx=(b[0]+b[2])/2,cz=(b[1]+b[3])/2;
    modelOffset=[cx-7,cz-4.5];sun.target.position.set(cx,0,cz);
    const half=Math.max(10,(b[2]-b[0])/2+2);Object.assign(sun.shadow.camera,{left:-half,right:half,top:half,bottom:-half,far:50});sun.shadow.camera.updateProjectionMatrix();
    setLighting(lighting);
  }
  function setLighting(value) {
    const p = LIGHTING[value];
    if (!p) throw new Error(`Unknown lighting: ${value}`);
    lighting = value;
    scene.background = new THREE.Color(p.sky);
    scene.environmentIntensity = p.environment;
    hemisphere.intensity = p.hemisphere;
    sun.intensity = p.sun; sun.color.setHex(p.sunColor); sun.position.set(p.position[0]+modelOffset[0],p.position[1],p.position[2]+modelOffset[1]);
    for (const light of lights) { light.intensity = p.indoor; light.color.setHex(p.indoorColor); }
    interiorRig.setLighting(value);
    const interior=mode==='tour';interiorRig.setEnabled(interior);
    lights.forEach((light,i)=>{light.visible=!interior&&i<activeLightCount;});
    renderer.toneMapping=interior?THREE.AgXToneMapping:THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=interior?1:p.exposure;
    scene.environment=interior?interiorEnvironment.texture:environment.texture;
    hemisphere.color.setHex(interior?0xfff3e6:0xe7efff);hemisphere.groundColor.setHex(interior?0xd4c9b3:0xb1a28b);
    if(interior){scene.environmentIntensity=value==='day'?.55:value==='sunset'?.35:.15;hemisphere.intensity=value==='day'?.4:.25;}
    renderer.shadowMap.needsUpdate = true;
  }
  function setQuality(value) {
    if (!['light', 'balanced', 'high', 'ultra'].includes(value)) throw new Error(`Unknown quality: ${value}`);
    quality = value;
    if(value==='high'||value==='ultra')ensureComposer();
    const shadowSize=value==='ultra'?4096:value==='high'?2048:value==='balanced'?1024:512;
    if (sun.shadow.mapSize.x !== shadowSize) {
      sun.shadow.map?.dispose(); sun.shadow.map = null;
      sun.shadow.mapSize.set(shadowSize, shadowSize);
    }
    renderer.shadowMap.needsUpdate = true;
    resize();
  }
  setLighting('day'); resize();
  return {
    render(dt) {
      const start=performance.now();renderer.info.reset();
      if(renderer.shadowMap.needsUpdate)stats.shadowUpdates++;
      const restoreContext = scene.userData.contextAppearance?.(renderer);
      try {
        if(usesAO()){ensureComposer();composer.render(dt);}
        else renderer.render(scene,camera);
      } finally { restoreContext?.(); }
      stats.frames++;stats.calls=renderer.info.render.calls;stats.triangles=renderer.info.render.triangles;stats.cpuMs=performance.now()-start;
    }, resize, setQuality, setLighting, setModel,
    setMode(next){if(mode===next)return;mode=next;setLighting(lighting);resize();},
    updateFocus(position){return interiorRig.updateFocus(position);},
    get pathtraceLights(){
      const areas=interiorRig.createPathtraceLights();
      // Independent path-tracing calibration; source powers remain documented.
      for(const light of areas)light.intensity*=1.77;
      const direct=sun.clone();direct.target=sun.target.clone();
      if(lighting==='day'){direct.color.setRGB(1,1,1);direct.intensity=1.8;direct.position.copy(direct.target.position).add(new THREE.Vector3(-.42332062,.87992316,.21571942).multiplyScalar(20));}
      return [...areas,direct];
    },
    get interiorLighting(){return interiorRig.inspect();},
    get stats(){return {...stats};},
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
      // glTF material extras opt authored PBR sets out of legacy look adjustments.
      // Keep this explicit so existing unmarked models retain their current look.
      if (material.userData.appearance_policy !== 'authored-pbr-v1') {
        if (material.normalMap) material.normalScale.set(.45,(Math.sign(material.normalScale.y)||1)*.45);
        if (material.name.includes('plaster')) material.roughness = 0.92;
        if (material.name.includes('Lacquer')) material.roughness = 0.48;
        if (material.name.includes('limestone')) { material.roughness = 0.52; material.normalScale.set(.2,(Math.sign(material.normalScale.y)||1)*.2); }
        if (material.name.includes('Calacatta')) material.roughness = 0.34;
        if (material.name.includes('nickel')) material.roughness = 0.3;
        if (material.emissiveIntensity > 1) material.emissiveIntensity = 1.4;
        // Keep legacy glazing clear without replacing authored transmission or normals.
        if (material.name.includes('Window glass')) {
          material.transmission = 0; material.transparent = true; material.opacity = 0.06; material.depthWrite = false;
          material.roughness = 0.35; if ('specularIntensity' in material) material.specularIntensity = 0.04;
        }
      }
      material.needsUpdate = true;
    }
  });
}
