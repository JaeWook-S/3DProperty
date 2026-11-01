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
    setFloor(n){floor=Math.max(1,Math.min(this.selected.floors,Number(n)));live?.setFloor(floor);},
    setCutawayEnabled(value){cutawayEnabled=Boolean(value);live?.setCutawayEnabled(cutawayEnabled);},
    get cutawayEnabled(){return live?.cutawayEnabled??cutawayEnabled;},
    setSelectionVisible(value){selectionVisible=Boolean(value);live?.setSelectionVisible(selectionVisible);},
    get cutawayState(){return live?.cutawayState??{enabled:cutawayEnabled,active:false};},
    floorHeight:(b,n)=>Math.min(b.height_m,n*b.height_m/b.floors),
    setView:v=>ensure().setView(v),viewpoint:v=>ensure().viewpoint(v),hitTest:r=>ensure().hitTest(r)};
}

// Reference photographs supply visual context only, not calibrated 22F views.
// Keeping this in the viewer leaves the surveyed room geometry unchanged.
export function createExterior(scene,invalidate,onChange,initialLighting='day') {
  const group=new THREE.Group();group.name='Uncalibrated ACRO exterior reference';scene.add(group);
  const material=new THREE.MeshBasicMaterial({side:THREE.BackSide,toneMapped:false});
  const walls=new THREE.Mesh(new THREE.BoxGeometry(160,90,160),[material,material,new THREE.MeshBasicMaterial({visible:false}),new THREE.MeshBasicMaterial({visible:false}),material,material]);
  walls.position.set(7,-10,5);group.add(walls);
  const textures=new Map(),loader=new THREE.TextureLoader();
  let lighting=initialLighting,reference='day',overrideNote=null;
  const referenceState=()=>{
    const status=textures.get(reference)?.status??'loading';
    const label=lighting==='night'?'밤 참고 사진':lighting==='sunset'?'낮 참고 사진 · 저녁 촬영본 없음':'낮 참고 사진';
    const note=overrideNote??(status==='ready'?`창밖: 아크로 리버파크 공식 ${label} · 실제 세대 조망이 아닙니다.`:status==='error'?'창밖 사진을 불러오지 못해 하늘 배경을 표시해요.':'창밖 참고 사진을 불러오는 중…');
    return {lighting,reference,status,custom:Boolean(overrideNote),note};
  };
  function syncReference(){
    const entry=textures.get(reference);
    material.map=entry?.status==='ready'?entry.texture:null;
    material.needsUpdate=true;
    walls.visible=!overrideNote&&entry?.status==='ready';
    onChange?.(referenceState());invalidate();
  }
  function setLighting(value){
    lighting=value;reference=value==='night'?'night':'day';
    // Cache both photos. A delayed previous request must never restore the wrong time of day.
    if(!textures.has(reference)){
      const key=reference,entry={status:'loading',texture:null};textures.set(key,entry);
      entry.texture=loader.load(key==='night'?LOCATION.night:LOCATION.riverside,()=>{
        entry.status='ready';if(reference===key)syncReference();
      },undefined,()=>{entry.status='error';if(reference===key)syncReference();});
      entry.texture.colorSpace=THREE.SRGBColorSpace;
    }
    syncReference();
  }
  // A small inferred shared landing is visible through the entry door. It is
  // visual context only: the existing apartment traversal boundary is retained.
  const wall=new THREE.MeshStandardMaterial({color:0xe4dfd3,roughness:.8});
  const floor=new THREE.MeshStandardMaterial({color:0x9d998c,roughness:.65});
  function box(size,p,m){const o=new THREE.Mesh(new THREE.BoxGeometry(...size),m);o.position.set(...p);o.userData.unitType='112A';group.add(o);}
  box([4,.08,1.9],[2.8,-.04,1.46],floor);
  box([4,2.6,.12],[2.8,1.3,.52],wall);
  box([.12,2.6,1.9],[.8,1.3,1.46],wall);
  box([.12,2.6,1.9],[4.8,1.3,1.46],wall);
  group.visible=false;
  setLighting(initialLighting);
  // An uploaded panorama owns the view and its label until the user resets it.
  return {group,photo:walls,setLighting,referenceState,
    setReferenceOverride(note=null){overrideNote=note;syncReference();},
    setUnit(unitType){for(const o of group.children)if(o.userData.unitType)o.visible=o.userData.unitType===unitType;}};
}
