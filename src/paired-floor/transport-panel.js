import { reviewPairedFloorTransport, inspectOpening } from './transport-review.js';

const STATUS={clear:'통과',blocked:'간섭',unresolved:'추가 검토'};
const cm=value=>(value*100).toFixed(1).replace(/\.0$/,'');
export function mountTransportPanel({aside,viewport,getView,getActive}) {
  const section=document.createElement('section');section.className='panel transport-panel';
  section.innerHTML=`<p class="eyebrow">FURNITURE ACCESS</p><h2>가구가 들어갈까요?</h2><p class="caption">포장·돌출부를 포함한 운반 치수를 입력하세요.</p>
    <form id="transport-form"><div class="cargo-dimensions"><label>가로 (cm)<input id="cargo-width" type="number" min="1" max="2000" step="0.1" value="50" required></label><label>깊이 (cm)<input id="cargo-depth" type="number" min="1" max="2000" step="0.1" value="50" required></label><label>높이 (cm)<input id="cargo-height" type="number" min="1" max="1000" step="0.1" value="90" required></label></div>
    <div class="row"><label class="field">목적지<select id="cargo-destination"><option value="211a">211A 현관 앞</option><option value="168c">168C 현관 앞</option></select></label><label class="field">면별 여유 (cm)<input id="cargo-clearance" type="number" min="0" max="30" step="0.1" value="2" required></label></div>
    <label class="field">예시 치수<select id="cargo-preset"><option value="small">작은 가구 · 50 × 50 × 90</option><option value="turn">회전 여유 확인 · 80 × 80 × 90</option><option value="large">큰 수납장 · 110 × 100 × 180</option><option value="tall">높은 수납장 · 50 × 50 × 212</option><option value="chair">CC0 라운지 체어 · 82 × 98.7 × 102.3</option><option value="custom">직접 입력</option></select></label>
    <button id="review-cargo" class="primary" type="submit" disabled>치수로 확인하기</button></form>
    <div id="transport-results" aria-live="polite"><p class="caption">모델을 불러온 뒤 검토할 수 있습니다.</p></div>
    <details class="cargo-basis"><summary>검토 기준 · 현재 공간 치수</summary><div id="cargo-space-size"></div><p>공용부는 가정 치수이며 현관 폭은 모델 문틀 사이 간격입니다. 열린 문짝·문틀의 보수적인 외곽 상자를 경로에 포함합니다. 세운 상태의 외곽 상자와 0°·90° 자세를 검사합니다. 기울이기·분해·사람·운반장비·중량은 제외합니다. 현관 개구부와 현관 앞까지의 동선을 나누어 검사하며 세대 안 진입은 아직 판정하지 않습니다.</p><p>예시 가구는 제품 실측값이 아닙니다. 정확한 반입 검토에는 포장 치수와 현장의 문·복도·승강기 유효 치수가 필요합니다.</p></details>`;
  aside.insertBefore(section,aside.querySelectorAll('section')[1]);
  const overlay=document.createElement('div');overlay.id='transport-scrubber';overlay.hidden=true;
  overlay.innerHTML=`<div><strong>가구 운반 경로</strong><button id="hide-cargo" aria-label="가구 경로 표시 닫기">닫기</button></div><p>열린 문짝·문틀 포함 · 엘리베이터 → 현관 앞</p><label for="cargo-progress">경로 위치 <output id="cargo-percent">0%</output></label><input id="cargo-progress" type="range" min="0" max="100" value="0" step="1"><p id="cargo-pose-state"></p>`;
  viewport.append(overlay);
  const $=id=>document.getElementById(id);let report=null,showing=false;
  const numeric=id=>Number($(id).value)/100;
  function input(){return {width:numeric('cargo-width'),depth:numeric('cargo-depth'),height:numeric('cargo-height'),clearance:numeric('cargo-clearance'),targetUnitId:$('cargo-destination').value,doorMode:'supplied',doorObstacles:getView().transportGeometry().doorObstacles};}
  function poseStatus(){const check=getView()?.inspect().transport?.poseCheck;$('cargo-pose-state').textContent=check?.clear?'현재 자세: 모델 경계와 여유 확보':'현재 자세: 경계 간섭 또는 검사 범위 밖';}
  function hide(){showing=false;overlay.hidden=true;getView()?.showTransport(null);}
  function invalidate(){report=null;hide();$('transport-results').innerHTML='<p class="caption">변경한 치수로 다시 확인해 주세요.</p>';}
  function show(){if(!report?.valid)return;showing=true;overlay.hidden=false;$('cargo-progress').value='0';$('cargo-percent').textContent='0%';getView().showTransport(report,0);getView().focusArea('common');poseStatus();}
  function render(){
    if(!report?.valid){$('transport-results').innerHTML='<p class="cargo-invalid">입력값 또는 공간 치수를 확인해 주세요.</p>';return;}
    const target=report.openings.find(o=>o.id===report.targetUnitId),lift=report.openings.find(o=>o.id==='elevator');
    const openingCard=o=>{const best=o.orientations.find(p=>p.fits)??[...o.orientations].sort((a,b)=>b.widthMargin_m-a.widthMargin_m)[0];return `<div class="cargo-result" data-status="${o.status}"><div><b>${o.label}</b><em>${STATUS[o.status]}</em></div><p>폭 ${cm(o.width)} · 높이 ${cm(o.height)} cm</p><small>여유 적용 후 폭 ${cm(best.widthMargin_m)} / 높이 ${cm(best.heightMargin_m)} cm<br>모델 개구부 검사 · 이동 경로는 별도</small></div>`;};
    $('transport-results').innerHTML=`<p class="cargo-scope">공용부 가정 치수 기준 · 세운 상태</p>${openingCard(lift)}<div class="cargo-result" data-status="${report.elevator.status}"><div><b>엘리베이터 내부 수용</b><em>${STATUS[report.elevator.status]}</em></div><p>${cm(report.environment.car.width)} × ${cm(report.environment.car.depth)} × ${cm(report.environment.car.height)} cm</p><small>0°·90° 중심 배치 검사 · 출입 가능과 별개</small></div>${openingCard(target)}<div class="cargo-result" data-status="${report.route.status}"><div><b>현관 앞까지 이동</b><em>${STATUS[report.route.status]}</em></div><p>${report.route.status==='clear'?'검토한 연속 경로에서 간섭 없음':report.route.status==='blocked'?'시험 경로에서 벽·문틀 간섭':'이 조건에서 통과 경로를 확인하지 못함'}</p><small>문 완전 개방 상태의 문짝·문틀 포함<br>복도 회전 포함<br>현관 안 진입·모든 가능한 경로는 미검사</small></div><button type="button" id="show-cargo">문 열고 3D 경로 보기</button>`;
    $('show-cargo').addEventListener('click',show);
  }
  $('transport-form').addEventListener('submit',event=>{event.preventDefault();hide();if(!getActive())return;report=reviewPairedFloorTransport(getActive().layout,input());if(report.valid){const geometry=getView().transportGeometry();for(const source of geometry.openings){const index=report.openings.findIndex(o=>o.id===source.id);if(index>=0)report.openings[index]=inspectOpening(report.cargo,{...report.openings[index],...source},{clearance:report.clearance});}report.geometryBasis=geometry.basis;}render();});
  for(const id of ['cargo-width','cargo-depth','cargo-height','cargo-clearance'])$(id).addEventListener('input',()=>{$('cargo-preset').value='custom';invalidate();});
  $('cargo-destination').addEventListener('change',invalidate);
  $('cargo-preset').addEventListener('change',()=>{const values={small:[50,50,90],turn:[80,80,90],large:[110,100,180],tall:[50,50,212],chair:[82.0344,98.6562,102.2852]}[$('cargo-preset').value];if(values){['cargo-width','cargo-depth','cargo-height'].forEach((id,i)=>$(id).value=values[i].toFixed(1));invalidate();}});
  $('cargo-progress').addEventListener('input',()=>{getView()?.transportProgress(Number($('cargo-progress').value)/100);$('cargo-percent').textContent=`${$('cargo-progress').value}%`;poseStatus();});
  $('hide-cargo').addEventListener('click',hide);
  return {
    hide,
    ready(){invalidate();$('review-cargo').disabled=false;const common=getActive().layout.commonArea,lift=common.elevator;$('cargo-space-size').textContent=`복도 폭 ${cm(common.hallClearWidth_m)}cm · 연결 통로 ${cm(common.connectorClearWidth_m)}cm · 엘리베이터 ${lift.size.map(cm).join(' × ')} × ${cm(lift.height)}cm · 문 ${cm(lift.doorWidth)} × ${cm(lift.doorHeight)}cm`;},
    loading(){invalidate();$('review-cargo').disabled=true;},
    inspect(){return {report,showing};},
  };
}
