import './style.css';
import { mountTransportPanel } from './transport-panel.js';
import { createPairedScene } from './scene.js';
import { floorSlabs, transformPoint } from './geometry.js';

const params=new URLSearchParams(location.search);
let variant=params.get('variant')==='basic'?'basic':'expanded';
const app=document.getElementById('paired-floor-app');
app.innerHTML=`<header><div><h1>168C · 211A 공용층 시범</h1><p>아크로리버파크 · 두 세대와 공용부를 한 공간에서 검토</p></div><span class="pill">로컬 검토 · 실제 층 배치 미확인</span></header>
<div class="notice"><strong>배치 가정</strong><span id="layout-note">세대 내부는 원본 좌표를 사용합니다. 공용 복도·엘리베이터 치수와 세대 간 위치는 검토용 가정이며, 실제 전체 층을 재현한 자료가 아닙니다.</span></div>
<main class="workspace"><aside>
<section class="panel"><p class="eyebrow">FLOOR REVIEW</p><h2>두 세대를 한눈에</h2><label class="field">평면 유형<select id="variant"><option value="basic">기본형 · 두 세대</option><option value="expanded">확장형 · 두 세대</option></select></label><div class="row"><button id="overview" aria-pressed="true">입체 전체</button><button id="top-view" aria-pressed="false">위에서 보기</button></div><div class="row" style="margin-top:7px"><button id="focus-common">복도 · 엘리베이터</button><button id="focus-211a">211A 가까이</button></div><p class="caption">드래그로 회전 · 휠로 확대<br>마우스 오른쪽 드래그로 화면 이동</p></section>
<section class="panel"><p class="eyebrow">WALK THROUGH</p><h2>걸어서 둘러보기</h2><div class="stack"><button class="primary" id="walk-hall">공용 홀에서 시작</button><div class="row"><button id="walk-211a">211A 실내</button><button id="walk-168c">168C 실내</button></div><button id="walk-elevator">엘리베이터 내부에서 시작</button></div><label class="field" style="margin-top:13px">방으로 시작 위치 옮기기<select id="room-place"><option value="">방 선택</option></select></label><button id="resume" hidden>마우스로 시선 조작 시작</button><p class="caption">WASD / 방향키로 이동 · 드래그로 시선<br>문을 바라보고 E 또는 클릭 · Esc로 마우스 해제<br>시작 위치 선택은 순간 이동입니다.</p></section>
<section class="panel"><p class="eyebrow">HUMAN SCALE</p><div class="metrics"><div><b>1.60m</b>눈높이</div><div><b>0.44m</b>몸통 폭</div></div><p class="caption">1m = 1 모델 단위 · 세대 크기 변경 없음<br>닫힌 문·벽·집기는 이동을 막습니다.</p><div class="door-state"><span>211A 현관</span><b id="entry-211a-state">닫힘</b></div><div class="door-state"><span>168C 현관</span><b id="entry-168c-state">닫힘</b></div><div class="door-state"><span>예시 엘리베이터</span><b id="elevator-state">닫힘</b></div></section>
<footer><div class="model-status">211A 기본형·확장형 구조 모델</div><div class="model-status">168C 기존 기본형·확장형 모델</div><p>문 개폐 방향·공용부 형상은 가정입니다. 엘리베이터는 이 층의 문 개폐와 내부 진입만 표현하며 층간 운행은 구현하지 않았습니다. 다른 라인·계단·피난 동선은 미구현입니다.</p></footer></aside>
<div class="viewport-wrap"><div id="viewport" aria-label="두 세대와 공용 복도 3D 공간"></div><div class="view-top"><div><strong id="view-title">공용층 전체 보기</strong><small id="view-subtitle">211A + 168C · 확장형</small></div><div class="scale-info">1m = 1 단위<small>공용부는 배치 가정</small></div></div><div id="crosshair"></div><button id="interaction" hidden></button><div id="mobile-controls" aria-label="이동 조작"><button class="turn" id="turn-left" aria-label="왼쪽 보기">↶</button><button data-move="1,0" aria-label="앞으로 이동">↑</button><button class="turn" id="turn-right" aria-label="오른쪽 보기">↷</button><button data-move="0,-1" aria-label="왼쪽 이동">←</button><button data-move="-1,0" aria-label="뒤로 이동">↓</button><button data-move="0,1" aria-label="오른쪽 이동">→</button></div><div class="view-bottom" role="status"><b id="status">두 세대 모델을 불러오는 중…</b><span id="help">공용 홀에서 시작해 현관문을 열고 두 세대를 오갈 수 있습니다.</span></div><svg id="minimap" aria-label="두 세대와 공용부 위치도"></svg><div id="loading" role="status">211A · 168C 모델을 불러오는 중…</div></div></main>`;
const $=id=>document.getElementById(id);
const ns='http://www.w3.org/2000/svg';
let active=null,fixture=null,view=null;
const cargoPanel=mountTransportPanel({aside:document.querySelector("aside"),viewport:document.querySelector(".viewport-wrap"),getView:()=>view,getActive:()=>active});
function svgElement(tag,attributes){const node=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);$('minimap').append(node);return node;}
function drawPlan(){
  const svg=$('minimap');svg.replaceChildren();if(!active)return;
  const points=[];
  for(const slab of floorSlabs(active.layout.commonArea)){
    const x=slab.center[0]-slab.size[0]/2,z=slab.center[1]-slab.size[1]/2;
    points.push([x,z],[x+slab.size[0],z+slab.size[1]]);
    svgElement('rect',{class:'hall',x,y:z,width:slab.size[0],height:slab.size[1]});
  }
  for(const unit of active.units){
    for(const room of unit.info.rooms){const polygon=room.polygon_m.map(point=>transformPoint(point,unit.placement));points.push(...polygon);svgElement('polygon',{class:'room',points:polygon.map(point=>point.join(',')).join(' ')});}
    const center=transformPoint(unit.info.spawn,unit.placement),label=svgElement('text',{x:center[0],y:center[1],'text-anchor':'middle'});label.textContent=unit.id.toUpperCase();
  }
  const minX=Math.min(...points.map(point=>point[0]))-1,minZ=Math.min(...points.map(point=>point[1]))-1,maxX=Math.max(...points.map(point=>point[0]))+1,maxZ=Math.max(...points.map(point=>point[1]))+1;
  svg.setAttribute('viewBox',`${minX} ${minZ} ${maxX-minX} ${maxZ-minZ}`);
  svgElement('circle',{id:'plan-person',class:'person',r:.38,cx:0,cy:0,visibility:'hidden'});
}
function sync(){
  if(!view)return;const state=view.inspect();
  for(const id of ['211a','168c']){
    const door=state.doors.find(door=>door.id.includes(`:${id}:`)&&door.id.endsWith(':door-00'));
    $(`entry-${id}-state`).textContent=door?door.progress>.98?'열림':door.progress<.02?'닫힘':'개폐 중':'미확인';
  }
  const elevator=state.doors.find(door=>door.id==='paired-floor:elevator');
  $('elevator-state').textContent=elevator?.progress>.98?'열림':elevator?.progress<.02?'닫힘':'개폐 중';
  $('resume').hidden=state.mode!=='walk'||state.locked;
  $('overview').setAttribute('aria-pressed',String(state.mode==='overview'));
  if(state.mode==='walk')$('top-view').setAttribute('aria-pressed','false');
}
function error(error){document.body.dataset.loadState='error';$('loading').hidden=false;$('loading').textContent=`공간을 불러오지 못했습니다. ${error.message}`;$('loading').classList.add('error');$('status').textContent='파일 또는 배치 정보를 확인해 주세요.';console.error(error);}
function start(destination,roomId){if(!view.goTo(destination,roomId)){$('status').textContent='선택한 시작 위치를 확보하지 못했습니다. 다른 위치를 선택해 주세요.';return;}$('status').textContent='WASD로 걷고 문 앞에서 E를 누르세요';$('help').textContent='화면을 드래그해 둘러보기 · 닫힌 문에는 부딪힙니다.';sync();}
async function boot(){try{
  view=createPairedScene($('viewport'),{
    onLoading(loading){if(loading)cargoPanel.loading();$('loading').hidden=!loading;$('variant').disabled=loading;document.body.dataset.loadState=loading?'loading':'ready';},
    onMode(mode){if(mode==='walk')cargoPanel.hide();document.body.dataset.view=mode;$('view-title').textContent=mode==='overview'?'공용층 전체 보기':'눈높이로 걷기';if(mode==='overview'){$('status').textContent='211A와 168C 사이에 공용 홀을 배치했습니다';$('help').textContent='현관과 공용부 연결은 시범 배치이며 실제 층 배치와 다를 수 있습니다.';}},
    onReady(next){active=next;cargoPanel.ready();drawPlan();$('room-place').replaceChildren(new Option('방 선택',''));for(const unit of active.units){const group=document.createElement('optgroup');group.label=unit.id.toUpperCase();for(const room of unit.info.rooms)group.append(new Option(room.name_ko,`${unit.id}:${room.id}`));$('room-place').append(group);}$('view-subtitle').textContent=`211A + 168C · ${variant==='basic'?'기본형':'확장형'}`;sync();},
    onChange:sync,onError:error,onDoorBlocked(){ $('status').textContent='문이 몸에 닿아 멈췄습니다. 한 걸음 물러난 뒤 다시 여세요.'; },
    onFrame({position,door,mode}){const person=$('plan-person');if(person){person.setAttribute('cx',position[0]);person.setAttribute('cy',position[2]);person.setAttribute('visibility',mode==='walk'?'visible':'hidden');}$('interaction').hidden=!door;$('interaction').textContent=door?`E · ${door.name} ${door.target>.5?'닫기':'열기'}`:'';sync();},
  });
  const response=await fetch(new URL('./layout.json',import.meta.url));if(!response.ok)throw Error('공용층 배치 파일이 없습니다.');fixture=await response.json();
  if(fixture.note)$('layout-note').textContent=fixture.note;
  $('variant').value=variant;
  await view.load(variant,fixture);
}catch(cause){error(cause);}}
boot();
async function changeVariant(next){variant=next;const url=new URL(location.href);url.searchParams.set('variant',variant);history.replaceState(null,'',url);try{await view.load(variant,fixture);}catch{}}
$('variant').addEventListener('change',event=>changeVariant(event.target.value));
$('focus-common').addEventListener('click',()=>view.focusArea('common'));
$('focus-211a').addEventListener('click',()=>view.focusArea('211a'));
$('overview').addEventListener('click',()=>{view.frameAll();$('top-view').setAttribute('aria-pressed','false');});
$('top-view').addEventListener('click',()=>{view.frameAll(true);$('top-view').setAttribute('aria-pressed','true');$('overview').setAttribute('aria-pressed','false');});
for(const destination of ['hall','211a','168c','elevator'])$(`walk-${destination}`).addEventListener('click',()=>start(destination));
$('room-place').addEventListener('change',event=>{if(!event.target.value)return;const [unit,room]=event.target.value.split(':');start(unit,room);});
$('resume').addEventListener('click',()=>view.startPointer());
$('interaction').addEventListener('click',()=>view.interact());
$('turn-left').addEventListener('click',()=>view.turn(Math.PI/8));$('turn-right').addEventListener('click',()=>view.turn(-Math.PI/8));
for(const button of document.querySelectorAll('[data-move]')){button.addEventListener('pointerdown',event=>{event.preventDefault();button.setPointerCapture(event.pointerId);view.setTouchMovement(...button.dataset.move.split(',').map(Number));});for(const eventName of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(eventName,()=>view.setTouchMovement(0,0));}
window.__pairedFloor={inspect:()=>view.inspect(),transport:()=>cargoPanel.inspect(),transportGeometry:()=>view.transportGeometry(),focus:area=>view.focusArea(area),move:(x,z)=>view.move(x,z),place:(x,z,tx,tz)=>view.place([x,z],tx===undefined?null:[tx,tz]),look:(yaw,pitch)=>view.look(yaw,pitch),goTo:(unit,room)=>view.goTo(unit,room),door:(id,open)=>view.setDoor(id,open),pickDoor:()=>view.pickDoor(),interact:()=>view.interact(),setMode:mode=>view.setMode(mode)};
window.addEventListener('pagehide',()=>view?.dispose(),{once:true});
