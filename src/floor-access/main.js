import './style.css';
import {buildFloor,DEFAULTS,LIMITS,UNIT_SOURCE,transformPoint,classifyEndpoint} from './fixture.js';
import {inspectPose,fitsCar,inspectRoute} from './transport.js';
import {createFloorScene} from './scene.js';
import {CATALOG_FURNITURE,loadCatalogFurniture} from '../walkthrough/catalog-furniture.js';

const root=document.querySelector('#floor-access-app');
const fields=[['hallWidth','공용 홀 폭'],['hallDepth','공용 홀 깊이'],['carWidth','카 내부 폭'],['carDepth','카 내부 깊이'],['carHeight','카 내부 높이'],['doorWidth','완전 개방 문 폭'],['doorHeight','문 유효 높이']];
root.innerHTML=`<header><a class="brand" href="/?studio=1">CORTEX <span>SPACE LAB</span></a><div class="study-badge">공용층 검토 · 가정 배치</div></header>
<main><section class="intro"><div><p class="eyebrow">FURNITURE ACCESS</p><h1>엘리베이터에서 현관 앞까지</h1><p>가구를 옮기고 돌려 보세요. 내부 크기, 문 간섭, 이동 경로를 나누어 확인합니다.</p></div><button id="export-review" class="secondary">검토 결과 저장</button></section>
<div class="source-note"><strong>실제 아크로리버파크 공용층 도면이 아닙니다.</strong> 168C 확장형 두 세대는 기존 도면 좌표를 그대로 배치했습니다. 홀·엘리베이터 치수와 세대 조합은 수정 가능한 가정입니다.</div>
<section class="workspace"><article class="panel"><div class="panel-head"><h2>2D 반입 경로</h2><div class="segmented"><button id="plan-core" aria-pressed="true">공용부</button><button id="plan-all" aria-pressed="false">한 층</button></div></div><svg id="floor-plan" tabindex="0" role="application" aria-label="가구 이동 평면도. 가구를 드래그하거나 방향키로 5cm 이동하고 Q, E로 회전하세요."></svg><div class="panel-tools"><span>드래그 · 방향키 5cm · Q/E 회전</span><button id="record-route">경로 기록 시작</button><button id="check-route" class="primary">기록 경로 검사</button></div><div class="route-info" id="record-info" aria-live="polite">기록을 시작한 뒤 가구를 움직여 주세요.</div></article>
<article class="panel"><div class="panel-head"><h2>3D로 확인</h2><span id="render-status" role="status">준비 중</span></div><div id="floor-viewport"></div><div class="panel-tools"><button id="frame-core">공용부 보기</button><button id="frame-all">한 층 보기</button><label><input type="checkbox" id="unit-context"> 원본 세대 3D 표시</label></div><p class="panel-caption">천장은 보기에서만 숨김 · 검사는 전체 높이 사용 · 세대 내부 경로는 제외</p></article></section>
<section class="results" aria-live="polite"><article id="car-card"><span>01 / 내부 수용</span><h3 id="car-result"></h3><p>현재 각도 그대로 카 중앙에 놓았을 때의 크기 비교입니다. 문 통과 결과와 다릅니다.</p></article><article id="pose-card"><span>02 / 현재 위치</span><h3 id="pose-result"></h3><p id="pose-detail"></p></article><article id="route-card"><span>03 / 기록한 경로</span><h3 id="route-result">아직 검사하지 않았어요</h3><p id="route-detail">엘리베이터 내부에서 현관 앞까지 이동한 경로를 기록해 검사하세요.</p></article></section>
<section class="settings"><article class="setting-card"><h2>옮길 가구</h2><label class="wide">가구 선택<select id="cargo-kind">${CATALOG_FURNITURE.map(a=>`<option value="${a.id}">${a.title}</option>`).join('')}<option value="manual">직접 치수 입력</option></select></label><p id="cargo-source" class="hint"></p><div class="field-grid">${[['width','폭'],['depth','깊이'],['height','높이']].map(([k,l])=>`<label>${l} (m)<input id="cargo-${k}" type="number" min="0.10" max="4" step="0.01"></label>`).join('')}<label>회전 (°)<input id="cargo-yaw" type="number" min="-720" max="720" step="15" value="0"></label></div><div class="button-row"><button id="rotate-left">↶ 15°</button><button id="rotate-right">↷ 15°</button><button id="cargo-render">가구 3D 불러오기</button></div><label class="wide">위치 옮기기<select id="cargo-place"><option value="car">엘리베이터 중앙</option><option value="hall">공용 홀 중앙</option><option value="study-unit-1">1라인 현관 앞</option><option value="study-unit-2">2라인 현관 앞</option></select></label><p class="hint">위치 선택은 순간 이동이며 경로 기록을 초기화합니다. 치수 수정 시 모델은 치수 상자로 바뀝니다.</p><p id="cargo-feedback" role="status"></p></article>
<article class="setting-card"><h2>공용부 치수 <span class="tag">가정값</span></h2><form id="dimensions-form"><div class="field-grid">${fields.map(([k,l])=>`<label>${l} (m)<input name="${k}" type="number" step="0.01" min="${LIMITS[k][0]}" max="${LIMITS[k][1]}" value="${DEFAULTS[k]}"></label>`).join('')}<label>계산 여유 (cm)<input name="clearance" type="number" step="0.5" min="0" max="15" value="2"></label></div><div class="button-row"><button type="submit" class="primary">치수 적용</button><button type="button" id="door-toggle" aria-pressed="false">엘리베이터 문 닫기</button></div><p id="dimension-feedback" role="status" class="hint">실측값이 있으면 입력하세요. 적용하면 위치와 기록 경로가 초기화됩니다.</p></form></article>
<article class="setting-card explanation"><h2>이 결과의 범위</h2><p>수치는 미터입니다. 가구를 서 있는 상태로 옮기며 수평 회전하는 경로만 검사합니다. 회전 도중의 벽·문틀 간섭도 포함합니다.</p><p>겹치는 위치로도 움직일 수 있고 경고를 표시합니다. “간섭 없음”은 입력한 형상과 경로에 대한 결과이며, 실제 반입 성공을 보증하지 않습니다.</p><ul><li>가구 모델 규격은 제품 실측값이 아닙니다.</li><li>기울이기, 다리 분리, 포장·손잡이, 사람의 작업 공간은 별도 검토가 필요합니다.</li><li>세대 현관문은 닫혀 있습니다. 이번 경로의 목적지는 현관 <strong>앞</strong>입니다.</li><li>문 상태나 치수가 바뀌면 이전 경로 결과는 무효화됩니다.</li></ul><button id="example-route">현관 앞 예시 경로 만들기</button><p class="hint">예시 경로도 검사하며, 통과하도록 가구를 축소하지 않습니다.</p></article></section>
<footer>공용부 실측 전 검토용 원형 · 계단·피난 공간 및 실제 1/2라인 대응은 미구현 · 원본 세대의 벽·가구·재질은 변경하지 않음</footer></main>`;
const $=id=>document.getElementById(id), svg=$('floor-plan'), ns='http://www.w3.org/2000/svg';
let floor=buildFloor(),currentAsset=CATALOG_FURNITURE.find(a=>a.id==='cc0-dining-chair-02')??CATALOG_FURNITURE[0];
let cargo={...currentAsset.dimensions_m,x:floor.car.x,z:floor.car.z,yaw:0,bottomY:0},cargoModel=null,loadVersion=0,planAll=false;
let route=[],recording=false,routeResult=null,drag=null,contextVersion=0;
const pose=()=>({x:cargo.x,z:cargo.z,yaw:cargo.yaw,bottomY:0});
const clone=v=>JSON.parse(JSON.stringify(v));
let view=createFloorScene($('floor-viewport'),{onReady:()=>{$('render-status').textContent='1m = 1 단위';document.body.dataset.loadState='ready';},onError:e=>{if(!view.inspect().ready)document.body.dataset.loadState='2d-only';$('render-status').textContent='3D 표시 실패 · 2D는 사용 가능';console.warn(e);}});
view.setFloor(floor);
function el(tag,attrs={},parent=svg){const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));parent.append(e);return e;}
function label(x,z,text,cls='plan-label',parent=svg){const e=el('text',{x,y:z,class:cls},parent);e.textContent=text;return e;}
function points(item){const c=Math.cos(item.yaw),s=Math.sin(item.yaw);return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z])=>[item.x+c*x*item.width/2+s*z*item.depth/2,item.z-s*x*item.width/2+c*z*item.depth/2]);}
// Only the hypothetical shared hall is modeled for cargo transport. A clear OBB
// test outside that domain says nothing about unmodeled apartment geometry.
function insideScope(item){
 const {hallWidth,hallDepth,clearance}=floor.config;
 return points(item).every(([x,z])=>Math.abs(x)+clearance<hallWidth/2 && Math.abs(z)+clearance<hallDepth/2);
}
function currentCheck(){
 const hit=inspectPose(cargo,floor.obstacles,{clearance:floor.config.clearance});
 return {...hit,clear:hit.clear&&insideScope(cargo),withinScope:insideScope(cargo)};
}
function drawPlan(){
 svg.replaceChildren();const p=floor.config,w=p.hallWidth/2,d=p.hallDepth/2;
 const rooms=floor.units.flatMap(u=>UNIT_SOURCE.rooms.map(r=>({...r,unit:u,poly:r.polygon_m.map(pt=>transformPoint(pt,u))})));
 const allPts=rooms.flatMap(r=>r.poly);
 const b=planAll?[Math.min(...allPts.map(p=>p[0]))-.7,Math.min(...allPts.map(p=>p[1]))-.7,Math.max(...allPts.map(p=>p[0]))+.7,Math.max(...allPts.map(p=>p[1]))+.7]:[-w-1.05,-d-.6,w+1.05,d+.65];
 svg.setAttribute('viewBox',`${b[0]} ${b[1]} ${b[2]-b[0]} ${b[3]-b[1]}`);
 for(const r of rooms)el('polygon',{points:r.poly.map(p=>p.join(',')).join(' '),class:'unit-room'});
 for(const z of floor.zones)el('rect',{x:z.x-z.width/2,y:z.z-z.depth/2,width:z.width,height:z.depth,class:`zone ${z.id==='car'?'car-zone':''}`});
 for(const o of floor.obstacles){if(['ceiling','lintel'].includes(o.kind)||o.bottomY>0)continue;el('polygon',{points:points(o).map(p=>p.join(',')).join(' '),class:`obstacle ${o.kind}`});}
 for(const dest of floor.destinations){el('circle',{cx:dest.x,cy:dest.z,r:.12,class:'destination'});label(dest.x,dest.z-.35,dest.label);}
 label(0,floor.car.z-.3,`엘리베이터 ${p.carWidth.toFixed(2)} × ${p.carDepth.toFixed(2)}m`);
 label(0,floor.car.z+.45,`문 ${p.doorWidth.toFixed(2)} × ${p.doorHeight.toFixed(2)}m`,'small-label');
 label(0,d-.35,`공용 홀 ${p.hallWidth.toFixed(2)} × ${p.hallDepth.toFixed(2)}m`,'small-label');
 if(planAll)for(const u of floor.units){const pt=transformPoint([16,7],u);label(pt[0],pt[1],u.label,'unit-label');}
 if(route.length>1)el('polyline',{id:'route-line',points:route.map(p=>`${p.x},${p.z}`).join(' '),class:`route-line ${routeResult?.status??'pending'}`});
 const hit=currentCheck();
 const g=el('g',{id:'cargo-plan',class:hit.clear?'cargo':'cargo collision','aria-label':'옮기는 가구'});
 el('polygon',{points:points(cargo).map(p=>p.join(',')).join(' ')},g);
 const front=[cargo.x+Math.sin(cargo.yaw)*cargo.depth/2,cargo.z+Math.cos(cargo.yaw)*cargo.depth/2];
 el('line',{x1:cargo.x,y1:cargo.z,x2:front[0],y2:front[1]},g);el('circle',{cx:cargo.x,cy:cargo.z,r:.065},g);
 label(cargo.x,cargo.z-cargo.depth/2-.18,currentAsset?.title??'치수 상자','cargo-label');
 $('plan-all').setAttribute('aria-pressed',String(planAll));$('plan-core').setAttribute('aria-pressed',String(!planAll));
}
function clearRoute(message='치수·위치·문 상태 변경으로 경로가 초기화됐어요.'){
 route=[];recording=false;routeResult=null;$('record-route').textContent='경로 기록 시작';$('record-info').textContent=message;
 $('route-result').textContent='아직 검사하지 않았어요';$('route-detail').textContent='엘리베이터 내부와 현관 앞 사이의 경로를 기록하세요.';$('route-card').dataset.state='pending';
}
function recordPose(){if(!recording)return;const p=pose(),a=route.at(-1);if(!a||Math.hypot(a.x-p.x,a.z-p.z)+Math.abs(a.yaw-p.yaw)>.0001){if(route.length>=1500){recording=false;$('record-info').textContent='기록 한도에 도달했습니다. 지금 경로를 검사하거나 다시 시작하세요.';}else route.push(p);}}
function sync(){
 recordPose();const hit=currentCheck();
 const carResult=fitsCar({...cargo,x:floor.car.x,z:floor.car.z},floor.car,{clearance:floor.config.clearance});
 $('car-result').textContent=carResult.fits?'현재 각도로 내부에 들어가요':'현재 각도로는 여유가 부족해요';$('car-card').dataset.state=carResult.fits?'clear':'blocked';
 $('pose-result').textContent=!hit.withinScope?'공용부 검토 범위 밖입니다':hit.clear?'현재 위치에 간섭 없음':'현재 위치에 간섭이 있어요';$('pose-card').dataset.state=!hit.withinScope?'unresolved':hit.clear?'clear':'blocked';
 $('pose-detail').textContent=!hit.withinScope?'가구 전체를 공용 홀·엘리베이터 안으로 옮겨 주세요. 세대 내부와 바깥 공간은 검사하지 않습니다.':hit.clear?`계산 여유 ${(floor.config.clearance*100).toFixed(1)}cm 포함 · 세대 내부는 검사하지 않아요.`:[...new Set(hit.hits.map(h=>h.title))].join(' / ');
 if(recording)$('record-info').textContent=`기록 중 · ${route.length}개 위치. 회전도 기록합니다.`;
 $('cargo-yaw').value=(cargo.yaw*180/Math.PI).toFixed(1);
 drawPlan();view.setCargo(cargo,{colliding:!hit.clear,model:cargoModel});view.setRoute(route,routeResult?.status??'pending');
 window.cortexFloorAccess.snapshot={config:clone(floor.config),cargo:clone(cargo),currentAsset:currentAsset?.id??null,poseCheck:hit,carCheck:carResult,route:clone(route),routeResult:clone(routeResult),recording,sourceGlb:UNIT_SOURCE.glb_sha256,units:clone(floor.units),renderer:view.inspect()};
}
function changedPose(){if(!recording && route.length)clearRoute('위치를 바꿨습니다. 새 경로를 기록해 주세요.');if(routeResult){routeResult=null;$('route-result').textContent='위치 변경 · 다시 검사해 주세요';$('route-card').dataset.state='pending';}sync();}
function pickAsset(id){loadVersion++;currentAsset=CATALOG_FURNITURE.find(a=>a.id===id)??null;cargoModel=null;if(currentAsset)Object.assign(cargo,currentAsset.dimensions_m);for(const k of ['width','depth','height'])$('cargo-'+k).value=cargo[k].toFixed(4);$('cargo-source').textContent=currentAsset?'Poly Haven · CC0 / 모델 경계 규격이며 제품 실측값은 미확인입니다.':'사용자 입력 치수입니다. 포장·다리·손잡이를 포함한 운반 규격을 입력하세요.';$('cargo-render').disabled=!currentAsset;$('cargo-feedback').textContent='';clearRoute();sync();}
function moveTo(id){clearRoute();const t=id==='car'?floor.car:id==='hall'?{x:0,z:0}:floor.destinations.find(d=>d.id===id);if(t){cargo.x=t.x;cargo.z=t.z;}sync();}
function checkRoute(){
 recording=false;$('record-route').textContent='새 경로 기록';const result=inspectRoute(cargo,route,floor.obstacles,{clearance:floor.config.clearance});
 const outside=route.some(p=>!insideScope({...cargo,...p}));
 if(outside&&result.status==='clear'){result.status='unresolved';result.reason='outside-review-scope';}
 result.withinScope=!outside;
 const first=route[0],last=route.at(-1),start=first&&classifyEndpoint(first,floor),end=last&&classifyEndpoint(last,floor);
 const carPose=start==='car'?first:end==='car'?last:null;
 const carInside=carPose&&fitsCar({...cargo,...carPose},floor.car,{clearance:floor.config.clearance}).fits;
 const complete=Boolean(carInside&&((start==='car'&&String(end).startsWith('study-unit'))||(end==='car'&&String(start).startsWith('study-unit'))));
 routeResult={...result,completeEndpoints:complete,start,end};
 $('route-card').dataset.state=result.status;
 $('route-result').textContent=result.status==='clear'?(complete?'기록한 현관 앞 경로에 간섭 없음':'기록한 일부 경로에 간섭 없음'):result.status==='blocked'?'기록 경로에 간섭이 있어요':'아직 경로를 확인할 수 없어요';
 $('route-detail').textContent=result.status==='clear'?`${result.segments}개 이동·회전 구간을 연속 범위로 확인했습니다. ${complete?'기울이기·세대 내부는 제외합니다.':'엘리베이터 내부↔현관 앞의 전체 경로는 아닙니다.'}`:result.status==='blocked'?`${result.hits.map(h=>h.title).join(' / ')}. 다른 경로가 불가능하다는 뜻은 아닙니다.`:outside?'검토 범위 밖의 위치가 포함돼 있습니다. 공용부 안의 경로를 다시 기록하세요.':'두 개 이상의 위치를 기록해 주세요. 보수적 검사 한도에서 확인하지 못한 구간도 미확인으로 남깁니다.';
 $('record-info').textContent=`경로 검사 ${result.samples}회 · 위치와 치수를 바꾸면 다시 검사해야 합니다.`;sync();
}
window.cortexFloorAccess={snapshot:{},inspect:()=>({...clone(window.cortexFloorAccess.snapshot),renderer:view.inspect()}),setPose(p){if(![p.x,p.z,p.yaw].every(Number.isFinite))throw Error('invalid pose');Object.assign(cargo,p,{bottomY:0});changedPose();},setRoute(poses){route=clone(poses);recording=false;checkRoute();}};
$('cargo-kind').value=currentAsset.id;pickAsset(currentAsset.id);
$('cargo-kind').addEventListener('change',e=>pickAsset(e.target.value));
for(const k of ['width','depth','height'])$('cargo-'+k).addEventListener('change',()=>{const n=Number($('cargo-'+k).value);if(!Number.isFinite(n)||n<.1||n>4){$('cargo-'+k).value=cargo[k];return;};cargo[k]=n;currentAsset=null;cargoModel=null;loadVersion++;$('cargo-kind').value='manual';$('cargo-render').disabled=true;$('cargo-source').textContent='직접 입력한 운반 규격 · 실측 여부는 사용자 확인 필요';clearRoute();sync();});
$('cargo-yaw').addEventListener('change',e=>{const n=Number(e.target.value);if(!Number.isFinite(n)||Math.abs(n)>720){e.target.value=(cargo.yaw*180/Math.PI).toFixed(1);return;}cargo.yaw=n*Math.PI/180;changedPose();});
for(const [id,direction] of [['rotate-left',-1],['rotate-right',1]])$(id).addEventListener('click',()=>{cargo.yaw+=direction*Math.PI/12;changedPose();});
$('cargo-place').addEventListener('change',e=>moveTo(e.target.value));
$('cargo-render').addEventListener('click',async()=>{const id=currentAsset?.id;if(!id)return;const token=++loadVersion;$('cargo-feedback').textContent='실제 가구 모델을 불러오는 중…';try{const model=await loadCatalogFurniture(id);if(token!==loadVersion||id!==currentAsset?.id)return;cargoModel=model;$('cargo-feedback').textContent='원본 모델 비율 유지 · 치수를 바꾸면 상자로 표시합니다.';sync();}catch(e){if(token===loadVersion)$('cargo-feedback').textContent=e.message;}});
$('dimensions-form').addEventListener('submit',e=>{e.preventDefault();const data=new FormData(e.target),input={doorOpen:floor.config.doorOpen};for(const [k] of fields)input[k]=Number(data.get(k));input.clearance=Number(data.get('clearance'))/100;try{floor=buildFloor(input);view.setFloor(floor);cargo.x=floor.car.x;cargo.z=floor.car.z;clearRoute();$('dimension-feedback').textContent='치수 적용 완료 · 입력 치수는 현장 실측으로 검증되지 않았습니다.';sync();}catch(err){$('dimension-feedback').textContent=err.message;}});
$('door-toggle').addEventListener('click',()=>{floor=buildFloor({...floor.config,doorOpen:!floor.config.doorOpen});clearRoute();view.setFloor(floor);$('door-toggle').textContent=floor.config.doorOpen?'엘리베이터 문 닫기':'엘리베이터 문 열기';$('door-toggle').setAttribute('aria-pressed',String(!floor.config.doorOpen));sync();});
$('record-route').addEventListener('click',()=>{if(recording){recording=false;$('record-route').textContent='새 경로 기록';$('record-info').textContent=`${route.length}개 위치 기록 완료. 경로 검사를 눌러 주세요.`;}else{clearRoute('');recording=true;route=[pose()];$('record-route').textContent='기록 마치기';sync();}});
$('check-route').addEventListener('click',checkRoute);
$('example-route').addEventListener('click',()=>{const dst=floor.destinations[0];cargo.yaw=0;route=[{x:0,z:floor.car.z,yaw:0},{x:0,z:0,yaw:0},{x:0,z:0,yaw:Math.PI/2},{x:dst.x,z:0,yaw:Math.PI/2},{x:dst.x,z:dst.z,yaw:Math.PI/2}];Object.assign(cargo,route.at(-1));checkRoute();});
$('plan-core').addEventListener('click',()=>{planAll=false;drawPlan();});$('plan-all').addEventListener('click',()=>{planAll=true;drawPlan();});
$('frame-core').addEventListener('click',()=>view.frame('core'));$('frame-all').addEventListener('click',()=>view.frame('all'));
$('unit-context').addEventListener('change',async e=>{
 const enabled=e.target.checked,token=++contextVersion;
 $('render-status').textContent=enabled?'원본 세대 1개를 불러와 두 곳에 배치 중…':'1m = 1 단위';
 try{
  const loaded=await view.setUnitContext(enabled);
  if(token!==contextVersion)return;
  if(!view.inspect().ready){$('unit-context').checked=false;$('render-status').textContent='3D 표시 실패 · 2D는 사용 가능';return;}
  if(enabled&&(!loaded||!view.inspect().unitsLoaded)){$('unit-context').checked=false;$('render-status').textContent='세대 모델 표시 미완료 · 공용부 검토는 사용 가능';return;}
  $('render-status').textContent=enabled?'원본 168C × 2 · scale 1':'1m = 1 단위';
  if(enabled)view.frame('all');
 }catch{if(token===contextVersion){$('unit-context').checked=false;$('render-status').textContent='세대 모델 로드 실패 · 공용부 검토는 사용 가능';}}
});
function svgPoint(e){const m=svg.getScreenCTM();if(!m)return null;const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const v=p.matrixTransform(m.inverse());return [v.x,v.y];}
svg.addEventListener('pointerdown',e=>{if(!e.target.closest('#cargo-plan'))return;e.preventDefault();const p=svgPoint(e);drag={id:e.pointerId,dx:cargo.x-p[0],dz:cargo.z-p[1]};svg.setPointerCapture(e.pointerId);svg.focus();});
svg.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const p=svgPoint(e);cargo.x=Math.max(-30,Math.min(30,p[0]+drag.dx));cargo.z=Math.max(-30,Math.min(30,p[1]+drag.dz));changedPose();});
const release=e=>{if(drag?.id===e.pointerId)drag=null;};svg.addEventListener('pointerup',release);svg.addEventListener('pointercancel',release);
svg.addEventListener('keydown',e=>{if(e.key==='ArrowLeft')cargo.x-=.05;else if(e.key==='ArrowRight')cargo.x+=.05;else if(e.key==='ArrowUp')cargo.z-=.05;else if(e.key==='ArrowDown')cargo.z+=.05;else if(e.key.toLowerCase()==='q')cargo.yaw-=Math.PI/12;else if(e.key.toLowerCase()==='e')cargo.yaw+=Math.PI/12;else return;e.preventDefault();changedPose();});
$('export-review').addEventListener('click',()=>{const report={schema:'cortex-floor-access-review-v1',at:new Date().toISOString(),basis:floor.provenance,source_glb_sha256:UNIT_SOURCE.glb_sha256,config:floor.config,cargo:{...cargo,source:currentAsset?.id??'user-entered-not-verified'},route,result:routeResult,scope:'upright common hall/elevator to closed unit entry front; no tilting; hypothetical shared floor; not as-built or delivery guarantee'};const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='cortex-floor-access-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);});
window.addEventListener('pagehide',()=>view.dispose(),{once:true});
