import {serviceBaseForPage} from '../property/service-endpoints.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { corners, doorFootprints, placementWarnings } from './layout.js';
import { wallSectionPath } from './wall-slice.js';
import { navigationRooms, navigationPlaces, pointInRoom, hingedSegment } from './minimap-geometry.js';
import { LOCATION, createFloorTower, createExterior } from './location.js';
import './studio.css';
import {VARIANTS,variantTitle,populateVariantSelect,resolveVariant} from './variants.js';
import { renderAreaSummary } from '../property/area-summary.js';
import './location.css';
import { installFloorControl } from './floor-control.js';
import { readSelection, writeSelection } from '../property/service-selection.js';
import {lookupUnit,getUnitModelVariants,variantForUnit} from '../property/unit-catalog.js';
import {layoutScope,layoutStorageKey,createUnitLayoutState} from '../property/unit-layout-state.js';
import './workspace.css';
import { isTouchFirst } from '../mobile/touch-walk-controls.js';
// S3 extensions: recommended concepts (W7-06), window views (W7-07) and house tours, wired through `hooks` below.
import { createConceptStudio } from '../concepts/concept-panel.js';
import { createWindowView } from '../window-view/window-view.js';
import { createHouseTours } from '../house-tours/house-tours.js';
import { readHome, saveHome } from './my-home.js';
import { setupFurnitureImageRegistration } from './furniture-registration.js';
import { fetchGeneratedAssets, generatedKind, installGeneratedTemplate, loadGeneratedModel } from './generated-furniture.js';
import { CATALOG_FURNITURE, installCatalogTemplate } from './catalog-furniture.js';

const catalogByKind=new Map(CATALOG_FURNITURE.map(asset=>[asset.kind,asset]));
const catalogSize=asset=>{const d=asset.dimensions_m;return `모델 규격 · 너비 ${(d.width*100).toFixed(1)} × 깊이 ${(d.depth*100).toFixed(1)} × 높이 ${(d.height*100).toFixed(1)} cm`;};

