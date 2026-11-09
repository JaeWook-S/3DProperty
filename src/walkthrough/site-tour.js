import {serviceBaseForPage} from '../property/service-endpoints.js';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createComplexContext} from './complex-context.js';
import {installFloorControl} from './floor-control.js';
import {normalizeSelection,readSelection,writeSelection} from '../property/service-selection.js';
import {getBuildingUnits,getFloorUnits,lookupUnit,getUnitModelVariants,variantForUnit} from '../property/unit-catalog.js';
import {surroundingsSourceUrl} from './site-surroundings.js';
import {installFloorUnitPreview,previewFloorCounts} from './floor-unit-preview.js';
import {floorInteriorAvailability} from './floor-interior-contract.js';
import './site-tour.css';

const serviceBase=serviceBaseForPage(location.href,import.meta.env.VITE_SERVICE_BASE_URL);
const $=id=>document.getElementById(id);
let selection=readSelection(location.href),view='site',visible=true,dirty=true,cameraOffset=0,previous=performance.now(),cutawayWanted=true,rendererClippingDuringFrame=false,selectionRevision=0;
selection.locationId='acro-river-park';selection.locationName='아크로리버파크';selection.serviceView='site';
const parentOrigin=new URL(document.referrer||location.href).origin;
function post(type,extra={}){if(parent!==window)parent.postMessage({type,selectionRevision,...extra},parentOrigin);}
function save(){selectionRevision++;selection=normalizeSelection(selection);history.replaceState(null,'',writeSelection(location.href,selection));post('cortex:selection',{selection});}
document.body.className='site-tour';document.body.innerHTML=`<main id="site-tour"><header><div><small>01 / EXPLORE THE COMPLEX</small><h1>아크로리버파크 <span>3D 단지투어</span></h1></div><button id="tour-back">← 지도</button></header><section id="tour-canvas" aria-label="아크로리버파크 3D 단지"><div id="tour-views" role="group" aria-label="단지 시점"><button data-view="site">단지 전체</button><button data-view="focus">선택 동</button><button data-view="river">강변 방향</button><button data-view="street">도로 방향</button></div><button id="tour-cutaway" type="button" aria-pressed="false" disabled title="외형 기준 층판입니다. 실제 세대·홀 배치는 미확인입니다.">위층 숨기기</button><div id="tour-tip">동 번호를 눌러 시작하세요.<small>드래그 회전 · 휠/두 손가락 확대</small></div><p id="tour-loading" role="status">단지를 준비하고 있습니다…</p><div id="tour-floor-rail" aria-label="층 선택"></div><div id="tour-credit"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a><details class="tour-source-details"><summary>출처</summary><div class="tour-source-panel"><p id="tour-basis">건물 위치·외형: OpenStreetMap. 외벽·창호·조경은 참고 디자인입니다.</p><a href="https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky" target="_blank" rel="noopener">하늘·반사 · Poly Haven CC0 ↗</a><br><a id="tour-surroundings-source" target="_blank" rel="noopener">주변 지도 자료 · ODbL ↗</a></div></details></div></section><aside id="tour-controls"><div class="tour-step"><span>1</span><label for="tour-building">둘러볼 동<select id="tour-building"><option value="">동을 선택하세요</option></select></label></div><div class="tour-step"><span>2</span><div><label for="tour-floor">층 선택 <strong id="tour-floor-value">미선택</strong></label><div class="tour-floor-adjust"><button id="tour-down" aria-label="한 층 아래">−</button><input id="tour-floor" type="range" min="1" max="38" value="1" disabled><button id="tour-up" aria-label="한 층 위">＋</button></div></div></div><p id="tour-unit-note">동과 층을 고른 뒤 호수를 선택하세요.</p><button id="tour-plan" disabled>동·층을 고른 후 평면 보기 →</button></aside><section id="tour-floor-units" aria-label="선택층 호수별 평면 미리보기"></section></main>`;
try{
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(47,1,.5,1800);
 const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'low-power'});renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.shadowMap.autoUpdate=false;renderer.setPixelRatio(Math.min(devicePixelRatio,innerWidth<650?1:1.5));$('tour-canvas').prepend(renderer.domElement);
 const controls=new OrbitControls(camera,renderer.domElement);controls.minDistance=55;controls.maxDistance=950;controls.maxPolarAngle=Math.PI*.48;controls.enableDamping=true;controls.dampingFactor=.1;controls.addEventListener('change',()=>dirty=true);
 const tower=createComplexContext(scene,()=>dirty=true);tower.group.visible=true;renderer.shadowMap.needsUpdate=true;
 const unitStep=document.createElement('div');unitStep.className='tour-step';unitStep.id='tour-unit-step';unitStep.innerHTML='<span>3</span><label for="tour-unit">호수 선택<select id="tour-unit" disabled><option value="">동·층을 먼저 선택하세요</option></select></label>';
 const variantStep=document.createElement('div');variantStep.className='tour-step';variantStep.id='tour-variant-step';variantStep.hidden=true;variantStep.innerHTML='<span>4</span><label for="tour-variant">기본형 / 확장형 비교<select id="tour-variant"></select></label>';
 $('tour-controls').insertBefore(unitStep,$('tour-unit-note'));$('tour-controls').insertBefore(variantStep,$('tour-unit-note'));
 $('tour-surroundings-source').href=surroundingsSourceUrl;
 const unitPreview=installFloorUnitPreview({host:$('tour-floor-units'),serviceBase,onChooseUnit:chooseUnit,onChooseFloor:chooseFloor,onOpen:openUnitView});
 const interiorPanel=document.createElement('section');interiorPanel.id='tour-interior-panel';interiorPanel.hidden=true;
 interiorPanel.innerHTML='<div class="floor-interior-heading"><div><small>SELECTED FLOOR</small><strong id="interior-title">선택층 내부</strong></div></div><div id="interior-options"><label>평면 비교 <select id="interior-variant"><option value="expanded">확장형 · 두 세대</option><option value="basic">기본형 · 두 세대</option></select></label><div class="interior-views"><button data-interior-view="all">층 전체</button><button data-interior-view="211a">211A</button><button data-interior-view="168c">168C</button><button data-interior-view="145f" hidden>145F · 2세대</button><button data-interior-view="168d" hidden>168D</button><button data-interior-view="common">공용 홀</button></div><a id="interior-walk">별도 가정 배치에서 보행·반입 검토 ↗</a></div><p id="interior-status" role="status"></p><button id="interior-retry" hidden>다시 불러오기</button><p class="interior-basis">세대 크기는 아키스케치 좌표 기준입니다. 동 안의 세대 위치·방향과 공용부는 가정 배치입니다. 회색 영역은 도면 미확보 영역이며 실제 경계가 아닙니다.</p>';
 $('tour-floor-units').prepend(interiorPanel);
 const interiorBadge=document.createElement('p');interiorBadge.id='tour-interior-badge';interiorBadge.hidden=true;$('tour-canvas').append(interiorBadge);
 let labelRestore=null;
 function floorLabels(hide){if(hide){const overlays=tower.buildings.flatMap(b=>[b.label,...b.markerParts.map(m=>m.mesh.children[0])]);labelRestore??=overlays.map(object=>[object,object.visible]);for(const object of overlays)object.visible=false;}else if(labelRestore){for(const [label,visible] of labelRestore)label.visible=visible;labelRestore=null;}}
 let floorInterior=null,interiorModule=null,interiorWanted=false,interiorVariant=selection.sampleVariant?.includes('-basic-')?'basic':'expanded',interiorKey='',interiorSequence=0,interiorFocus='all',cameraIntentRevision=0;
 $('interior-variant').value=interiorVariant;controls.addEventListener('start',()=>cameraIntentRevision++);
 function interiorFrame(part='all'){
  const bounds=floorInterior?.bounds(part);if(!bounds)return;floorInterior.setLabelFocus(part);
  view='floor';cameraOffset=0;tower.setView('focus');floorLabels(true);controls.minDistance=4;controls.maxDistance=950;
  const center=bounds.getCenter(new THREE.Vector3()),direction=new THREE.Vector3(.16,1,.55).normalize();
  const right=new THREE.Vector3().crossVectors(direction,new THREE.Vector3(0,1,0)).normalize(),up=new THREE.Vector3().crossVectors(right,direction).normalize();
  const tangent=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));let distance=8;
  for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
   const delta=new THREE.Vector3(x,y,z).sub(center),depth=delta.dot(direction);
   distance=Math.max(distance,depth+Math.abs(delta.dot(right))/(tangent*camera.aspect)*1.20,depth+Math.abs(delta.dot(up))/tangent*1.20);
  }
  controls.target.copy(center);camera.position.copy(center).addScaledVector(direction,distance);controls.update();
  document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed','false'));dirty=true;renderer.shadowMap.needsUpdate=true;
 }
 function interiorSync(){
  const available=floorInteriorAvailability(selection.building,selection.floor);
  interiorPanel.hidden=!available.available;
  interiorWanted=available.available&&cutawayWanted;
  interiorBadge.hidden=!interiorWanted;
  interiorBadge.textContent=`${selection.floor}층 내부 · 배치 가정`;
  document.body.dataset.floorInterior=interiorWanted?'active':'off';
  $('interior-options').hidden=!interiorWanted;
  $('interior-retry').hidden=true;
  if(!interiorWanted){
   interiorKey='';interiorSequence++;floorInterior?.hide();tower.setInteriorSection(false);floorLabels(false);
   if(view==='floor')frame(selection.building?'focus':'site');
   if(available.available)$('interior-status').textContent='위층 숨기기를 켜면 이 층의 내부를 볼 수 있습니다.';
   return;
  }
  $('interior-title').textContent=available.fiveUnits?'10층 · 1001–1005호 · 5세대':`${selection.floor}층 · ${available.units[0].unit}호 211A / ${available.units[1].unit}호 168C`;
  for(const option of $('interior-variant').options)option.textContent=`${option.value==='basic'?'기본형':'확장형'} · ${available.fiveUnits?'5':'2'}세대`;
  document.querySelector('[data-interior-view=common]').hidden=available.fiveUnits;
  for(const type of ['145f','168d'])document.querySelector(`[data-interior-view="${type}"]`).hidden=!available.fiveUnits;
  document.querySelector('.interior-basis').textContent=available.fiveUnits?'배치도와 도면을 조합한 검토안입니다. 세대 크기는 유지했으며, 위치·방향과 공용부는 미확정입니다. 기존 건물 외곽과 약 48㎡ 차이가 있습니다.':'세대 크기는 아키스케치 좌표 기준입니다. 동 안의 세대 위치·방향과 공용부는 가정 배치입니다. 회색 영역은 도면 미확보 영역이며 실제 경계가 아닙니다.';
  const walk=new URL(import.meta.env.VITE_PAIRED_FLOOR_URL||'./paired-floor-review.html',location.href);walk.searchParams.set('variant',interiorVariant);walk.searchParams.set('returnTo',writeSelection(location.href,selection).href);$('interior-walk').href=walk.href;
  const key=`${selection.building}:${selection.floor}:${interiorVariant}`;
  if(key===interiorKey)return;interiorKey=key;const token=++interiorSequence,cameraIntent=cameraIntentRevision;
  $('interior-status').textContent='선택층 내부를 불러오는 중…';interiorPanel.dataset.state='loading';
  tower.setInteriorSection(false);
  interiorModule??=import('./floor-interior.js');
  interiorModule.then(module=>{
   if(token!==interiorSequence)return false;
   floorInterior??=module.createFloorInterior(scene,()=>{dirty=true;renderer.shadowMap.needsUpdate=true;});
   return floorInterior.show(tower.selected,selection.floor,interiorVariant);
  }).then(ready=>{
   if(token!==interiorSequence)return;
   interiorPanel.dataset.state=ready?'ready':'error';
   if(ready){tower.setInteriorSection(true);$('interior-status').textContent=available.fiveUnits?'5세대 내부 표시 · 원본 크기 1:1 · 공용부 미확정':`등록 ${available.totalUnits}세대 중 211A·168C 내부 표시 · 원본 크기 1:1`;if(cameraIntent===cameraIntentRevision)interiorFrame(interiorFocus);interiorFocus='all';}
   else{interiorKey='';$('interior-status').textContent='내부 모델을 불러오지 못했습니다.';$('interior-retry').hidden=false;}
  }).catch(()=>{if(token!==interiorSequence)return;interiorModule=null;interiorKey='';interiorPanel.dataset.state='error';$('interior-status').textContent='내부 모델을 불러오지 못했습니다.';$('interior-retry').hidden=false;});
 }
 $('interior-retry').onclick=()=>{interiorKey='';interiorSync();};
 $('interior-variant').onchange=e=>{interiorVariant=e.target.value;interiorSync();};
 document.querySelectorAll('[data-interior-view]').forEach(button=>button.onclick=()=>interiorFrame(button.dataset.interiorView));
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
 // A selected building is a facade detail view, independent of Studio's overview camera.
 // Without a floor, start halfway up the facade; floor choices track their storey centre.
 function focusHeight(){return selection.floor===null?tower.selected.height_m*.45:tower.floorHeight(tower.selected,selection.floor-.5);}
 function focusPose(){
  const building=tower.selected,{bounds}=building,azimuth=new THREE.Vector2(105,135).normalize();
  // Project the actual envelope toward the camera, then keep a clear facade setback.
  // This stays outside broad buildings as well as narrow ones; no geometry is rescaled.
  const frontDepth=((bounds.maxX-bounds.minX)*azimuth.x+(bounds.maxZ-bounds.minZ)*azimuth.y)/2;
  const setback=38*Math.max(.85,Math.min(1.25,1/camera.aspect)),distance=frontDepth+setback,y=focusHeight();
  return {target:[building.x,y,building.z],position:[building.x+azimuth.x*distance,y+setback*.23,building.z+azimuth.y*distance]};
 }
 function frame(next){
  if(next==='focus'&&interiorWanted&&floorInterior?.inspect().visible){interiorFrame('all');return;}
  floorLabels(false);controls.minDistance=55;view=next;cameraOffset=0;tower.setView(view);
  const pose=view==='focus'?focusPose():tower.viewpoint(view);camera.position.fromArray(pose.position);controls.target.fromArray(pose.target);controls.update();
  for(const b of document.querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',String(b.dataset.view===view));dirty=true;renderer.shadowMap.needsUpdate=true;
 }
 function sync(){
  const chosen=Boolean(selection.building),floorChosen=chosen&&selection.floor!==null,maximum=maxFloor(tower.selected),beyondEnvelope=floorChosen&&selection.floor>tower.selected.floors;
  $('tour-building').value=selection.building;$('tour-floor').disabled=!chosen;$('tour-floor').max=maximum;$('tour-floor').value=selection.floor??1;$('tour-floor-value').textContent=floorChosen?`${selection.floor}층`:'미선택';$('tour-down').disabled=!chosen||selection.floor===1;$('tour-up').disabled=!chosen||selection.floor===maximum;
  // Higher catalog floors remain selectable without inventing taller OSM geometry.
  tower.setFloor(selection.floor);tower.setSelectionVisible(floorChosen);tower.setCutawayEnabled(cutawayWanted);$('tour-cutaway').disabled=!floorChosen||beyondEnvelope;$('tour-cutaway').setAttribute('aria-pressed',String(tower.cutawayState.active));renderer.shadowMap.needsUpdate=true;$('tour-floor-rail').hidden=!chosen;$('tour-floor-rail').replaceChildren();
  const readyFloors=previewFloorCounts(selection.building);
  if(chosen)for(let n=maximum;n>=1;n--){const b=document.createElement('button');b.textContent=`${n}F`;b.dataset.floor=n;b.setAttribute('aria-pressed',String(n===selection.floor));const count=readyFloors.get(n)||0;b.classList.toggle('has-preview',count>0);b.setAttribute('aria-label',`${n}층${count?` · ${count}호 평면 준비`:''}`);b.title=count?`${count}호 평면 미리보기`:'';b.onclick=()=>chooseFloor(n);$('tour-floor-rail').append(b);}
  $('tour-basis').textContent='건물 위치·외형: OpenStreetMap. 외벽·창호·조경은 참고 디자인이며 실제 공용부 배치와 다를 수 있습니다. 100동 10층은 배치도 기반 5세대 검토안이며, 다른 준비층은 211A·168C 참고 배치입니다. 실제 세대 방향·공용부·전체층 외곽은 미확인입니다. 주변 강·공원·도로·건물 윤곽은 OSM 기준이며 수목·재질·일부 높이는 시각화 가정입니다.';
  if(beyondEnvelope)$('tour-basis').textContent+=` 선택한 ${selection.floor}층은 OSM 외관 ${tower.selected.floors}층 범위 밖이므로 단면과 층 강조를 표시하지 않습니다.`;
  $('tour-tip').firstChild.textContent=chosen?`${tower.selected.title}${floorChosen?` · ${selection.floor}층`:': 층을 골라 주세요.'}`:'동 번호를 눌러 시작하세요.';
  const units=floorChosen?getFloorUnits(selection.building,selection.floor):[],unit=selectedUnit(),variants=getUnitModelVariants(unit);
  const availableFloor=floorInteriorAvailability(selection.building,selection.floor);
  const floorType=row=>availableFloor.available?(availableFloor.fiveUnits?({'211.99A':'211a','168.95C':'168c','145.95F':'145f','168.66D':'168d'}[row?.type]??null):row?.type==='211.99A'?'211a':null):null;
  $('tour-unit').replaceChildren();const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=!floorChosen?'동·층을 먼저 선택하세요':units.length?'호수를 선택하세요':'이 층에 확인된 세대가 없습니다';$('tour-unit').append(placeholder);
  for(const row of units){const option=document.createElement('option');option.value=row.unit;option.textContent=`${row.unit}호 · ${row.type}${getUnitModelVariants(row).length?' · 3D 가능':floorType(row)?' · 층 내부 3D':' · 실내 3D 준비 중'}`;$('tour-unit').append(option);}
  $('tour-unit').value=unit?.unit||'';$('tour-unit').disabled=!units.length;
  $('tour-variant').replaceChildren();for(const key of variants){const option=document.createElement('option');option.value=key;option.textContent=key.includes('-basic-')?'기본형':'확장형';$('tour-variant').append(option);}
  $('tour-variant-step').hidden=!variants.length;if(variants.length)$('tour-variant').value=variantForUnit(unit,selection.sampleVariant);
  $('tour-unit-note').textContent=unit?`${unit.type} · 공급 ${unit.supplyM2.toFixed(2)}㎡ / 전용 ${unit.exclusiveM2.toFixed(2)}㎡ · ${variants.length?'실제 확장 여부 미확인':floorType(unit)?'층 내부 3D에서 비교 가능 · 확장 여부 미확인':'실내 3D 준비 중'}${beyondEnvelope?' · 선택층의 외관 표시는 준비 중':''}`:floorChosen&&!units.length?'이 층의 세대 정보가 없습니다. 다른 층을 선택하세요.':'동과 층을 고른 뒤 호수를 선택하세요.';
  $('tour-plan').disabled=!variants.length;$('tour-plan').textContent=variants.length?`${unit.building}동 ${unit.unit}호 평면 보기 →`:unit?'이 타입은 실내 3D 준비 중':'호수를 선택한 후 평면 보기 →';
  unitPreview.render(selection);
  for(const row of units){
   const type=floorType(row);if(!type||getUnitModelVariants(row).length)continue;
   const card=document.querySelector(`#floor-unit-list [data-unit="${row.unit}"]`);if(!card)continue;
   const hint=card.querySelector('.floor-unit-caption small');if(hint)hint.textContent=`${type.toUpperCase()} · 층 내부 3D`;
   card.querySelector('.floor-unit-select')?.setAttribute('aria-label',`${row.unit}호 · ${type.toUpperCase()} · 층 내부에서 확인`);
   const actions=document.createElement('div');actions.className='floor-unit-actions';const button=document.createElement('button');button.dataset.floorModel=type;button.textContent=`${type.toUpperCase()} 층 내부에서 보기 →`;
   button.onclick=()=>{chooseUnit(row.unit);const focus=availableFloor.fiveUnits?row.unit:type;if(interiorWanted&&floorInterior?.inspect().status==='ready')interiorFrame(focus);else{interiorFocus=focus;cutawayWanted=true;interiorSync();}};actions.append(button);card.append(actions);
  }
  interiorSync();if(view==='floor')floorLabels(true);
  for(const b of document.querySelectorAll('[data-view="focus"]'))b.disabled=!chosen;
 }
 function chooseBuilding(id){cutawayWanted=true;selection.building=id;selection.floor=null;selection.unit='';selection.unitType='unknown';selection.buildingType='';selection.typeEvidence='';selection.typeScope='';if(id)tower.selectBuilding(id);tower.setFloor(1);sync();frame(id?'focus':'site');save();}
 function chooseFloor(value){if(!selection.building)return;const number=Number(value);if(!Number.isFinite(number))return;cutawayWanted=true;const old=focusHeight();selection.floor=Math.max(1,Math.min(maxFloor(tower.selected),Math.round(number)));selection.unit='';selection.unitType='unknown';selection.room='';selection.physicalRoom='';tower.setFloor(selection.floor);if(view==='focus')cameraOffset+=focusHeight()-old;else if(view!=='floor')frame('focus');sync();save();dirty=true;}
 function chooseUnit(value,requestedVariant){const unit=lookupUnit(selection.building,selection.floor,value);selection.unit=unit?.unit||'';selection.unitType=unit?.type||'unknown';selection.room='';selection.physicalRoom='';const variant=variantForUnit(unit,requestedVariant||selection.sampleVariant);if(variant)selection.sampleVariant=variant;selection.previewMode='unit';sync();save();}
 selection=reconcile(selection);
 if(selection.building){tower.selectBuilding(selection.building);if(selection.floor!==null)tower.setFloor(selection.floor);}
 resize();frame(selection.building?'focus':'site');sync();
 $('tour-cutaway').onclick=()=>{cutawayWanted=!cutawayWanted;sync();dirty=true;};
 $('tour-building').onchange=e=>chooseBuilding(e.target.value);installFloorControl({input:$('tour-floor'),down:$('tour-down'),up:$('tour-up'),onChange:chooseFloor});
 $('tour-unit').onchange=e=>chooseUnit(e.target.value);$('tour-variant').onchange=e=>{const unit=selectedUnit();if(!getUnitModelVariants(unit).includes(e.target.value))return;selection.sampleVariant=e.target.value;sync();save();};
 document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{cameraIntentRevision++;frame(b.dataset.view);});
 const ray=new THREE.Raycaster();let down;
 renderer.domElement.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY]);renderer.domElement.addEventListener('pointerup',e=>{if(view==='floor')return;if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;const r=renderer.domElement.getBoundingClientRect();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2),camera);const hit=tower.hitTest(ray);if(hit){const same=hit.id===selection.building;if(!same)chooseBuilding(hit.id);else chooseFloor(hit.floor);}});
 function service(view){return writeSelection(serviceBaseForPage(location.href,import.meta.env.VITE_SERVICE_BASE_URL),{...selection,serviceView:view}).href;}
 $('tour-back').onclick=()=>parent!==window?post('cortex:show-map'):location.assign(service('map'));
 function openUnitView(mode){if(!['plan','3d'].includes(mode)||!getUnitModelVariants(selectedUnit()).length)return;save();if(parent!==window)post(mode==='3d'?'cortex:open-interior':'cortex:open-plan',{selection});else location.assign(service(mode));}
 $('tour-plan').onclick=()=>openUnitView('plan');
 window.addEventListener('message',e=>{if(e.source!==parent||e.origin!==parentOrigin)return;if(e.data?.type==='cortex:visibility'){visible=e.data.visible===true;document.body.dataset.serviceVisible=String(visible);if(visible)resize();}if(e.data?.type==='cortex:selection'){if(Number.isSafeInteger(e.data.selectionRevision)){if(e.data.selectionRevision<selectionRevision)return;selectionRevision=e.data.selectionRevision;}if(e.data.selection?.locationId&&e.data.selection.locationId!=='acro-river-park')return;const next=reconcile(readSelection(writeSelection(location.href,e.data.selection)));const changed=next.building!==selection.building,oldHeight=focusHeight();if(next.floor!==selection.floor||changed)cutawayWanted=true;selection=next;if(selection.building)tower.selectBuilding(selection.building);tower.setFloor(selection.floor??1);sync();history.replaceState(null,'',writeSelection(location.href,selection));if(changed)frame(selection.building?'focus':'site');else if(view==='focus')cameraOffset+=focusHeight()-oldHeight;dirty=true;}});
 let frames=0;
 renderer.setAnimationLoop(now=>{const dt=Math.min(now-previous,64);previous=now;if(!visible||document.hidden)return;if(Math.abs(cameraOffset)>.005){const shift=cameraOffset*(1-Math.exp(-dt/70));camera.position.y+=shift;controls.target.y+=shift;cameraOffset-=shift;dirty=true;}controls.update();if(!dirty)return;const restore=scene.userData.contextAppearance?.(renderer);try{rendererClippingDuringFrame=renderer.localClippingEnabled;if(view==='floor')floorLabels(true);renderer.render(scene,camera);frames++;}finally{restore?.();}dirty=false;});
 $('tour-loading').hidden=true;document.body.dataset.loadState='ready';post('cortex:viewer-ready',{mode:'site'});
 if(import.meta.env.DEV&&new URL(location.href).searchParams.has('test'))window.__siteTour={state:()=>({selection,view,frames,triangles:renderer.info.render.triangles,calls:renderer.info.render.calls,environment:tower.appearance.state,surroundings:tower.surroundings.inspect(),camera:camera.position.toArray(),target:controls.target.toArray(),cameraAspect:camera.aspect,interior:floorInterior?.inspect()??{status:'idle',visible:false},focusHeight:focusHeight(),pendingCameraOffset:cameraOffset,cutaway:tower.inspectCutaway(),rendererClippingDuringFrame,rendererClippingAfterFrame:renderer.localClippingEnabled,visibleBuildings:tower.buildings.filter(b=>b.tower.visible).length,selectableMaxFloor:maxFloor(tower.selected),osmMaxFloor:tower.selected.floors}),chooseBuilding,chooseFloor,chooseUnit,interiorFrame,ray:(origin,direction)=>{const ray=new THREE.Raycaster(new THREE.Vector3(...origin),new THREE.Vector3(...direction).normalize());ray.camera=camera;return tower.inspectRay(ray);},bounds:()=>({id:tower.selected.id,...tower.selected.bounds,height:tower.selected.height_m})};
}catch(error){console.error(error);$('tour-loading').textContent='3D 단지를 열지 못했습니다. 지도로 돌아가 다시 시도해 주세요.';document.body.dataset.loadState='error';post('cortex:viewer-error');}
