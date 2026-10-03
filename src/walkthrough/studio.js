import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { corners } from './layout.js';
import './studio.css';
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
  <section id="room-picker" hidden><label for="studio-room">장소 선택</label><select id="studio-room"></select><div class="room-actions"><button id="room-walk" class="studio-primary">이곳에서 둘러보기</button><button id="room-edit">이곳 꾸미기</button></div><p class="evidence-note">천장고 2.6m · 문 개구부 2.1m 가정<br>킹 167×207.5cm / 싱글 100×200cm<br>욕실 집기와 침대 프레임은 예시 형상입니다.</p></section>
  <section id="editor-tools" hidden><div class="editor-row"><label for="add-kind">가구 추가</label><select id="add-kind"></select><button id="add-item">＋ 추가</button></div><label for="selected-item">배치한 가구</label><select id="selected-item"></select><p id="item-size"></p><div class="coordinate-inputs"><label>X (m)<input id="item-x" type="number" step="0.01"></label><label>Z (m)<input id="item-z" type="number" step="0.01"></label></div><div class="editor-row"><button id="apply-position">위치 적용</button><button id="rotate-item">90° 회전</button><button id="remove-item">삭제</button></div><div class="editor-row"><button id="save-layout">배치 저장</button><button id="restore-layout">저장 불러오기</button><button id="reset-layout">초기 배치</button></div><p class="evidence-note">이 브라우저에 저장됩니다. 2D에서 가구를 드래그하거나 방향키로 5cm씩 옮기세요. 가구 크기는 유지됩니다.</p></section>
  <p id="studio-status" role="status" aria-live="polite"></p></aside>
  <section id="plan-pane" hidden><div class="pane-label"><strong id="plan-title">2D 배치도</strong><span>미터 기준 · 위쪽이 도면 상단</span></div><svg id="layout-plan" role="img" aria-label="공간과 가구 배치도"></svg></section><div id="three-label" class="pane-label"><strong>단지 둘러보기</strong><span id="orbit-help">드래그 회전 · 휠 확대</span></div><button id="back-plan" hidden>← 세대 전체 보기</button>`;
  document.body.append(ui);
  let mode='complex',roomId='Living front',selection=null,drag=null,ready=false;
  const orbit=new OrbitControls(camera,renderer.domElement);orbit.enableDamping=false;orbit.maxPolarAngle=Math.PI*.48;orbit.minDistance=2;orbit.maxDistance=90;
  orbit.addEventListener('change',invalidate);
  const clipping=new THREE.Plane(new THREE.Vector3(0,-1,0),1.35);
  const complex=new THREE.Group();complex.name='Illustrative complex';scene.add(complex);
  const buildingMeshes=[];
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(52,40),new THREE.MeshStandardMaterial({color:0xd3dfcc,roughness:.95}));ground.rotation.x=-Math.PI/2;ground.position.set(6,-.02,5);complex.add(ground);
  for(let i=0;i<15;i++){
    const x=(i%5)*8-10,z=Math.floor(i/5)*11-6,h=4+(i%4)*1.5;
    const b=new THREE.Mesh(new THREE.BoxGeometry(3.2,h,5),new THREE.MeshStandardMaterial({color:i===0?0x48766b:0xe5e5da,roughness:.7}));b.position.set(x,h/2,z);b.userData.building=i;b.castShadow=true;complex.add(b);buildingMeshes.push(b);
    const edges=new THREE.LineSegments(new THREE.EdgesGeometry(b.geometry),new THREE.LineBasicMaterial({color:0x8eaaa1}));b.add(edges);
    for(let floor=1;floor<h/.45;floor++){const strip=new THREE.Mesh(new THREE.BoxGeometry(3.22,.025,5.02),new THREE.MeshBasicMaterial({color:0x9daea7}));strip.position.y=-h/2+floor*.45;b.add(strip);}
  }
  const raycaster=new THREE.Raycaster();
  const current=()=>getActive();
  function rooms(){const a=current();if(!a)return [];const labels={'Living front':'거실','Bedroom west':'작은 방 1','Bedroom center':'작은 방 2','Common bathroom lower':'공용 욕실'};return [...a.definition.info.rooms.filter(r=>!r.id.includes('balcony')&&!r.id.includes('strip')&&r.id!=='Common shower').map(r=>({...r,name_ko:labels[r.id]||r.name_ko})),{id:'Kitchen',name_ko:'주방',bounds_m:[6.9049,1.28,9.5642,4.0777]}];}
  const room=()=>rooms().find(r=>r.id===roomId)||rooms()[0];
  const item=()=>current()?.staging.items.find(i=>i.id===selection&&!i.deleted);
  const key=()=>`cortex-layout-v2:${current().key}:1`;
  function status(text){$('studio-status').textContent=text;}
  function dirty(){invalidate();}
  function frame(bounds,top=false){const [x1,z1,x2,z2]=bounds,cx=(x1+x2)/2,cz=(z1+z2)/2,span=Math.max(x2-x1,z2-z1);const fit=Math.max(z2-z1,(x2-x1)/camera.aspect)/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)))*1.18;orbit.target.set(cx,.2,cz);camera.up.set(0,1,0);camera.position.set(cx+(top?0:span*.7),top?fit:Math.max(span,fit*.65),cz+(top?.001:span*.8));camera.lookAt(orbit.target);orbit.update();dirty();}
  function setMode(next){
    if(!current())return;
    unlock();mode=next;document.body.dataset.studioMode=mode;orbit.enabled=mode!=='tour';
    complex.visible=mode==='complex';current().model.visible=!complex.visible;
    renderer.clippingPlanes=['overview','edit'].includes(mode)?[clipping]:[];
    $('unit-picker').hidden=mode!=='complex';$('room-picker').hidden=mode==='complex';$('editor-tools').hidden=mode!=='edit';
    $('plan-pane').hidden=!['overview','edit'].includes(mode);$('back-plan').hidden=mode!=='tour';
    $('mode-edit').disabled=mode==='complex';$('mode-tour').disabled=mode==='complex';
    $('mode-edit').classList.toggle('selected',mode==='edit');$('mode-tour').classList.toggle('selected',mode==='tour');
    $('studio-step').textContent=mode==='complex'?'01 / SELECT A HOME':mode==='overview'?'02 / EXPLORE THE PLAN':mode==='edit'?'03 / DESIGN YOUR SPACE':'03 / WALK THROUGH';
    $('studio-title').textContent=mode==='complex'?'살아볼 공간을 선택하세요.':mode==='overview'?'우리 집을 한눈에.':mode==='edit'?`${room().name_ko} 꾸미기`:`${room().name_ko} 둘러보기`;
    $('studio-description').textContent=mode==='complex'?'단지에서 세대를 고르고, 집 안으로 들어가 보세요.':mode==='overview'?'평면도나 3D에서 장소를 선택하세요.':mode==='edit'?'왼쪽에서 배치하면 오른쪽 공간에 바로 반영됩니다.':`방을 선택한 뒤 둘러보기를 시작하세요. ${hint('walk')}`;
    $('three-label').querySelector('strong').textContent=mode==='complex'?'단지 예시':mode==='overview'?'세대 전체 · 3D':mode==='edit'?'실시간 3D':'1인칭 둘러보기';
    $('orbit-help').textContent=hint(mode==='tour'?'tour':'orbit');
    requestAnimationFrame(()=>{resize();if(mode==='complex'){orbit.target.set(6,0,5);camera.position.set(40,36,42);orbit.update();}else if(mode==='overview')frame([-.2,0,13.7,10.2],true);else if(mode==='edit')frame(room().bounds_m);dirty();});
    if(mode==='edit'){selection=current().staging.items.find(i=>!i.deleted&&inside(i,room()))?.id||null;}
    renderPlan();refreshItems();status('');
  }
  function inside(i,r){const [x1,z1,x2,z2]=r.bounds_m;return i.x>=x1&&i.x<=x2&&i.z>=z1&&i.z<=z2;}
  function refreshRooms(){const value=roomId;$('studio-room').replaceChildren();for(const r of rooms()){const o=document.createElement('option');o.value=r.id;o.textContent=r.name_ko;$('studio-room').append(o);}$('studio-room').value=rooms().some(r=>r.id===value)?value:rooms()[0].id;roomId=$('studio-room').value;}
  function chooseRoom(id){roomId=id;$('studio-room').value=id;if(mode==='edit')setMode('edit');else{renderPlan();status(`${room().name_ko} 선택됨. 둘러보기 또는 꾸미기를 눌러 주세요.`);}}
  function refreshItems(){
    if(!current())return;const host=$('selected-item');host.replaceChildren();
    for(const i of current().staging.items.filter(i=>!i.deleted&&inside(i,room()))){const o=document.createElement('option');o.value=i.id;o.textContent=i.title;host.append(o);}
    if(!item()||!inside(item(),room()))selection=host.options[0]?.value||null;
    host.value=selection||'';const selected=item();
    $('item-size').textContent=selected?`${selected.title} · 외곽 ${(selected.width*100).toFixed(1)} × ${(selected.depth*100).toFixed(1)}cm`:'배치할 가구를 추가해 보세요.';
    $('item-x').value=selected?selected.x.toFixed(2):'';$('item-z').value=selected?selected.z.toFixed(2):'';
    for(const id of ['apply-position','rotate-item','remove-item','item-x','item-z'])$(id).disabled=!selected;
    const old=$('add-kind').value;$('add-kind').replaceChildren();for(const [kind,source] of current().staging.templates){const o=document.createElement('option');o.value=kind;o.textContent=source.title.replace('안방 ','').replace('서쪽 ','');$('add-kind').append(o);}if(old)$('add-kind').value=old;
  }
  function renderPlan(){
    if(!current()||!room())return;
    const plan=$('layout-plan'),b=mode==='edit'?room().bounds_m:[-.25,-.25,13.9,10.35],pad=.25;
    plan.setAttribute('viewBox',`${b[0]-pad} ${b[1]-pad} ${b[2]-b[0]+2*pad} ${b[3]-b[1]+2*pad}`);plan.replaceChildren();
    $('plan-title').textContent=mode==='edit'?`${room().name_ko} · 2D 배치도`:'세대 평면 · 장소 선택';
    for(const r of rooms()){
      if(mode==='edit'&&r.id!==roomId)continue;
      const [x,z,x2,z2]=r.bounds_m;const group=svg('g',{'data-room':r.id,class:`plan-room ${r.id===roomId?'active':''}`});
      group.append(svg('rect',{x,y:z,width:x2-x,height:z2-z,rx:.03}),svg('text',{x:(x+x2)/2,y:z+.27,'text-anchor':'middle'},r.name_ko));
      group.addEventListener('click',()=>{if(mode==='overview')chooseRoom(r.id);});plan.append(group);
    }
    for(const o of current().staging.obstacles){const x=Math.max(b[0],o.x-o.width/2),z=Math.max(b[1],o.z-o.depth/2),x2=Math.min(b[2],o.x+o.width/2),z2=Math.min(b[3],o.z+o.depth/2);if(x2>x&&z2>z)plan.append(svg('rect',{x,y:z,width:x2-x,height:z2-z,class:'plan-fixed'}));}
    for(const i of current().staging.items){
      if(i.deleted||mode==='edit'&&!inside(i,room()))continue;
      const g=svg('g',{'data-item':i.id,class:`plan-item ${selection===i.id?'selected':''}`,tabindex:mode==='edit'?0:-1,role:'button','aria-label':`${i.title}, X ${i.x.toFixed(2)}m, Z ${i.z.toFixed(2)}m`});
      g.append(svg('polygon',{points:corners(i).map(p=>p.join(',')).join(' ')}),svg('text',{x:i.x,y:i.z,'text-anchor':'middle','dominant-baseline':'middle'},i.kind==='sofa'?'소파':i.kind==='stool'?'스툴':i.kind==='king'?'킹':'싱글'));
      g.addEventListener('pointerdown',e=>{if(mode!=='edit')return;e.preventDefault();selection=i.id;const p=planPoint(e);drag={id:i.id,dx:i.x-p.x,dz:i.z-p.y};plan.setPointerCapture(e.pointerId);refreshItems();renderPlan();});
      g.addEventListener('keydown',e=>{if(mode!=='edit')return;const d={ArrowLeft:[-.05,0],ArrowRight:[.05,0],ArrowUp:[0,-.05],ArrowDown:[0,.05]}[e.key];if(!d)return;e.preventDefault();selection=i.id;moveSelected({x:i.x+d[0],z:i.z+d[1]});plan.querySelector(`[data-item="${i.id}"]`)?.focus();});plan.append(g);
    }
  }
  function planPoint(e){const p=new DOMPoint(e.clientX,e.clientY);return p.matrixTransform($('layout-plan').getScreenCTM().inverse());}
  function moveSelected(patch,commit=true){const error=current().staging.move(selection,patch,room(),commit);status(error||'배치가 3D에 반영됐어요.');refreshItems();renderPlan();dirty();return error;}
  $('layout-plan').addEventListener('pointermove',e=>{if(!drag)return;const p=planPoint(e);selection=drag.id;moveSelected({x:Math.round((p.x+drag.dx)*100)/100,z:Math.round((p.y+drag.dz)*100)/100},false);});
  function endDrag(){if(!drag)return;drag=null;current().staging.rebuild();dirty();}
  $('layout-plan').addEventListener('pointerup',endDrag);$('layout-plan').addEventListener('pointercancel',endDrag);$('layout-plan').addEventListener('lostpointercapture',endDrag);
  $('select-building').onclick=()=>{$('unit-options').hidden=false;buildingMeshes[0].material.color.setHex(0xb59259);status('예시 동 A · 구현된 112A 세대를 선택하세요.');dirty();};
  $('open-unit').onclick=async()=>{const button=$('open-unit');button.disabled=true;try{await loadVariant($('studio-variant').value);if(current().key!==$('studio-variant').value){status('세대 로딩에 실패했습니다. 다시 시도해 주세요.');return;}refreshRooms();setMode('overview');}finally{button.disabled=false;}};
  $('studio-room').onchange=e=>chooseRoom(e.target.value);
  $('nav-complex').onclick=()=>setMode('complex');$('nav-plan').onclick=()=>setMode('overview');$('back-plan').onclick=()=>setMode('overview');
  function walk(){setMode('tour');if(!enterRoom(room()))status('이 공간에서 안전한 시작 위치를 찾지 못했어요. 다른 장소를 선택해 주세요.');}
  $('room-walk').onclick=walk;$('mode-tour').onclick=walk;$('mode-edit').onclick=()=>setMode('edit');$('room-edit').onclick=()=>setMode('edit');
  $('selected-item').onchange=e=>{selection=e.target.value;refreshItems();renderPlan();};
  $('apply-position').onclick=()=>moveSelected({x:Number($('item-x').value),z:Number($('item-z').value)});
  $('rotate-item').onclick=()=>{if(item())moveSelected({angle:(item().angle+Math.PI/2)%(Math.PI*2)});};
  $('remove-item').onclick=()=>{current().staging.remove(selection);selection=null;refreshItems();renderPlan();dirty();status('가구를 제거했어요.');};
  $('add-item').onclick=()=>{const r=current().staging.add($('add-kind').value,room());if(r.error){status(r.error);return;}selection=r.item.id;refreshItems();renderPlan();dirty();status('가구를 추가했어요.');};
  $('save-layout').onclick=()=>{try{localStorage.setItem(key(),JSON.stringify({revision:1,items:current().staging.snapshot()}));status('이 브라우저에 배치를 저장했어요.');}catch{status('브라우저 저장 공간을 사용할 수 없어요.');}};
  $('restore-layout').onclick=()=>{try{const data=JSON.parse(localStorage.getItem(key()));if(data?.revision!==1||!Array.isArray(data.items))throw Error();current().staging.restore(data.items,rooms());refreshItems();renderPlan();dirty();status('저장한 배치를 불러왔어요.');}catch{status('이 평면에 저장된 유효한 배치가 없어요.');}};
  $('reset-layout').onclick=()=>{current().staging.reset();refreshItems();renderPlan();dirty();status('초기 배치로 되돌렸어요. 저장한 배치는 유지돼요.');};
  let pointerStart;
  renderer.domElement.addEventListener('pointerdown',e=>{pointerStart=[e.clientX,e.clientY];});
  renderer.domElement.addEventListener('pointerup',e=>{
    if(!pointerStart||Math.hypot(e.clientX-pointerStart[0],e.clientY-pointerStart[1])>5)return;
    const rect=renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);
    if(mode==='complex'){const hit=raycaster.intersectObjects(buildingMeshes,false)[0];if(hit){if(hit.object.userData.building===0)$('select-building').click();else status('현재는 예시 동 A의 112A 세대만 구현돼 있어요.');}}
    if(mode==='overview'){const p=new THREE.Vector3();if(raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),p)){const r=rooms().find(r=>inside({x:p.x,z:p.z},r));if(r)chooseRoom(r.id);}}
  });
  refreshRooms();$('studio-variant').value=current().key;setMode('complex');ready=true;
  return {onVariant(){if(!ready)return;refreshRooms();setMode(mode);},get mode(){return mode;},
    inspect:()=>({mode,roomId,selection,items:current().staging.snapshot(),positions:current().staging.items.map(i=>({id:i.id,position:i.group.position.toArray(),rotation:i.group.rotation.y,visible:i.group.visible}))}),
    selectRoom:chooseRoom,setMode,moveSelected};
}