const $=id=>document.getElementById(id);
const NS='http://www.w3.org/2000/svg';
// Control hints follow the device: on-screen stick and gestures on touch, keys and mouse on PC.
const HINTS={touch:{walk:'왼쪽 아래 방향키 이동 · 화면을 밀어 시선 · 버튼으로 문 열기',tour:'방향키 이동 · 드래그 시선',orbit:'드래그 회전 · 두 손가락 확대'},pc:{walk:'WASD 이동 · E 문 열기 · Esc 해제',tour:'WASD 이동 · 마우스 시선',orbit:'드래그 회전 · 휠 확대'}};
const hint=key=>HINTS[isTouchFirst()?'touch':'pc'][key];
function svg(tag,attrs,text){const n=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text)n.textContent=text;return n;}
export function createStudio({scene,camera,renderer,getActive,loadVariant,resize,invalidate,enterRoom,unlock,surfaceEditor=null,settle=()=>true,standAt=()=>false,resume=()=>{},openCommonArea=()=>false,onModeChange=()=>{},initialMode='complex',lighting='day'}) {
  document.body.classList.add('studio');
  const ui=document.createElement('section');ui.id='studio-ui';
  ui.innerHTML=`<header class="studio-header"><a href="?studio=1" class="studio-brand">CORTEX</a><nav aria-label="주요 메뉴"><button id="nav-plan">우리 집</button><button id="nav-complex"><span class="nav-long">새로운 </span>집 찾기</button></nav><div class="mode-switch"><button id="mode-tour">둘러보기</button><button id="mode-edit">꾸미기</button></div></header>
  <aside id="studio-sidebar"><p class="studio-eyebrow" id="studio-step"></p><h1 id="studio-title"></h1><p id="studio-description"></p>
  <section id="unit-picker"><button id="select-building">동·층 선택 시작</button><div id="unit-options" hidden><label for="studio-variant">동·층과 별개인 체험 평면 선택</label><select id="studio-variant"><option value="expanded">112A · 확장형</option><option value="basic">112A · 기본형</option><option value="168c-expanded">168C · 확장형</option></select><button id="open-unit" class="studio-primary">체험 평면 열기 →</button></div></section>
  <section id="room-picker" hidden><label for="studio-model">평면 선택</label><select id="studio-model"></select><label for="studio-room">장소 선택</label><select id="studio-room"></select><p id="studio-room-dimensions" class="evidence-note"></p><div class="room-actions"><button id="room-walk" class="studio-primary">이곳에서 둘러보기</button><button id="room-edit">이곳 꾸미기</button></div><p id="studio-dimension-note" class="evidence-note">천장고 2.6m · 문 개구부 2.1m 가정<br>안방 킹 167×207.5cm · 작은 방은 빈 방/서재<br>책상·의자·욕실 집기 세부 치수는 가정입니다.</p></section>
  <section id="editor-tools" hidden><div class="editor-row"><label for="add-kind">가구 추가</label><select id="add-kind"></select><button id="add-item">＋ 추가</button></div><section class="furniture-registration" aria-labelledby="furniture-registration-title"><div class="furniture-registration-heading"><div><span>MY FURNITURE</span><strong id="furniture-registration-title">이미지로 새 가구 등록</strong></div><button id="register-furniture" class="register-furniture-button" type="button" aria-controls="furniture-image-file">가구 등록</button></div><input id="furniture-image-file" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" aria-label="등록할 가구 이미지 선택" hidden><p class="furniture-registration-help">JPG, PNG, WebP · 최대 20MB<br>이미지를 선택하면 가구 치수를 자동으로 측정합니다.</p><figure id="furniture-image-preview" hidden><img alt=""><figcaption><strong id="furniture-image-name"></strong><span id="furniture-image-metadata"></span></figcaption></figure><p id="furniture-image-status" role="status" aria-live="polite"></p></section><label for="selected-item">배치한 가구</label><select id="selected-item"></select><p id="item-size"></p><div class="coordinate-inputs"><label>X (m)<input id="item-x" type="number" step="0.01"></label><label>Z (m)<input id="item-z" type="number" step="0.01"></label></div><div class="editor-row"><button id="apply-position">위치 적용</button><button id="rotate-item">90° 회전</button><button id="remove-item">삭제</button></div><div class="editor-row"><button id="save-layout">배치 저장</button><button id="restore-layout">저장 불러오기</button><button id="reset-layout">초기 배치</button></div><p class="evidence-note">이 브라우저에 저장됩니다. 2D에서 가구를 드래그하거나 방향키로 5cm씩 옮기세요. 가구 크기는 유지됩니다.</p></section>

  <p id="studio-status" role="status" aria-live="polite"></p></aside>
  <section id="plan-pane" hidden><div class="pane-label"><strong id="plan-title">2D 배치도</strong></div><svg id="layout-plan" role="img" aria-label="공간과 가구 배치도"></svg></section><div id="three-label" class="pane-label"><strong>단지 둘러보기</strong><span id="orbit-help">드래그 회전 · 휠 확대</span></div><button id="back-plan" hidden>← 세대 전체 보기</button>`;
  document.body.append(ui);
  const commonStart=document.createElement('button');commonStart.id='common-area-start';commonStart.hidden=true;
  commonStart.textContent='현관 밖 둘러보기 · 예시 공용부';
  commonStart.style.cssText='position:fixed;z-index:31;bottom:76px;right:24px;max-width:calc(100% - 48px);border:1px solid #b5c6bb;background:#fafbf1;padding:12px 18px;border-radius:8px;color:#34583f;pointer-events:auto';
  const commonBadge=document.createElement('p');commonBadge.id='common-area-badge';commonBadge.hidden=true;
  commonBadge.textContent='예시 공용부 · 실제 동·층 배치 아님 · 층간 이동 없음';
  commonBadge.style.cssText='position:fixed;z-index:31;pointer-events:none;bottom:126px;right:24px;max-width:calc(100% - 48px);padding:8px 12px;border-radius:7px;background:#fcfcf7ed;color:#34583f;font-size:12px;line-height:1.5';
  if(isTouchFirst()){commonStart.style.bottom='160px';commonBadge.style.bottom='210px';}
  else{commonStart.style.top='84px';commonStart.style.bottom='auto';commonStart.style.padding='8px 14px';commonStart.style.fontSize='12px';commonBadge.style.top='120px';commonBadge.style.bottom='auto';commonBadge.style.margin='0';commonBadge.style.padding='2px 8px';commonBadge.style.fontSize='11px';}
  document.body.append(commonStart,commonBadge);
  commonStart.onclick=()=>{
    if(mode!=='tour')return;
    if(!openCommonArea()){status('현관 주변에 안전한 시작 위치를 찾지 못했습니다.');return;}
    const entrance=places().find(p=>p.id==='entrance'||p.name_ko==='현관')??places().find(p=>pointInRoom(p,camera.position.x,camera.position.z));
    if(entrance)chooseRoom(entrance.id);
    $('studio-title').textContent='현관 · 공용부 둘러보기';
    commonStart.textContent='현관에서 다시 시작';commonBadge.hidden=false;
    status('현관문으로 나가 복도를 걸어가세요. E 또는 클릭으로 엘리베이터 문을 여닫고, 같은 현관으로 돌아올 수 있어요.');resume();
  };
  const catalogNote=document.createElement('p');catalogNote.id='catalog-add-note';catalogNote.className='evidence-note';catalogNote.hidden=true;
  $('add-kind').closest('.editor-row').after(catalogNote);$('add-kind').setAttribute('aria-describedby',catalogNote.id);
  function updateCatalogNote(){
    const asset=catalogByKind.get($('add-kind').value);catalogNote.hidden=!asset;catalogNote.replaceChildren();
    if(!asset)return;
    catalogNote.append(`${catalogSize(asset)}. 원본 비율로 추가합니다. 제품 실측값은 확인되지 않았습니다. `);
    const source=document.createElement('a');source.href=asset.source.official_page;source.target='_blank';source.rel='noopener';source.textContent='Poly Haven · CC0 ↗';catalogNote.append(source);
  }
  $('add-kind').onchange=updateCatalogNote;
  let furniturePending=false;
  function setFurniturePending(operation){
    furniturePending=Boolean(operation);
    for(const id of ['add-kind','add-item','restore-layout','save-layout','reset-layout'])$(id).disabled=furniturePending;
    $('editor-tools').setAttribute('aria-busy',String(furniturePending));
    $('add-item').textContent=operation==='add'?'불러오는 중…':'＋ 추가';
    $('restore-layout').textContent=operation==='restore'?'불러오는 중…':'저장 불러오기';
  }
  let measurementToken=null;
  setupFurnitureImageRegistration({
    button:$('register-furniture'),input:$('furniture-image-file'),panel:$('furniture-image-preview'),
    preview:$('furniture-image-preview').querySelector('img'),name:$('furniture-image-name'),
    metadata:$('furniture-image-metadata'),status:$('furniture-image-status'),
    onMeasurementStart(){measurementToken=operationToken();},
    async onMeasurementComplete(job) {
      const assets=job.result?.generation?.assets || [];
      if(assets.length&&operationCurrent(measurementToken)) await importGeneratedAssets(assets,true);
    },
  });
  let mode='complex',roomId='Living front',placeId=null,selection=null,drag=null,ready=false;
  // The room select also offers the first unit screen: the whole 2D plan beside the 3D model.
  const WHOLE='whole';let whole=true;
  let serviceSelection=readSelection(location.href);
  let floor=serviceSelection.floor??1,buildingSelected=false,allowOverlap=true,exteriorEnabled=true;
  const notifySelection=()=>{serviceSelection={...serviceSelection,sampleVariant:current()?.key??serviceSelection.sampleVariant};const next=writeSelection(location.href,serviceSelection);history.replaceState(null,'',next);if(parent!==window)parent.postMessage({type:'cortex:selection',selection:serviceSelection},new URL(document.referrer||location.href).origin);};
  const assignments=new Map();
  const layoutState=createUnitLayoutState();
  let scopedTarget=null,pendingServiceSelection=null,selectionEpoch=0,selectionRequest=0;
  const actualUnit=()=>serviceSelection.locationId==='acro-river-park'?lookupUnit(serviceSelection.building,serviceSelection.floor,serviceSelection.unit):null;
  const operationToken=()=>({layout:layoutState.token(),epoch:selectionEpoch});
  const operationCurrent=token=>Boolean(token&&token.epoch===selectionEpoch&&layoutState.isCurrent(token.layout));
  function syncLayout(target){
    const scope=layoutScope(serviceSelection,target.key,target.definition.info.finishRevision||1);
    const previous=scopedTarget;
    const changed=layoutState.switchTo(scope,{
      capture:()=>({items:previous.staging.snapshot(),assignments:[...assignments],finish:$('finish').value}),
      restore:saved=>{
        scopedTarget=target;assignments.clear();drag=null;selection=null;
        if(saved){target.staging.restore(saved.items,navigationRooms(target.definition.info));for(const [id,value]of saved.assignments)assignments.set(id,value);}
        else if(previous)target.staging.reset();
        // Lighting/quality are viewing preferences; saved material finish belongs to this layout.
        const finish=saved?.finish||(previous?'original':$('finish').value);
        if($('finish').value!==finish){$('finish').value=finish;$('finish').dispatchEvent(new Event('change'));}
      },
    });
    if(changed)selectionEpoch++;
    surfaceEditor?.activate(target,scope);
    return changed;
  }
  function restrictVariants(){
    const unit=actualUnit(),allowed=unit?getUnitModelVariants(unit):Object.keys(VARIANTS);
    for(const id of ['studio-model','studio-variant','variant']){
      const select=$(id);populateVariantSelect(select);
      for(const option of [...select.options])if(!allowed.includes(option.value))option.remove();
      select.value=current().key;
    }
    $('room-picker').querySelector('label[for="studio-model"]').textContent=unit?'기본형 / 확장형 보기':'평면 선택';
  }
  const generatedModels=new Map();
  camera.far=1200;camera.updateProjectionMatrix();
  $('unit-picker').innerHTML=`<p class="location-address">${LOCATION.address}</p><button id="select-building">동·층 시각화 선택</button><div id="unit-options" hidden><label for="floor-range">층 선택 · <strong id="floor-value">1층</strong></label><div class="floor-adjust"><button id="floor-down" type="button" aria-label="한 층 아래">−</button><input id="floor-range" type="range" min="1" max="${LOCATION.maxFloor}" value="${LOCATION.initialFloor}" step="1" aria-describedby="floor-help"><button id="floor-up" type="button" aria-label="한 층 위">＋</button></div><p id="floor-help">천천히 드래그 · − / ＋로 한 층씩</p><p id="floor-availability"></p><label for="studio-variant">동·층과 별개인 체험 평면 선택</label><select id="studio-variant"><option value="expanded">112A · 확장형</option><option value="basic">112A · 기본형</option><option value="168c-expanded">168C · 확장형</option></select><button id="open-unit" class="studio-primary">체험 평면 열기 →</button></div><details class="studio-source-details"><summary>출처</summary><p class="evidence-note" id="building-evidence"></p><a href="${LOCATION.map}" target="_blank" rel="noopener">지도에서 위치 확인 ↗</a></details>`;

  const hero=document.createElement('section');hero.id='location-hero';
  hero.innerHTML=`<img src="${LOCATION.riverside}" alt="ACRO 공식 아크로 리버파크 단지 전경"><div class="location-caption"><p>SEOUL · BANPO</p><h2>아크로 리버파크</h2><p>실제 100–114동 배치에서 공간을 선택하세요.</p><button id="hero-building">동·층 선택 →</button></div><a class="photo-credit" href="${LOCATION.source}" target="_blank" rel="noopener">출처: ACRO 공식 소개 · 특정 동 선택 위치를 뜻하지 않습니다 ↗</a><p id="photo-error" hidden>전경을 불러오지 못했어요. 공식 소개 또는 지도 링크에서 확인해 주세요.</p>`;ui.append(hero);
  hero.querySelector('img').onerror=()=>{$('photo-error').hidden=false;};
  const rail=document.createElement('div');rail.id='floor-rail';rail.hidden=true;rail.setAttribute('aria-label','층 선택 목록');
  for(let n=LOCATION.maxFloor;n>=1;n--){const b=document.createElement('button');b.textContent=`${n}F`;b.dataset.floor=n;b.onclick=()=>selectFloor(n);rail.append(b);}ui.append(rail);
  const badge=document.createElement('p');badge.id='exterior-note';badge.hidden=true;badge.textContent='창밖: 아크로 리버파크 공식 참고 사진 · 실제 세대 조망이 아닙니다.';ui.append(badge);

  $('room-picker').append($('view-settings'));
  const exteriorControl=document.createElement('label');exteriorControl.className='placement-toggle';exteriorControl.innerHTML='<input id="exterior-enabled" type="checkbox" checked> 창밖 풍경 보기';$('room-picker').append(exteriorControl);
  const warningControl=document.createElement('div');warningControl.innerHTML='<label class="placement-toggle"><input id="allow-overlap" type="checkbox" checked> 겹침 허용 · 경고로 확인</label><p class="evidence-note">끄면 겹침·경계 이탈·문 개방 간섭을 제한합니다.<br>60cm 여유는 참고 기준이며 통행 가능 판정은 아닙니다.</p><div id="placement-warnings" role="status" aria-live="polite"></div>';$('editor-tools').append(warningControl);
  const orbit=new OrbitControls(camera,renderer.domElement);orbit.enableDamping=false;orbit.maxPolarAngle=Math.PI*.48;orbit.minDistance=2;orbit.maxDistance=90;
  orbit.addEventListener('change',()=>invalidate());
  const clipping=new THREE.Plane(new THREE.Vector3(0,-1,0),1.35);
  const tower=createFloorTower(scene,()=>dirty(true),{lazy:true});let complex=tower.group;
  if(serviceSelection.building)tower.selectBuilding(serviceSelection.building);tower.setFloor(floor);
  const contextBar=document.createElement('section');contextBar.id='context-toolbar';contextBar.hidden=true;
  contextBar.innerHTML='<div class="context-views" role="group" aria-label="단지 시점"><button data-view="focus">선택 동</button><button data-view="site">단지 전체</button><button data-view="river">강변 방향</button><button data-view="street">도로 방향</button><button id="context-photo">공식 전경</button><button id="context-cutaway" aria-pressed="true" title="외형 기준 층판 · 실제 세대/홀 배치 미확인">위층 숨기기</button></div><p id="context-selection-note"></p><div class="context-credits"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a><details class="studio-source-details"><summary>출처</summary><p>건물 외형은 지도 자료를 바탕으로 표현했으며 외벽·창호·조경은 참고 디자인입니다.</p><a href="https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky" target="_blank" rel="noopener">하늘·반사 · Poly Haven CC0 ↗</a></details></div>';ui.append(contextBar);
  $('context-cutaway').onclick=()=>{tower.setCutawayEnabled(!tower.cutawayEnabled);$('context-cutaway').setAttribute('aria-pressed',String(tower.cutawayState.active));dirty(true);};
  const buildingSelect=document.createElement('select');buildingSelect.id='context-building';buildingSelect.setAttribute('aria-label','둘러볼 동');
  for(const b of tower.buildings){const o=document.createElement('option');o.value=b.id;o.textContent=b.title;buildingSelect.append(o);}buildingSelect.value=tower.selected.id;
  $('unit-options').prepend(buildingSelect);
  for (const [selectId, areaId] of [['studio-variant', 'unit-area'], ['studio-model', 'studio-area']]) {
    const area = document.createElement('section'); area.id = areaId; $(selectId).after(area);
  }
  $('studio-variant').addEventListener('change', () => renderAreaSummary($('unit-area'), VARIANTS[$('studio-variant').value].unitType));
  const photoPanel=document.createElement('section');photoPanel.id='context-photo-panel';photoPanel.hidden=true;
  photoPanel.innerHTML=`<img src="${LOCATION.night}" alt="ACRO 공식 단지 야경"><div><button id="close-context-photo">3D로 돌아가기</button><a href="${LOCATION.source}" target="_blank" rel="noopener">ACRO 공식 소개 ↗</a></div>`;ui.append(photoPanel);
  let contextView='focus',floorCameraFrame=0,floorCameraOffset=0;
  function stopFloorCamera(){cancelAnimationFrame(floorCameraFrame);floorCameraFrame=0;floorCameraOffset=0;}
  function followFloorHeight(delta){
    floorCameraOffset+=delta;
    if(floorCameraFrame)return;
    let previous=performance.now();
    function step(now){
      const dt=Math.min(64,now-previous);previous=now;
      const settled=Math.abs(floorCameraOffset)<.01;
      const shift=settled?floorCameraOffset:floorCameraOffset*(1-Math.exp(-dt/70));
      floorCameraOffset-=shift;camera.position.y+=shift;orbit.target.y+=shift;orbit.update();dirty();
      if(settled){floorCameraFrame=0;return;}
      floorCameraFrame=requestAnimationFrame(step);
    }
    floorCameraFrame=requestAnimationFrame(step);
  }
  function setContextView(view){stopFloorCamera();contextView=view;tower.setView(view);const pose=tower.viewpoint(view);orbit.maxDistance=550;orbit.target.fromArray(pose.target);camera.position.fromArray(pose.position);orbit.update();contextBar.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));$('context-selection-note').textContent=view==='focus'?`${tower.selected.title}은 선명하게 · 주변 동은 반투명 · 동 번호를 눌러 전환`:'모든 동을 함께 표시 · 동 번호를 눌러 선택';dirty(true);}
  contextBar.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>setContextView(b.dataset.view));
  $('context-photo').onclick=()=>{photoPanel.hidden=false;};$('close-context-photo').onclick=()=>{photoPanel.hidden=true;};
  photoPanel.addEventListener('keydown',e=>{if(e.key==='Escape'){photoPanel.hidden=true;$('context-photo').focus();}});
  function chooseBuilding(id){tower.selectBuilding(id);buildingSelect.value=tower.selected.id;selectFloor(floor,{focus:true});status(`${tower.selected.title} · 둘러볼 층을 선택하세요.`);}
  buildingSelect.onchange=e=>chooseBuilding(e.target.value);

  // Reuse the existing controls and listeners, moving frequent actions next to
  // the plan/viewport while keeping furniture properties in the sidebar.
  const dock=document.createElement('section');dock.id='editor-dock';dock.hidden=true;dock.setAttribute('aria-label','배치 작업 도구');
  dock.innerHTML='<div class="editor-pane-actions"><div id="plan-action-bar" aria-label="2D 배치 도구"><span>2D 배치</span></div><div id="view-action-bar" aria-label="3D 보기 도구"><button id="frame-room">방 전체 보기</button></div></div><div class="layout-action-bar"><div id="layout-save-actions"></div><label class="dock-overlap"><input id="dock-overlap-placeholder" type="checkbox"> 겹침 허용</label></div><div id="dock-warnings"></div><div id="dock-status"></div>';ui.append(dock);
  $('plan-action-bar').append($('rotate-item'),$('remove-item'));
  $('layout-save-actions').append($('save-layout'),$('restore-layout'),$('reset-layout'));
  $('dock-overlap-placeholder').replaceWith($('allow-overlap'));
  $('dock-warnings').append($('placement-warnings'));
  const dockHint=document.createElement('span');dockHint.className='dock-warning-hint';dockHint.textContent='문 방향·60cm 여유는 참고 기준';$('dock-warnings').append(dockHint);
  warningControl.remove();
  $('frame-room').onclick=()=>frame(room().bounds_m);
  const originalWalkHost=$('room-walk').parentElement;
  const exterior=createExterior(scene,invalidate,state=>{badge.textContent=state.note;},lighting);

  const raycaster=new THREE.Raycaster();
  const current=()=>getActive();
  const unitBounds=()=>current().definition.info.bounds_m || [-.2,0,13.7,10.2];
  function syncModelUI(){
    restrictVariants();
    serviceSelection.sampleVariant=current().key;
    notifySelection();
    exterior.setUnit?.(current().definition.coordinateBased?'structure':current().definition.unitType);
    $('studio-model').value=$('studio-variant').value=current().key;
    $('nav-plan').textContent='우리 집';$('nav-plan').title=(actualUnit()?`${actualUnit().building}동 ${actualUnit().unit}호 · `:'')+variantTitle(current().definition);
    renderAreaSummary($('unit-area'), current().definition.unitType);
    renderAreaSummary($('studio-area'), current().definition.unitType);
    $('studio-dimension-note').textContent=(actualUnit()?'동·호수의 타입은 제공 자료 기준입니다. 실제 확장 여부·좌우 반전·내부 시공 상태는 미확인으로 기본형/확장형을 선택해 비교합니다. ':'')+(current().definition.coordinateBased ? current().definition.note : current().definition.unitType==='168C' ? '천장고 2.50m · 일반 문짝 0.80×2.40m. VR을 참고한 마감이며 주방 집기·일부 창호 치수는 임시값입니다.' : '천장고 2.6m · 문 개구부 2.1m 가정. 안방 킹 167×207.5cm · 작은 방은 빈 방/서재. 집기 세부 치수는 가정입니다.');
  }
  populateVariantSelect($('studio-model'));populateVariantSelect($('studio-variant'));
  $('studio-model').onchange=async e=>{const value=e.target.value;e.target.disabled=true;try{await loadVariant(value);}finally{e.target.disabled=false;syncModelUI();}};
  function rooms(){return current()?navigationRooms(current().definition.info):[];}
  const room=()=>rooms().find(r=>r.id===roomId)||rooms()[0];
  const places=()=>current()?navigationPlaces(current().definition.info):[];
  const selectedPlace=()=>places().find(p=>p.id===placeId)||room();
  const item=()=>current()?.staging.items.find(i=>i.id===selection&&!i.deleted);
  const key=()=>layoutStorageKey(serviceSelection,current().key,current().definition.info.finishRevision||1);
  function placementRoom(i){const saved=assignments.get(i.id);return rooms().find(r=>r.id===saved)||rooms().find(r=>inside(i,r))||room();}
  const doorAreas=new WeakMap();
  function clearances(){const definitions=current().definition.doors;if(!doorAreas.has(definitions))doorAreas.set(definitions,doorFootprints(definitions));return doorAreas.get(definitions);}
  function warnings(i){return placementWarnings(i,placementRoom(i),current().staging.items,current().staging.obstacles,clearances());}
  function showWarnings(){
    const host=$('placement-warnings');host.replaceChildren();
    const messages=current().staging.items.filter(i=>!i.deleted).flatMap(i=>warnings(i).map(message=>`${i.title}: ${message}`));
    host.classList.toggle('has-warnings',messages.length>0);
    const title=document.createElement('strong');title.textContent=messages.length?`배치 확인 필요 · ${messages.length}건`:'배치 경고 없음';host.append(title);
    if(messages.length){const list=document.createElement('ul');for(const message of messages){const li=document.createElement('li');li.textContent=message;list.append(li);}host.append(list);}
  }
  function selectFloor(value,{focus=false}={}){
    const previousHeight=tower.floorHeight(tower.selected,floor);
    floor=Math.max(1,Math.min(tower.selected.floors,Math.round(Number(value))));tower.setFloor(floor);tower.setCutawayEnabled(true);$('context-cutaway').setAttribute('aria-pressed',String(tower.cutawayState.active));$('floor-range').max=tower.selected.floors;$('floor-range').value=floor;$('floor-value').textContent=`${tower.selected.title} · ${floor}층`;$('floor-range').setAttribute('aria-valuetext',`${floor}층`);$('floor-down').disabled=floor===1;$('floor-up').disabled=floor===tower.selected.floors;
    $('building-evidence').textContent=`${tower.selected.title} · OSM ${tower.selected.floors}층 / ${tower.selected.height_m.toFixed(0)}m · 표시 층간격 약 ${(tower.selected.height_m/tower.selected.floors).toFixed(2)}m${tower.selected.data_warnings?.length?' · 파트 층수 상충 있음':''}`;
    $('open-unit').disabled=false;$('studio-variant').disabled=false;
    $('floor-availability').textContent=`${tower.selected.title} ${floor}층의 실제 호·타입은 확인되지 않았습니다. 아래 체험 평면은 이 층의 세대를 뜻하지 않습니다.`;
    $('open-unit').textContent='선택한 체험 평면 열기 →';
    $('studio-variant').hidden=false;$('unit-options').querySelector('label[for="studio-variant"]').hidden=false;$('unit-area').hidden=false;
    for(const b of rail.children){const n=Number(b.dataset.floor);b.hidden=n>tower.selected.floors;b.textContent=`${n}F`;b.classList.toggle('selected',n===floor);b.classList.remove('demo-floor');b.setAttribute('aria-pressed',String(n===floor));}
    if(buildingSelected){serviceSelection={...serviceSelection,building:tower.selected.id,floor,unit:'',unitType:'unknown',buildingType:'',typeEvidence:'',typeScope:''};notifySelection();}
    if(mode==='complex'&&buildingSelected){$('three-label').querySelector('strong').textContent=`${tower.selected.title} · ${floor}층 강조`;if(focus)setContextView('focus');else followFloorHeight(tower.floorHeight(tower.selected,floor)-previousHeight);}dirty(true);
  }
  function status(text){$('studio-status').textContent=text;}
  function dirty(shadows=false){invalidate(shadows);}
  function frame(bounds,top=false){const [x1,z1,x2,z2]=bounds,cx=(x1+x2)/2,cz=(z1+z2)/2,span=Math.max(x2-x1,z2-z1);const fit=Math.max(z2-z1,(x2-x1)/camera.aspect)/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)))*1.18;orbit.target.set(cx,.2,cz);camera.up.set(0,1,0);camera.position.set(cx+(top?0:span*.7),top?fit:Math.max(span,fit*.65),cz+(top?.001:span*.8));camera.lookAt(orbit.target);orbit.update();dirty();}
  function setMode(next){
    if(!current())return;
    surfaceEditor?.setEditing(false);
    stopFloorCamera();unlock();mode=next;onModeChange(mode);document.body.dataset.studioMode=mode;
    commonStart.hidden=mode!=='tour';
    if(mode!=='tour'){commonBadge.hidden=true;commonStart.textContent='현관 밖 둘러보기 · 예시 공용부';}orbit.enabled=mode!=='tour';
    if(mode==='overview')whole=true;$('studio-room').value=mode==='overview'?WHOLE:placeId;roomActions();
    camera.far=mode==='complex'?1200:mode==='tour'?350:80;camera.updateProjectionMatrix();
    if(mode==='complex'&&buildingSelected){tower.ensure();complex=tower.group;}
    complex.visible=mode==='complex'&&buildingSelected;current().model.visible=mode!=='complex';
    hero.hidden=mode!=='complex'||buildingSelected;rail.hidden=mode!=='complex'||!buildingSelected;
    contextBar.hidden=rail.hidden;photoPanel.hidden=true;
    dock.hidden=mode!=='edit';
    if(mode==='edit'){$('view-action-bar').append($('room-walk'));$('dock-status').append($('studio-status'));}
    else{originalWalkHost.prepend($('room-walk'));$('studio-sidebar').append($('studio-status'));}
    orbit.maxDistance=mode==='complex'?550:90;
    exterior.group.visible=mode==='tour'&&exteriorEnabled;badge.hidden=!exterior.group.visible;
    renderer.clippingPlanes=['overview','edit'].includes(mode)?[clipping]:[];dirty(true);
    $('unit-picker').hidden=mode!=='complex';$('room-picker').hidden=mode==='complex';$('editor-tools').hidden=mode!=='edit';
    $('plan-pane').hidden=!['overview','edit'].includes(mode);$('back-plan').hidden=mode!=='tour';
    $('mode-edit').disabled=mode==='complex';$('mode-tour').disabled=mode==='complex';
    $('mode-edit').classList.toggle('selected',mode==='edit');$('mode-tour').classList.toggle('selected',mode==='tour');
    $('studio-step').textContent=mode==='complex'?'새로운 집 찾기':mode==='overview'?'우리 집':mode==='edit'?'꾸미기':'둘러보기';
    $('studio-title').textContent=mode==='complex'?'살아볼 공간을 선택하세요.':mode==='overview'?'우리 집을 한눈에.':mode==='edit'?`${room().name_ko} 꾸미기`:`${selectedPlace().name_ko} 둘러보기`;
    $('studio-description').textContent=mode==='complex'?'단지를 둘러보고 체험할 평면을 선택하세요.':mode==='overview'?'평면도나 3D에서 장소를 선택하세요.':mode==='edit'?'왼쪽에서 배치하면 오른쪽 공간에 바로 반영됩니다.':`방을 선택한 뒤 둘러보기를 시작하세요. ${hint('walk')}`;
    $('three-label').querySelector('strong').textContent=mode==='complex'?(buildingSelected?`${tower.selected.title} · ${floor}층 강조`:'아크로 리버파크'):mode==='overview'?(actualUnit()?`${actualUnit().building}동 ${actualUnit().unit}호 · ${current().definition.unitType} · 확장 여부 선택 보기`:'체험 평면 · 실제 세대 대응 미확인'):mode==='edit'?'실시간 3D':'1인칭 둘러보기';

    $('orbit-help').textContent=hint(mode==='tour'?'tour':'orbit');
    requestAnimationFrame(()=>{resize();if(mode==='complex')selectFloor(floor,{focus:true});else if(mode==='overview')frame(unitBounds(),true);else if(mode==='edit')frame(room().bounds_m);dirty();});
    if(mode==='edit'){selection=current().staging.items.find(i=>!i.deleted&&inside(i,room()))?.id||null;}
    renderPlan();refreshItems();showWarnings();status('');
    for(const extension of extensions)extension.onMode?.(mode);
  }
  // With the whole unit selected, name the room the walk/edit buttons will open.
  function roomActions(){
    const r=selectedPlace();
    $('studio-room-dimensions').textContent=r?`${r.source_room_id?'구역':'방'} 최대 외곽 범위 ${(r.width_m??r.bounds_m[2]-r.bounds_m[0]).toFixed(3)} m × ${(r.depth_m??r.bounds_m[3]-r.bounds_m[1]).toFixed(3)} m · 천장 ${(current().definition.info.ceilingHeight_m??current().definition.info.ceiling_m??2.6).toFixed(2)} m. ${current().definition.coordinateBased?'아키스케치 좌표':'모델 경계'} 기준입니다. 위치별 벽 사이 폭은 달라질 수 있으며, 가구 여유폭이나 실측값을 뜻하지 않습니다.`:'';
    const all=mode==='overview'&&whole;
    $('room-walk').textContent=all?`${r.name_ko}에서 둘러보기`:'이곳에서 둘러보기';
    $('room-edit').textContent=all?`${r.name_ko} 꾸미기`:'이곳 꾸미기';
  }
  function inside(i,r){return pointInRoom(r,i.x,i.z);}
  function refreshRooms(){
    const value=roomId;
    $('studio-room').replaceChildren();
    const all=document.createElement('option');all.value=WHOLE;all.textContent='전체 보기 · 2D/3D 평면';$('studio-room').append(all);
    for(const r of places()){const o=document.createElement('option');o.value=r.id;o.textContent=r.name_ko;$('studio-room').append(o);}
    roomId=rooms().some(r=>r.id===value)?value:(current().definition.info.defaultRoom||rooms()[0].id);
    if(!places().some(p=>p.id===placeId))placeId=places().find(p=>(p.source_room_id||p.id)===roomId)?.id||places()[0].id;
    $('studio-room').value=mode==='overview'&&whole?WHOLE:placeId;
    for(const i of current().staging.items){const k=i.id;if(!assignments.has(k))assignments.set(k,placementRoom(i).id);}
  }
  function chooseRoom(id){
    if(id===WHOLE){serviceSelection.room='';serviceSelection.physicalRoom='';notifySelection();if(mode==='overview'){whole=true;$('studio-room').value=WHOLE;roomActions();renderPlan();frame(unitBounds(),true);status('');}else setMode('overview');return;}
    const place=places().find(p=>p.id===id)||places().find(p=>p.source_room_id===id);
    if(!place)return;
    placeId=place.id;roomId=place.source_room_id||place.id;serviceSelection.room=place.id;serviceSelection.physicalRoom=roomId;notifySelection();whole=false;$('studio-room').value=placeId;roomActions();
    if(mode==='edit')setMode('edit');else{renderPlan();status(`${place.name_ko} 선택됨. 둘러보기 또는 꾸미기를 눌러 주세요.`);}
  }
  function refreshItems(){
    if(!current())return;const host=$('selected-item');host.replaceChildren();
    for(const i of current().staging.items.filter(i=>!i.deleted&&placementRoom(i).id===roomId)){const o=document.createElement('option');o.value=i.id;o.textContent=i.title;host.append(o);}
    if(!item()||placementRoom(item()).id!==roomId)selection=host.options[0]?.value||null;
    host.value=selection||'';const selected=item();
    const catalog=selected&&catalogByKind.get(selected.kind);
    $('item-size').textContent=catalog?`${selected.title} · ${catalogSize(catalog)} · 제품 실측 미확인`:selected?`${selected.title} · 외곽 ${(selected.width*100).toFixed(1)} × ${(selected.depth*100).toFixed(1)}cm`:'배치할 가구를 추가해 보세요.';
    $('item-x').value=selected?selected.x.toFixed(2):'';$('item-z').value=selected?selected.z.toFixed(2):'';
    for(const id of ['apply-position','rotate-item','remove-item','item-x','item-z'])$(id).disabled=!selected;
    const old=$('add-kind').value;$('add-kind').replaceChildren();
    for(const [kind,source] of current().staging.templates){if(catalogByKind.has(kind))continue;const o=document.createElement('option');o.value=kind;o.textContent=source.title.replace('안방 ','').replace('서쪽 ','');$('add-kind').append(o);}
    const catalogOptions=document.createElement('optgroup');catalogOptions.label='CC0 모델 가구';
    for(const asset of CATALOG_FURNITURE){const o=document.createElement('option');o.value=asset.kind;o.textContent=asset.title;catalogOptions.append(o);}$('add-kind').append(catalogOptions);
    if([...$('add-kind').options].some(o=>o.value===old))$('add-kind').value=old;
    updateCatalogNote();
  }
  const wallPaths=new WeakMap();
  function renderPlan(){
    if(!current()||!room())return;
    const plan=$('layout-plan'),b=[...(mode==='edit'?room().bounds_m:unitBounds())],pad=.25;
    // Keep freely dragged furniture visible and selectable beyond the room edge.
    if(mode==='edit'&&!drag)for(const i of current().staging.items.filter(i=>!i.deleted&&placementRoom(i).id===roomId))for(const [x,z] of corners(i)){b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],z);b[2]=Math.max(b[2],x);b[3]=Math.max(b[3],z);}
    plan.setAttribute('viewBox',drag?.viewBox||`${b[0]-pad} ${b[1]-pad} ${b[2]-b[0]+2*pad} ${b[3]-b[1]+2*pad}`);plan.replaceChildren();
    $('plan-title').textContent=mode==='edit'?`${room().name_ko} · 2D 배치도`:'세대 평면 · 장소 선택';
    for(const r of mode==='edit'?current().definition.info.rooms:places()){
      if(mode==='edit'&&r.id!==roomId)continue;
      const [x,z,x2,z2]=r.bounds_m;const group=svg('g',{'data-room':r.id,class:`plan-room ${r.kind==='balcony'||r.kind==='open_balcony'?'balcony':''} ${r.id===(mode==='edit'?roomId:placeId)&&!(mode==='overview'&&whole)?'active':''}`});
      group.append(r.polygon_m?svg('polygon',{points:r.polygon_m.map(p=>p.join(',')).join(' ')}):svg('rect',{x,y:z,width:x2-x,height:z2-z,rx:.03}),svg('text',{x:(x+x2)/2,y:z+.27,'text-anchor':'middle'},r.id==='entrance'&&current().definition.info.entryReview?'':r.name_ko));
      group.addEventListener('click',()=>{if(mode==='overview')chooseRoom(r.id);});plan.append(group);
    }
    const entry=current().definition.info.entryReview;
    if(entry&&(mode!=='edit'||roomId==='living-kitchen-hall')){
      const [x,z,x2,z2]=entry.gross_bounds_m;
      plan.append(svg('rect',{x,y:z,width:x2-x,height:z2-z,class:'plan-entry'}));
      plan.append(svg('text',{x:(x+x2)/2,y:(z+z2)/2,'text-anchor':'middle',class:'plan-entry-label'},'현관'));
    }
    for(const o of current().staging.obstacles){const x=Math.max(b[0],o.x-o.width/2),z=Math.max(b[1],o.z-o.depth/2),x2=Math.min(b[2],o.x+o.width/2),z2=Math.min(b[3],o.z+o.depth/2);if(x2>x&&z2>z)plan.append(svg('rect',{x,y:z,width:x2-x,height:z2-z,class:'plan-fixed'}));}
    if(current().definition.info.wallSlice){
      const walls=svg('g',{class:'plan-walls','fill-rule':'evenodd'});
      current().model.traverse(o=>{
        if(!o.isMesh||current().definition.info.objects[o.userData.object_id]?.category!=='Structure')return;
        if(!wallPaths.has(o))wallPaths.set(o,wallSectionPath(o));
        const d=wallPaths.get(o);if(d)walls.append(svg('path',{d}));
      });plan.append(walls);
      for(const o of current().definition.info.openings ?? []){
        if(!['window','sliding'].includes(o.kind))continue;
        const [x,z]=o.center_m,dx=o.axis==='x'?o.width_m/2:0,dz=o.axis==='z'?o.width_m/2:0;
        plan.append(svg('line',{x1:x-dx,y1:z-dz,x2:x+dx,y2:z+dz,class:'plan-window'}));
      }
      for(const door of current().doors.filter(d=>d.definition.type==='hinged')){
        const [x1,y1,x2,y2]=hingedSegment(door.definition,door.progress);
        plan.append(svg('line',{x1,y1,x2,y2,class:'plan-door-leaf'}));
        if(door.definition.operationBasis==='furnished_reference_plan_image'){
          const points=Array.from({length:17},(_,i)=>hingedSegment(door.definition,i/16).slice(2).join(',')).join(' ');
          plan.append(svg('polyline',{points,class:'plan-door-swing'}));
        }
      }
    }
    for(const d of clearances()){if(mode==='edit'&&!inside(d,room()))continue;plan.append(svg('polygon',{points:corners(d).map(p=>p.join(',')).join(' '),class:'plan-door-clearance'}));}
    for(const i of current().staging.items){
      if(i.deleted||mode==='edit'&&placementRoom(i).id!==roomId)continue;
      const g=svg('g',{'data-item':i.id,class:`plan-item ${i.height<.05?'flat':''} ${selection===i.id?'selected':''} ${warnings(i).length?'warning':''}`,tabindex:mode==='edit'?0:-1,role:'button','aria-label':`${i.title}, X ${i.x.toFixed(2)}m, Z ${i.z.toFixed(2)}m`});
      g.append(svg('polygon',{points:corners(i).map(p=>p.join(',')).join(' ')}),svg('text',{x:i.x,y:i.z,'text-anchor':'middle','dominant-baseline':'middle'},catalogByKind.get(i.kind)?.title??i.label??(i.kind==='sofa'?'소파':i.kind==='stool'?'스툴':i.kind==='king'?'킹':i.kind==='desk'?'책상':i.kind==='chair'?'의자':i.kind==='coffee-table'?'테이블':i.kind==='dining-table'?'식탁':i.label||i.title)));
      g.addEventListener('pointerdown',e=>{if(mode!=='edit')return;e.preventDefault();selection=i.id;const p=planPoint(e);drag={id:i.id,dx:i.x-p.x,dz:i.z-p.y,viewBox:plan.getAttribute('viewBox')};plan.setPointerCapture(e.pointerId);refreshItems();renderPlan();});
      g.addEventListener('keydown',e=>{if(mode!=='edit')return;const d={ArrowLeft:[-.05,0],ArrowRight:[.05,0],ArrowUp:[0,-.05],ArrowDown:[0,.05]}[e.key];if(!d)return;e.preventDefault();selection=i.id;moveSelected({x:i.x+d[0],z:i.z+d[1]});plan.querySelector(`[data-item="${i.id}"]`)?.focus();});plan.append(g);
    }
  }
  function planPoint(e){const p=new DOMPoint(e.clientX,e.clientY);return p.matrixTransform($('layout-plan').getScreenCTM().inverse());}
  function moveSelected(patch,commit=true){
    const candidate=item()?{...item(),...patch}:null;
    const doorError=candidate&&!allowOverlap?placementWarnings(candidate,room(),[],[],clearances()).find(s=>s.includes('개방 범위')):null;
    const error=doorError||current().staging.move(selection,patch,room(),commit,allowOverlap);
    status(error||'배치가 3D에 반영됐어요.');refreshItems();renderPlan();showWarnings();dirty(true);return error;
  }
  let pendingDrag=null,dragFrame=0;
  function flushDrag(){dragFrame=0;if(!drag||!pendingDrag)return;const p=pendingDrag;pendingDrag=null;selection=drag.id;moveSelected({x:Math.round((p.x+drag.dx)*100)/100,z:Math.round((p.y+drag.dz)*100)/100},false);}
  $('layout-plan').addEventListener('pointermove',e=>{if(!drag)return;pendingDrag=planPoint(e);if(!dragFrame)dragFrame=requestAnimationFrame(flushDrag);});
  function endDrag(){if(!drag)return;if(dragFrame)cancelAnimationFrame(dragFrame);flushDrag();drag=null;current().staging.rebuild();renderPlan();dirty(true);}
  $('layout-plan').addEventListener('pointerup',endDrag);$('layout-plan').addEventListener('pointercancel',endDrag);$('layout-plan').addEventListener('lostpointercapture',endDrag);
  $('select-building').onclick=()=>{buildingSelected=true;buildingSelect.value=tower.selected.id;$('unit-options').hidden=false;setMode('complex');selectFloor(floor);requestAnimationFrame(()=>rail.querySelector(`[data-floor="${floor}"]`)?.scrollIntoView({block:'center'}));};
  $('hero-building').onclick=()=>$('select-building').click();
  installFloorControl({input:$('floor-range'),down:$('floor-down'),up:$('floor-up'),onChange:selectFloor});
  $('allow-overlap').onchange=e=>{allowOverlap=e.target.checked;status(allowOverlap?'겹침을 허용하고 경고로 안내합니다.':'이후 이동에서 겹침과 문 개방 간섭을 제한합니다. 기존 배치는 유지됩니다.');showWarnings();};
  $('exterior-enabled').onchange=e=>{exteriorEnabled=e.target.checked;exterior.group.visible=mode==='tour'&&exteriorEnabled;badge.hidden=!exterior.group.visible;dirty();};
  $('open-unit').onclick=async()=>{const button=$('open-unit');button.disabled=true;try{await loadVariant($('studio-variant').value);if(current().key!==$('studio-variant').value){status('세대 로딩에 실패했습니다. 다시 시도해 주세요.');return;}refreshRooms();setMode('overview');}finally{button.disabled=false;}};
  $('studio-room').onchange=e=>chooseRoom(e.target.value);
  function findHome(query = '') {
    if(parent!==window){parent.postMessage({type:'cortex:show-map'},new URL(document.referrer||location.href).origin);return;}
    const url=writeSelection(serviceBaseForPage(location.href,import.meta.env.VITE_SERVICE_BASE_URL),{...serviceSelection,serviceView:'map'});
    if(query)url.searchParams.set('query',query);
    location.href=url.href;
  }
  async function goHome(){
    // A selected address keeps its own supported model and layout scope.
    const home=actualUnit()?current().key:resolveVariant(readHome(current().key));
    if(current().key!==home){const loaded=await loadVariant(home);if(!loaded||current().key!==home)return false;refreshRooms();}
    $('studio-variant').value=current().key;setMode('overview');return true;
  }
  ui.querySelector('.studio-brand').onclick=e=>{e.preventDefault();buildingSelected=false;$('unit-options').hidden=true;setMode('complex');};
  $('nav-complex').onclick=()=>findHome();$('hero-building').onclick=()=>findHome();
  $('nav-plan').onclick=goHome;$('back-plan').onclick=()=>setMode('overview');
  function walk({capture=true}={}){setMode('tour');if(!enterRoom(selectedPlace(),{capture})){status('이 공간에서 안전한 시작 위치를 찾지 못했어요. 다른 장소를 선택해 주세요.');return false;}return true;}

  $('room-walk').onclick=walk;$('mode-tour').onclick=walk;$('mode-edit').onclick=()=>setMode('edit');$('room-edit').onclick=()=>setMode('edit');
  $('selected-item').onchange=e=>{selection=e.target.value;refreshItems();renderPlan();};
  $('apply-position').onclick=()=>moveSelected({x:Number($('item-x').value),z:Number($('item-z').value)});
  $('rotate-item').onclick=()=>{if(item())moveSelected({angle:(item().angle+Math.PI/2)%(Math.PI*2)});};
  $('remove-item').onclick=()=>{current().staging.remove(selection);selection=null;refreshItems();renderPlan();showWarnings();dirty(true);status('가구를 제거했어요.');};
  $('add-item').onclick=async()=>{
    if(furniturePending)return;
    const target=current(),token=operationToken(),targetRoom=room(),targetRoomId=roomId,targetPlaceId=placeId,kind=$('add-kind').value;
    const asset=catalogByKind.get(kind);
    try{
      if(asset){
        setFurniturePending('add');status(`${asset.title}를 불러오는 중이에요. 처음 사용 시 약 ${(asset.model_bytes/1e6).toFixed(1)} MB를 내려받습니다.`);
        await installCatalogTemplate(target.staging,kind);
        if(!operationCurrent(token)||current()!==target||roomId!==targetRoomId||placeId!==targetPlaceId||mode!=='edit'){
          status('선택한 공간이 바뀌어 추가하지 않았어요. 원하는 공간에서 다시 추가해 주세요.');return;
        }
      }
      const result=target.staging.add(kind,targetRoom,allowOverlap);
      if(result.error){status(result.error);return;}
      selection=result.item.id;assignments.set(selection,targetRoomId);
      refreshItems();renderPlan();showWarnings();dirty(true);
      status(asset?`${asset.title}를 원본 모델 크기로 추가했어요. 제품 실측값은 미확인입니다.`:'가구를 추가했어요.');
    }catch(error){status(`가구를 추가하지 못했어요. ${error.message}`);}
    finally{if(asset)setFurniturePending(null);}
  };
  $('save-layout').onclick=()=>{
    if(surfaceEditor?.pending||surfaceEditor?.loading){status('마감을 불러오는 중이에요. 완료 후 저장해 주세요.');return;}
    try{localStorage.setItem(key(),JSON.stringify({revision:2,items:current().staging.snapshot().map(i=>({...i,roomId:placementRoom(i).id})),surfaceFinishes:surfaceEditor?.snapshot()}));status(actualUnit()?`${actualUnit().building}동 ${actualUnit().unit}호 ${current().definition.label} 마감과 배치를 이 브라우저에 저장했어요.`:'이 브라우저에 마감과 배치를 저장했어요.');}catch{status('브라우저 저장 공간을 사용할 수 없어요.');}
  };
  $('restore-layout').onclick=async()=>{
    if(furniturePending)return;
    const target=current(),token=operationToken(),savedKey=key();let catalogLoading=false,surfaceRestore=null;
    setFurniturePending('restore');
    try{
      const data=JSON.parse(localStorage.getItem(savedKey));
      if(![1,2].includes(data?.revision)||!Array.isArray(data.items))throw Error();
      await generatedReady;
      if(!operationCurrent(token)||current()!==target)throw Error('평면이 바뀌어 복원하지 않았어요. 원하는 평면에서 다시 불러와 주세요.');
      if(data.items.some(i=>i?.kind?.startsWith('generated:')&&!target.staging.templates.has(i.kind)))throw Error('생성 가구를 불러오지 못했습니다. 모델이 저장된 서버 API·터널을 확인하세요.');
      const catalogKinds=[...new Set(data.items.filter(i=>i?.deleted!==true&&typeof i?.kind==='string'&&i.kind.startsWith('catalog:')).map(i=>i.kind))];
      // Resolve required templates before restoring, so a failed download leaves the current layout intact.
      for(const kind of catalogKinds){catalogLoading=true;status('저장된 CC0 가구를 불러오는 중이에요.');await installCatalogTemplate(target.staging,kind);}
      if(!operationCurrent(token)||current()!==target)throw Error('평면이 바뀌어 복원하지 않았어요. 원하는 평면에서 다시 불러와 주세요.');
      surfaceRestore=await surfaceEditor?.prepareRestore(data.revision===2?data.surfaceFinishes:null);
      if(!operationCurrent(token)||current()!==target)throw Error('평면이 바뀌어 복원하지 않았어요. 원하는 평면에서 다시 불러와 주세요.');
      if(surfaceEditor&&!surfaceRestore)throw Error('마감 선택이 바뀌어 복원하지 않았어요. 다시 불러와 주세요.');
      if(surfaceRestore&&!surfaceRestore.commit())throw Error('마감 선택이 바뀌어 복원하지 않았어요. 다시 불러와 주세요.');
      target.staging.restore(data.items,rooms());
      for(const i of data.items)if(rooms().some(r=>r.id===i?.roomId))assignments.set(i.id,i.roomId);
      refreshRooms();refreshItems();renderPlan();showWarnings();dirty(true);status('저장한 마감과 배치를 불러왔어요.');
    }catch(error){status(error.message?.includes('생성 가구')||error.message?.includes('평면이 바뀌어')||error.message?.includes('마감')?error.message:catalogLoading?`CC0 가구를 불러오지 못해 배치를 복원하지 않았어요. ${error.message}`:'이 평면에 저장된 유효한 배치가 없어요.');}
    finally{surfaceRestore?.discard();setFurniturePending(null);}
  };
  $('reset-layout').onclick=()=>{current().staging.reset();assignments.clear();refreshRooms();refreshItems();renderPlan();showWarnings();dirty(true);status('초기 배치로 되돌렸어요. 저장한 배치는 유지돼요.');};
  let pointerStart;
  renderer.domElement.addEventListener('pointerdown',e=>{pointerStart=[e.clientX,e.clientY];});
  renderer.domElement.addEventListener('pointerup',e=>{
    if(surfaceEditor?.editing)return;
    if(!pointerStart||Math.hypot(e.clientX-pointerStart[0],e.clientY-pointerStart[1])>5)return;
    const rect=renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);
    if(mode==='complex'&&buildingSelected){const hit=tower.hitTest(raycaster);if(hit){if(hit.id!==tower.selected.id)chooseBuilding(hit.id);selectFloor(hit.floor);}}
    if(mode==='overview'){const p=new THREE.Vector3();if(raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),p)){const r=places().find(r=>inside({x:p.x,z:p.z},r));if(r)chooseRoom(r.id);}}
  });
  function installGeneratedTemplates(){
    for(const {asset,group} of generatedModels.values())installGeneratedTemplate(current().staging,asset,group);
  }
  async function importGeneratedAssets(assets,place=false){
    const token=operationToken(),imported=[];
    for(const asset of assets){
      try{
        const group=await loadGeneratedModel(asset);
        generatedModels.set(asset.asset_id,{asset,group});imported.push(asset);
      }catch(error){status(`측정 결과는 보존했습니다. GLB 연결 실패: ${error.message}`);}
    }
    installGeneratedTemplates();refreshItems();
    if(place&&!operationCurrent(token)){status('세대가 바뀌어 자동 배치하지 않았어요. 가구 추가 목록에서 선택해 주세요.');return imported;}
    if(place&&imported.length){
      setMode('edit');
      let placed=0;
      const placementErrors=[];
      for(const asset of imported){
        const kind=generatedKind(asset);
        const existing=current().staging.items.find(i=>i.kind===kind&&!i.deleted);
        const result=existing?{item:existing}:current().staging.add(kind,room(),allowOverlap);
        if(result.error){placementErrors.push(result.error);continue;}
        selection=result.item.id;assignments.set(selection,roomId);
        placed++;
      }
      refreshItems();renderPlan();showWarnings();dirty(true);
      status(`테스트 모델 ${placed}개를 배치했어요. 사진 재현/GPT 생성 결과가 아닙니다.${placementErrors.length?` 배치 실패: ${placementErrors.join(' ')}`:''}`);
    }
    return imported;
  }
  async function initializeGeneratedAssets(){
    const requested=new URLSearchParams(location.search).get('furnitureAsset');
    if(import.meta.env.VITE_FURNITURE_MEASUREMENT_ENABLED==='0'&&!requested)return;
    try{
      const assets=await fetchGeneratedAssets();
      await importGeneratedAssets(assets);
      if(requested){
        const asset=assets.find(a=>a.asset_id===requested);
        if(!asset)throw Error('요청한 생성 가구가 없습니다. 서버 API와 모델 파일을 확인하세요.');
        await importGeneratedAssets([asset],true);
      }
    }catch(error){if(requested)status(error.message);}
  }
  const hooks={ui,current,goHome,findHome,get buildingSelected(){return buildingSelected;},
    async loadVariant(key){
      const canonical=resolveVariant(key),unit=actualUnit();
      if(unit&&!getUnitModelVariants(unit).includes(canonical)){status('선택한 세대에서는 이 평면을 지원하지 않아요. 새로운 집 찾기에서 다른 체험 평면을 선택해 주세요.');return false;}
      if(current()?.key!==canonical)await loadVariant(canonical);
      $('studio-variant').value=current().key;return current().key===canonical;
    },
    get layoutScope(){return layoutState.current;},rooms,frame,status,exterior,setMode,selectRoom:chooseRoom,invalidate:dirty,settle,standAt,resume,previewRoom:()=>walk({capture:isTouchFirst()}),get mode(){return mode;},
    refreshLayout(){assignments.clear();refreshRooms();refreshItems();renderPlan();showWarnings();dirty(true);},
    warnings:()=>current().staging.items.filter(i=>!i.deleted).map(i=>({id:i.id,title:i.title,messages:warnings(i)}))};
  syncLayout(current());
  const concepts=createConceptStudio(hooks);
  const extensions=[concepts,createWindowView(hooks),createHouseTours(hooks,concepts.api)];
  refreshRooms();syncModelUI();setMode(initialMode==='overview'?'overview':'complex');ready=true;
  if(serviceSelection.room)chooseRoom(serviceSelection.room);
  const serviceNav=document.createElement('a');serviceNav.id='service-map-link';serviceNav.textContent='← 지도에서 위치 찾기';
  const serviceURL=serviceBaseForPage(location.href,import.meta.env.VITE_SERVICE_BASE_URL);
  serviceNav.href=writeSelection(serviceURL,{...serviceSelection,serviceView:'map'}).href;serviceNav.style.cssText='font-size:12px;margin-left:14px;color:inherit';ui.querySelector('.studio-header nav').prepend(serviceNav);
  serviceNav.onclick=e=>{if(parent!==window){e.preventDefault();parent.postMessage({type:'cortex:show-map'},new URL(document.referrer||location.href).origin);}else serviceNav.href=writeSelection(serviceURL,{...serviceSelection,serviceView:'map'}).href;};
  const parentOrigin=new URL(document.referrer||location.href).origin;
  window.addEventListener('message',async event=>{
    if(parent===window||event.source!==parent||event.origin!==parentOrigin||event.data?.type!=='cortex:selection')return;
    const next=readSelection(writeSelection(location.href,event.data.selection).href);
    const unit=next.locationId==='acro-river-park'?lookupUnit(next.building,next.floor,next.unit):null;
    if(next.unit&&next.locationId==='acro-river-park'&&(!unit||!getUnitModelVariants(unit).length)){
      status('선택한 호수의 실내 모델은 준비되지 않았어요. 지도에서 지원하는 세대를 선택해 주세요.');return;
    }
    const requested=unit?variantForUnit(unit,next.sampleVariant):next.sampleVariant;
    if(!Object.hasOwn(VARIANTS,requested))return;
    const previousSelection=serviceSelection;
    const request=++selectionRequest;selectionEpoch++;
    pendingServiceSelection={...next,sampleVariant:requested};
    // Even a cached same-type request cancels an older pending type load.
    const loaded=await loadVariant(requested);if(request!==selectionRequest)return;
    if(!loaded||current().key!==requested){pendingServiceSelection=null;serviceSelection=previousSelection;syncModelUI();parent.postMessage({type:'cortex:viewer-error'},parentOrigin);return;}
    if(serviceSelection.building)tower.selectBuilding(serviceSelection.building);
    if(serviceSelection.floor)floor=serviceSelection.floor;
    if(syncLayout(current())){for(const door of current().doors){door.setProgress(0);door.target=0;}refreshRooms();for(const extension of extensions)extension.onVariant?.();setMode('overview');}
    syncModelUI();refreshItems();renderPlan();showWarnings();dirty(true);
    if(serviceSelection.room)chooseRoom(serviceSelection.room);else chooseRoom(WHOLE);
    notifySelection();parent.postMessage({type:'cortex:viewer-ready',variant:current().key},parentOrigin);
  });
  if(parent!==window)parent.postMessage({type:'cortex:viewer-ready',variant:current().key},parentOrigin);


  const generatedReady=initializeGeneratedAssets();
  return {getSelection:()=>pendingServiceSelection??serviceSelection,onVariant(){if(!ready)return;if(pendingServiceSelection){serviceSelection=pendingServiceSelection;pendingServiceSelection=null;}syncLayout(current());installGeneratedTemplates();refreshRooms();syncModelUI();setMode(mode==='tour'?'overview':mode);for(const extension of extensions)extension.onVariant?.();refreshItems();},get mode(){return mode;},
    inspect:()=>({layoutScope:layoutState.current,layoutEpoch:layoutState.epoch,storageKey:key(),siteBuilt:tower.built,serviceSelection,mode,roomId,placeId,selection,floor,contextView,cutaway:tower.inspectCutaway(),rendererLocalClipping:renderer.localClippingEnabled,contextCamera:{position_m:camera.position.toArray(),target_m:orbit.target.toArray()},visibleBuildings:tower.buildings.filter(b=>b.tower.visible).map(b=>b.id),buildingPresentation:tower.buildings.map(b=>({id:b.id,opacity:b.material.opacity,depthWrite:b.material.depthWrite})),buildingId:tower.selected.id,buildingCount:tower.buildings.length,siteAppearance:{environment:tower.appearance.state,facadeWindows:tower.buildings.reduce((sum,b)=>sum+b.facade.userData.windowCount,0)},building:{id:tower.selected.id,floors:tower.selected.floors,height_m:tower.selected.height_m,floorHeight_m:tower.floorHeight(tower.selected,floor)},allowOverlap,exteriorVisible:exterior.group.visible,warnings:current().staging.items.filter(i=>!i.deleted).map(i=>({id:i.id,messages:warnings(i)})),items:current().staging.snapshot(),positions:current().staging.items.map(i=>({id:i.id,position:i.group.position.toArray(),rotation:i.group.rotation.y,visible:i.group.visible}))}),
    selectRoom:chooseRoom,setMode,moveSelected,setLighting:exterior.setLighting};
}
