import * as THREE from 'three';
import { createComplexContext } from './complex-context.js';
import site from '../../assets/location/acro-river-park/site-context.json';

export const LOCATION = {
  name: '아크로 리버파크', address: '서울 서초구 신반포로15길 19',
  source: 'https://www.acro.co.kr/Posm_main.action?commonMap.CD_BIZ_LND=010366',
  map: 'https://map.naver.com/p/search/'+encodeURIComponent('서울 서초구 신반포로15길 19 아크로리버파크'),
  riverside: new URL('../../assets/location/acro-river-park/official-riverside.jpg',import.meta.url).href,
  night: new URL('../../assets/location/acro-river-park/official-night.jpg',import.meta.url).href,
  initialFloor: 1, maxFloor: 38,
  osm: 'https://www.openstreetmap.org/copyright',
  osmAttribution: '© OpenStreetMap contributors · ODbL 1.0',
};

// Site massing derived from OSM footprints, part levels and height tags.
export function createFloorTower(scene, invalidate, {lazy=false}={}) {
  if(!lazy)return createComplexContext(scene,invalidate);
  // Keep only catalog records until the user actually opens the site visualization.
  let live=null,selectedId='109',floor=1,cutawayEnabled=true,selectionVisible=true;
  const empty=new THREE.Group();
  const records=site.buildings.map(b=>({...b,floors:b.levels,tower:{visible:false},material:{opacity:1,depthWrite:true},facade:{userData:{windowCount:0}}}));
  const ensure=()=>{if(!live){live=createComplexContext(scene,invalidate);live.selectBuilding(selectedId);live.setFloor(floor);live.setCutawayEnabled(cutawayEnabled);live.setSelectionVisible(selectionVisible);}return live;};
  return {ensure,get built(){return Boolean(live);},get group(){return live?.group??empty;},get buildings(){return live?.buildings??records;},get selected(){return live?.selected??records.find(b=>b.id===selectedId)??records[0];},get appearance(){return live?.appearance??{state:'not-loaded'};},
    selectBuilding(id){selectedId=records.some(b=>b.id===String(id))?String(id):records[0].id;return live?live.selectBuilding(selectedId):this.selected;},
    setFloor(n){floor=n===null?null:Number(n);live?.setFloor(floor);},
    setCutawayEnabled(v){cutawayEnabled=Boolean(v);live?.setCutawayEnabled(v);},
    get cutawayEnabled(){return live?.cutawayEnabled??cutawayEnabled;},
    get cutawayState(){return live?.cutawayState??{enabled:cutawayEnabled,active:false};},
    inspectCutaway:()=>live?.inspectCutaway()??{active:false},
    setSelectionVisible(v){selectionVisible=Boolean(v);live?.setSelectionVisible(v);},
    floorHeight:(b,n)=>Math.min(b.height_m,n*b.height_m/b.floors),
    setView:v=>ensure().setView(v),viewpoint:v=>ensure().viewpoint(v),hitTest:r=>ensure().hitTest(r)};
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

export function createExterior(scene,invalidate,onChange,initialLighting='day') {
  const group=new THREE.Group();group.name='Uncalibrated exterior window views';scene.add(group);
  const view=new THREE.Group();view.name='Window view photographs';group.add(view);
  const loader=new THREE.TextureLoader();loader.setCrossOrigin('anonymous');
  const fade=edgeFade(),references=new Map(),domes={};
  let lighting=initialLighting,reference=initialLighting==='night'?'night':'day',overrideNote=null;
  const dome=new THREE.Mesh(new THREE.SphereGeometry(DOME_RADIUS,48,24),new THREE.MeshBasicMaterial({side:THREE.BackSide,toneMapped:false,depthWrite:false,fog:false}));
  dome.position.set(7,EYE,5);dome.renderOrder=-2;view.add(dome);
  function referenceState(){
    const entries=references.get(reference)||[];
    const status=entries.some(e=>e.status==='loading')?'loading':entries.some(e=>e.status==='ready')?'ready':'error';
    const label=lighting==='night'?'밤 참고 사진':lighting==='sunset'?'낮 참고 사진 · 저녁 촬영본 없음':'낮 참고 사진';
    const note=overrideNote??(status==='ready'?`${VIEW_CREDIT} · ${label} · 실제 세대 조망이 아닙니다.`:status==='error'?'창밖 사진을 불러오지 못해 하늘 배경을 표시해요.':'창밖 참고 사진을 불러오는 중…');
    return {lighting,reference,status,custom:Boolean(overrideNote),note};
  }
  function syncReference(){
    view.visible=!overrideNote;
    for(const [key,entries] of references)for(const entry of entries){
      entry.mesh.visible=key===reference&&entry.status==='ready';
      entry.mesh.material.color.setHex(TINT[lighting]??0xffffff);
    }
    domes[reference]??=gradient(VIEWS[reference].sky);
    dome.material.map=domes[reference];dome.material.color.setHex(TINT[lighting]??0xffffff);dome.material.needsUpdate=true;
    onChange?.(referenceState());invalidate();
  }
  function arc(photo,facing){
    const span=THREE.MathUtils.degToRad(photo.span),height=ARC_RADIUS*span/photo.aspect;
    const geometry=new THREE.CylinderGeometry(ARC_RADIUS,ARC_RADIUS,height,96,1,true,-span/2,span);
    const material=new THREE.MeshBasicMaterial({side:THREE.BackSide,toneMapped:false,transparent:true,depthWrite:false,alphaMap:fade,fog:false});
    const mesh=new THREE.Mesh(geometry,material);mesh.position.set(7,EYE+photo.horizon*height-height/2,5);mesh.rotation.y=facing;mesh.renderOrder=-1;mesh.visible=false;view.add(mesh);
    const entry={mesh,status:'loading'};
    const show=texture=>{
      texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=8;
      texture.repeat.x=-1;texture.offset.x=1;material.map=texture;material.needsUpdate=true;
      entry.status='ready';syncReference();
    };
    const failed=()=>{entry.status='error';syncReference();};
    loader.load(photo.url,show,undefined,()=>{if(photo.fallback)loader.load(photo.fallback,show,undefined,failed);else failed();});
    return entry;
  }
  function setLighting(value){
    lighting=value;reference=value==='night'?'night':'day';
    if(!references.has(reference)){
      const photos=VIEWS[reference];references.set(reference,[arc(photos.south,0),arc(photos.north,Math.PI)]);
    }
    // Recompute from current lighting; late previous requests cannot replace it.
    syncReference();
  }
  // Inferred shared landing is hidden for coordinate models with their own entry geometry.
  const wall=new THREE.MeshStandardMaterial({color:0xe4dfd3,roughness:.8});
  const floor=new THREE.MeshStandardMaterial({color:0x9d998c,roughness:.65});
  function box(size,p,m){const o=new THREE.Mesh(new THREE.BoxGeometry(...size),m);o.position.set(...p);o.userData.unitType='112A';group.add(o);}
  box([4,.08,1.9],[2.8,-.04,1.46],floor);
  box([4,2.6,.12],[2.8,1.3,.52],wall);
  box([.12,2.6,1.9],[.8,1.3,1.46],wall);
  box([.12,2.6,1.9],[4.8,1.3,1.46],wall);
  group.visible=false;setLighting(initialLighting);
  return {group,photo:view,setLighting,referenceState,credit:VIEW_CREDIT,
    setReferenceOverride(note=null){overrideNote=note;syncReference();},
    setUnit(unitType){for(const o of group.children)if(o.userData.unitType)o.visible=o.userData.unitType===unitType;}};
}
