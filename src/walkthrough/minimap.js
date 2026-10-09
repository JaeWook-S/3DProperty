import {Box3} from 'three';
import {corners} from './layout.js';
import {headingDegrees, hingedSegment, navigationRooms, planBounds, roomAt, viewSector} from './minimap-geometry.js';
import './minimap.css';

const NS = 'http://www.w3.org/2000/svg';
function svg(tag, attributes = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [key,value] of Object.entries(attributes)) node.setAttribute(key,value);
  if (text !== undefined) node.textContent = text;
  return node;
}

// DOM overlay only: reads the active model and never moves/rescales it.
export function createMinimap() {
  const host = document.createElement('aside');
  host.id = 'walk-minimap'; host.hidden = true; host.setAttribute('aria-label','둘러보기 미니맵');
  host.innerHTML = `<header><span id="minimap-variant"></span><button id="minimap-toggle" type="button" aria-controls="minimap-content" aria-expanded="true">미니맵 접기 <kbd>M</kbd></button></header><div id="minimap-content"><svg id="minimap-plan" role="img" aria-label="도면 위 현재 위치와 시선 방향"></svg><footer><strong id="minimap-room" aria-live="polite"></strong><span>도면 상단 고정</span></footer></div>`;
  document.body.append(host);
  const button = host.querySelector('button'), content = host.querySelector('#minimap-content');
  const plan = host.querySelector('svg'), label = host.querySelector('#minimap-room');
  let collapsed = matchMedia('(max-height:520px)').matches;
  let activeKey = null, roomNodes = new Map(), rooms = [], currentRoomId = null;
  let furnitureKey = '', doorKey = '', poseKey = '', furnitureLayer, doorLayer, marker, sector;
  let furnitureNodes = new Map();
  const setCollapsed = value => {
    collapsed = value; content.hidden = value; host.classList.toggle('is-collapsed',value);
    button.setAttribute('aria-expanded',String(!value));
    button.innerHTML = `${value ? '미니맵 펼치기' : '미니맵 접기'} <kbd>M</kbd>`;
  };
  button.addEventListener('click', () => setCollapsed(!collapsed));
  document.addEventListener('keydown', event => {
    if (host.hidden || event.code !== 'KeyM' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest?.('input,select,textarea,[contenteditable="true"]')) return;
    event.preventDefault(); setCollapsed(!collapsed);
  });
  setCollapsed(collapsed);

  function rebuild(active) {
    activeKey = active.key; host.dataset.variant = active.key;
    host.querySelector('#minimap-variant').textContent = `112A · ${active.definition.label}`;
    rooms = navigationRooms(active.definition.info);
    plan.setAttribute('viewBox',planBounds(rooms).join(' ')); plan.replaceChildren(); roomNodes = new Map();
    for (const room of rooms) {
      const [x,z,x2,z2] = room.bounds_m;
      const group = svg('g',{'data-room':room.id,class:room.kind === 'balcony' ? 'minimap-zone balcony' : 'minimap-zone'});
      group.append(svg('rect',{x,y:z,width:x2-x,height:z2-z,rx:.025}));
      plan.append(group); roomNodes.set(room.id,group);
    }
    // Slice the actual architectural bounds at waist height; omit lintels/low trim.
    const walls = svg('g',{class:'minimap-walls'});
    active.model.updateWorldMatrix(true,true);
    active.model.traverse(object => {
      if (!object.isMesh || active.definition.info.objects[object.userData.object_id]?.category !== 'Structure') return;
      const b = new Box3().setFromObject(object);
      if (b.min.y > 1 || b.max.y < 1) return;
      walls.append(svg('rect',{x:b.min.x,y:b.min.z,width:b.max.x-b.min.x,height:b.max.z-b.min.z}));
    });
    plan.append(walls);
    furnitureLayer = svg('g',{class:'minimap-furniture'}); doorLayer = svg('g',{class:'minimap-doors'});
    plan.append(furnitureLayer,doorLayer); furnitureNodes = new Map();
    for (const room of rooms.filter(r => r.kind !== 'balcony')) {
      const [x,z,x2,z2] = room.bounds_m;
      plan.append(svg('text',{x:(x+x2)/2,y:(z+z2)/2,'text-anchor':'middle',class:'minimap-zone-label'},room.name_ko));
    }
    marker = svg('g',{id:'minimap-position'});
    sector = svg('path',{class:'minimap-sector'});
    marker.append(sector,svg('path',{class:'minimap-heading',d:'M 0 -.43 L -.16 -.13 L .16 -.13 Z'}),svg('circle',{r:.12,class:'minimap-person'}));
    plan.append(marker);
    const scaleX = .1, scaleZ = planBounds(rooms)[1]+planBounds(rooms)[3]-.12;
    plan.append(svg('path',{class:'minimap-scale',d:`M ${scaleX} ${scaleZ-.12} V ${scaleZ} H ${scaleX+1} V ${scaleZ-.12}`}),svg('text',{class:'minimap-scale-label',x:scaleX+1.2,y:scaleZ},'1m'));
    furnitureKey = doorKey = poseKey = ''; currentRoomId = null;
  }

  function update({active,position,yaw,horizontalFov,visible}) {
    const hidden = !visible || !active;
    if (host.hidden !== hidden) host.hidden = hidden;
    if (host.hidden) return;
    if (active.key !== activeKey) rebuild(active);
    const room = roomAt(rooms,position.x,position.z) || roomAt(active.definition.info.rooms,position.x,position.z);
    const id = room?.id || '';
    if (currentRoomId !== id) {
      roomNodes.get(currentRoomId)?.classList.remove('current'); roomNodes.get(id)?.classList.add('current');
      currentRoomId = id; host.dataset.room = id; label.textContent = room?.name_ko || '복도 · 연결 공간';
    }
    if (collapsed) return;
    const pose = [position.x,position.z,yaw,horizontalFov].join(':');
    if (pose !== poseKey) {
      marker.setAttribute('transform',`translate(${position.x} ${position.z}) rotate(${headingDegrees(yaw)})`);
      marker.dataset.x = position.x; marker.dataset.z = position.z; marker.dataset.heading = headingDegrees(yaw);
      sector.setAttribute('d',viewSector(horizontalFov)); poseKey = pose;
    }
    const items = active.staging.items.filter(item => !item.deleted);
    const signature = items.map(i => [i.id,i.x,i.z,i.angle,i.width,i.depth].join(':')).join('|');
    if (signature !== furnitureKey) {
      const ids = new Set(items.map(i => i.id));
      for (const [id,node] of furnitureNodes) if (!ids.has(id)) {node.remove(); furnitureNodes.delete(id);}
      for (const item of items) {
        let node = furnitureNodes.get(item.id);
        if (!node) {node=svg('polygon',{'data-item':item.id}); furnitureLayer.append(node); furnitureNodes.set(item.id,node);}
        node.setAttribute('points',corners(item).map(p => p.join(',')).join(' '));
      }
      furnitureKey = signature;
    }
    const doors = active.doors.filter(d => d.definition.type === 'hinged');
    const doorSignature = doors.map(d => d.progress).join(':');
    if (doorSignature !== doorKey) {
      doorLayer.replaceChildren(...doors.map(d => {
        const [x1,y1,x2,y2] = hingedSegment(d.definition,d.progress);
        return svg('line',{x1,y1,x2,y2,'data-door':d.definition.id});
      })); doorKey = doorSignature;
    }
  }
  return {update};
}
