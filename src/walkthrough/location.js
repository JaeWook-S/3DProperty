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

// Window views: real photographs set far outside the windows so they read like a view, not a
// backdrop. The south windows look onto the Han river from a high floor (Unsplash photos), the
// north windows onto the complex (ACRO official photos). Each photo sits on a distant arc with
// its horizon at eye level, and a sky-to-ground gradient taken from the photo fills the rest of
// the view. Night uses night photos; sunset warms the day ones. These are reference views, not
// calibrated 22F views; the surveyed room geometry is unchanged.
// Inside the 350 m far plane the studio uses while walking.
const EYE=1.6,ARC_RADIUS=200,DOME_RADIUS=320;
const unsplash=photo=>`https://images.unsplash.com/${photo}?w=4096&q=82&auto=format&fm=jpg`;
// aspect: width/height; horizon: where the horizon sits, from the top (0–1); span: degrees of arc.
const VIEWS={
  day:{
    south:{url:unsplash('photo-1634750773272-747605941f05'),fallback:LOCATION.riverside,aspect:5332/3554,horizon:.42,span:100},
    north:{url:LOCATION.riverside,aspect:16/9,horizon:.62,span:90},
    sky:['#9fb4d6','#c4cfe1','#8fa3bd','#6b84a3','#4f7fae'],
  },
  night:{
    south:{url:unsplash('photo-1556513583-a50f8a1a0b34'),fallback:LOCATION.night,aspect:3840/2151,horizon:.48,span:100},
    north:{url:LOCATION.night,aspect:16/9,horizon:.42,span:90},
    sky:['#29292d','#4b4845','#3a2f26','#2a2622','#15130f'],
  },
};
const TINT={day:0xffffff,sunset:0xffc9a6,night:0xffffff};
const VIEW_CREDIT='창밖: 한강 사진(Unsplash · Yujin Seo, Ethan Brooke), 단지 사진(ACRO 공식)';

// Opaque in the middle, fading to the sides and top so the photo melts into the gradient.
function edgeFade(){
  const c=document.createElement('canvas');c.width=256;c.height=256;const g=c.getContext('2d');
  const x=g.createLinearGradient(0,0,256,0);x.addColorStop(0,'#000');x.addColorStop(.14,'#fff');x.addColorStop(.86,'#fff');x.addColorStop(1,'#000');
  g.fillStyle=x;g.fillRect(0,0,256,256);
  g.globalCompositeOperation='multiply';
  const y=g.createLinearGradient(0,0,0,256);y.addColorStop(0,'#000');y.addColorStop(.2,'#fff');y.addColorStop(.94,'#fff');y.addColorStop(1,'#000');
  g.fillStyle=y;g.fillRect(0,0,256,256);
  return new THREE.CanvasTexture(c);
}
function gradient(stops){
  const c=document.createElement('canvas');c.width=4;c.height=512;const g=c.getContext('2d');
  const v=g.createLinearGradient(0,0,0,512);[0,.47,.5,.56,1].forEach((at,i)=>v.addColorStop(at,stops[i]));
  g.fillStyle=v;g.fillRect(0,0,4,512);
  const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

export function createExterior(scene,invalidate,onLoad) {
  const group=new THREE.Group();group.name='Exterior window views';scene.add(group);
  const view=new THREE.Group();view.name='Window view photographs';group.add(view);
  const loader=new THREE.TextureLoader();loader.setCrossOrigin('anonymous');
  const fade=edgeFade();
  const dome=new THREE.Mesh(new THREE.SphereGeometry(DOME_RADIUS,48,24),new THREE.MeshBasicMaterial({side:THREE.BackSide,toneMapped:false,depthWrite:false,fog:false}));
  dome.position.set(7,EYE,5);dome.renderOrder=-2;view.add(dome);
  const domes={};
  // One arc per photo, centred on the unit and facing outward from it (south +z, north −z).
  function arc(photo,facing){
    const span=THREE.MathUtils.degToRad(photo.span),height=ARC_RADIUS*span/photo.aspect;
    const geometry=new THREE.CylinderGeometry(ARC_RADIUS,ARC_RADIUS,height,96,1,true,-span/2,span);
    const material=new THREE.MeshBasicMaterial({side:THREE.BackSide,toneMapped:false,transparent:true,depthWrite:false,alphaMap:fade,fog:false});
    const mesh=new THREE.Mesh(geometry,material);
    mesh.position.set(7,EYE+photo.horizon*height-height/2,5);mesh.rotation.y=facing;mesh.renderOrder=-1;mesh.visible=false;
    const show=(texture)=>{texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=8;
      // Seen from inside the arc the image would read mirrored; flip it back.
      texture.repeat.x=-1;texture.offset.x=1;material.map=texture;material.needsUpdate=true;invalidate();};
    loader.load(photo.url,(texture)=>{show(texture);onLoad?.(true);},undefined,()=>{
      if(photo.fallback)loader.load(photo.fallback,show);else onLoad?.(false);});
    view.add(mesh);return mesh;
  }
  const arcs={};
  for(const [key,v] of Object.entries(VIEWS))arcs[key]=[arc(v.south,0),arc(v.north,Math.PI)];
  function setLighting(value){
    const key=value==='night'?'night':'day';
    for(const [name,meshes] of Object.entries(arcs))for(const mesh of meshes){mesh.visible=name===key;mesh.material.color.setHex(TINT[value]??0xffffff);}
    domes[key]??=gradient(VIEWS[key].sky);
    dome.material.map=domes[key];dome.material.color.setHex(TINT[value]??0xffffff);dome.material.needsUpdate=true;
    invalidate();
  }
  setLighting('day');
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
  // `photo` lets src/window-view swap the photographs for a viewer's own 360° panorama.
  return {group,photo:view,setLighting,credit:VIEW_CREDIT};
}
