import {measureRoomBounds, measureRoomAxes, measureRoomSegment} from '../../../src/walkthrough/space-measurements.js';

const NS = 'http://www.w3.org/2000/svg';
const meters = value => `${value.toFixed(3)} m`;
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const shape = (tag, attributes) => {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
};

// UI-only state. Coordinates stay in the source polygon's X/Z meters.
// Never modifies a polygon, GLB, room size, furniture, or unit mapping.
export function createPlanMeasurements({svg, toolbar, output, onSelectRoom}) {
  let data = null, room = null, bounds = null, mode = 'select';
  let cursor = null, start = null, result = null, message = '';
  toolbar.innerHTML = `<div class="measurement-modes" role="group" aria-label="평면 측정 도구"><button type="button" data-measure-mode="select" aria-pressed="true">방 선택</button><button type="button" data-measure-mode="axes" aria-pressed="false">가로·세로 폭</button><button type="button" data-measure-mode="segment" aria-pressed="false">두 점 거리</button></div><button type="button" id="clear-plan-measurement">측정 지우기</button>`;
  output.setAttribute('role', 'status');
  output.setAttribute('aria-live', 'polite');
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-describedby', 'measurement-instruction measurement-basis');

  function clear() { cursor = null; start = null; result = null; message = ''; }
  function initialPoint() {
    if (!room || !bounds?.valid) return null;
    const [a,b,c,d] = bounds.bounds_m, center = [(a+c)/2, (b+d)/2];
    return measureRoomAxes(room, center).inside ? center : [...room.polygon_m[0]];
  }
  function setMode(next) {
    mode = next; clear();
    if (mode !== 'select') cursor = initialPoint();
    render();
    if (mode !== 'select') svg.focus({preventScroll:true});
  }
  for (const button of toolbar.querySelectorAll('[data-measure-mode]')) {
    button.onclick = () => setMode(button.dataset.measureMode);
  }
  toolbar.querySelector('#clear-plan-measurement').onclick = () => { clear(); render(); };

  function choose(next) {
    if (next && next !== room) onSelectRoom(next);
  }
  function measure(point, clickedRoom) {
    // The second point belongs to the first point's room even when another room is clicked.
    if (mode === 'axes' || !start || result) choose(clickedRoom);
    if (!room || !bounds?.valid) {
      message = room ? '이 방의 경계로 치수를 계산할 수 없습니다.' : '먼저 측정할 방 안의 지점을 선택하세요.';
      render(); return;
    }
    cursor = [...point]; message = '';
    if (mode === 'axes') {
      result = measureRoomAxes(room, point);
      if (!result.valid || !result.inside || !result.x || !result.z) message = '선택한 지점이 방 밖입니다. 방 안의 지점을 선택하세요.';
    } else {
      if (!start || result) { start = [...point]; result = null; }
      else result = measureRoomSegment(room, start, point);
      if (result && !result.valid) message = '이 두 점의 거리를 계산할 수 없습니다.';
    }
    render();
  }
  svg.addEventListener('click', event => {
    if (mode === 'select' || !data) return;
    event.preventDefault(); event.stopPropagation();
    const matrix = svg.getScreenCTM(); if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const roomId = event.target.closest('[data-room]')?.dataset.room;
    measure([point.x, point.y], data.rooms.find(r => r.id === roomId));
    svg.focus({preventScroll:true});
  }, true);
  svg.addEventListener('keydown', event => {
    if (mode === 'select' || !data) return;
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' ','Escape'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') { clear(); render(); return; }
    if (!room) { message = '방 선택 도구에서 방을 고른 뒤 측정하세요.'; render(); return; }
    if (!cursor) cursor = initialPoint();
    if (!cursor) return;
    if (event.key === 'Enter' || event.key === ' ') { measure(cursor); return; }
    const step = event.shiftKey ? .01 : .05;
    cursor = [cursor[0] + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
      cursor[1] + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0)];
    if (mode === 'axes') measure(cursor); else render();
  }, true);

  function drawOverlay() {
    svg.querySelector('#plan-measure-overlay')?.remove();
    const overlay = shape('g', {id:'plan-measure-overlay', 'aria-hidden':'true'});
    const line = (a,b,cls) => overlay.append(shape('line', {x1:a[0],y1:a[1],x2:b[0],y2:b[1],class:cls,'vector-effect':'non-scaling-stroke'}));
    const dot = (point,cls) => overlay.append(shape('circle',{cx:point[0],cy:point[1],r:.055,class:cls}));
    if (mode === 'axes' && result?.valid && result.inside) {
      if (result.x) line(result.x.start_m,result.x.end_m,'measurement-x');
      if (result.z) line(result.z.start_m,result.z.end_m,'measurement-z');
    }
    if (mode === 'segment' && start) {
      dot(start,'measurement-point');
      if (result?.valid) {
        line(result.start_m,result.end_m,'measurement-segment');
        for (const outside of result.outside_intervals) line(outside.start_m,outside.end_m,'measurement-outside');
        dot(result.end_m,'measurement-point');
      }
    }
    if (mode !== 'select' && cursor) dot(cursor,'measurement-cursor');
    svg.append(overlay);
  }
  function render() {
    svg.dataset.measureMode = mode;
    for (const button of toolbar.querySelectorAll('[data-measure-mode]')) {
      button.setAttribute('aria-pressed', String(button.dataset.measureMode === mode));
      button.disabled = !data;
    }
    toolbar.querySelector('#clear-plan-measurement').disabled = !cursor && !start && !result;
    output.replaceChildren();
    if (room && bounds?.valid) output.append(node('p', `${room.name} · 최대 외곽 범위 ${meters(bounds.width_m)} × ${meters(bounds.depth_m)}`, 'measurement-bounds'));
    let instruction = '방을 선택하면 최대 외곽 범위를 확인할 수 있어요.';
    if (mode === 'axes') instruction = '방 안을 클릭하거나 탭해 그 지점의 가로·세로 폭을 확인하세요.';
    if (mode === 'segment') instruction = start && !result ? `${room.name} 기준 · 끝점을 선택하세요. 다른 방을 누르면 방 밖 구간으로 표시합니다.` : '시작점과 끝점을 차례로 클릭하거나 탭하세요. 완료 후 다시 누르면 새 측정입니다.';
    const hint = node('p', message || instruction, 'measurement-instruction'); hint.id = 'measurement-instruction'; output.append(hint);
    if (result?.valid && mode === 'axes' && result.inside && result.x && result.z) {
      const values = node('p', `선택 위치의 모델 방 경계 간 거리 · 가로 ${meters(result.x.length_m)} · 세로 ${meters(result.z.length_m)}`, 'measurement-values');
      values.dataset.x = result.x.length_m; values.dataset.z = result.z.length_m; output.append(values);
      output.append(node('p', `선택점에서 왼쪽 ${meters(result.x.negative_m)} / 오른쪽 ${meters(result.x.positive_m)} · 위 ${meters(result.z.negative_m)} / 아래 ${meters(result.z.positive_m)}`, 'measurement-detail'));
    }
    if (result?.valid && mode === 'segment') {
      const values = node('p', `두 점 거리 ${meters(result.length_m)} · ${result.inside ? '측정선 전체가 선택한 방 안에 있습니다.' : '방 밖 구간 포함'}`, 'measurement-values');
      values.dataset.length = result.length_m; values.dataset.outside = result.outside; output.append(values);
      if (result.outside) output.append(node('p', '주황 점선은 선택한 방 밖을 지나는 부분입니다. 이 거리를 방의 폭으로 사용할 수 없습니다.', 'measurement-warning'));
    }
    if (mode !== 'select') output.append(node('p', '키보드: 방향키 5cm · Shift+방향키 1cm · Enter 점 지정 · Esc 지우기', 'measurement-detail'));
    const basis = node('p', '아키스케치 좌표를 방 안쪽으로 해석한 모델 경계 기준입니다. 가구·문짝·마감 두께와 통행 여유를 반영한 값이나 현장 실측값은 아닙니다.', 'measurement-basis'); basis.id = 'measurement-basis'; output.append(basis);
    drawOverlay();
  }
  render();
  return {
    setPlan(next) { data = next; room = null; bounds = null; mode = 'select'; clear(); render(); },
    setRoom(next) {
      if (next !== room) { room = next || null; bounds = room ? measureRoomBounds(room) : null; clear(); }
      render();
    },
  };
}
