import {serviceBaseForPage} from '../property/service-endpoints.js';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createComplexContext} from './complex-context.js';
import {installFloorControl} from './floor-control.js';
import {normalizeSelection,readSelection,writeSelection} from '../property/service-selection.js';
import {getBuildingUnits,getFloorUnits,lookupUnit,getUnitModelVariants,variantForUnit} from '../property/unit-catalog.js';
import './site-tour.css';

serviceBaseForPage(location.href,import.meta.env.VITE_SERVICE_BASE_URL);
const $=id=>document.getElementById(id);
let selection=readSelection(location.href),view='site',visible=true,dirty=true,cameraOffset=0,previous=performance.now(),cutawayWanted=true,rendererClippingDuringFrame=false;
selection.locationId='acro-river-park';selection.locationName='아크로리버파크';selection.serviceView='site';
const parentOrigin=new URL(document.referrer||location.href).origin;
function post(type,extra={}){if(parent!==window)parent.postMessage({type,...extra},parentOrigin);}
function save(){selection=normalizeSelection(selection);history.replaceState(null,'',writeSelection(location.href,selection));post('cortex:selection',{selection});}
document.body.className='site-tour';document.body.innerHTML=`<main id="site-tour"><header><div><small>01 / EXPLORE THE COMPLEX</small><h1>아크로리버파크 <span>3D 단지투어</span></h1></div><button id="tour-back">← 지도</button></header><section id="tour-canvas" aria-label="아크로리버파크 3D 단지"><div id="tour-views" role="group" aria-label="단지 시점"><button data-view="site">단지 전체</button><button data-view="focus">선택 동</button><button data-view="river">강변 방향</button><button data-view="street">도로 방향</button></div><button id="tour-cutaway" type="button" aria-pressed="false" disabled>위층 숨기기</button><div id="tour-tip">동 번호를 눌러 시작하세요.<small>드래그 회전 · 휠/두 손가락 확대</small></div><p id="tour-loading" role="status">단지를 준비하고 있습니다…</p><div id="tour-floor-rail" aria-label="층 선택"></div><div id="tour-credit"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a><details class="tour-source-details"><summary>출처</summary><div class="tour-source-panel"><p id="tour-basis">건물 위치·외형: OpenStreetMap. 외벽·창호·조경은 참고 디자인입니다.</p><a href="https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky" target="_blank" rel="noopener">하늘·반사 · Poly Haven CC0 ↗</a></div></details></div></section><aside id="tour-controls"><div class="tour-step"><span>1</span><label for="tour-building">둘러볼 동<select id="tour-building"><option value="">동을 선택하세요</option></select></label></div><div class="tour-step"><span>2</span><div><label for="tour-floor">층 선택 <strong id="tour-floor-value">미선택</strong></label><div class="tour-floor-adjust"><button id="tour-down" aria-label="한 층 아래">−</button><input id="tour-floor" type="range" min="1" max="38" value="1" disabled><button id="tour-up" aria-label="한 층 위">＋</button></div></div></div><p id="tour-unit-note">동과 층을 고른 뒤 호수를 선택하세요.</p><button id="tour-plan" disabled>동·층을 고른 후 평면 보기 →</button></aside></main>`;
try{
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(47,1,.5,1800);
 const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'low-power'});renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.shadowMap.autoUpdate=false;renderer.setPixelRatio(Math.min(devicePixelRatio,innerWidth<650?1:1.5));$('tour-canvas').prepend(renderer.domElement);
 const controls=new OrbitControls(camera,renderer.domElement);controls.minDistance=55;controls.maxDistance=950;controls.maxPolarAngle=Math.PI*.48;controls.enableDamping=true;controls.dampingFactor=.1;controls.addEventListener('change',()=>dirty=true);
 const tower=createComplexContext(scene,()=>dirty=true);tower.group.visible=true;renderer.shadowMap.needsUpdate=true;
 const unitStep=document.createElement('div');unitStep.className='tour-step';unitStep.id='tour-unit-step';unitStep.innerHTML='<span>3</span><label for="tour-unit">호수 선택<select id="tour-unit" disabled><option value="">동·층을 먼저 선택하세요</option></select></label>';
 const variantStep=document.createElement('div');variantStep.className='tour-step';variantStep.id='tour-variant-step';variantStep.hidden=true;variantStep.innerHTML='<span>4</span><label for="tour-variant">기본형 / 확장형 비교<select id="tour-variant"></select></label>';
 $('tour-controls').insertBefore(unitStep,$('tour-unit-note'));$('tour-controls').insertBefore(variantStep,$('tour-unit-note'));
 const maxFloor=building=>Math.max(building.floors,...getBuildingUnits(building.id).map(unit=>unit.floor));
 const selectedUnit=()=>lookupUnit(selection.building,selection.floor,selection.unit);
 function reconcile(next){
  next=normalizeSelection(next);next.locationId='acro-river-park';next.locationName='아크로리버파크';next.serviceView='site';
  const building=tower.buildings.find(item=>item.id===next.building);
  if(!building){next.building='';next.floor=null;next.unit='';next.unitType='unknown';return next;}
  if(next.floor!==null)next.floor=Math.max(1,Math.min(maxFloor(building),next.floor));
  const unit=lookupUnit(next.building,next.floor,next.unit);
  if(!unit){next.unit='';next.unitType='unknown';}
  else{next.unitType=unit.type;const variant=variantForUnit(unit,next.sampleVariant);if(variant)next.sampleVariant=variant;}
  return next;
 }
 for(const building of tower.buildings){const o=document.createElement('option');o.value=building.id;o.textContent=building.title;$('tour-building').append(o);}
 function resize(){const r=$('tour-canvas').getBoundingClientRect();if(!r.width||!r.height)return;renderer.setSize(r.width,r.height);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();dirty=true;}
 new ResizeObserver(resize).observe($('tour-canvas'));
 function frame(next){view=next;cameraOffset=0;tower.setView(view);const pose=tower.viewpoint(view);camera.position.fromArray(pose.position);controls.target.fromArray(pose.target);controls.update();for(const b of document.querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',String(b.dataset.view===view));dirty=true;renderer.shadowMap.needsUpdate=true;}
 function sync(){
  const chosen=Boolean(selection.building),floorChosen=chosen&&selection.floor!==null,maximum=maxFloor(tower.selected),beyondEnvelope=floorChosen&&selection.floor>tower.selected.floors;
  $('tour-building').value=selection.building;$('tour-floor').disabled=!chosen;$('tour-floor').max=maximum;$('tour-floor').value=selection.floor??1;$('tour-floor-value').textContent=floorChosen?`${selection.floor}층`:'미선택';$('tour-down').disabled=!chosen||selection.floor===1;$('tour-up').disabled=!chosen||selection.floor===maximum;
  // Higher catalog floors remain selectable without inventing taller OSM geometry.
  tower.setSelectionVisible(floorChosen&&!beyondEnvelope);tower.setCutawayEnabled(cutawayWanted);$('tour-cutaway').disabled=!floorChosen||beyondEnvelope;$('tour-cutaway').setAttribute('aria-pressed',String(floorChosen&&!beyondEnvelope&&cutawayWanted));$('tour-cutaway').title=beyondEnvelope?'선택층의 외관 자료가 없어 단면을 표시할 수 없습니다.':'선택층보다 높은 부분을 숨깁니다.';renderer.shadowMap.needsUpdate=true;$('tour-floor-rail').hidden=!chosen;$('tour-floor-rail').replaceChildren();
  if(chosen)for(let n=maximum;n>=1;n--){const b=document.createElement('button');b.textContent=`${n}F`;b.dataset.floor=n;b.setAttribute('aria-pressed',String(n===selection.floor));b.onclick=()=>chooseFloor(n);$('tour-floor-rail').append(b);}
  $('tour-basis').textContent='건물 위치·외형: OpenStreetMap. 외벽·창호·조경은 참고 디자인이며 실제 공용부 배치와 다를 수 있습니다. 단면 층판은 외형 기준이며 실제 세대·홀 배치를 뜻하지 않습니다.';
  $('tour-tip').firstChild.textContent=chosen?`${tower.selected.title}${floorChosen?` · ${selection.floor}층`:': 층을 골라 주세요.'}`:'동 번호를 눌러 시작하세요.';
  const units=floorChosen?getFloorUnits(selection.building,selection.floor):[],unit=selectedUnit(),variants=getUnitModelVariants(unit);
  $('tour-unit').replaceChildren();const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=!floorChosen?'동·층을 먼저 선택하세요':units.length?'호수를 선택하세요':'이 층에 확인된 세대가 없습니다';$('tour-unit').append(placeholder);
  for(const row of units){const option=document.createElement('option');option.value=row.unit;option.textContent=`${row.unit}호 · ${row.type}${getUnitModelVariants(row).length?' · 3D 가능':' · 실내 3D 준비 중'}`;$('tour-unit').append(option);}
  $('tour-unit').value=unit?.unit||'';$('tour-unit').disabled=!units.length;
  $('tour-variant').replaceChildren();for(const key of variants){const option=document.createElement('option');option.value=key;option.textContent=key.includes('-basic-')?'기본형':'확장형';$('tour-variant').append(option);}
  $('tour-variant-step').hidden=!variants.length;if(variants.length)$('tour-variant').value=variantForUnit(unit,selection.sampleVariant);
  $('tour-unit-note').textContent=unit?`${unit.type} · 공급 ${unit.supplyM2.toFixed(2)}㎡ / 전용 ${unit.exclusiveM2.toFixed(2)}㎡ · ${variants.length?'실제 확장 여부 미확인':'실내 3D 준비 중'}${beyondEnvelope?' · 선택층의 외관 표시는 준비 중':''}`:floorChosen&&!units.length?'이 층의 세대 정보가 없습니다. 다른 층을 선택하세요.':'동과 층을 고른 뒤 호수를 선택하세요.';
  $('tour-plan').disabled=!variants.length;$('tour-plan').textContent=variants.length?`${unit.building}동 ${unit.unit}호 평면 보기 →`:unit?'이 타입은 실내 3D 준비 중':'호수를 선택한 후 평면 보기 →';
  for(const b of document.querySelectorAll('[data-view="focus"]'))b.disabled=!chosen;
 }
 function chooseBuilding(id){cutawayWanted=true;selection.building=id;selection.floor=null;selection.unit='';selection.unitType='unknown';selection.buildingType='';selection.typeEvidence='';selection.typeScope='';if(id)tower.selectBuilding(id);tower.setFloor(1);sync();frame(id?'focus':'site');save();}
 function chooseFloor(value){if(!selection.building)return;const number=Number(value);if(!Number.isFinite(number))return;cutawayWanted=true;const old=tower.floorHeight(tower.selected,selection.floor??1);selection.floor=Math.max(1,Math.min(maxFloor(tower.selected),Math.round(number)));selection.unit='';selection.unitType='unknown';selection.room='';selection.physicalRoom='';tower.setFloor(selection.floor);if(view==='focus')cameraOffset+=tower.floorHeight(tower.selected,selection.floor)-old;else frame('focus');sync();save();dirty=true;}
 function chooseUnit(value){const unit=lookupUnit(selection.building,selection.floor,value);selection.unit=unit?.unit||'';selection.unitType=unit?.type||'unknown';selection.room='';selection.physicalRoom='';const variant=variantForUnit(unit,selection.sampleVariant);if(variant)selection.sampleVariant=variant;sync();save();}
 selection=reconcile(selection);
 if(selection.building){tower.selectBuilding(selection.building);if(selection.floor!==null)tower.setFloor(selection.floor);}
 sync();frame(selection.building?'focus':'site');resize();
 $('tour-cutaway').onclick=()=>{cutawayWanted=!cutawayWanted;sync();dirty=true;};
 $('tour-building').onchange=e=>chooseBuilding(e.target.value);installFloorControl({input:$('tour-floor'),down:$('tour-down'),up:$('tour-up'),onChange:chooseFloor});
 $('tour-unit').onchange=e=>chooseUnit(e.target.value);$('tour-variant').onchange=e=>{const unit=selectedUnit();if(!getUnitModelVariants(unit).includes(e.target.value))return;selection.sampleVariant=e.target.value;sync();save();};
 document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>frame(b.dataset.view));
 const ray=new THREE.Raycaster();let down;
 renderer.domElement.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY]);renderer.domElement.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;const r=renderer.domElement.getBoundingClientRect();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2),camera);const hit=tower.hitTest(ray);if(hit){const same=hit.id===selection.building;if(!same)chooseBuilding(hit.id);else chooseFloor(hit.floor);}});
 function service(view){return writeSelection(serviceBaseForPage(location.href,import.meta.env.VITE_SERVICE_BASE_URL),{...selection,serviceView:view}).href;}
 $('tour-back').onclick=()=>parent!==window?post('cortex:show-map'):location.assign(service('map'));
 $('tour-plan').onclick=()=>{if(!getUnitModelVariants(selectedUnit()).length)return;save();if(parent!==window)post('cortex:open-plan',{selection});else location.assign(service('plan'));};
 window.addEventListener('message',e=>{if(e.source!==parent||e.origin!==parentOrigin)return;if(e.data?.type==='cortex:visibility'){visible=e.data.visible===true;document.body.dataset.serviceVisible=String(visible);if(visible)resize();}if(e.data?.type==='cortex:selection'){if(e.data.selection?.locationId&&e.data.selection.locationId!=='acro-river-park')return;const next=reconcile(readSelection(writeSelection(location.href,e.data.selection)));const changed=next.building!==selection.building,oldHeight=tower.floorHeight(tower.selected,selection.floor??1);if(next.floor!==selection.floor||next.building!==selection.building)cutawayWanted=true;selection=next;if(selection.building)tower.selectBuilding(selection.building);tower.setFloor(selection.floor??1);sync();history.replaceState(null,'',writeSelection(location.href,selection));if(changed)frame(selection.building?'focus':'site');else if(view==='focus'&&selection.floor!==null)cameraOffset+=tower.floorHeight(tower.selected,selection.floor)-oldHeight;dirty=true;}});
 let frames=0;
 renderer.setAnimationLoop(now=>{const dt=Math.min(now-previous,64);previous=now;if(!visible||document.hidden)return;if(Math.abs(cameraOffset)>.005){const shift=cameraOffset*(1-Math.exp(-dt/70));camera.position.y+=shift;controls.target.y+=shift;cameraOffset-=shift;dirty=true;}controls.update();if(!dirty)return;const restore=scene.userData.contextAppearance?.(renderer);try{rendererClippingDuringFrame=renderer.localClippingEnabled;renderer.render(scene,camera);frames++;}finally{restore?.();}dirty=false;});
 $('tour-loading').hidden=true;document.body.dataset.loadState='ready';post('cortex:viewer-ready',{mode:'site'});
 if(import.meta.env.DEV&&new URL(location.href).searchParams.has('test'))window.__siteTour={state:()=>({selection,view,frames,triangles:renderer.info.render.triangles,calls:renderer.info.render.calls,environment:tower.appearance.state,camera:camera.position.toArray(),target:controls.target.toArray(),visibleBuildings:tower.buildings.filter(b=>b.tower.visible).length,selectableMaxFloor:maxFloor(tower.selected),osmMaxFloor:tower.selected.floors}),chooseBuilding,chooseFloor,chooseUnit};
}catch(error){console.error(error);$('tour-loading').textContent='3D 단지를 열지 못했습니다. 지도로 돌아가 다시 시도해 주세요.';document.body.dataset.loadState='error';post('cortex:viewer-error');}
