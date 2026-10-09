import * as THREE from 'three';
import { createComplexContext } from './complex-context.js';

export const LOCATION = {
  name: '아크로 리버파크', address: '서울 서초구 신반포로15길 19',
  source: 'https://www.acro.co.kr/Posm_main.action?commonMap.CD_BIZ_LND=010366',
  map: 'https://map.naver.com/p/search/'+encodeURIComponent('서울 서초구 신반포로15길 19 아크로리버파크'),
  riverside: new URL('../../assets/location/acro-river-park/official-riverside.jpg',import.meta.url).href,
  night: new URL('../../assets/location/acro-river-park/official-night.jpg',import.meta.url).href,
  demoFloor: 22, maxFloor: 38,
};

// Detailed selection facade, not a reconstruction of a particular surveyed tower.
export function createFloorTower(scene) {
  return createComplexContext(scene);
}

// Reference photographs supply visual context only, not calibrated 22F views.
// Keeping this in the viewer leaves the surveyed room geometry unchanged.
export function createExterior(scene,invalidate,onLoad) {
  const group=new THREE.Group();group.name='Uncalibrated ACRO exterior reference';scene.add(group);
  const map=new THREE.TextureLoader().load(LOCATION.night,()=>{onLoad?.(true);invalidate();},undefined,()=>onLoad?.(false));
  map.colorSpace=THREE.SRGBColorSpace;
  const material=new THREE.MeshBasicMaterial({map,side:THREE.BackSide,toneMapped:false});
  const walls=new THREE.Mesh(new THREE.BoxGeometry(160,90,160),[material,material,new THREE.MeshBasicMaterial({visible:false}),new THREE.MeshBasicMaterial({visible:false}),material,material]);
  walls.position.set(7,-10,5);group.add(walls);
  // A small inferred shared landing is visible through the entry door. It is
  // visual context only: the existing apartment traversal boundary is retained.
  const wall=new THREE.MeshStandardMaterial({color:0xe4dfd3,roughness:.8});
  const floor=new THREE.MeshStandardMaterial({color:0x9d998c,roughness:.65});
  function box(size,p,m){const o=new THREE.Mesh(new THREE.BoxGeometry(...size),m);o.position.set(...p);group.add(o);}
  box([4,.08,1.9],[2.8,-.04,1.46],floor);
  box([4,2.6,.12],[2.8,1.3,.52],wall);
  box([.12,2.6,1.9],[.8,1.3,1.46],wall);
  box([.12,2.6,1.9],[4.8,1.3,1.46],wall);
  group.visible=false;
  return {group};
}
