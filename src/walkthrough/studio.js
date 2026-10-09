import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { corners, doorFootprints, placementWarnings } from './layout.js';
import { navigationRooms } from './minimap-geometry.js';
import { LOCATION, createFloorTower, createExterior } from './location.js';
import './studio.css';
import './location.css';
import './workspace.css';
import { isTouchFirst } from '../mobile/touch-walk-controls.js';

const $=id=>document.getElementById(id);
const NS='http://www.w3.org/2000/svg';
// Control hints follow the device: on-screen stick and gestures on touch, keys and mouse on PC.
const HINTS={touch:{walk:'왼쪽 아래 방향키 이동 · 화면을 밀어 시선 · 버튼으로 문 열기',tour:'방향키 이동 · 드래그 시선',orbit:'드래그 회전 · 두 손가락 확대'},pc:{walk:'WASD 이동 · E 문 열기 · Esc 해제',tour:'WASD 이동 · 마우스 시선',orbit:'드래그 회전 · 휠 확대'}};
const hint=key=>HINTS[isTouchFirst()?'touch':'pc'][key];
function svg(tag,attrs,text){const n=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text)n.textContent=text;return n;}
export function createStudio({scene,camera,renderer,getActive,loadVariant,resize,invalidate,enterRoom,unlock}) {
  document.body.classList.add('studio');
  const ui=document.createElement('section');ui.id='studio-ui';
  ui.innerHTML=`<header class="studio-header"><a href="?studio=1" class="studio-brand">CORTEX <small>SPATIAL STUDIO</small></a><nav aria-label="공간 탐색"><button id="nav-complex">단지</button><span>/</span><button id="nav-plan">112A 세대</button></nav><div class="mode-switch"><button id="mode-tour">둘러보기</button><button id="mode-edit">인테리어</button></div></header>
  <aside id="studio-sidebar"><p class="studio-eyebrow" id="studio-step"></p><h1 id="studio-title"></h1><p id="studio-description"></p>
  <section id="unit-picker"><p class="evidence-note">단지 배치는 화면 흐름을 위한 예시입니다.<br>실제 동·호수 및 위치와 다릅니다.</p><button id="select-building">예시 동 A 선택</button><div id="unit-options" hidden><label for="studio-variant">구현된 세대 · 112A</label><select id="studio-variant"><option value="expanded">확장형</option><option value="basic">기본형</option></select><button id="open-unit" class="studio-primary">이 세대 보기 →</button></div></section>
  <section id="room-picker" hidden><label for="studio-room">장소 선택</label><select id="studio-room"></select><div class="room-actions"><button id="room-walk" class="studio-primary">이곳에서 둘러보기</button><button id="room-edit">이곳 꾸미기</button></div><p class="evidence-note">천장고 2.6m · 문 개구부 2.1m 가정<br>안방 킹 167×207.5cm · 작은 방은 빈 방/서재<br>책상·의자·욕실 집기 세부 치수는 가정입니다.</p></section>
  <section id="editor-tools" hidden><div class="editor-row"><label for="add-kind">가구 추가</label><select id="add-kind"></select><button id="add-item">＋ 추가</button></div><label for="selected-item">배치한 가구</label><select id="selected-item"></select><p id="item-size"></p><div class="coordinate-inputs"><label>X (m)<input id="item-x" type="number" step="0.01"></label><label>Z (m)<input id="item-z" type="number" step="0.01"></label></div><div class="editor-row"><button id="apply-position">위치 적용</button><button id="rotate-item">90° 회전</button><button id="remove-item">삭제</button></div><div class="editor-row"><button id="save-layout">배치 저장</button><button id="restore-layout">저장 불러오기</button><button id="reset-layout">초기 배치</button></div><p class="evidence-note">이 브라우저에 저장됩니다. 2D에서 가구를 드래그하거나 방향키로 5cm씩 옮기세요. 가구 크기는 유지됩니다.</p></section>
  <p id="studio-status" role="status" aria-live="polite"></p></aside>
  <section id="plan-pane" hidden><div class="pane-label"><strong id="plan-title">2D 배치도</strong><span>미터 기준 · 위쪽이 도면 상단</span></div><svg id="layout-plan" role="img" aria-label="공간과 가구 배치도"></svg></section><div id="three-label" class="pane-label"><strong>단지 둘러보기</strong><span id="orbit-help">드래그 회전 · 휠 확대</span></div><button id="back-plan" hidden>← 세대 전체 보기</button>`;
  document.body.append(ui);
  let mode='complex',roomId='Living front',selection=null,drag=null,ready=false;
  let floor=22,buildingSelected=false,allowOverlap=true,exteriorEnabled=true;
  const assignments=new Map();
  camera.far=1200;camera.updateProjectionMatrix();
  $('unit-picker').innerHTML=`<p class="location-address">${LOCATION.address}</p><p class="evidence-note">공식 단지 전경 · 15개동 · 최고 38층</p><a href="${LOCATION.map}" target="_blank" rel="noopener">네이버 지도에서 위치 확인 ↗</a><button id="select-building">예시 동 A · 층 선택</button><div id="unit-options" hidden><p class="evidence-note">예시 동 A와 22층 연결은 시연용입니다.<br>실제 동별 층수·호수와 다를 수 있습니다.</p><label for="floor-range">층 선택 · <strong id="floor-value">22층</strong></label><input id="floor-range" type="range" min="1" max="38" value="22"><p id="floor-availability"></p><label for="studio-variant">22층 시연 세대 · 112A</label><select id="studio-variant"><option value="expanded">확장형</option><option value="basic">기본형</option></select><button id="open-unit" class="studio-primary">22층 세대 보기 →</button></div>`;
  const hero=document.createElement('section');hero.id='location-hero';
  hero.innerHTML=`<img src="${LOCATION.riverside}" alt="ACRO 공식 아크로 리버파크 단지 전경"><div class="location-caption"><p>SEOUL · BANPO</p><h2>아크로 리버파크</h2><p>한강 곁에서 시작하는 우리 집</p><button id="hero-building">예시 동 A · 층 선택 →</button></div><a class="photo-credit" href="${LOCATION.source}" target="_blank" rel="noopener">출처: ACRO 공식 소개 · 특정 동 선택 위치를 뜻하지 않습니다 ↗</a><p id="photo-error" hidden>전경을 불러오지 못했어요. 공식 소개 또는 지도 링크에서 확인해 주세요.</p>`;ui.append(hero);
  hero.querySelector('img').onerror=()=>{$('photo-error').hidden=false;};
  const rail=document.createElement('div');rail.id='floor-rail';rail.hidden=true;rail.setAttribute('aria-label','층 선택 목록');
  for(let n=38;n>=1;n--){const b=document.createElement('button');b.textContent=`${n}F${n===22?' · 112A →':''}`;b.dataset.floor=n;b.onclick=()=>{selectFloor(n);if(n===22)$('open-unit').click();};rail.append(b);}ui.append(rail);
  const badge=document.createElement('p');badge.id='exterior-note';badge.hidden=true;badge.textContent='외부 풍경: 공식 사진 참고 배경 · 실제 22층 조망 아님 / 현관 밖: 구조 예시';ui.append(badge);
  $('room-picker').append($('view-settings'));
  const exteriorControl=document.createElement('label');exteriorControl.className='placement-toggle';exteriorControl.innerHTML='<input id="exterior-enabled" type="checkbox" checked> 창밖 참고 배경 보기';$('room-picker').append(exteriorControl);
  const warningControl=document.createElement('div');warningControl.innerHTML='<label class="placement-toggle"><input id="allow-overlap" type="checkbox" checked> 겹침 허용 · 경고로 확인</label><p class="evidence-note">끄면 겹침·경계 이탈·문 개방 간섭을 제한합니다.<br>60cm 여유는 참고 기준이며 통행 가능 판정은 아닙니다.</p><div id="placement-warnings" role="status" aria-live="polite"></div>';$('editor-tools').append(warningControl);
  const orbit=new OrbitControls(camera,renderer.domElement);orbit.enableDamping=false;orbit.maxPolarAngle=Math.PI*.48;orbit.minDistance=2;orbit.maxDistance=90;
  orbit.addEventListener('change',invalidate);
  const clipping=new THREE.Plane(new THREE.Vector3(0,-1,0),1.35);
  const tower=createFloorTower(scene),complex=tower.group;
  const contextBar=document.createElement('section');contextBar.id='context-toolbar';contextBar.hidden=true;
  contextBar.innerHTML='<div class="context-views" role="group" aria-label="단지 시점"><button data-view="focus">선택 동</button><button data-view="site">단지 전체</button><button data-view="river">강변 방향</button><button data-view="street">도로 방향</button><button id="context-photo">공식 전경</button></div><p>주변 동·조경·강변 배치는 탐색용 예시입니다.</p>';ui.append(contextBar);
  const buildingSelect=document.createElement('select');buildingSelect.id='context-building';buildingSelect.setAttribute('aria-label','둘러볼 동');
  for(const b of tower.buildings){const o=document.createElement('option');o.value=b.id;o.textContent=b.title+(b.id==='A'?' · 22층 실내 구현':' · 외관 보기');buildingSelect.append(o);}
  $('unit-options').prepend(buildingSelect);
  const photoPanel=document.createElement('section');photoPanel.id='context-photo-panel';photoPanel.hidden=true;
  photoPanel.innerHTML=`<img src="${LOCATION.night}" alt="ACRO 공식 단지 야경"><div><button id="close-context-photo">3D로 돌아가기</button><a href="${LOCATION.source}" target="_blank" rel="noopener">ACRO 공식 소개 ↗</a></div>`;ui.append(photoPanel);
  let contextView='focus';
  function setContextView(view){contextView=view;const pose=tower.viewpoint(view);orbit.maxDistance=550;orbit.target.fromArray(pose.target);camera.position.fromArray(pose.position);orbit.update();contextBar.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));dirty();}
  contextBar.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>setContextView(b.dataset.view));
  $('context-photo').onclick=()=>{photoPanel.hidden=false;};$('close-context-photo').onclick=()=>{photoPanel.hidden=true;};
  photoPanel.addEventListener('keydown',e=>{if(e.key==='Escape'){photoPanel.hidden=true;$('context-photo').focus();}});
  function chooseBuilding(id){tower.selectBuilding(id);buildingSelect.value=tower.selected.id;selectFloor(floor);status(tower.selected.id==='A'?'예시 동 A의 22층에서 실내로 들어갈 수 있어요.':`${tower.selected.title} 외관 보기 · 실내는 아직 구현되지 않았어요.`);}
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
  const exterior=createExterior(scene,invalidate,ok=>{badge.textContent=ok?'외부 풍경: 공식 사진 참고 배경 · 실제 22층 조망 아님 / 현관 밖: 구조 예시':'외부 사진 로딩 실패 · 현관 밖은 구조 예시';});
  const raycaster=new THREE.Raycaster();
  const current=()=>getActive();
  function rooms(){return current()?navigationRooms(current().definition.info):[];}
  const room=()=>rooms().find(r=>r.id===roomId)||rooms()[0];
  const item=()=>current()?.staging.items.find(i=>i.id===selection&&!i.deleted);
  const key=()=>`cortex-layout-v3:${current().key}:1`;
  function placementRoom(i){const saved=assignments.get(`${current().key}:${i.id}`);return rooms().find(r=>r.id===saved)||rooms().find(r=>inside(i,r))||room();}
  function warnings(i){return placementWarnings(i,placementRoom(i),current().staging.items,current().staging.obstacles,doorFootprints(current().definition.doors));}
  function showWarnings(){
    const host=$('placement-warnings');host.replaceChildren();
    const messages=current().staging.items.filter(i=>!i.deleted).flatMap(i=>warnings(i).map(message=>`${i.title}: ${message}`));
    host.classList.toggle('has-warnings',messages.length>0);
    const title=document.createElement('strong');title.textContent=messages.length?`배치 확인 필요 · ${messages.length}건`:'배치 경고 없음';host.append(title);
    if(messages.length){const list=document.createElement('ul');for(const message of messages){const li=document.createElement('li');li.textContent=message;list.append(li);}host.append(list);}
  }
  function selectFloor(value){
    floor=Math.max(1,Math.min(tower.selected.floors,Math.round(Number(value))));tower.setFloor(floor);$('floor-range').max=tower.selected.floors;$('floor-range').value=floor;$('floor-value').textContent=`${tower.selected.title} · ${floor}층`;
    const available=tower.selected.id==='A'&&floor===22;
    $('open-unit').disabled=!available;$('studio-variant').disabled=tower.selected.id!=='A';$('floor-availability').textContent=available?'112A 기본형·확장형을 둘러볼 수 있어요.':tower.selected.id!=='A'?'외관 탐색 중입니다. 실내는 예시 동 A의 22층에서 볼 수 있어요.':'아직 구현되지 않은 층입니다. 22층을 선택해 주세요.';
    $('open-unit').textContent=tower.selected.id==='A'?'22층 세대 보기 →':'실내 미구현';
    $('studio-variant').hidden=tower.selected.id!=='A';$('unit-options').querySelector('label[for="studio-variant"]').hidden=tower.selected.id!=='A';
    for(const b of rail.children){const n=Number(b.dataset.floor);b.hidden=n>tower.selected.floors;b.textContent=`${n}F${n===22&&tower.selected.id==='A'?' · 112A →':''}`;b.classList.toggle('selected',n===floor);b.setAttribute('aria-pressed',String(n===floor));}
    if(mode==='complex'&&buildingSelected){$('three-label').querySelector('strong').textContent=`${tower.selected.title} · 주변 둘러보기`;setContextView('focus');}dirty();
  }
  function status(text){$('studio-status').textContent=text;}
  function dirty(){invalidate();}
  function frame(bounds,top=false){const [x1,z1,x2,z2]=bounds,cx=(x1+x2)/2,cz=(z1+z2)/2,span=Math.max(x2-x1,z2-z1);const fit=Math.max(z2-z1,(x2-x1)/camera.aspect)/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)))*1.18;orbit.target.set(cx,.2,cz);camera.up.set(0,1,0);camera.position.set(cx+(top?0:span*.7),top?fit:Math.max(span,fit*.65),cz+(top?.001:span*.8));camera.lookAt(orbit.target);orbit.update();dirty();}
  function setMode(next){
    if(!current())return;
    unlock();mode=next;document.body.dataset.studioMode=mode;orbit.enabled=mode!=='tour';
    camera.far=mode==='complex'?1200:mode==='tour'?350:80;camera.updateProjectionMatrix();
    complex.visible=mode==='complex'&&buildingSelected;current().model.visible=mode!=='complex';
    hero.hidden=mode!=='complex'||buildingSelected;rail.hidden=mode!=='complex'||!buildingSelected;
    contextBar.hidden=rail.hidden;photoPanel.hidden=true;
    dock.hidden=mode!=='edit';
    if(mode==='edit'){$('view-action-bar').append($('room-walk'));$('dock-status').append($('studio-status'));}
    else{originalWalkHost.prepend($('room-walk'));$('studio-sidebar').append($('studio-status'));}
    orbit.maxDistance=mode==='complex'?550:90;
    exterior.group.visible=mode==='tour'&&exteriorEnabled;badge.hidden=!exterior.group.visible;
    renderer.clippingPlanes=['overview','edit'].includes(mode)?[clipping]:[];
    $('unit-picker').hidden=mode!=='complex';$('room-picker').hidden=mode==='complex';$('editor-tools').hidden=mode!=='edit';
    $('plan-pane').hidden=!['overview','edit'].includes(mode);$('back-plan').hidden=mode!=='tour';
    $('mode-edit').disabled=mode==='complex';$('mode-tour').disabled=mode==='complex';
    $('mode-edit').classList.toggle('selected',mode==='edit');$('mode-tour').classList.toggle('selected',mode==='tour');
    $('studio-step').textContent=mode==='complex'?'01 / SELECT A HOME':mode==='overview'?'02 / EXPLORE THE PLAN':mode==='edit'?'03 / DESIGN YOUR SPACE':'03 / WALK THROUGH';
    $('studio-title').textContent=mode==='complex'?'살아볼 공간을 선택하세요.':mode==='overview'?'우리 집을 한눈에.':mode==='edit'?`${room().name_ko} 꾸미기`:`${room().name_ko} 둘러보기`;
    $('studio-description').textContent=mode==='complex'?'단지에서 세대를 고르고, 집 안으로 들어가 보세요.':mode==='overview'?'평면도나 3D에서 장소를 선택하세요.':mode==='edit'?'왼쪽에서 배치하면 오른쪽 공간에 바로 반영됩니다.':`방을 선택한 뒤 둘러보기를 시작하세요. ${hint('walk')}`;
    $('three-label').querySelector('strong').textContent=mode==='complex'?(buildingSelected?'예시 동 A · 층 선택 입면':'아크로 리버파크'):mode==='overview'?'22층 시연 세대 · 3D':mode==='edit'?'실시간 3D':'1인칭 둘러보기';
    $('orbit-help').textContent=hint(mode==='tour'?'tour':'orbit');
    requestAnimationFrame(()=>{resize();if(mode==='complex')selectFloor(floor);else if(mode==='overview')frame([-.2,0,13.7,10.2],true);else if(mode==='edit')frame(room().bounds_m);dirty();});
    if(mode==='edit'){selection=current().staging.items.find(i=>!i.deleted&&inside(i,room()))?.id||null;}
    renderPlan();refreshItems();showWarnings();status('');
  }
  function inside(i,r){const [x1,z1,x2,z2]=r.bounds_m;return i.x>=x1&&i.x<=x2&&i.z>=z1&&i.z<=z2;}
  function refreshRooms(){const value=roomId;$('studio-room').replaceChildren();for(const r of rooms()){const o=document.createElement('option');o.value=r.id;o.textContent=r.name_ko;$('studio-room').append(o);}$('studio-room').value=rooms().some(r=>r.id===value)?value:rooms()[0].id;roomId=$('studio-room').value;for(const i of current().staging.items){const k=`${current().key}:${i.id}`;if(!assignments.has(k))assignments.set(k,placementRoom(i).id);}}
  function chooseRoom(id){if(!rooms().some(r=>r.id===id))return;roomId=id;$('studio-room').value=id;if(mode==='edit')setMode('edit');else{renderPlan();status(`${room().name_ko} 선택됨. 둘러보기 또는 꾸미기를 눌러 주세요.`);}}
  function refreshItems(){
    if(!current())return;const host=$('selected-item');host.replaceChildren();
    for(const i of current().staging.items.filter(i=>!i.deleted&&placementRoom(i).id===roomId)){const o=document.createElement('option');o.value=i.id;o.textContent=i.title;host.append(o);}
    if(!item()||placementRoom(item()).id!==roomId)selection=host.options[0]?.value||null;
    host.value=selection||'';const selected=item();
    $('item-size').textContent=selected?`${selected.title} · 외곽 ${(selected.width*100).toFixed(1)} × ${(selected.depth*100).toFixed(1)}cm`:'배치할 가구를 추가해 보세요.';
    $('item-x').value=selected?selected.x.toFixed(2):'';$('item-z').value=selected?selected.z.toFixed(2):'';
    for(const id of ['apply-position','rotate-item','remove-item','item-x','item-z'])$(id).disabled=!selected;
    const old=$('add-kind').value;$('add-kind').replaceChildren();for(const [kind,source] of current().staging.templates){const o=document.createElement('option');o.value=kind;o.textContent=source.title.replace('안방 ','').replace('서쪽 ','');$('add-kind').append(o);}if(old)$('add-kind').value=old;
  }
  function renderPlan(){
    if(!current()||!room())return;
    const plan=$('layout-plan'),b=[...(mode==='edit'?room().bounds_m:[-.25,-.25,13.9,10.35])],pad=.25;
    // Keep freely dragged furniture visible and selectable beyond the room edge.
    if(mode==='edit'&&!drag)for(const i of current().staging.items.filter(i=>!i.deleted&&placementRoom(i).id===roomId))for(const [x,z] of corners(i)){b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],z);b[2]=Math.max(b[2],x);b[3]=Math.max(b[3],z);}
    plan.setAttribute('viewBox',drag?.viewBox||`${b[0]-pad} ${b[1]-pad} ${b[2]-b[0]+2*pad} ${b[3]-b[1]+2*pad}`);plan.replaceChildren();
    $('plan-title').textContent=mode==='edit'?`${room().name_ko} · 2D 배치도`:'세대 평면 · 장소 선택';
    for(const r of rooms()){
      if(mode==='edit'&&r.id!==roomId)continue;
      const [x,z,x2,z2]=r.bounds_m;const group=svg('g',{'data-room':r.id,class:`plan-room ${r.kind==='balcony'||r.kind==='open_balcony'?'balcony':''} ${r.id===roomId?'active':''}`});
      group.append(svg('rect',{x,y:z,width:x2-x,height:z2-z,rx:.03}),svg('text',{x:(x+x2)/2,y:z+.27,'text-anchor':'middle'},r.name_ko));
      group.addEventListener('click',()=>{if(mode==='overview')chooseRoom(r.id);});plan.append(group);
    }
    for(const o of current().staging.obstacles){const x=Math.max(b[0],o.x-o.width/2),z=Math.max(b[1],o.z-o.depth/2),x2=Math.min(b[2],o.x+o.width/2),z2=Math.min(b[3],o.z+o.depth/2);if(x2>x&&z2>z)plan.append(svg('rect',{x,y:z,width:x2-x,height:z2-z,class:'plan-fixed'}));}
    for(const d of doorFootprints(current().definition.doors)){if(mode==='edit'&&!inside(d,room()))continue;plan.append(svg('polygon',{points:corners(d).map(p=>p.join(',')).join(' '),class:'plan-door-clearance'}));}
    for(const i of current().staging.items){
      if(i.deleted||mode==='edit'&&placementRoom(i).id!==roomId)continue;
      const g=svg('g',{'data-item':i.id,class:`plan-item ${selection===i.id?'selected':''} ${warnings(i).length?'warning':''}`,tabindex:mode==='edit'?0:-1,role:'button','aria-label':`${i.title}, X ${i.x.toFixed(2)}m, Z ${i.z.toFixed(2)}m`});
      g.append(svg('polygon',{points:corners(i).map(p=>p.join(',')).join(' ')}),svg('text',{x:i.x,y:i.z,'text-anchor':'middle','dominant-baseline':'middle'},i.kind==='sofa'?'소파':i.kind==='stool'?'스툴':i.kind==='king'?'킹':i.kind==='desk'?'책상':i.kind==='chair'?'의자':'싱글'));
      g.addEventListener('pointerdown',e=>{if(mode!=='edit')return;e.preventDefault();selection=i.id;const p=planPoint(e);drag={id:i.id,dx:i.x-p.x,dz:i.z-p.y,viewBox:plan.getAttribute('viewBox')};plan.setPointerCapture(e.pointerId);refreshItems();renderPlan();});
      g.addEventListener('keydown',e=>{if(mode!=='edit')return;const d={ArrowLeft:[-.05,0],ArrowRight:[.05,0],ArrowUp:[0,-.05],ArrowDown:[0,.05]}[e.key];if(!d)return;e.preventDefault();selection=i.id;moveSelected({x:i.x+d[0],z:i.z+d[1]});plan.querySelector(`[data-item="${i.id}"]`)?.focus();});plan.append(g);
    }
  }
  function planPoint(e){const p=new DOMPoint(e.clientX,e.clientY);return p.matrixTransform($('layout-plan').getScreenCTM().inverse());}
  function moveSelected(patch,commit=true){
    const candidate=item()?{...item(),...patch}:null;
    const doorError=candidate&&!allowOverlap?placementWarnings(candidate,room(),[],[],doorFootprints(current().definition.doors)).find(s=>s.includes('개방 범위')):null;
    const error=doorError||current().staging.move(selection,patch,room(),commit,allowOverlap);
    status(error||'배치가 3D에 반영됐어요.');refreshItems();renderPlan();showWarnings();dirty();return error;
  }
  $('layout-plan').addEventListener('pointermove',e=>{if(!drag)return;const p=planPoint(e);selection=drag.id;moveSelected({x:Math.round((p.x+drag.dx)*100)/100,z:Math.round((p.y+drag.dz)*100)/100},false);});
  function endDrag(){if(!drag)return;drag=null;current().staging.rebuild();renderPlan();dirty();}
  $('layout-plan').addEventListener('pointerup',endDrag);$('layout-plan').addEventListener('pointercancel',endDrag);$('layout-plan').addEventListener('lostpointercapture',endDrag);
  $('select-building').onclick=()=>{buildingSelected=true;tower.selectBuilding('A');buildingSelect.value='A';$('unit-options').hidden=false;setMode('complex');selectFloor(floor);requestAnimationFrame(()=>rail.querySelector(`[data-floor="${floor}"]`).scrollIntoView({block:'center'}));};
  $('hero-building').onclick=()=>$('select-building').click();
  $('floor-range').oninput=e=>selectFloor(e.target.value);
  rail.addEventListener('wheel',e=>{e.preventDefault();selectFloor(floor+(e.deltaY<0?1:-1));rail.querySelector(`[data-floor="${floor}"]`).scrollIntoView({block:'nearest'});},{passive:false});
  $('allow-overlap').onchange=e=>{allowOverlap=e.target.checked;status(allowOverlap?'겹침을 허용하고 경고로 안내합니다.':'이후 이동에서 겹침과 문 개방 간섭을 제한합니다. 기존 배치는 유지됩니다.');showWarnings();};
  $('exterior-enabled').onchange=e=>{exteriorEnabled=e.target.checked;exterior.group.visible=mode==='tour'&&exteriorEnabled;badge.hidden=!exterior.group.visible;dirty();};
  $('open-unit').onclick=async()=>{if(floor!==22||tower.selected.id!=='A')return;const button=$('open-unit');button.disabled=true;try{await loadVariant($('studio-variant').value);if(current().key!==$('studio-variant').value){status('세대 로딩에 실패했습니다. 다시 시도해 주세요.');return;}refreshRooms();setMode('overview');}finally{button.disabled=floor!==22||tower.selected.id!=='A';}};
  $('studio-room').onchange=e=>chooseRoom(e.target.value);
  $('nav-complex').onclick=()=>{buildingSelected=false;$('unit-options').hidden=true;setMode('complex');};$('nav-plan').onclick=()=>{if(mode==='complex'){status('예시 동 A의 22층을 선택해 주세요.');return;}setMode('overview');};$('back-plan').onclick=()=>setMode('overview');
  function walk(){setMode('tour');if(!enterRoom(room()))status('이 공간에서 안전한 시작 위치를 찾지 못했어요. 다른 장소를 선택해 주세요.');}
  $('room-walk').onclick=walk;$('mode-tour').onclick=walk;$('mode-edit').onclick=()=>setMode('edit');$('room-edit').onclick=()=>setMode('edit');
  $('selected-item').onchange=e=>{selection=e.target.value;refreshItems();renderPlan();};
  $('apply-position').onclick=()=>moveSelected({x:Number($('item-x').value),z:Number($('item-z').value)});
  $('rotate-item').onclick=()=>{if(item())moveSelected({angle:(item().angle+Math.PI/2)%(Math.PI*2)});};
  $('remove-item').onclick=()=>{current().staging.remove(selection);selection=null;refreshItems();renderPlan();showWarnings();dirty();status('가구를 제거했어요.');};
  $('add-item').onclick=()=>{const r=current().staging.add($('add-kind').value,room(),allowOverlap);if(r.error){status(r.error);return;}selection=r.item.id;assignments.set(`${current().key}:${selection}`,roomId);refreshItems();renderPlan();showWarnings();dirty();status('가구를 추가했어요.');};
  $('save-layout').onclick=()=>{try{localStorage.setItem(key(),JSON.stringify({revision:1,items:current().staging.snapshot().map(i=>({...i,roomId:placementRoom(i).id}))}));status('이 브라우저에 배치를 저장했어요.');}catch{status('브라우저 저장 공간을 사용할 수 없어요.');}};
  $('restore-layout').onclick=()=>{try{const data=JSON.parse(localStorage.getItem(key()));if(data?.revision!==1||!Array.isArray(data.items))throw Error();current().staging.restore(data.items,rooms());for(const i of data.items)if(rooms().some(r=>r.id===i?.roomId))assignments.set(`${current().key}:${i.id}`,i.roomId);refreshRooms();refreshItems();renderPlan();showWarnings();dirty();status('저장한 배치를 불러왔어요.');}catch{status('이 평면에 저장된 유효한 배치가 없어요.');}};
  $('reset-layout').onclick=()=>{current().staging.reset();assignments.clear();refreshRooms();refreshItems();renderPlan();showWarnings();dirty();status('초기 배치로 되돌렸어요. 저장한 배치는 유지돼요.');};
  let pointerStart;
  renderer.domElement.addEventListener('pointerdown',e=>{pointerStart=[e.clientX,e.clientY];});
  renderer.domElement.addEventListener('pointerup',e=>{
    if(!pointerStart||Math.hypot(e.clientX-pointerStart[0],e.clientY-pointerStart[1])>5)return;
    const rect=renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);
    if(mode==='complex'&&buildingSelected){const hit=tower.hitTest(raycaster);if(hit){const alreadySelected=hit.id===tower.selected.id;chooseBuilding(hit.id);selectFloor(hit.floor);if(alreadySelected&&hit.id==='A'&&floor===22)$('open-unit').click();}}
    if(mode==='overview'){const p=new THREE.Vector3();if(raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),p)){const r=rooms().find(r=>inside({x:p.x,z:p.z},r));if(r)chooseRoom(r.id);}}
  });
  refreshRooms();$('studio-variant').value=current().key;setMode('complex');ready=true;
  return {onVariant(){if(!ready)return;refreshRooms();setMode(mode);},get mode(){return mode;},
    inspect:()=>({mode,roomId,selection,floor,contextView,buildingId:tower.selected.id,buildingCount:tower.buildings.length,allowOverlap,exteriorVisible:exterior.group.visible,warnings:current().staging.items.filter(i=>!i.deleted).map(i=>({id:i.id,messages:warnings(i)})),items:current().staging.snapshot(),positions:current().staging.items.map(i=>({id:i.id,position:i.group.position.toArray(),rotation:i.group.rotation.y,visible:i.group.visible}))}),
    selectRoom:chooseRoom,setMode,moveSelected};
}
