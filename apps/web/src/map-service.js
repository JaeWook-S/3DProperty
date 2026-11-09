import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './map-service.css';
import {createPlanMeasurements} from './plan-measurements.js';
import {appendPlanArchitecture} from './plan-architecture.js';
import {appendPlanRoomLabel} from './plan-room-labels.js';
import {ACRO,INHA,PREPARED_PLACES,createPlaceSearch} from './place-search.js';
import {VARIANTS,DEFAULT_VARIANT,buildViewerUrl,buildFloorAccessUrl} from './viewer-url.js';
import {getBuildingUnits,getFloorUnits,lookupUnit,getUnitModelVariants,variantForUnit,UNIT_CATALOG_SOURCE} from '../../../src/property/unit-catalog.js';
import {normalizeSelection,readSelection,writeSelection} from '../../../src/property/service-selection.js';

const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const NS='http://www.w3.org/2000/svg';
export function createMapService({host,viewerBase}){
 let evidence=null,evidencePromise,sitePromise;
 let selection=readSelection(location.href),places=[...PREPARED_PLACES],resultMode='ready',selected=null,site=null,map=null,markers=new Map(),search,searchSequence=0,planSequence=0,frameKey='',planData=null,siteFrameLoaded=false,siteSelectionRevision=0;
 if(selection.locationId!==INHA.id&&!Object.hasOwn(VARIANTS,selection.sampleVariant))selection.sampleVariant=DEFAULT_VARIANT;
 const prepared=PREPARED_PLACES.find(p=>p.id===selection.locationId);
 if(prepared){selected=prepared;selection=normalizeSelection({...selection,locationName:prepared.name,address:prepared.address,lat:prepared.lat,lon:prepared.lon});}
 else if(selection.locationId&&selection.lat!==null&&selection.lon!==null){selected={id:selection.locationId,name:selection.locationName||'선택한 위치',address:selection.address,lat:selection.lat,lon:selection.lon,ready:false,source:`https://www.openstreetmap.org/?mlat=${selection.lat}&mlon=${selection.lon}`,sourceLabel:'URL에 저장한 위치 · 세대 정보 미확인'};}
 host.innerHTML=`<div class="explore-shell"><aside class="place-sidebar"><p class="eyebrow">A PLACE TO BEGIN</p><h1>어디에서 살아볼까요?</h1><p class="explore-intro">단지와 캠퍼스를 둘러보고,<br>준비된 공간을 체험하세요.</p><form id="place-search"><label for="place-query" class="visually-hidden">지역·주소·단지·학교 검색</label><div class="search-field"><span aria-hidden="true">⌕</span><input id="place-query" type="search" placeholder="지역, 주소, 단지 또는 학교 이름" maxlength="120" autocomplete="off"><button type="submit">검색</button></div></form><div class="search-examples"><button data-search="서울역">서울역</button><button data-search="인하대">인하대</button><button id="ready-place">3D 체험 가능</button></div><p id="search-status" class="map-status" role="status" aria-live="polite">위치를 검색하거나 지도에서 직접 선택하세요.</p><div class="result-heading"><h2 id="result-title">준비된 공간</h2><span id="result-count">2곳</span></div><div id="place-results" aria-label="위치 검색 결과"></div><div id="place-detail" hidden><div class="detail-top"><span id="place-readiness" class="readiness"></span><h2 id="selected-place-name"></h2><p id="selected-place-address"></p><p id="selected-point-note" hidden>지도에서 지정한 좌표입니다. 실제 건물이나 준비된 3D 단지를 뜻하지 않습니다.</p><button id="clear-selected-point" class="subtle" type="button" hidden>위치 선택 해제</button></div><div class="unit-fields" role="group" aria-label="동·층·호수 선택"><label for="selected-building">동<select id="selected-building"><option value="">동 선택</option></select></label><label for="selected-floor">층<select id="selected-floor" disabled><option value="">층 선택</option></select></label><label class="unit-select-label" for="selected-unit">호수<select id="selected-unit"><option value="">호수 선택</option></select></label></div><p class="mapping-status">선택 세대 타입: <strong id="unit-mapping">미확인</strong></p><section id="sample-models" hidden><label for="sample-variant">기본형 / 확장형 보기</label><select id="sample-variant"></select><p id="renovation-note" class="detail-note">실제 확장 여부는 미확인입니다. 기본형·확장형은 비교할 평면으로 선택하세요.</p><button id="sample-preview" class="subtle">호수와 별개로 전체 체험 평면 보기</button><div class="detail-actions"><button id="open-plan">2D 평면</button><button id="open-3d" class="solid">3D 체험 →</button></div><button id="open-site" class="subtle">동·층 선택 · 3D 단지투어</button><a id="open-floor-access" class="floor-access-link" aria-describedby="floor-access-basis">가구 반입 검토 · 가정 배치</a><p id="floor-access-basis" class="detail-note">168C 확장형 두 세대와 가정한 홀·엘리베이터를 살펴봅니다. 선택한 동·층의 실제 배치가 아닙니다.</p></section><section id="campus-preview" class="campus-preview" hidden><h3>캠퍼스 외관 둘러보기</h3><p>인하대학교 본캠퍼스의 건물과 주변 공간을 둘러보세요.</p><p class="campus-interior-status">실내 공간은 준비 중입니다.</p><button id="open-campus" type="button">캠퍼스 3D 열기 →</button></section><details id="selection-sources" class="selection-sources"><summary>출처</summary><div class="selection-source-content"><a id="place-source" target="_blank" rel="noopener">위치 출처 ↗</a><p id="building-basis" class="detail-note"></p><section id="building-type-evidence" class="type-evidence" hidden></section><p id="unit-source-detail" class="detail-note">동·호수는 사용자 제공 자료 기준이며, 실제 확장 여부·좌우 반전·방향·내부 시공 상태는 확인되지 않았습니다.</p><details id="source-plan-catalog" hidden><summary>단지 도면 출처 목록</summary><p class="detail-note">아키스케치에서 확인한 목록이며 단지 전체 조사나 해당 동·층·호의 배정을 뜻하지 않습니다.</p><div id="catalog-links"></div></details></div></details><section id="plan-request" hidden><h3>이 위치의 도면이 아직 없어요.</h3><p>등록된 도면과 3D 모델이 없습니다. 필요한 위치를 요청서로 남겨 두세요.</p><button id="save-plan-request">도면 요청서 저장</button><p id="request-status" class="detail-note" role="status">이 브라우저에 저장하는 요청 초안입니다. 서버 접수나 제작 예약은 아닙니다.</p><a id="download-plan-request" hidden download="cortex-floorplan-request.json">요청서 JSON 다운로드 ↓</a></section></div><p class="search-credit">장소 검색: Photon · OpenStreetMap<br>준비된 위치는 바로 찾습니다. 그 외 검색어는 검색 제공자에게 전송됩니다.</p></aside><section class="map-workspace" aria-label="지도와 평면 탐색"><div class="map-toolbar"><div class="view-switch" role="group" aria-label="보기 전환"><button data-service-view="map" aria-pressed="true">지도</button><button data-service-view="site" aria-pressed="false" disabled>단지투어</button><button data-service-view="plan" aria-pressed="false" disabled>2D 평면</button><button data-service-view="3d" aria-pressed="false" disabled>실내 3D</button></div><span id="workspace-context">위치에서 공간까지</span><button id="copy-location-link" title="현재 선택 링크 복사">링크 복사</button></div><div id="map-stage"><div id="location-map" aria-label="위치 선택 지도"></div><div class="map-guide"><span class="map-guide-dot"></span><div><strong>지도 위에서 시작하세요</strong><span>핀과 목록은 함께 선택됩니다 · 빈 곳을 눌러 위치 지정</span></div></div><p id="tile-status" role="status" hidden></p><a class="map-issue" href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener">지도 오류 알리기 ↗</a></div><div id="plan-stage" hidden><div class="plan-title"><div><p class="eyebrow">EXPLORE IN 2D</p><h2 id="plan-name"></h2><p>기본형·확장형의 방 배치를 비교하고, 보고 싶은 방을 선택하세요. 실내 3D에서 둘러보거나 꾸밀 수 있어요.</p></div><div class="plan-zoom"><button id="plan-zoom-out" aria-label="평면 축소">−</button><button id="plan-fit">전체</button><button id="plan-zoom-in" aria-label="평면 확대">＋</button></div></div><div id="plan-measure-toolbar" class="plan-measure-toolbar"></div><p class="plan-measure-help">거리 측정은 가로·세로 폭 또는 두 점 거리를 선택한 뒤 시작하세요.</p><label class="plan-room-picker" for="plan-room-select">공간 선택<select id="plan-room-select" aria-label="평면에서 볼 공간 선택"><option value="">전체 평면</option></select></label><svg id="service-plan" role="img" aria-label="미터 좌표 기반 체험 평면"></svg><div class="plan-room-actions"><p id="plan-room-note" role="status"></p><button id="plan-open-3d" type="button" disabled>실내 3D 열기</button></div><div id="plan-measure-output" class="plan-measure-output"></div><p id="plan-source" class="detail-note"></p></div><div id="site-stage" hidden><p id="site-load-status" role="status">3D 단지를 불러오는 중…</p><iframe id="site-tour-frame" title="아크로리버파크 3D 단지투어" allow="fullscreen" allowfullscreen></iframe></div><div id="viewer-stage" hidden><p id="viewer-load-status" role="status">3D 공간을 불러오는 중…</p><iframe id="service-viewer" title="Cortex 3D 공간" allow="fullscreen" allowfullscreen></iframe><div class="viewer-recovery"><a id="standalone-viewer" target="_blank" rel="noopener">별도 창으로 열기 ↗</a><span id="interior-unit-note">타입별 참고 평면 · 실제 확장 여부 미확인</span></div></div><p id="map-feedback" class="map-feedback" role="status" hidden></p></section></div>`;
 const $=id=>host.querySelector('#'+id),frame=$('service-viewer'),siteFrame=$('site-tour-frame');
 const measurements=createPlanMeasurements({svg:$('service-plan'),toolbar:$('plan-measure-toolbar'),output:$('plan-measure-output'),onSelectRoom:choosePlanRoom});
 function choosePlanRoom(room){selection.room=room.id;selection.physicalRoom=room.id;save();drawPlan();}
 for(const [key,v] of Object.entries(VARIANTS)){const o=el('option',v.title);o.value=key;$('sample-variant').append(o);} $('sample-variant').value=selection.sampleVariant;
 const isCampus=()=>selected?.id===INHA.id;
 const isResidential=()=>selected?.id===ACRO.id&&selected.ready===true;
 function save(){selection=normalizeSelection(selection);const next=writeSelection(location.href,selection);history.replaceState(null,'',next);if(isResidential())$('open-floor-access').href=buildFloorAccessUrl(viewerBase,next);else $('open-floor-access').removeAttribute('href');try{sessionStorage.setItem('cortex-service-selection',JSON.stringify(selection));}catch{}return next;}
 function feedback(text){$('map-feedback').textContent=text;$('map-feedback').hidden=false;}
 function contextText(){return selected?[selected.name,selection.building&&`${selection.building}동`,selection.floor&&`${selection.floor}층`,selection.unit&&`${selection.unit}호`].filter(Boolean).join(' · '):'위치에서 공간까지';}
 const isPoint=p=>p?.id?.startsWith('point:')===true;
 function syncMarkers(){if(!map)return;for(const m of markers.values())m.remove();markers.clear();const visible=new Map([...PREPARED_PLACES,...places,...(selected?[selected]:[])].map(p=>[p.id,p]));for(const p of visible.values()){const active=selected?.id===p.id;const marker=L.marker([p.lat,p.lon],{icon:L.divIcon({className:'place-pin'+(p.ready?' ready':'')+(isPoint(p)?' point':'')+(active?' selected':''),html:p.ready?'3D':isPoint(p)?'+':'•',iconSize:p.ready?[42,30]:[28,28]}),title:p.name,keyboard:true}).addTo(map);marker.bindTooltip(p.name,{direction:'top'});marker.on('click',()=>select(p));markers.set(p.id,marker);}}
 function renderResults(){const list=$('place-results'),listed=places.filter(p=>!isPoint(p)&&(resultMode!=='ready'||p.ready===true));list.replaceChildren();$('result-title').textContent=resultMode==='ready'?'준비된 공간':'검색 결과';list.setAttribute('aria-label',resultMode==='ready'?'3D 체험 가능한 공간':'위치 검색 결과');$('result-count').textContent=`${listed.length}곳`;for(const p of listed){const b=el('button',undefined,'place-card'+(selected?.id===p.id?' selected':''));b.type='button';b.dataset.placeId=p.id;b.setAttribute('aria-pressed',String(selected?.id===p.id));const icon=el('span',p.ready?'3D':'↗','place-card-icon');const text=el('span');text.append(el('strong',p.name),el('small',p.address),el('span',p.ready?(p.kind==='campus'?'캠퍼스 외관 3D · 실내 준비 중':'3D 체험 가능 · 4개 평면'):'장소 정보 · 도면·3D 미등록','place-card-state'));b.append(icon,text);b.onclick=()=>select(p);list.append(b);}syncMarkers();}
 function buildingOptions(){
  const select=$('selected-building');select.replaceChildren();const none=el('option','동 선택');none.value='';select.append(none);
  if(isResidential()&&site)for(const b of site.buildings){const option=el('option',b.title);option.value=b.id;select.append(option);}
  if(selection.building&&!Array.from(select.options).some(option=>option.value===selection.building)){const option=el('option',`${selection.building}동`);option.value=selection.building;select.append(option);}
  select.value=selection.building;select.disabled=!isResidential();
  const floorSelect=$('selected-floor'),floorRows=isResidential()?getBuildingUnits(selection.building):[],floors=[...new Set(floorRows.map(row=>row.floor))].sort((a,b)=>a-b);
  floorSelect.replaceChildren();const floorNone=el('option',selection.building?'층 선택':'동 선택 후 선택');floorNone.value='';floorSelect.append(floorNone);
  // Keep a selected exterior-only floor visible without fabricating household data.
  const selectedWithoutUnits=selection.floor!==null&&!floors.includes(selection.floor);
  if(selectedWithoutUnits)floors.push(selection.floor);
  for(const floor of floors.sort((a,b)=>a-b)){const option=el('option',`${floor}층${selectedWithoutUnits&&floor===selection.floor?' · 세대 자료 없음':''}`);option.value=String(floor);floorSelect.append(option);}
  floorSelect.value=selection.floor??'';floorSelect.disabled=!isResidential()||!selection.building||!floors.length;
  $('building-basis').textContent=isCampus()?'공식 위치와 OSM 지리 정보를 바탕으로 한 본캠퍼스 외관 체험입니다. 실내 도면과 모델은 준비 중입니다.':isResidential()?'동 윤곽·층수: OSM 커뮤니티 자료. 동·층·호수 목록은 사용자 제공 세대 자료를 기준으로 하며 외관과 층수 차이가 있을 수 있습니다.':'선택 좌표의 건물·동·층 정보는 확인되지 않았습니다.';
 }
 function chosenUnit(){return selection.locationId===ACRO.id?lookupUnit(selection.building,selection.floor,selection.unit):null;}
 function modelReady(){return isResidential()&&(getUnitModelVariants(chosenUnit()).length>0||selection.previewMode==='sample'&&!selection.unit);}
 function renderUnitOptions(){
  selection=normalizeSelection(selection);
  const rows=isResidential()?getFloorUnits(selection.building,selection.floor):[],unit=chosenUnit(),select=$('selected-unit');
  select.replaceChildren();const none=el('option',rows.length?'호수 선택':selection.floor?'이 층의 주거 세대 자료 없음':'동과 층을 먼저 선택');none.value='';select.append(none);
  for(const row of rows){const option=el('option',`${row.unit}호 · ${row.type}${row.modelType?' · 3D 보기':' · 3D 준비 중'}`);option.value=row.unit;select.append(option);}
  select.value=unit?.unit||'';select.disabled=!rows.length;
  const allowed=unit?getUnitModelVariants(unit):isResidential()&&selection.previewMode==='sample'?Object.keys(VARIANTS):[];
  $('sample-variant').replaceChildren();
  for(const key of allowed){const option=el('option',VARIANTS[key].title);option.value=key;$('sample-variant').append(option);}
  if(unit)selection.sampleVariant=variantForUnit(unit,selection.sampleVariant)||selection.sampleVariant;
  $('sample-variant').value=selection.sampleVariant;$('sample-variant').disabled=!allowed.length;
  $('unit-mapping').textContent=unit?`${unit.type} · 공급 ${unit.supplyM2}m² / 전용 ${unit.exclusiveM2}m²`:'호수를 선택해 주세요';
  $('renovation-note').textContent=unit?(allowed.length?'실제 확장 여부는 미확인입니다.':'이 타입의 실내 3D는 아직 준비 중입니다.'):selection.previewMode==='sample'?'호수와 별개인 체험 평면입니다.':'동·층·호수를 선택해 주세요.';
  $('interior-unit-note').textContent=unit?`${unit.building}동 ${unit.unit}호 · ${unit.type} · 실제 확장 여부 미확인`:'동·호수와 별개인 체험 평면';
 }
 function renderEvidence(){
  const host=$('building-type-evidence');host.replaceChildren();host.hidden=!isResidential();$('source-plan-catalog').hidden=!isResidential();$('unit-source-detail').hidden=!isResidential();
  selection.buildingType='';if(!chosenUnit()){selection.typeEvidence='';selection.typeScope='';}
  if(!isResidential())return;
  if(!evidence){host.append(el('p','동·타입 출처를 불러오는 중…','detail-note'));return;}
  const rows=getBuildingUnits(selection.building),types=[...new Set(rows.map(row=>row.type))];
  if(rows.length){host.append(el('strong',`${selection.building}동 · 제공 자료 ${rows.length}세대`),el('p',types.join(' · '),'detail-note'));const link=el('a','네이버 부동산 · 동호수/공시가격 출처 ↗');link.href=UNIT_CATALOG_SOURCE.url;link.target='_blank';link.rel='noopener';host.append(link,el('small','자료 수신 2026-10-25 · 촬영/추출 시각 미확인 · 실제 확장 여부 미확인'));}
  else host.append(el('p','동·층을 고른 뒤 호수를 선택하세요.','detail-note'));
  const catalog=$('catalog-links');if(!catalog.childElementCount){$('source-plan-catalog summary').textContent=`단지 도면 출처 · 확인한 ${evidence.planCatalog.length}건`;
   for(const r of evidence.planCatalog){const a=el('a',`${r.type_label_exact} · ${r.plan_variant==='expanded'?'확장':r.plan_variant==='basic'?'기본':'상태 미확인'} · 공급 ${r.supply_area_m2??'미확인'} / 전용 ${r.exclusive_area_m2??'미확인'}m² ↗`);a.href=r.source_url;a.target='_blank';a.rel='noopener';a.dataset.evidence=r.row_id;catalog.append(a);}
  }
 }
 function loadEvidence(){if(evidencePromise)return;evidencePromise=fetch(`${import.meta.env.BASE_URL}acro-evidence.json`).then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{evidence=data;renderEvidence();save();}).catch(()=>{$('building-type-evidence').replaceChildren(el('p','동·타입 근거를 불러오지 못했습니다. 실제 세대 대응은 미확인으로 유지합니다.','detail-note'));});}
 function loadSiteSelection(){
  if(!sitePromise)sitePromise=fetch(`${import.meta.env.BASE_URL}acro-site-selection.json`).then(r=>{if(!r.ok)throw Error('동 목록을 불러오지 못했습니다.');return r.json();}).then(data=>{site=data;if(isResidential())renderSelection();}).catch(e=>{if(isResidential())feedback(e.message);});
  return sitePromise;
 }
 function renderSelection(){
  const ready=selected?.ready===true,point=isPoint(selected),residential=isResidential(),campus=isCampus();
  $('selected-point-note').hidden=!point;$('clear-selected-point').hidden=!point;
  host.querySelector('.unit-fields').hidden=!residential;host.querySelector('.mapping-status').hidden=!residential;$('place-detail').hidden=!selected;
  if(selected){$('selected-place-name').textContent=selected.name;$('selected-place-address').textContent=selected.address;$('place-source').href=selected.source;$('place-source').textContent=selected.sourceLabel+' ↗';$('place-readiness').textContent=campus?'캠퍼스 외관 3D':ready?'3D 체험 가능':point?'선택한 위치 · 미등록':'도면·3D 미등록';$('place-readiness').classList.toggle('pending',!ready);buildingOptions();}
  $('sample-models').hidden=!residential;$('campus-preview').hidden=!campus;$('plan-request').hidden=!selected||ready;
  renderUnitOptions();renderEvidence();if(residential){loadSiteSelection();loadEvidence();}
  $('workspace-context').textContent=contextText();siteFrame.title=campus?'인하대학교 캠퍼스 외관 3D':'아크로리버파크 3D 단지투어';
  for(const b of host.querySelectorAll('[data-service-view]')){const interior=['plan','3d'].includes(b.dataset.serviceView);b.hidden=campus&&interior;b.disabled=b.dataset.serviceView!=='map'&&(!ready||interior&&!modelReady());if(b.dataset.serviceView==='site')b.textContent=campus?'캠퍼스 3D':'단지투어';}
  $('open-plan').disabled=$('open-3d').disabled=!modelReady();$('plan-open-3d').disabled=!modelReady()||!planData;renderResults();
 }
 function select(p,{pan=true,reset=true,openTour=true}={}){const changed=selected?.id!==p.id;selected=p;selection={...selection,locationId:p.id,locationName:p.name,address:p.address,lat:p.lat,lon:p.lon,...(changed&&reset?{building:'',floor:null,unit:'',unitType:'unknown',room:'',physicalRoom:''}:{})};if(changed){planSequence++;planData=null;measurements.setPlan(null);selection=normalizeSelection(selection);siteSelectionRevision=0;frame.removeAttribute('src');frameKey='';siteFrame.removeAttribute('src');siteFrameLoaded=false;clearTimeout(siteTimer);clearTimeout(viewerTimer);$('download-plan-request').hidden=true;$('request-status').textContent='이 브라우저에 저장하는 요청 초안입니다. 서버 접수나 제작 예약은 아닙니다.';}renderSelection();if(pan&&map)map.setView([p.lat,p.lon],Math.max(map.getZoom(),15));if(p.ready&&openTour)setView('site');else if(!p.ready&&selection.serviceView!=='map')setView('map');else save();}
 let viewerTimer,siteTimer;
 let zoom=1;
 async function renderPlan(){const seq=++planSequence;const variant=selection.sampleVariant;$('plan-name').textContent=VARIANTS[variant].title+(chosenUnit()?` · ${selection.building}동 ${selection.unit}호`:' · 체험 평면');$('plan-room-note').textContent='평면을 불러오는 중…';$('plan-open-3d').disabled=true;$('plan-room-select').disabled=true;$('plan-open-3d').textContent='실내 3D 열기';planData=null;$('service-plan').replaceChildren();measurements.setPlan(null);try{const r=await fetch(`${import.meta.env.BASE_URL}floorplans/${variant}.json`);if(!r.ok)throw Error('평면 자료를 불러오지 못했습니다.');const data=await r.json();if(seq!==planSequence)return;planData=data;measurements.setPlan(data);zoom=1;drawPlan();}catch(e){if(seq===planSequence){$('service-plan').replaceChildren();$('plan-room-note').textContent=e.message;}}}
 function drawPlan(){
  const svg=$('service-plan'),d=planData;if(!d)return;
  svg.replaceChildren();
  const [x1,z1,x2,z2]=d.bounds,pad=.45,w=(x2-x1+2*pad)/zoom,h=(z2-z1+2*pad)/zoom;
  svg.setAttribute('viewBox',`${(x1+x2-w)/2} ${(z1+z2-h)/2} ${w} ${h}`);
  const picker=$('plan-room-select'),all=el('option','전체 평면');all.value='';picker.replaceChildren(all);picker.disabled=false;
  d.rooms.forEach((r,i)=>{
   if(!r.polygon_m?.length)return;
   const active=selection.room===r.id||selection.physicalRoom===r.id;
   const option=el('option',`${i+1}. ${r.name}`);option.value=r.id;picker.append(option);
   const group=document.createElementNS(NS,'g');
   for(const [k,v] of Object.entries({tabindex:'0',role:'button','aria-label':r.name,'aria-pressed':String(active)}))group.setAttribute(k,v);
   group.dataset.room=r.id;
   const polygon=document.createElementNS(NS,'polygon');polygon.classList.add('plan-room-shape');
   polygon.setAttribute('points',r.polygon_m.map(p=>p.join(',')).join(' '));
   polygon.setAttribute('fill',active?'#c4dfbc':['#ecece2','#e4ece8','#f1e9df'][i%3]);
   polygon.setAttribute('stroke','#9aaa9d');polygon.setAttribute('stroke-width','1');polygon.setAttribute('vector-effect','non-scaling-stroke');group.append(polygon);
   group.onclick=()=>choosePlanRoom(r);
   group.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();choosePlanRoom(r);[...svg.querySelectorAll('[data-room]')].find(n=>n.dataset.room===r.id)?.focus({preventScroll:true});}};
   svg.append(group);
   appendPlanRoomLabel({svg,group,room:r,index:i});
  });
  appendPlanArchitecture(svg,d.architecture);
  const room=d.rooms.find(r=>r.id===selection.room||r.id===selection.physicalRoom);picker.value=room?.id||'';
  $('plan-room-note').textContent=room?`${room.name}${room.polygon_area_m2?` · 좌표상 면적 ${room.polygon_area_m2.toFixed(2)}m²`:''}`:'방을 선택하면 이름과 좌표상 면적을 확인할 수 있어요.';
  $('plan-open-3d').textContent=room?`${room.name} · 실내 3D 열기`:'실내 3D 열기';$('plan-open-3d').disabled=!selected?.ready||!modelReady();
  $('plan-source').textContent=d.basis;measurements.setRoom(room);
 }
 $('plan-room-select').onchange=e=>{const r=planData?.rooms.find(r=>r.id===e.target.value);if(r)choosePlanRoom(r);else{selection.room='';selection.physicalRoom='';save();drawPlan();}};
 let planResizeFrame=0;
 const planObserver=new ResizeObserver(entries=>{if(!planData||!entries[0].contentRect.width||!entries[0].contentRect.height)return;cancelAnimationFrame(planResizeFrame);planResizeFrame=requestAnimationFrame(drawPlan);});
 planObserver.observe($('service-plan'));
 document.fonts?.ready.then(()=>{if(planData)drawPlan();});
 function viewerUrl(mode){
  let url;
  if(isCampus()){
   url=writeSelection(viewerBase,selection);
   // Keep the configured origin/path and return endpoint, never an indoor route.
   for(const key of ['variant','studio','entry','finish','lighting','quality','tours','roomId'])url.searchParams.delete(key);
   url.searchParams.set('embedded','1');
  }else url=new URL(buildViewerUrl(viewerBase,selection.sampleVariant,{entry:mode==='site'?'complex':'overview',selection,embedded:true}));
  if(mode==='site')url.searchParams.set('serviceTour','1');
  if(import.meta.env.DEV&&new URL(location.href).searchParams.has('test'))url.searchParams.set('test','1');url.hash='';return url.href;
 }
 function setView(view){
  if(view!=='map'&&!selected?.ready){feedback('이 위치에는 등록된 도면과 3D 모델이 없습니다.');return;}
  if(['plan','3d'].includes(view)&&!modelReady()){feedback(isCampus()?'인하대학교 실내 공간은 준비 중입니다. 캠퍼스 외관을 둘러보세요.':'3D가 준비된 호수를 고르거나, 호수와 별개인 체험 평면 보기를 선택해 주세요.');view='site';}else $('map-feedback').hidden=true;
  selection.serviceView=view;save();frame.contentWindow?.postMessage({type:'cortex:visibility',visible:view==='3d'},new URL(viewerBase).origin);siteFrame.contentWindow?.postMessage({type:'cortex:visibility',visible:view==='site'},new URL(viewerBase).origin);
  $('map-stage').hidden=view!=='map';$('plan-stage').hidden=view!=='plan';$('site-stage').hidden=view!=='site';$('viewer-stage').hidden=view!=='3d';for(const b of host.querySelectorAll('[data-service-view]'))b.setAttribute('aria-pressed',String(b.dataset.serviceView===view));
  if(view==='map')requestAnimationFrame(()=>map?.invalidateSize());if(view==='plan')renderPlan();
  if(view==='site'){if(!siteFrameLoaded){siteFrameLoaded=true;$('site-load-status').hidden=false;$('site-load-status').textContent=isCampus()?'인하대학교 캠퍼스를 불러오는 중…':'3D 단지를 불러오는 중…';clearTimeout(siteTimer);siteTimer=setTimeout(()=>{siteFrameLoaded=false;$('site-load-status').textContent='3D 공간 로딩이 오래 걸립니다. 지도에서 위치를 다시 선택하면 재시도합니다.';},45000);siteFrame.src=viewerUrl('site');}else siteFrame.contentWindow?.postMessage({type:'cortex:selection',selection,selectionRevision:siteSelectionRevision},new URL(viewerBase).origin);}
  if(view==='3d'){try{const url=viewerUrl(view);const key=JSON.stringify([selection.locationId,'3d']);$('standalone-viewer').href=url;if(key!==frameKey){frameKey=key;$('viewer-load-status').hidden=false;$('viewer-load-status').textContent='실내 공간을 불러오는 중…';clearTimeout(viewerTimer);viewerTimer=setTimeout(()=>{$('viewer-load-status').textContent='로딩이 오래 걸립니다. 아래 별도 창 링크로 다시 열 수 있어요.';},45000);frame.src=url;}else frame.contentWindow?.postMessage({type:'cortex:selection',selection},new URL(viewerBase).origin);}catch(e){feedback(e.message);}}
 }
 function sendPanelSelection(){siteSelectionRevision++;if(selection.serviceView==='site')siteFrame.contentWindow?.postMessage({type:'cortex:selection',selection,selectionRevision:siteSelectionRevision},new URL(viewerBase).origin);}
 async function submitSearch(q){$('place-query').value=q;const seq=++searchSequence;if(!search){feedback('지도 검색 연결을 준비하고 있습니다.');return;}$('search-status').textContent='검색 중…';$('place-search button').disabled=true;try{const found=await search(q);if(seq!==searchSequence)return;places=found;resultMode='search';$('search-status').textContent=found.length?'지도와 목록에서 위치를 선택하세요.':'검색 결과가 없습니다. 다른 주소로 검색하거나 지도에서 위치를 선택해 주세요.';renderResults();if(found.length&&map)map.fitBounds(found.map(p=>[p.lat,p.lon]),{padding:[70,70],maxZoom:15});}catch(e){if(seq===searchSequence)$('search-status').textContent=e.message;}finally{if(seq===searchSequence)$('place-search button').disabled=false;}}
 $('place-search').onsubmit=e=>{e.preventDefault();submitSearch($('place-query').value);};host.querySelectorAll('[data-search]').forEach(b=>b.onclick=()=>submitSearch(b.dataset.search));$('ready-place').onclick=()=>{searchSequence++;$('place-search button').disabled=false;places=[...PREPARED_PLACES];resultMode='ready';$('search-status').textContent='3D 체험이 준비된 단지와 캠퍼스입니다.';select(selected?.ready?selected:ACRO);};
 $('clear-selected-point').onclick=()=>{if(!isPoint(selected))return;selected=null;selection=normalizeSelection({mapLat:selection.mapLat,mapLon:selection.mapLon,mapZoom:selection.mapZoom,sampleVariant:selection.sampleVariant});renderSelection();setView('map');$('search-status').textContent='위치 선택을 해제했습니다. 지도나 목록에서 다시 선택하세요.';$('location-map').focus();};
 function selectionChanged(){selection.room='';selection.physicalRoom='';selection=normalizeSelection(selection);renderSelection();save();if(['plan','3d'].includes(selection.serviceView))setView(selection.serviceView);else sendPanelSelection();}
 $('selected-building').onchange=e=>{selection.building=e.target.value;selection.floor=null;selection.unit='';selection.previewMode='unit';selectionChanged();};
 $('selected-floor').onchange=e=>{selection.floor=e.target.value;selection.unit='';selection.previewMode='unit';selection=normalizeSelection(selection);const max=Math.max(site?.buildings.find(b=>b.id===selection.building)?.levels||1,...getBuildingUnits(selection.building).map(row=>row.floor));if(selection.floor)selection.floor=Math.min(max,selection.floor);selectionChanged();};
 $('selected-unit').onchange=e=>{selection.unit=e.target.value;selection.previewMode='unit';selectionChanged();};
 $('sample-preview').onclick=()=>{selection.unit='';selection.previewMode='sample';selectionChanged();};
 $('sample-variant').onchange=e=>{selection.sampleVariant=e.target.value;selectionChanged();};
 host.querySelectorAll('[data-service-view]').forEach(b=>b.onclick=()=>setView(b.dataset.serviceView));$('open-plan').onclick=()=>setView('plan');$('open-3d').onclick=$('plan-open-3d').onclick=()=>setView('3d');$('open-site').onclick=$('open-campus').onclick=()=>setView('site');
 $('plan-zoom-in').onclick=()=>{zoom=Math.min(2.5,zoom*1.25);drawPlan();};$('plan-zoom-out').onclick=()=>{zoom=Math.max(.65,zoom/1.25);drawPlan();};$('plan-fit').onclick=()=>{zoom=1;drawPlan();};
 let requestBlob; $('save-plan-request').onclick=()=>{const request={schema:'cortex.floorplan-request.draft.v1',createdAt:new Date().toISOString(),status:'local_draft_not_submitted',selection,source:selected?.source,requested:['floorplan','unit_mapping','3d_model']};try{localStorage.setItem('cortex-floorplan-request:'+selection.locationId,JSON.stringify(request));if(requestBlob)URL.revokeObjectURL(requestBlob);requestBlob=URL.createObjectURL(new Blob([JSON.stringify(request,null,2)],{type:'application/json'}));$('download-plan-request').href=requestBlob;$('download-plan-request').hidden=false;$('request-status').textContent='요청 초안을 이 브라우저에 저장했습니다. JSON으로 내려받을 수 있으며 서버에는 접수되지 않았습니다.';}catch{$('request-status').textContent='브라우저 저장 공간을 사용할 수 없습니다.';}};
 $('copy-location-link').onclick=async()=>{const url=save();try{await navigator.clipboard.writeText(url.href);feedback('현재 위치와 보기의 링크를 복사했습니다.');}catch{feedback('주소창의 URL에 현재 선택이 저장되어 있습니다. 주소를 복사해 주세요.');}};
 const viewerOrigin=new URL(viewerBase).origin;
 window.addEventListener('message',event=>{
  const fromSite=event.source===siteFrame.contentWindow,fromInterior=event.source===frame.contentWindow;if(event.origin!==viewerOrigin||!fromSite&&!fromInterior)return;const m=event.data;
  if(fromSite&&Number.isSafeInteger(m?.selectionRevision)){if(m.selectionRevision<siteSelectionRevision&&['cortex:selection','cortex:open-plan','cortex:open-interior'].includes(m.type))return;siteSelectionRevision=Math.max(siteSelectionRevision,m.selectionRevision);}
  if(m?.type==='cortex:viewer-ready'){if(fromSite){clearTimeout(siteTimer);$('site-load-status').hidden=true;siteFrame.contentWindow.postMessage({type:'cortex:selection',selection,selectionRevision:siteSelectionRevision},viewerOrigin);siteFrame.contentWindow.postMessage({type:'cortex:visibility',visible:selection.serviceView==='site'},viewerOrigin);}else{clearTimeout(viewerTimer);$('viewer-load-status').hidden=true;frame.contentWindow.postMessage({type:'cortex:visibility',visible:selection.serviceView==='3d'},viewerOrigin);}}
  if(m?.type==='cortex:viewer-error'){clearTimeout(viewerTimer);if(fromSite){clearTimeout(siteTimer);siteFrameLoaded=false;}const status=$(fromSite?'site-load-status':'viewer-load-status');status.hidden=false;status.textContent='공간을 불러오지 못했습니다. 지도로 돌아가 다시 시도해 주세요.';}
  if(m?.type==='cortex:show-map')setView('map');
  if((['cortex:selection','cortex:open-plan'].includes(m?.type)||(fromSite&&m?.type==='cortex:open-interior'))&&isResidential()){const next=normalizeSelection(m.selection);if(next.locationId!==selection.locationId)return;if(fromInterior&&(next.building!==selection.building||next.floor!==selection.floor||next.unit!==selection.unit))return;selection={...selection,building:next.building,floor:next.floor,unit:next.unit,unitType:next.unitType,renovationState:'unknown',previewMode:next.previewMode,sampleVariant:Object.hasOwn(VARIANTS,next.sampleVariant)?next.sampleVariant:selection.sampleVariant,room:next.room,physicalRoom:next.physicalRoom};if(fromInterior&&frameKey){/* Keep the same iframe/model cache across basic/expanded and household changes. */}renderSelection();save();if(m.type==='cortex:open-plan')setView('plan');else if(m.type==='cortex:open-interior')setView('3d');}
 });
 window.addEventListener('popstate',()=>{const next=readSelection(location.href);if(next.locationId!==selection.locationId){location.reload();return;}selection=next;renderSelection();setView(selection.serviceView);});
 const ready=fetch(`${import.meta.env.BASE_URL}map-config.json`).then(r=>{if(!r.ok)throw Error('지도 설정을 불러오지 못했습니다.');return r.json();}).then(async config=>{search=createPlaceSearch(config);if(isResidential())await loadSiteSelection();map=L.map($('location-map'),{zoomControl:false}).setView([selection.mapLat??selected?.lat??ACRO.lat,selection.mapLon??selected?.lon??ACRO.lon],selection.mapZoom??13);L.control.zoom({position:'bottomright'}).addTo(map);L.control.scale({imperial:false,position:'bottomleft'}).addTo(map);L.tileLayer(config.tileUrl,{maxZoom:config.maxZoom||19,keepBuffer:0,updateWhenIdle:true,attribution:config.attribution}).on('tileerror',()=>{$('tile-status').hidden=false;$('tile-status').textContent='배경 지도를 불러오지 못했습니다. 검색 목록과 선택 정보는 계속 사용할 수 있어요.';}).addTo(map);map.on('moveend',()=>{const c=map.getCenter();selection.mapLat=+c.lat.toFixed(6);selection.mapLon=+c.lng.toFixed(6);selection.mapZoom=map.getZoom();save();});map.on('click',e=>{const lat=+e.latlng.lat.toFixed(6),lon=+e.latlng.lng.toFixed(6);select({id:`point:${lat},${lon}`,name:'지도에서 선택한 위치',address:`위도 ${lat} · 경도 ${lon}`,lat,lon,ready:false,source:`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`,sourceLabel:'OpenStreetMap 선택 좌표'}, {pan:false});});renderSelection();if(selection.serviceView!=='map'&&selected?.ready)setView(selection.serviceView);else setView('map');}).catch(e=>{$('search-status').textContent=e.message;renderSelection();});
 renderSelection();if(import.meta.env.DEV&&new URL(location.href).searchParams.has('test'))window.__mapService={state:()=>({selection,selected,places,loaded3d:Boolean(frame.src),loadedSite:Boolean(siteFrame.src),zoom:map?.getZoom()}),choosePoint:(lat,lon)=>map.fire('click',{latlng:L.latLng(lat,lon)}),ready};
 return{selection:()=>selection,resize:()=>map?.invalidateSize(),ready};
}
