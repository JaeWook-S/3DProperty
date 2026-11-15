import * as THREE from 'three';
import { wallSectionPath } from '../walkthrough/wall-slice.js';
import { hingedSegment } from '../walkthrough/minimap-geometry.js';
import priceDB from './data/price-db.json';
import { FINISH_CATEGORIES, FINISHES, finishById, finishPriceCode, finishesFor } from './finish-catalog.js';
import { createFinishLibrary } from './finish-materials.js';
import { createFinishEditor } from './finish-editor.js';
import { createStructureEditor } from './structure-editor.js';
import { PARTITION_TYPES, DOOR_OPENING, movedOffset, movedWall, partitionFrame, partitionPolygon, removalBox, roomContains, segmentPolygon, snapPoint, validatePartition } from './wall-plan.js';
import { buildEstimate, finishUnitPrice, won } from './estimate.js';
import { EXAMPLE_PRODUCTS, parseFurnitureProducts, resolveFurnitureProduct } from '../walkthrough/furniture-products.js';
import { createFurnitureThumbnail } from '../walkthrough/furniture-thumbnail.js';
import { corners } from '../walkthrough/layout.js';
import { createQuoteStore, quoteNumber } from './quote-store.js';
import { quoteCSV, quoteHTML } from './quote-document.js';
import { facePlanSegment } from './surface-faces.js';
import './interior.css';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, text) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text != null) n.textContent = text; return n; };
const el = (tag, attrs = {}, ...children) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v); } n.append(...children.filter(c => c != null)); return n; };
const area = polygon => Math.abs(polygon.reduce((s, [x, z], i) => { const [x2, z2] = polygon[(i + 1) % polygon.length]; return s + x * z2 - x2 * z; }, 0)) / 2;
const m2 = n => `${n.toFixed(1)}m²`;
const TOOL_TITLES = { select: '선택 (V)', demolish: '벽 허물기 (D)', build: '평면에서 끌어 가벽 세우기 (W)', move: '평면에서 벽을 잡고 끌어 옮기기 (M)' };
const TAB_TITLES = { structure: '벽을 허물고, 세우고, 옮겨 보세요.', finish: '벽지·타일·바닥을 대보세요.', furniture: '가구를 놓고 끌어서 옮겨 보세요.', estimate: '바꾼 만큼 바로 견적이 나와요.' };
// Korean object particle: 을 after a final consonant, 를 otherwise.
const eul = word => { const c = String(word).trim().slice(-1).charCodeAt(0) - 0xac00; return `${word}${c >= 0 && c <= 11171 && c % 28 ? '을' : '를'}`; };
const productName = (product, fallback) => String(product?.name || fallback || '가구').replace(/^임시\s*상품\s*·\s*/, '');
const ICONS = {
  select: '<path d="M5 3l12 7-5 1.6L9.6 17z"/>',
  demolish: '<path d="M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14"/><path d="M10 10l4 6M14 10l-4 6"/>',
  build: '<rect x="3" y="9" width="18" height="6" rx="1"/><path d="M8 9v6M13 9v6M18 9v6"/>',
  move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
};
const icon = d => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const unitPrice = item => item.material + item.labor + item.expense;

export function createInteriorStudio(hooks) {
  const { camera, renderer, orbit } = hooks;
  const library = createFinishLibrary({ anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()) });
  const finishes = createFinishEditor({ library, invalidate: () => hooks.invalidate(false), onChange: () => { scheduleEstimate(); renderFinishPanel(); } });
  const structures = createStructureEditor();
  const store = createQuoteStore();
  let overrides = new Map(); store.priceOverrides().then(map => { overrides = map; scheduleEstimate(); }).catch(() => {});
  let tab = 'structure', tool = 'select', partitionType = 'drywall', partitionDoor = false, selected = null, hover = null, draft = null;
  let view = 'dollhouse', lowWalls = false, finishScope = 'walls', finishRoom = null, selectedFace = null, category = 'wallpaper', query = '', armed = null, tileMethod = 'overlay';
  let lastApply = null, estimate = null, estimateTimer = 0, bound = null, boundScope = null, active = false, statusTimer = 0, lastQuote = null;
  let fnSelected = null, fnHover = null, fnDrag = null, productConfig = EXAMPLE_PRODUCTS;
  fetch(`${import.meta.env?.BASE_URL ?? '/'}furniture-products.yaml`, { cache: 'no-store' }).then(r => r.ok ? r.text() : Promise.reject(Error(String(r.status))))
    .then(text => { productConfig = parseFurnitureProducts(text); scheduleEstimate(); if (tab === 'furniture') renderFurniturePanel(); }).catch(() => {});
  const history = { past: [], future: [] }, scopes = new Map(), wallPaths = new WeakMap();
  const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 2.55);
  const current = () => hooks.current();
  const info = () => current().definition.info;
  const ceiling = () => info().ceilingHeight_m ?? info().ceiling_m ?? 2.6;
  const segments = () => structures.segments(current());
  const structure = () => structures.structure(current());
  const rooms = () => info().rooms;

  // ---------------------------------------------------------------- markup
  const panel = el('section', { id: 'interior-panel', hidden: true, 'aria-label': '인테리어 편집' });
  panel.innerHTML = `
    <div class="ix-tabs" role="tablist" aria-label="인테리어 단계">
      <button role="tab" data-tab="structure" aria-selected="true">구조</button>
      <button role="tab" data-tab="finish" aria-selected="false">마감</button>
      <button role="tab" data-tab="furniture" aria-selected="false">가구</button>
      <button role="tab" data-tab="estimate" aria-selected="false">견적 <span id="ix-total-chip"></span></button>
    </div>
    <div class="ix-history" aria-label="편집 기록">
      <button id="ix-undo" type="button" title="되돌리기 (⌘/Ctrl+Z)" aria-label="되돌리기">↶</button><button id="ix-redo" type="button" title="다시 하기 (⌘/Ctrl+Shift+Z)" aria-label="다시 하기">↷</button>
      <span id="ix-change-count">변경 없음</span><button id="ix-save" type="button">저장</button>
    </div>
    <section class="ix-pane" data-pane="structure">
      <div class="ix-tools" role="radiogroup" aria-label="구조 도구">
        ${Object.entries({ select: '선택', demolish: '허물기', build: '가벽 세우기', move: '옮기기' }).map(([id, label]) => `<button type="button" role="radio" data-tool="${id}" aria-checked="${id === 'select'}" title="${TOOL_TITLES[id]}">${icon(ICONS[id])}<span>${label}</span></button>`).join('')}
      </div>
      <div id="ix-partition-options" hidden>
        <div class="ix-type-grid" role="radiogroup" aria-label="가벽 종류">
          ${Object.entries(PARTITION_TYPES).map(([id, t]) => `<button type="button" role="radio" data-type="${id}" aria-checked="${id === 'drywall'}"><span class="ix-type-swatch ix-type-${id}"></span><strong>${t.label}</strong><em data-price="${t.priceCode}"></em></button>`).join('')}
        </div>
        <label class="ix-check"><input type="checkbox" id="ix-door"> 문 개구부 포함</label>
      </div>
      <div id="ix-selection" class="ix-card" hidden></div>
      <h3 class="ix-subhead">변경 내역 <span id="ix-structure-count"></span></h3>
      <ul id="ix-structure-list" class="ix-list"></ul>
    </section>
    <section class="ix-pane" data-pane="finish" hidden>
      <div class="ix-target">
        <label class="ix-field">공간<select id="ix-room"></select></label>
        <div class="ix-segmented" role="radiogroup" aria-label="적용 범위">
          <button type="button" role="radio" data-scope="walls" aria-checked="true">방 전체 벽</button><button type="button" role="radio" data-scope="face" aria-checked="false">선택한 벽</button><button type="button" role="radio" data-scope="floor" aria-checked="false">바닥</button>
        </div>
        <div id="ix-faces" class="ix-chips" aria-label="벽면 선택"></div>
        <p id="ix-target-label" class="ix-target-label"></p>
      </div>
      <div class="ix-cats" role="tablist" aria-label="재질 분류"></div>
      <input id="ix-search" type="search" placeholder="검색" aria-label="재질 검색">
      <div id="ix-grid" class="ix-grid" role="listbox" aria-label="재질 목록"></div>
      <div class="ix-row"><button id="ix-rotate" type="button">↻ 결 방향</button><button id="ix-reset-finish" type="button">원래대로</button><button id="ix-look" type="button">이 면 보기</button></div>
      <h3 class="ix-subhead" id="ix-finish-head">적용한 마감 <span id="ix-finish-count"></span></h3>
      <ul id="ix-finish-list" class="ix-list"></ul>
    </section>
    <section class="ix-pane" data-pane="furniture" hidden>
      <div class="ix-target"><label class="ix-field">공간<select id="ix-fn-room"></select></label></div>
      <div id="ix-fn-cats" class="ix-cats" role="tablist" aria-label="가구 분류"></div>
      <div id="ix-fn-grid" class="ix-grid ix-fn-grid" aria-label="가구 목록"></div>
      <div id="ix-fn-selection" class="ix-card" hidden></div>
      <h3 class="ix-subhead" id="ix-fn-head">배치한 가구 <span id="ix-fn-count"></span></h3>
      <ul id="ix-fn-list" class="ix-list"></ul>
    </section>
    <section class="ix-pane" data-pane="estimate" hidden>
      <div class="ix-total-card"><span>예상 비용 · 부가세 포함</span><strong id="ix-total">0원</strong><small id="ix-split"></small>
        <div id="ix-trade-bar" class="ix-trade-bar" aria-hidden="true"></div><ul id="ix-trade-legend" class="ix-legend"></ul><p id="ix-days"></p></div>
      <div class="ix-estimate-actions"><button id="ix-quote-open" type="button" class="studio-primary">견적서 보기 · 인쇄</button>
        <div class="ix-row"><button id="ix-quote-save" type="button">견적 저장</button><button id="ix-quote-csv" type="button">CSV 내려받기</button><button id="ix-prices" type="button">단가표</button></div></div>
      <label class="ix-field ix-inline" id="ix-tile-row" hidden>기존 타일 위 시공<select id="ix-tile-method"><option value="overlay">덧방</option><option value="remove">철거 후 시공</option></select></label>
      <details class="ix-details"><summary>세부 내역</summary><div id="ix-lines"></div></details>
      <h3 class="ix-subhead" id="ix-quotes-head" hidden>저장한 견적</h3><ul id="ix-quotes" class="ix-list"></ul>
    </section>
    <p id="ix-status" role="status" aria-live="polite"></p>`;
  hooks.ui.querySelector('#studio-description').after(panel);
  const $ = sel => panel.querySelector(sel);

  const viewbar = el('div', { id: 'ix-viewbar', hidden: true, role: 'toolbar', 'aria-label': '3D 보기' });
  viewbar.innerHTML = `<div class="ix-segmented ix-segmented-dark" role="radiogroup" aria-label="시점">
      <button type="button" role="radio" data-view="dollhouse" aria-checked="true">돌하우스</button><button type="button" role="radio" data-view="top" aria-checked="false">평면</button><button type="button" role="radio" data-view="inside" aria-checked="false">실내 시점</button></div>
    <button type="button" id="ix-low" aria-pressed="false">벽 낮게</button>
    <button type="button" id="ix-render" aria-pressed="false" title="빛의 반사와 그림자를 경로 추적으로 계산해요">✦ 사실적 렌더</button>
    <button type="button" id="ix-walk" title="지금 꾸민 집 안을 직접 걸어 다녀 보세요">걸어보기 →</button>`;
  hooks.ui.append(viewbar);
  const paintChip = el('div', { id: 'ix-paint-chip', hidden: true, role: 'status' });
  hooks.ui.append(paintChip);
  const tooltip = el('div', { id: 'ix-tooltip', hidden: true });
  hooks.ui.append(tooltip);

  const quoteDialog = el('dialog', { id: 'ix-quote-dialog', 'aria-labelledby': 'ix-quote-title' });
  quoteDialog.innerHTML = `<header><div><span class="ix-eyebrow">QUOTE</span><h2 id="ix-quote-title">인테리어 견적서</h2></div>
    <label>받는 분<input id="ix-customer" type="text" maxlength="30" placeholder="고객 이름"></label>
    <div class="ix-row"><button id="ix-print" type="button" class="studio-primary">인쇄 · PDF 저장</button><button id="ix-quote-close" type="button">닫기</button></div></header>
    <iframe id="ix-quote-frame" title="견적서 미리보기"></iframe>`;
  document.body.append(quoteDialog);
  const priceDialog = el('dialog', { id: 'ix-price-dialog', 'aria-labelledby': 'ix-price-title' });
  priceDialog.innerHTML = `<header><div><span class="ix-eyebrow">PRICE DB</span><h2 id="ix-price-title">견적 단가표</h2><p>샘플 단가 · 원(VAT 별도) · 수정값은 이 브라우저에 저장</p></div>
    <div class="ix-row"><input id="ix-price-search" type="search" placeholder="항목 검색"><button id="ix-price-reset" type="button">모두 기본값</button><button id="ix-price-close" type="button">닫기</button></div></header>
    <div class="ix-price-table" id="ix-price-table"></div>`;
  document.body.append(priceDialog);

  // 3D hover/selection ghosts (structure tab).
  const ghostMaterial = color => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, depthTest: true });
  const ghosts = { hover: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), ghostMaterial(0x2f9e7f)), select: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), ghostMaterial(0xd27a3a)), draft: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), ghostMaterial(0x2b6cb0)) };
  for (const g of Object.values(ghosts)) { g.visible = false; g.renderOrder = 10; g.userData = { surfaceOverride: true, noBatch: true, collisionDisabled: true, surfaceHighlight: true }; }
  function placeGhost(ghost, rect, color) {
    if (!rect) { ghost.visible = false; return; }
    const [cx, cz, w, d, angle = 0] = rect, h = lowWalls && view !== 'inside' ? 1.2 : ceiling();
    ghost.position.set(cx, h / 2, cz); ghost.scale.set(Math.max(0.02, w), h + 0.02, Math.max(0.02, d)); ghost.rotation.set(0, angle, 0);
    if (color != null) ghost.material.color.setHex(color);
    if (ghost.parent !== current().model) current().model.add(ghost);
    ghost.visible = active;
  }
  const segmentRect = seg => { const b = removalBox(seg, undefined, 0.01); return [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, b.maxX - b.minX, b.maxZ - b.minZ]; };
  const partitionRect = p => { const { length, angle } = partitionFrame(p), t = p.thickness ?? PARTITION_TYPES[p.type].thickness; return [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, length, t + 0.02, angle]; };

  // ---------------------------------------------------------------- status
  function status(text, tone = 'info') {
    const node = $('#ix-status'); node.textContent = text; node.dataset.tone = tone;
    clearTimeout(statusTimer); if (text && tone !== 'error') statusTimer = setTimeout(() => { if (node.textContent === text) node.textContent = ''; }, 6500);
  }
  function showTooltip(text, x, y) { if (!text) { tooltip.hidden = true; return; } tooltip.textContent = text; tooltip.hidden = false; tooltip.style.left = `${x + 14}px`; tooltip.style.top = `${y + 14}px`; }

  // ---------------------------------------------------------------- history
  const furnitureState = () => hooks.furniture?.snapshot() ?? null;
  const snapshotState = () => ({ structure: structure(), finishes: finishes.snapshot(), furniture: furnitureState() });
  function restoreState(state) {
    applyStructure(state.structure, { record: false });
    finishes.restore(state.finishes);
    if (state.furniture && hooks.furniture && JSON.stringify(state.furniture) !== JSON.stringify(furnitureState())) {
      hooks.furniture.restore(state.furniture);
      if (fnSelected && !fnItem(fnSelected)) fnSelected = null;
      afterFurniture();
    }
  }
  function record() { history.past.push(snapshotState()); if (history.past.length > 80) history.past.shift(); history.future = []; syncHistory(); }
  function undo() { if (!history.past.length) return; history.future.push(snapshotState()); restoreState(history.past.pop()); syncHistory(); status('되돌렸어요.'); }
  function redo() { if (!history.future.length) return; history.past.push(snapshotState()); restoreState(history.future.pop()); syncHistory(); status('다시 적용했어요.'); }
  function syncHistory() {
    $('#ix-undo').disabled = !history.past.length; $('#ix-redo').disabled = !history.future.length;
    const s = structure(), f = finishes.quantities().length, n = s.removed.length + s.partitions.length + f;
    $('#ix-change-count').textContent = n ? `변경 ${n}건` : '';
  }

  // ---------------------------------------------------------------- structure
  function applyStructure(next, { record: rec = true, message = null } = {}) {
    if (rec) record();
    const t0 = performance.now(), result = structures.apply(current(), next), t1 = performance.now();
    current().interiorEdited = structures.edited(current());
    finishes.refresh(); const t2 = performance.now();
    hooks.onStructureChange?.();
    if (selected?.type === 'partition' && !next.partitions.some(p => p.id === selected.id)) selected = null;
    renderPlan(); renderStructurePanel(); syncGhosts(); scheduleEstimate(); syncHistory();
    lastApply = { structureMs: t1 - t0, facesMs: t2 - t1, uiMs: performance.now() - t2, ...result };
    if (message) status(message);
    return result;
  }
  const isRemoved = id => structure().removed.includes(id);
  function toggleDemolish(seg) {
    const s = structure();
    if (s.removed.includes(seg.id)) {
      const moved = s.partitions.find(p => p.movedFrom === seg.id);
      applyStructure({ ...s, removed: s.removed.filter(id => id !== seg.id), partitions: s.partitions.filter(p => p.movedFrom !== seg.id) }, { message: `${seg.roomNames.join(' ↔ ')} 벽을 ${moved ? '원래 위치로 되돌렸어요' : '복구했어요'}.` });
    } else {
      applyStructure({ ...s, removed: [...s.removed, seg.id] }, { message: `${seg.roomNames.join(' ↔ ')} 벽 ${seg.length.toFixed(2)}m를 허물었어요.${seg.openings.length ? ` 벽 안의 ${seg.openings.length}개 문·창도 함께 철거돼요.` : ''}` });
      selected = { type: 'segment', id: seg.id };
    }
    renderStructurePanel();
  }
  let partitionSerial = 1;
  function addPartition(a, b) {
    const s = structure();
    while (s.partitions.some(p => p.id === `pt-${partitionSerial}`)) partitionSerial++;
    const p = { id: `pt-${partitionSerial++}`, type: partitionType, a, b, thickness: PARTITION_TYPES[partitionType].thickness, height: PARTITION_TYPES[partitionType].height,
      door: partitionDoor ? { offset: Math.hypot(b[0] - a[0], b[1] - a[1]) / 2, width: DOOR_OPENING.width, height: DOOR_OPENING.height } : null, movedFrom: null };
    const error = validatePartition(p, info(), { removed: s.removed, segments: segments() });
    if (error) { status(error, 'error'); return false; }
    applyStructure({ ...s, partitions: [...s.partitions, p] }, { message: `${PARTITION_TYPES[p.type].label} ${partitionFrame(p).length.toFixed(2)}m를 세웠어요.` });
    selected = { type: 'partition', id: p.id }; renderStructurePanel(); renderPlan();
    return true;
  }
  function removePartition(id) {
    const s = structure(), p = s.partitions.find(x => x.id === id); if (!p) return;
    if (p.movedFrom) { const seg = segments().find(x => x.id === p.movedFrom); applyStructure({ ...s, removed: s.removed.filter(r => r !== p.movedFrom), partitions: s.partitions.filter(x => x.id !== id) }, { message: `${seg?.roomNames.join(' ↔ ') ?? ''} 벽을 원래 자리로 되돌렸어요.` }); }
    else applyStructure({ ...s, partitions: s.partitions.filter(x => x.id !== id) }, { message: '가벽을 없앴어요.' });
    selected = null; renderStructurePanel();
  }
  function updatePartition(id, patch, message) {
    const s = structure(), p = s.partitions.find(x => x.id === id); if (!p) return;
    const next = { ...p, ...patch };
    const error = validatePartition(next, info(), { removed: s.removed, segments: segments() });
    if (error) { status(error, 'error'); return; }
    applyStructure({ ...s, partitions: s.partitions.map(x => x.id === id ? next : x) }, { message });
  }
  function moveWall(target, offset) {
    const s = structure();
    if (target.type === 'segment') {
      const seg = segments().find(x => x.id === target.id); if (!seg) return;
      if (Math.abs(offset) < 0.05) return;
      const existing = s.partitions.find(p => p.movedFrom === seg.id), p = movedWall(seg, offset, existing);
      const error = validatePartition(p, info(), { removed: [...new Set([...s.removed, seg.id])], segments: segments() });
      if (error) { status(error, 'error'); return; }
      applyStructure({ ...s, removed: [...new Set([...s.removed, seg.id])], partitions: [...s.partitions.filter(x => x.id !== p.id), p] }, { message: `벽을 ${Math.round(offset * 100)}cm 옮겼어요. 기존 벽 철거와 새 벽 시공이 견적에 반영돼요.` });
      selected = { type: 'partition', id: p.id };
    } else {
      const p = s.partitions.find(x => x.id === target.id); if (!p) return;
      const { normal } = partitionFrame(p), dx = normal[0] * offset, dz = normal[1] * offset;
      if (p.movedFrom) {
        const seg = segments().find(x => x.id === p.movedFrom), total = movedOffset(seg, p) + offset;
        if (Math.abs(total) < 0.05) { removePartition(p.id); return; }
      }
      updatePartition(p.id, { a: [+(p.a[0] + dx).toFixed(3), +(p.a[1] + dz).toFixed(3)], b: [+(p.b[0] + dx).toFixed(3), +(p.b[1] + dz).toFixed(3)] }, `벽을 ${Math.round(Math.abs(offset) * 100)}cm 옮겼어요.`);
    }
    renderStructurePanel();
  }
  function selectionTarget() {
    if (!selected) return null;
    if (selected.type === 'segment') { const seg = segments().find(s => s.id === selected.id); return seg ? { type: 'segment', seg } : null; }
    const p = structure().partitions.find(x => x.id === selected.id); return p ? { type: 'partition', p } : null;
  }
  function renderStructurePanel() {
    for (const b of panel.querySelectorAll('[data-tool]')) b.setAttribute('aria-checked', String(b.dataset.tool === tool));
    for (const b of panel.querySelectorAll('[data-type]')) b.setAttribute('aria-checked', String(b.dataset.type === partitionType));
    for (const em of panel.querySelectorAll('[data-price]')) { const item = priceItem(em.dataset.price); em.textContent = item ? `${won(unitPrice(item))}/m²` : ''; }
    $('#ix-partition-options').hidden = tool !== 'build';
    $('#ix-door').checked = partitionDoor;
    const card = $('#ix-selection'), target = selectionTarget(); card.replaceChildren(); card.hidden = !target;
    if (target?.type === 'segment') {
      const { seg } = target, removed = isRemoved(seg.id), moved = structure().partitions.find(p => p.movedFrom === seg.id);
      card.append(el('span', { class: 'ix-eyebrow', text: removed ? (moved ? '옮긴 벽' : '철거 예정 벽') : '기존 내부 벽' }), el('strong', { text: `${seg.roomNames.join(' ↔ ')}` }),
        el('p', { text: `길이 ${seg.length.toFixed(2)}m · 두께 ${Math.round(seg.thickness * 1000)}mm · 높이 ${ceiling().toFixed(2)}m${seg.openings.length ? ` · 문·창 ${seg.openings.length}개` : ''}` }));
      if (seg.caution === 'wet') card.append(el('p', { class: 'ix-caution', text: '욕실과 맞닿은 벽이에요. 철거 시 방수층 보강과 배관 확인이 필요해요.' }));
      if (seg.caution === 'balcony') card.append(el('p', { class: 'ix-caution', text: '발코니 경계 벽이에요. 철거는 발코니 확장 공사로 단열·결로 대책이 필요해요.' }));
      const row = el('div', { class: 'ix-row' });
      row.append(el('button', { type: 'button', class: removed ? '' : 'ix-danger', text: removed ? '되돌리기' : '이 벽 허물기', onclick: () => toggleDemolish(seg) }));
      if (!removed) row.append(el('button', { type: 'button', text: '옮기기', onclick: () => { setTool('move'); status('2D 평면에서 이 벽을 잡고 끌어 옮기세요.'); } }));
      card.append(row);
    } else if (target?.type === 'partition') {
      const { p } = target, { length } = partitionFrame(p), t = PARTITION_TYPES[p.type];
      card.append(el('span', { class: 'ix-eyebrow', text: p.movedFrom ? '옮긴 벽' : '새로 세운 벽' }), el('strong', { text: `${t.label} · ${length.toFixed(2)}m` }),
        el('p', { text: `${t.detail} · 두께 ${Math.round((p.thickness ?? t.thickness) * 1000)}mm${p.door ? ' · 문 개구부 900mm' : ''}` }));
      const types = el('div', { class: 'ix-mini-types' });
      for (const [id, def] of Object.entries(PARTITION_TYPES)) types.append(el('button', { type: 'button', 'aria-pressed': String(p.type === id), text: def.label, onclick: () => updatePartition(p.id, { type: id, thickness: p.movedFrom ? p.thickness : def.thickness, height: def.height }, `${def.label}으로 바꿨어요.`) }));
      card.append(types);
      const row = el('div', { class: 'ix-row' });
      row.append(el('button', { type: 'button', text: p.door ? '문 개구부 없애기' : '문 개구부 넣기', onclick: () => updatePartition(p.id, { door: p.door ? null : { offset: length / 2, width: DOOR_OPENING.width, height: DOOR_OPENING.height } }, p.door ? '문 개구부를 막았어요.' : '가운데에 문 개구부를 냈어요.') }));
      row.append(el('button', { type: 'button', class: 'ix-danger', text: p.movedFrom ? '원래 자리로' : '삭제', onclick: () => removePartition(p.id) }));
      card.append(row);
    }
    const list = $('#ix-structure-list'), s = structure(); list.replaceChildren();
    $('#ix-structure-count').textContent = s.removed.length + s.partitions.length ? `${s.removed.length + s.partitions.length}` : '';
    for (const id of s.removed) {
      const seg = segments().find(x => x.id === id); if (!seg || s.partitions.some(p => p.movedFrom === id)) continue;
      list.append(listItem('철거', `${seg.roomNames.join(' ↔ ')} · ${seg.length.toFixed(2)}m`, () => { selected = { type: 'segment', id }; renderStructurePanel(); renderPlan(); syncGhosts(); }, () => toggleDemolish(seg), 'demolish'));
    }
    for (const p of s.partitions) list.append(listItem(p.movedFrom ? '이동' : '신설', `${PARTITION_TYPES[p.type].label} · ${partitionFrame(p).length.toFixed(2)}m${p.door ? ' · 문' : ''}`, () => { selected = { type: 'partition', id: p.id }; renderStructurePanel(); renderPlan(); syncGhosts(); }, () => removePartition(p.id), p.movedFrom ? 'move' : 'build'));
    $('#ix-structure-list').previousElementSibling.hidden = !list.children.length;
  }
  function listItem(tag, text, onSelect, onRemove, kind) {
    const li = el('li', { class: `ix-item ix-item-${kind}` });
    li.append(el('button', { type: 'button', class: 'ix-item-main', onclick: onSelect }, el('span', { class: 'ix-tag', text: tag }), el('span', { text })), el('button', { type: 'button', class: 'ix-item-remove', 'aria-label': `${text} 취소`, text: '×', onclick: onRemove }));
    return li;
  }
  function setTool(next) {
    tool = next; draft = null; if (tool !== 'select' && tool !== 'move') selected = tool === 'build' ? selected : selected;
    renderStructurePanel(); renderPlan(); syncGhosts();
    document.body.dataset.interiorTool = tool;
  }

  // ---------------------------------------------------------------- finishes
  const priceItem = code => { const item = priceDB.items.find(i => i.code === code); if (!item) return null; const o = overrides.get(code); return o ? { ...item, ...o } : item; };
  function targetKeys() {
    if (!finishRoom) return [];
    if (finishScope === 'floor') return finishes.faces.has(`f|${finishRoom}`) ? [`f|${finishRoom}`] : [];
    if (finishScope === 'walls') return finishes.roomFaces(finishRoom, 'wall').map(f => f.key);
    return selectedFace && finishes.face(selectedFace) ? [selectedFace] : [];
  }
  const targetSurface = () => finishScope === 'floor' ? 'floor' : 'wall';
  function chooseRoom(roomId, { keepFace = false } = {}) {
    finishRoom = roomId; if (!keepFace) selectedFace = null;
    $('#ix-room').value = roomId ?? ''; $('#ix-fn-room').value = roomId ?? '';
    if (tab === 'furniture') renderFurniturePanel(); else renderFinishPanel();
    renderPlan();
  }
  function chooseFace(key) {
    const face = finishes.face(key); if (!face) return;
    selectedFace = key; finishRoom = face.roomId ?? finishRoom; finishScope = face.kind === 'floor' ? 'floor' : 'face';
    $('#ix-room').value = finishRoom ?? '';
    renderFinishPanel(); renderPlan();
  }
  function renderFinishPanel() {
    if (!bound) return;
    for (const b of panel.querySelectorAll('[data-scope]')) b.setAttribute('aria-checked', String(b.dataset.scope === finishScope));
    const faces = finishRoom ? finishes.roomFaces(finishRoom, 'wall').sort((a, b) => b.area - a.area) : [];
    const chips = $('#ix-faces'); chips.replaceChildren(); chips.hidden = finishScope !== 'face';
    for (const f of faces) chips.append(el('button', { type: 'button', 'aria-pressed': String(f.key === selectedFace), title: `${f.label} · ${m2(f.area)}`, text: `${f.label} ${m2(f.area)}`, onclick: () => chooseFace(f.key),
      onmouseenter: () => finishes.setHighlight([f.key]), onmouseleave: () => finishes.setHighlight(targetKeys()) }));
    const keys = targetKeys(), total = keys.reduce((s, k) => s + (finishes.face(k)?.area ?? 0), 0), room = rooms().find(r => r.id === finishRoom);
    $('#ix-target-label').textContent = !finishRoom || !keys.length ? ''
      : `${finishScope === 'floor' ? '바닥' : finishScope === 'walls' ? `벽 ${keys.length}면` : finishes.face(keys[0]).label} · ${m2(total)}`;
    void room;
    finishes.setHighlight(keys);
    // Category chips follow the surface: floors never list wallpaper.
    const cats = $('.ix-cats'), surface = targetSurface(), allowed = FINISH_CATEGORIES.filter(c => FINISHES.some(f => f.category === c.id && f.surfaces.includes(surface)));
    if (!allowed.some(c => c.id === category)) category = allowed[0].id;
    cats.replaceChildren(...allowed.map(c => el('button', { type: 'button', role: 'tab', 'aria-selected': String(c.id === category), text: c.label, onclick: () => { category = c.id; renderFinishPanel(); } })));
    renderGrid();
    const list = $('#ix-finish-list'), applied = finishes.quantities(); list.replaceChildren();
    $('#ix-finish-count').textContent = applied.length ? String(applied.length) : '';
    const grouped = new Map();
    for (const q of applied) { const k = `${q.roomId}|${q.finishId}|${q.surface}`; if (!grouped.has(k)) grouped.set(k, { ...q, keys: [], area: 0, count: 0 }); const g = grouped.get(k); g.keys.push(q.key); g.area += q.area; g.count++; }
    for (const g of grouped.values()) {
      const f = finishById(g.finishId);
      list.append(listItem(g.surface === 'floor' ? '바닥' : '벽', `${g.roomName} ${g.surface === 'floor' ? '' : `${g.count}면 `}· ${f.name} · ${m2(g.area)}`, () => { chooseRoom(g.roomId); finishScope = g.surface === 'floor' ? 'floor' : 'walls'; renderFinishPanel(); }, () => { record(); finishes.clear(g.keys); status('원래 마감으로 되돌렸어요.'); }, 'finish'));
    }
    $('#ix-finish-head').hidden = !list.children.length;
    $('#ix-rotate').disabled = !keys.some(k => finishes.assignment(k));
    $('#ix-reset-finish').disabled = !keys.some(k => finishes.assignment(k));
    $('#ix-look').disabled = !finishRoom;
    syncHistory();
  }
  const thumbCache = new Map();
  function renderGrid() {
    const grid = $('#ix-grid'), surface = targetSurface(), keys = targetKeys();
    const appliedIds = new Set(keys.map(k => finishes.assignment(k)?.finishId).filter(Boolean));
    const items = finishesFor(surface, query ? null : category, query);
    grid.replaceChildren();
    for (const f of items) {
      const price = finishUnitPrice(priceDB, overrides, f, surface);
      const card = el('button', { type: 'button', role: 'option', class: 'ix-card-material', 'aria-selected': String(appliedIds.has(f.id)), 'data-finish': f.id, 'aria-label': `${f.name}, ${f.detail}`, title: f.detail });
      const img = el('span', { class: 'ix-thumb', style: `background-color:${f.recipe.color}` });
      const cached = thumbCache.get(f.id); if (cached) img.style.backgroundImage = `url(${cached})`;
      else library.thumbnail(f.id).then(url => { if (url) { thumbCache.set(f.id, url); img.style.backgroundImage = `url(${url})`; } });
      card.append(img, el('strong', { text: f.name }), el('em', { text: price ? `${won(price)}/m²` : '' }));
      if (armed === f.id) card.classList.add('armed');
      card.addEventListener('mouseenter', () => { if (keys.length) finishes.setPreview(keys, f.id); library.load(f.id).catch(() => status('재질 이미지를 만들지 못했어요. 다른 재질을 고르거나 다시 시도해 주세요. 기존 마감은 그대로예요.', 'error')); });
      card.addEventListener('focus', () => { if (keys.length) finishes.setPreview(keys, f.id); });
      card.addEventListener('mouseleave', () => finishes.clearPreview());
      card.addEventListener('blur', () => finishes.clearPreview());
      card.addEventListener('click', () => applyFinish(f.id));
      grid.append(card);
    }
    if (!items.length) grid.append(el('p', { class: 'ix-empty', text: '결과 없음' }));
  }
  function applyFinish(finishId) {
    const f = finishById(finishId), keys = targetKeys();
    if (!keys.length) { armed = armed === finishId ? null : finishId; syncPaintChip(); renderGrid(); status(armed ? '3D에서 벽이나 바닥을 누르세요.' : ''); return; }
    if (!f.surfaces.includes(targetSurface())) { status(`${f.surfaces.includes('floor') ? '바닥' : '벽'} 전용 재질이에요.`, 'error'); return; }
    record();
    const count = finishes.apply(keys, finishId);
    library.load(finishId).then(() => status(`${f.name} · ${count}면 적용`)).catch(() => status('재질 이미지를 만들지 못해 단색으로 표시하고 있어요.', 'error'));
    renderFinishPanel();
  }
  function syncPaintChip() {
    paintChip.hidden = !active || !armed || tab !== 'finish';
    if (armed) paintChip.innerHTML = `<span class="ix-dot" style="background:${finishById(armed).recipe.color}"></span><b>${finishById(armed).name}</b> 칠하기 · 벽이나 바닥을 누르세요 <button type="button" aria-label="칠하기 끄기">Esc</button>`;
    paintChip.querySelector('button')?.addEventListener('click', () => { armed = null; finishes.clearPreview(); syncPaintChip(); renderGrid(); });
  }


  // ---------------------------------------------------------------- furniture
  // Placement, collision and persistence stay in the studio's staging; this tab
  // is a whole-unit view of it with prices from furniture-products.yaml.
  const fnApi = () => hooks.furniture ?? null;
  const fnItems = () => fnApi()?.items() ?? [];
  const fnItem = id => fnItems().find(i => i.id === id) ?? null;
  const productOf = item => resolveFurnitureProduct(productConfig, item);
  const roomName = id => { const r = rooms().find(x => x.id === id); return r?.name_ko ?? r?.name ?? ''; };
  const FN_CATEGORIES = [['all', '전체'], ['seat', '소파·의자'], ['table', '테이블'], ['bed', '침대'], ['storage', '수납'], ['desk', '책상'], ['decor', '러그·소품']];
  const fnCategoryOf = def => { const k = `${def.kind} ${def.title}`; return /bed|crib|king|single|침대/i.test(k) ? 'bed' : /desk|책상/i.test(k) && !/kids/i.test(k) ? 'desk' : /coffee|dining|table|테이블|식탁/i.test(k) ? 'table' : /sofa|loveseat|armchair|chair|stool|소파|의자|체어/i.test(k) ? 'seat' : /shelf|wardrobe|console|sideboard|dresser|cabinet|책장|옷장|수납/i.test(k) ? 'storage' : 'decor'; };
  let fnCategory = 'all';
  // Kit thumbnails render one per frame so the tab opens instantly.
  const fnThumbs = new Map(), thumbQueue = [];
  let thumbRenderer = null, thumbTimer = 0;
  function fnThumb(def, img) {
    if (def.preview) { img.style.backgroundImage = `url(${def.preview})`; return; }
    const cached = fnThumbs.get(def.kind); if (cached) { img.style.backgroundImage = `url(${cached})`; return; }
    if (!def.group) return;
    thumbQueue.push([def, img]); if (!thumbTimer) thumbTimer = setTimeout(drainThumbs, 30);
  }
  function drainThumbs() {
    thumbTimer = 0; const started = performance.now();
    while (thumbQueue.length && performance.now() - started < 14) {
      const [def, img] = thumbQueue.shift();
      if (!fnThumbs.has(def.kind)) { try { thumbRenderer ??= createFurnitureThumbnail(); fnThumbs.set(def.kind, thumbRenderer(def.group)); } catch { fnThumbs.set(def.kind, null); } }
      const url = fnThumbs.get(def.kind); if (url && img.isConnected) img.style.backgroundImage = `url(${url})`;
    }
    if (thumbQueue.length) thumbTimer = setTimeout(drainThumbs, 16);
  }
  function afterFurniture({ estimate: updateCost = true } = {}) {
    if (tab === 'furniture') renderFurniturePanel();
    renderPlan(); syncFurnitureGhost(); if (updateCost) scheduleEstimate(); syncHistory();
  }
  function selectFurniture(id) { fnSelected = id; const item = fnItem(id); if (item && tab === 'furniture') { const r = fnApi().roomOf(item); if (r && r !== finishRoom) { finishRoom = r; $('#ix-fn-room').value = r; $('#ix-room').value = r; } } afterFurniture({ estimate: false }); }
  let fnBusy = false;
  async function addFurniture(kind) {
    const api = fnApi(); if (!api || fnBusy) return;
    const room = rooms().find(r => r.id === finishRoom) ?? rooms().find(r => r.id === info().defaultRoom) ?? rooms()[0];
    const def = api.kinds().find(k => k.kind === kind);
    fnBusy = true; panel.querySelector('#ix-fn-grid').setAttribute('aria-busy', 'true');
    if (def?.catalog) status(`${def.title} 불러오는 중…`);
    record();
    try {
      const result = await api.add(kind, room);
      if (result?.error) { history.past.pop(); syncHistory(); status(result.error, 'error'); return; }
      fnSelected = result.item.id; finishRoom = room.id;
      status(`${room.name_ko ?? room.name}에 ${eul(def?.title ?? '가구')} 놓았어요.`);
      afterFurniture();
    } finally { fnBusy = false; panel.querySelector('#ix-fn-grid').removeAttribute('aria-busy'); }
  }
  function rotateFurniture(id = fnSelected) { const item = fnItem(id); if (!item) return; record(); fnApi().move(id, { angle: (item.angle + Math.PI / 2) % (Math.PI * 2) }); afterFurniture({ estimate: false }); }
  function removeFurniture(id = fnSelected) { const item = fnItem(id); if (!item) return; record(); fnApi().remove(id); if (fnSelected === id) fnSelected = null; status(`${eul(item.title)} 뺐어요.`); afterFurniture(); }
  function nudgeFurniture(dx, dz) { const item = fnItem(fnSelected); if (!item) return; record(); fnApi().move(item.id, { x: +(item.x + dx).toFixed(3), z: +(item.z + dz).toFixed(3) }); afterFurniture(); }
  function renderFurniturePanel() {
    if (!bound) return;
    const api = fnApi(), grid = $('#ix-fn-grid'); grid.replaceChildren(); thumbQueue.length = 0;
    if (!api) { grid.append(el('p', { class: 'ix-empty', text: '가구를 불러올 수 없어요.' })); return; }
    const kinds = api.kinds();
    $('#ix-fn-cats').replaceChildren(...FN_CATEGORIES.filter(([id]) => id === 'all' || kinds.some(d => fnCategoryOf(d) === id)).map(([id, label]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(id === fnCategory), text: label, onclick: () => { fnCategory = id; renderFurniturePanel(); } })));
    for (const def of kinds.filter(d => fnCategory === 'all' || fnCategoryOf(d) === fnCategory)) {
      const product = productOf({ id: def.catalogId ?? def.kind, kind: def.kind, title: def.title, group: def.group });
      const size = def.width ? `${Math.round(def.width * 100)}×${Math.round(def.depth * 100)}cm` : '';
      const card = el('button', { type: 'button', class: 'ix-card-material ix-card-furniture', 'data-kind': def.kind, title: `${def.title}${size ? ` · ${size}` : ''} 놓기`, onclick: () => addFurniture(def.kind) });
      const img = el('span', { class: 'ix-thumb ix-fn-thumb' });
      fnThumb(def, img);
      card.append(img, el('strong', { text: def.title.replace(/\s\d+\s*×\s*\d+cm$/, '') }), el('em', { text: product.price == null ? '가격 확인' : won(product.price) }));
      grid.append(card);
    }
    const list = $('#ix-fn-list'); list.replaceChildren();
    const items = fnItems(), inRoom = finishRoom ? items.filter(i => api.roomOf(i) === finishRoom) : items, shown = inRoom.length ? inRoom : items;
    $('#ix-fn-count').textContent = shown.length ? String(shown.length) : '';
    $('#ix-fn-head').firstChild.textContent = inRoom.length && finishRoom ? `${roomName(finishRoom)} 가구 ` : '배치한 가구 ';
    for (const item of shown) {
      const product = productOf(item), li = el('li', { class: `ix-item ix-item-furniture ${item.id === fnSelected ? 'selected' : ''}` });
      li.append(el('button', { type: 'button', class: 'ix-item-main', onclick: () => selectFurniture(item.id), onmouseenter: () => { fnHover = item.id; syncFurnitureGhost(); renderPlan(); }, onmouseleave: () => { fnHover = null; syncFurnitureGhost(); renderPlan(); } },
        el('span', { class: 'ix-tag', text: product.price == null ? '-' : `${Math.round(product.price / 10000).toLocaleString('ko-KR')}만` }), el('span', { text: item.title })),
        el('button', { type: 'button', class: 'ix-item-load', 'aria-label': `${item.title} 회전`, title: '90° 회전', text: '↻', onclick: () => rotateFurniture(item.id) }),
        el('button', { type: 'button', class: 'ix-item-remove', 'aria-label': `${item.title} 빼기`, text: '×', onclick: () => removeFurniture(item.id) }));
      list.append(li);
    }
    $('#ix-fn-head').hidden = !shown.length;
    const card = $('#ix-fn-selection'), item = fnItem(fnSelected); card.replaceChildren(); card.hidden = !item;
    if (item) {
      const product = productOf(item), warnings = api.warnings(item.id);
      card.append(el('span', { class: 'ix-eyebrow', text: roomName(api.roomOf(item)) }), el('strong', { text: item.title }),
        el('p', { text: `${Math.round(item.width * 100)} × ${Math.round(item.depth * 100)} cm · ${product.price == null ? '가격 확인' : won(product.price)}` }));
      if (warnings.length) card.append(el('p', { class: 'ix-caution', text: warnings[0].replace(/\s*\([^)]*\)\s*$/, '') }));
      card.append(el('div', { class: 'ix-row' }, el('button', { type: 'button', text: '↻ 회전', onclick: () => rotateFurniture() }), el('button', { type: 'button', class: 'ix-danger', text: '빼기', onclick: () => removeFurniture() })));
    }
  }
  function furnitureQuantities() {
    const api = fnApi(); if (!api) return [];
    return fnItems().map(item => { const product = productOf(item); return { key: product.key, name: productName(product, item.title), price: product.price, roomName: roomName(api.roomOf(item)) }; }).filter(f => f.price != null);
  }
  // Plan layer: interactive in the furniture tab, faint context elsewhere.
  function planFurniture(plan) {
    const g = svg('g', { class: `ix-fn-layer ${tab === 'furniture' ? '' : 'passive'}` });
    for (const item of fnItems()) {
      const poly = corners(item).map(p => p.join(',')).join(' '), selectedNow = tab === 'furniture' && item.id === fnSelected, hovered = tab === 'furniture' && item.id === fnHover;
      const node = svg('g', { class: `ix-fn ${item.height < 0.05 ? 'flat' : ''} ${selectedNow ? 'selected' : ''} ${hovered ? 'hover' : ''}`, 'data-furniture': item.id });
      node.append(svg('polygon', { points: poly }));
      if (tab === 'furniture' && Math.min(item.width, item.depth) > 0.32) node.append(svg('text', { x: item.x, y: item.z, 'text-anchor': 'middle', 'dominant-baseline': 'middle', class: 'ix-fn-label' }, item.title.replace(/^(안방|서쪽|가운데)\s/, '').split(' ')[0]));
      g.append(node);
    }
    plan.append(g);
  }
  function furnitureAt(event) { const n = planEl.ownerDocument.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-furniture]'); return n?.dataset.furniture ?? null; }

  // ---------------------------------------------------------------- estimate
  function scheduleEstimate() { clearTimeout(estimateTimer); estimateTimer = setTimeout(updateEstimate, 120); }
  function computeEstimate() {
    return buildEstimate({ db: priceDB, overrides, structure: structures.quantities(current()), finishes: finishes.quantities(), furniture: furnitureQuantities(), options: { tileMethod } });
  }
  const TRADE_COLORS = { demolition: '#c0573a', structure: '#8c6a43', repair: '#a39a86', tile: '#3f7c8a', floor: '#b8894f', paint: '#7d8f6c', wallpaper: '#5e8f7b', general: '#9aa59d', furniture: '#d9b26f' };
  const manwon = n => `${Math.round(n / 10000).toLocaleString('ko-KR')}만`;
  function updateEstimate() {
    if (!bound) return;
    try { estimate = computeEstimate(); } catch (error) { status(`견적을 계산하지 못했어요. ${error.message}`, 'error'); return; }
    const t = estimate.totals, grand = t.grand;
    $('#ix-total-chip').textContent = grand ? manwon(grand) : '';
    $('#ix-total').textContent = won(grand);
    $('#ix-split').textContent = t.total && t.furniture ? `공사 ${manwon(t.total)} · 가구 ${manwon(t.furniture)}` : '';
    $('#ix-days').textContent = estimate.days ? `공사 기간 약 ${Math.ceil(estimate.days)}일` : '';
    const bar = $('#ix-trade-bar'); bar.replaceChildren(); const legend = $('#ix-trade-legend'); legend.replaceChildren();
    const parts = [...estimate.trades, ...(t.furniture ? [{ id: 'furniture', label: '가구', amount: t.furniture }] : [])], sum = parts.reduce((a, x) => a + x.amount, 0) || 1;
    for (const trade of parts) {
      bar.append(el('span', { style: `flex:${trade.amount / sum};background:${TRADE_COLORS[trade.id]}`, title: `${trade.label} ${won(trade.amount)}` }));
      legend.append(el('li', {}, el('i', { style: `background:${TRADE_COLORS[trade.id]}` }), el('span', { text: trade.label }), el('b', { text: manwon(trade.amount) })));
    }
    bar.hidden = legend.hidden = !parts.length;
    const lines = $('#ix-lines'); lines.replaceChildren();
    for (const trade of estimate.trades) {
      const group = el('div', { class: 'ix-line-group' }, el('h4', {}, el('span', { text: trade.label }), el('b', { text: won(trade.amount) })));
      for (const l of estimate.lines.filter(x => x.trade === trade.id)) group.append(el('div', { class: 'ix-line' }, el('span', { text: l.name, title: l.spec }), el('small', { text: `${l.qty.toLocaleString('ko-KR')} ${l.unit}${l.packs ? ` (${l.packs})` : ''}` }), el('b', { text: won(l.amount) })));
      lines.append(group);
    }
    if (estimate.furniture.length) {
      const group = el('div', { class: 'ix-line-group' }, el('h4', {}, el('span', { text: '가구' }), el('b', { text: won(t.furniture) })));
      for (const l of estimate.furniture) group.append(el('div', { class: 'ix-line' }, el('span', { text: l.name }), el('small', { text: `${l.qty}개` }), el('b', { text: won(l.amount) })));
      lines.append(group);
    }
    $('.ix-details').hidden = !estimate.lines.length && !estimate.furniture.length;
    $('#ix-tile-row').hidden = !estimate.lines.some(l => l.code === 'TL-OVERLAY' || l.code === 'DM-FIN-TILE');
    $('#ix-tile-method').value = tileMethod;
    for (const id of ['#ix-quote-open', '#ix-quote-save', '#ix-quote-csv']) $(id).disabled = !estimate.lines.length && !estimate.furniture.length;
    hooks.onEstimate?.(estimate);
  }
  function quoteMeta() {
    const sel = hooks.getSelection?.() ?? {}, def = current().definition;
    const where = sel.building && sel.unit ? `아크로 리버파크 ${sel.building}동 ${sel.unit}호` : `체험 평면 ${def.unitType} ${def.label}`;
    const s = structures.quantities(current()), f = finishes.quantities();
    const goods = furnitureQuantities().length;
    const scope = [s.demolition.length && `벽 철거 ${s.demolition.length}곳`, goods && `가구 ${goods}점`, s.partitions.length && `벽 신설·이동 ${s.partitions.length}곳`, f.some(x => x.surface === 'wall') && `벽 마감 ${m2(f.filter(x => x.surface === 'wall').reduce((a, x) => a + x.area, 0))}`, f.some(x => x.surface === 'floor') && `바닥 ${m2(f.filter(x => x.surface === 'floor').reduce((a, x) => a + x.area, 0))}`].filter(Boolean).join(' · ');
    return { project: `${where} 인테리어`, scope: scope || '변경 없음', customer: $customer.value.trim() };
  }
  const $customer = quoteDialog.querySelector('#ix-customer');
  function makeQuote() {
    const e = computeEstimate(), meta = quoteMeta(), now = new Date();
    let image = null;
    // Selection boxes and face highlights are editing aids, not part of the design.
    const shown = Object.values(ghosts).filter(g => g.visible), keys = tab === 'finish' ? targetKeys() : [];
    try { shown.forEach(g => { g.visible = false; }); finishes.setHighlight([]); finishes.clearPreview(); image = hooks.snapshotImage?.() ?? null; }
    catch { image = null; }
    finally { shown.forEach(g => { g.visible = true; }); if (keys.length) finishes.setHighlight(keys); }
    return { id: `${now.getTime()}`, scope: boundScope, createdAt: now.toISOString(), rates: priceDB.rates,
      meta: { ...meta, number: quoteNumber(now), createdAt: now.toISOString(), image, plan: planMarkup() }, estimate: e, design: snapshotState(), tileMethod };
  }
  function openQuote(quote = makeQuote()) {
    lastQuote = quote; $customer.value = quote.meta.customer ?? '';
    quoteDialog.querySelector('iframe').srcdoc = quoteHTML(quote);
    if (!quoteDialog.open) quoteDialog.showModal();
  }
  $customer.addEventListener('input', () => { if (!lastQuote) return; lastQuote.meta.customer = $customer.value.trim(); quoteDialog.querySelector('iframe').srcdoc = quoteHTML(lastQuote); });
  quoteDialog.querySelector('#ix-print').onclick = () => { const frame = quoteDialog.querySelector('iframe'); frame.contentWindow.focus(); frame.contentWindow.print(); };
  quoteDialog.querySelector('#ix-quote-close').onclick = () => quoteDialog.close();
  async function saveQuote() {
    const quote = makeQuote();
    try { await store.saveQuote(quote); status(`견적을 저장했어요.${store.persistent ? '' : ' (임시 저장)'}`); renderQuotes(); }
    catch (error) { status(`견적을 저장하지 못했어요. ${error.message}`, 'error'); }
  }
  async function renderQuotes() {
    const list = $('#ix-quotes'); list.replaceChildren();
    let quotes = [];
    try { quotes = await store.listQuotes(boundScope); } catch { list.append(el('li', { class: 'ix-empty', text: '저장소를 열 수 없어요.' })); return; }
    for (const q of quotes.slice(0, 12)) {
      const li = el('li', { class: 'ix-item ix-item-quote' });
      const d = new Date(q.createdAt);
      li.append(el('button', { type: 'button', class: 'ix-item-main', onclick: () => openQuote(q) }, el('span', { class: 'ix-tag', text: `${d.getMonth() + 1}/${d.getDate()}` }), el('span', { text: `${q.meta.number} · ${won(q.estimate.totals.grand ?? q.estimate.totals.total)}` })),
        el('button', { type: 'button', class: 'ix-item-load', title: '이 견적의 디자인 불러오기', 'aria-label': '디자인 불러오기', text: '↺', onclick: () => { record(); restoreState(q.design); tileMethod = q.tileMethod ?? 'overlay'; status(`${q.meta.number}의 디자인을 불러왔어요.`); } }),
        el('button', { type: 'button', class: 'ix-item-remove', 'aria-label': '견적 삭제', text: '×', onclick: async () => { await store.deleteQuote(q.id); renderQuotes(); } }));
      list.append(li);
    }
    $('#ix-quotes-head').hidden = !quotes.length;
  }
  function downloadCSV() {
    const quote = makeQuote(), blob = new Blob([quoteCSV(quote)], { type: 'text/csv;charset=utf-8' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `${quote.meta.number}.csv` }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    status('CSV 파일을 만들었어요.');
  }
  function renderPrices() {
    const q = priceDialog.querySelector('#ix-price-search').value.trim();
    const host = priceDialog.querySelector('#ix-price-table'); host.replaceChildren();
    const table = el('table'), head = el('thead'); head.innerHTML = '<tr><th>공종</th><th>코드</th><th>항목 · 규격</th><th>단위</th><th>재료비</th><th>노무비</th><th>경비</th><th>합계</th><th></th></tr>';
    const body = el('tbody'), match = (...texts) => !q || texts.some(t => String(t ?? '').toLowerCase().includes(q.toLowerCase()));
    const refresh = () => { scheduleEstimate(); renderGrid(); renderStructurePanel(); if (tab === 'furniture') renderFurniturePanel(); };
    const section = text => body.append(el('tr', { class: 'section' }, el('th', { colspan: '9', text })));
    // Editable row: fields is a list of [key, base value]; empty cells keep the column grid.
    function row({ code, trade, name, spec, unit, fields, total }) {
      const o = overrides.get(code), value = (k, base) => o?.[k] ?? base;
      const tr = el('tr', { class: o ? 'overridden' : '' });
      tr.append(el('td', { text: trade }), el('td', { class: 'code', text: code }), el('td', {}, el('b', { text: name }), spec ? el('small', { text: spec }) : null), el('td', { text: unit }));
      const inputs = [];
      for (const slot of ['material', 'labor', 'expense']) {
        const field = fields.find(f => f[0] === slot || (slot === 'material' && f[0] === 'price'));
        if (!field) { tr.append(el('td', { class: 'muted', text: '–' })); continue; }
        const input = el('input', { type: 'number', min: '0', step: '100', value: String(value(field[0], field[1])), 'aria-label': `${name} ${field[0]}` });
        tr.append(el('td', {}, input)); inputs.push([field[0], input]);
      }
      const sum = el('td', { class: 'sum', text: won(total(Object.fromEntries(fields.map(([k, base]) => [k, value(k, base)])))) }); tr.append(sum);
      const reset = el('button', { type: 'button', text: '기본값', disabled: !o, onclick: async () => { await store.resetPrice(code); overrides.delete(code); renderPrices(); refresh(); } });
      tr.append(el('td', {}, reset));
      for (const [, input] of inputs) input.addEventListener('change', async () => {
        const values = Object.fromEntries(inputs.map(([k, i]) => [k, Math.max(0, Number(i.value) || 0)]));
        await store.setPrice(code, values); overrides.set(code, { code, ...values });
        tr.classList.add('overridden'); reset.disabled = false; sum.textContent = won(total({ ...Object.fromEntries(fields), ...values })); refresh();
      });
      body.append(tr);
    }
    section('시공 단가');
    for (const item of priceDB.items.filter(i => match(i.name, i.spec, i.code))) {
      row({ code: item.code, trade: priceDB.trades[item.trade].label, name: item.name, spec: item.spec, unit: item.unit,
        fields: [['material', item.material], ['labor', item.labor], ['expense', item.expense]], total: v => v.material + v.labor + v.expense });
    }
    const products = FINISHES.filter(f => priceDB.products?.[f.id] && match(f.name, f.detail, f.id));
    if (products.length) section('마감재 제품 · 재료비만 (노무비·경비는 시공 단가)');
    for (const f of products) {
      const code = finishPriceCode(f, f.surfaces[0]), item = priceDB.items.find(i => i.code === code);
      row({ code: f.id, trade: FINISH_CATEGORIES.find(c => c.id === f.category)?.label ?? '', name: f.name, spec: `${f.detail} · ${code}`, unit: 'm²',
        fields: [['material', priceDB.products[f.id].material]], total: v => v.material + (item?.labor ?? 0) + (item?.expense ?? 0) });
    }
    const goods = (fnApi()?.kinds() ?? []).map(def => ({ def, product: productOf({ id: def.catalogId ?? def.kind, kind: def.kind, title: def.title, group: def.group }) }))
      .filter(({ def, product }, i, all) => product.price != null && all.findIndex(x => x.product.key === product.key) === i && match(def.title, product.key));
    if (goods.length) section('가구 · 예시 가격 (부가세 포함)');
    for (const { def, product } of goods) {
      const code = `FN:${product.key}`;
      row({ code, trade: '가구', name: def.title, spec: productName(product, def.title), unit: '개', fields: [['price', product.price]], total: v => v.price });
    }
    table.append(head, body); host.append(table);
  }
  priceDialog.querySelector('#ix-price-search').addEventListener('input', renderPrices);
  priceDialog.querySelector('#ix-price-close').onclick = () => priceDialog.close();
  priceDialog.querySelector('#ix-price-reset').onclick = async () => { await store.resetAllPrices(); overrides = new Map(); renderPrices(); scheduleEstimate(); renderGrid(); status('단가표를 기본값으로 되돌렸어요.'); };

  // ---------------------------------------------------------------- plan
  let planEl = null;
  const planPoint = event => { const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(planEl.getScreenCTM().inverse()); return [p.x, p.y]; };
  function planSegments(group) {
    for (const seg of segments()) {
      const removed = isRemoved(seg.id), moved = structure().partitions.some(p => p.movedFrom === seg.id);
      const isSel = selected?.type === 'segment' && selected.id === seg.id, isHover = hover?.type === 'segment' && hover.id === seg.id;
      const poly = segmentPolygon(seg).map(p => p.join(',')).join(' ');
      const g = svg('g', { class: `ix-seg ${removed ? 'removed' : ''} ${moved ? 'moved' : ''} ${isSel ? 'selected' : ''} ${isHover ? 'hover' : ''}`, 'data-segment': seg.id, tabindex: '0', role: 'button', 'aria-label': `${seg.roomNames.join('과 ')} 사이 벽 ${seg.length.toFixed(2)}m${removed ? ', 철거 예정' : ''}` });
      g.append(svg('polygon', { points: poly }));
      if (removed && !moved) { const [cx, cz] = segmentRect(seg); g.append(svg('text', { x: cx, y: cz, class: 'ix-seg-label', 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, '철거')); }
      if ((isSel || isHover) && !removed) {
        const [cx, cz] = segmentRect(seg), off = seg.axis === 'x' ? [0, -seg.thickness / 2 - 0.16] : [-seg.thickness / 2 - 0.16, 0];
        g.append(svg('text', { x: cx + off[0], y: cz + off[1], class: 'ix-dim', 'text-anchor': 'middle', 'dominant-baseline': 'middle', transform: seg.axis === 'z' ? `rotate(-90 ${cx + off[0]} ${cz + off[1]})` : '' }, `${(seg.length * 1000).toFixed(0)}`));
      }
      g.addEventListener('pointerenter', () => { if (tab === 'structure' && !draft) { hover = { type: 'segment', id: seg.id }; group.querySelector(`[data-segment="${seg.id}"]`)?.classList.add('hover'); syncGhosts(); } });
      g.addEventListener('pointerleave', () => { if (hover?.id === seg.id) { hover = null; group.querySelector(`[data-segment="${seg.id}"]`)?.classList.remove('hover'); syncGhosts(); } });
      g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); segmentAction(seg); } });
      group.append(g);
    }
  }
  function planPartitions(group, { passive = false } = {}) {
    for (const p of structure().partitions) {
      const isSel = !passive && selected?.type === 'partition' && selected.id === p.id, isHover = !passive && hover?.type === 'partition' && hover.id === p.id;
      const g = svg('g', { class: `ix-part ix-part-${p.type} ${isSel ? 'selected' : ''} ${isHover ? 'hover' : ''}`, 'data-partition': p.id, tabindex: '0', role: 'button', 'aria-label': `${PARTITION_TYPES[p.type].label} ${partitionFrame(p).length.toFixed(2)}m` });
      g.append(svg('polygon', { points: partitionPolygon(p).map(q => q.join(',')).join(' ') }));
      if (p.door) {
        const { dir, normal, length } = partitionFrame(p), w = p.door.width, c = Math.max(w / 2 + 0.1, Math.min(length - w / 2 - 0.1, p.door.offset ?? length / 2)), t = (p.thickness ?? 0.1) / 2 + 0.01;
        const at = (s, n) => [p.a[0] + dir[0] * s + normal[0] * n, p.a[1] + dir[1] * s + normal[1] * n];
        g.append(svg('polygon', { class: 'ix-part-door', points: [at(c - w / 2, t), at(c + w / 2, t), at(c + w / 2, -t), at(c - w / 2, -t)].map(q => q.join(',')).join(' ') }));
      }
      if (isSel || isHover) { const { length } = partitionFrame(p), [cx, cz] = partitionRect(p); g.append(svg('text', { x: cx, y: cz - 0.2, class: 'ix-dim', 'text-anchor': 'middle' }, `${(length * 1000).toFixed(0)}`)); }
      if (passive) { g.removeAttribute('tabindex'); g.removeAttribute('role'); group.append(g); continue; }
      g.addEventListener('pointerenter', () => { if (tab === 'structure' && !draft) { hover = { type: 'partition', id: p.id }; syncGhosts(); } });
      g.addEventListener('pointerleave', () => { if (hover?.id === p.id) { hover = null; syncGhosts(); } });
      group.append(g);
    }
  }
  function segmentAction(seg) {
    if (tool === 'demolish') { toggleDemolish(seg); return; }
    selected = { type: 'segment', id: seg.id }; renderStructurePanel(); renderPlan(); syncGhosts();
  }
  function renderPlan() {
    if (!active || !planEl) return;
    const plan = planEl, b = info().bounds_m ?? [0, 0, 14, 10], pad = 0.45;
    plan.setAttribute('viewBox', `${b[0] - pad} ${b[1] - pad} ${b[2] - b[0] + 2 * pad} ${b[3] - b[1] + 2 * pad}`);
    plan.replaceChildren();
    plan.dataset.interiorTab = tab; plan.dataset.interiorTool = tool;
    const defs = svg('defs'); defs.innerHTML = '<pattern id="ix-hatch" width=".12" height=".12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2=".12" stroke="#c0573a" stroke-width=".035"/></pattern>';
    plan.append(defs);
    const selectedFloor = tab === 'finish' && finishScope === 'floor' ? finishRoom : null;
    for (const r of rooms()) {
      const poly = r.polygon_m ?? segmentPolygon({ axis: 'x', s0: r.bounds_m[0], s1: r.bounds_m[2], faces: [r.bounds_m[1], r.bounds_m[3]] });
      const assigned = finishes.assignment(`f|${r.id}`), fill = assigned ? finishById(assigned.finishId)?.recipe.color : null;
      const g = svg('g', { class: `plan-room ix-room ${r.kind === 'balcony' ? 'balcony' : ''} ${tab === 'finish' && finishRoom === r.id ? 'active' : ''} ${selectedFloor === r.id ? 'floor-selected' : ''}`, 'data-room': r.id });
      g.append(svg('polygon', { points: poly.map(p => p.join(',')).join(' '), style: fill ? `fill:${fill};fill-opacity:.55` : '' }));
      const [x1, z1, x2, z2] = r.bounds_m, a = area(poly);
      const cx = r.representative_point_m?.[0] ?? (x1 + x2) / 2, cz = r.representative_point_m?.[1] ?? (z1 + z2) / 2;
      if (a > 1.2) { g.append(svg('text', { x: cx, y: cz - 0.05, 'text-anchor': 'middle', class: 'ix-room-name' }, r.name_ko ?? r.name)); g.append(svg('text', { x: cx, y: cz + 0.19, 'text-anchor': 'middle', class: 'ix-room-area' }, `${a.toFixed(1)}m² · ${(a / 3.3058).toFixed(1)}평`)); }
      g.addEventListener('click', () => { if (tab === 'finish') { chooseRoom(r.id); if (finishScope === 'face') finishScope = 'walls'; renderFinishPanel(); } });
      plan.append(g);
    }
    plan.append(planWalls());
    for (const seg of segments()) if (isRemoved(seg.id)) plan.append(svg('polygon', { class: 'ix-removed-base', points: segmentPolygon(seg).map(p => p.join(',')).join(' ') }));
    const hidden = structures.hiddenOpenings(current());
    for (const o of info().openings ?? []) {
      if (!['window', 'sliding'].includes(o.kind) || hidden.has(o.id)) continue;
      const [x, z] = o.center_m, dx = o.axis === 'x' ? o.width_m / 2 : 0, dz = o.axis === 'z' ? o.width_m / 2 : 0;
      plan.append(svg('line', { x1: x - dx, y1: z - dz, x2: x + dx, y2: z + dz, class: 'plan-window' }));
    }
    for (const door of current().doors.filter(d => d.definition.type === 'hinged' && !d.disabled)) { const [x1, y1, x2, y2] = hingedSegment(door.definition, door.progress); plan.append(svg('line', { x1, y1, x2, y2, class: 'plan-door-leaf' })); }
    if (tab === 'structure') { const g = svg('g', { class: 'ix-structure-layer' }); planSegments(g); planPartitions(g); plan.append(g); }
    else { const g = svg('g', { class: 'ix-structure-layer passive' }); planPartitions(g, { passive: true }); plan.append(g); }
    planFurniture(plan);
    if (tab === 'finish') {
      for (const key of targetKeys()) { const seg = finishes.face(key) && facePlanSegment(finishes.face(key)); if (seg) plan.append(svg('line', { x1: seg[0][0], y1: seg[0][1], x2: seg[1][0], y2: seg[1][1], class: 'ix-face-line' })); }
      for (const [key] of finishes.quantities().map(q => [q.key])) { const face = finishes.face(key); if (face?.kind !== 'wall') continue; const seg = facePlanSegment(face), color = finishById(finishes.assignment(key).finishId)?.recipe.color; if (seg) plan.append(svg('line', { x1: seg[0][0], y1: seg[0][1], x2: seg[1][0], y2: seg[1][1], class: 'ix-face-applied', style: `stroke:${color}` })); }
    }
    if (draft?.kind === 'build' && draft.b) {
      const p = { type: partitionType, a: draft.a, b: draft.b, thickness: PARTITION_TYPES[partitionType].thickness };
      const { length } = partitionFrame(p), valid = !validatePartition(p, info(), { removed: structure().removed, segments: segments() });
      plan.append(svg('polygon', { class: `ix-draft ${valid ? '' : 'invalid'}`, points: partitionPolygon(p).map(q => q.join(',')).join(' ') }));
      plan.append(svg('text', { x: (draft.a[0] + draft.b[0]) / 2, y: (draft.a[1] + draft.b[1]) / 2 - 0.22, class: 'ix-dim ix-dim-live', 'text-anchor': 'middle' }, `${(length * 1000).toFixed(0)} mm`));
    }
    if (draft?.kind === 'build') plan.append(svg('circle', { cx: draft.a[0], cy: draft.a[1], r: 0.06, class: 'ix-snap' }));
    if (draft?.kind === 'move' && draft.preview) plan.append(svg('polygon', { class: 'ix-draft', points: draft.preview.map(q => q.join(',')).join(' ') }));
    if (draft?.kind === 'move' && draft.offset) plan.append(svg('text', { x: draft.label[0], y: draft.label[1], class: 'ix-dim ix-dim-live', 'text-anchor': 'middle' }, `${draft.offset > 0 ? '+' : ''}${Math.round(draft.offset * 1000)} mm`));
    if (hoverPoint && tab === 'structure' && tool === 'build' && !draft) plan.append(svg('circle', { cx: hoverPoint[0], cy: hoverPoint[1], r: 0.05, class: 'ix-snap' }));
  }
  // Walls are drawn from the unclipped geometry (closed contours); removed
  // runs are painted over and new walls drawn on top. Shared with the studio's
  // overview and furniture plans so every 2D view shows the remodel.
  function planWalls({ changes = false } = {}) {
    const walls = svg('g', { class: 'plan-walls', 'fill-rule': 'evenodd' }), roots = new Map();
    current().model.traverse(o => {
      if (!o.isMesh || !o.visible && !o.userData.renderBatched || o.userData.renderBatch || o.userData.surfaceOverride || o.userData.interiorAdded) return;
      if (info().objects[o.userData.object_id]?.category !== 'Structure' || o.userData.component === 'glass') return;
      const root = o.parent?.userData.component === 'wall' && !o.parent.isMesh ? o.parent : o;
      if (!roots.has(root)) roots.set(root, []); roots.get(root).push(o);
    });
    for (const [root, meshes] of roots) {
      let d = wallPaths.get(root);
      if (d === undefined) {
        for (const m of meshes) m.updateWorldMatrix(true, false);
        const proxies = meshes.map(m => ({ isMesh: true, parent: null, userData: {}, geometry: structures.originalGeometry(current(), m) ?? m.geometry, matrixWorld: m.matrixWorld, updateWorldMatrix() {} }));
        d = wallSectionPath(proxies.length === 1 ? proxies[0] : { isMesh: false, parent: null, userData: {}, traverse(fn) { proxies.forEach(fn); } });
        wallPaths.set(root, d);
      }
      if (d) walls.append(svg('path', { d }));
    }
    if (!changes) return walls;
    const group = svg('g', { class: 'ix-plan-changes' }); group.append(walls);
    for (const seg of segments()) if (isRemoved(seg.id)) group.append(svg('polygon', { class: 'ix-removed-base', points: segmentPolygon(seg).map(p => p.join(',')).join(' ') }));
    const parts = svg('g', { class: 'ix-structure-layer passive' }); planPartitions(parts, { passive: true }); group.append(parts);
    return group;
  }
  let hoverPoint = null;
  // Snap a point to nearby room-edge lines (wall faces) within 10cm, then grid.
  function snapToFaces(point) {
    let [x, z] = point, bestX = 0.1, bestZ = 0.1;
    for (const r of rooms()) for (const [px, pz] of r.polygon_m ?? []) {
      if (Math.abs(px - point[0]) < bestX && Math.abs(pz - point[1]) < 1.5) { bestX = Math.abs(px - point[0]); x = px; }
      if (Math.abs(pz - point[1]) < bestZ && Math.abs(px - point[0]) < 1.5) { bestZ = Math.abs(pz - point[1]); z = pz; }
    }
    return [bestX < 0.1 ? x : Math.round(point[0] / 0.05) * 0.05, bestZ < 0.1 ? z : Math.round(point[1] / 0.05) * 0.05].map(v => +v.toFixed(3));
  }
  function hitAt(point) {
    const g = planEl.ownerDocument.elementFromPoint(point.clientX, point.clientY)?.closest?.('[data-segment],[data-partition]');
    if (!g) return null;
    return g.dataset.segment ? { type: 'segment', id: g.dataset.segment } : { type: 'partition', id: g.dataset.partition };
  }
  function bindPlan(plan) {
    planEl = plan;
    plan.addEventListener('pointerdown', event => {
      if (!active || event.button !== 0) return;
      const p = planPoint(event), hit = hitAt(event);
      if (tab === 'furniture') {
        const id = furnitureAt(event);
        if (!id) { const roomEl = event.target.closest?.('[data-room]'); fnSelected = null; if (roomEl) chooseRoom(roomEl.dataset.room); else afterFurniture({ estimate: false }); return; }
        event.preventDefault(); const item = fnItem(id);
        fnDrag = { id, dx: item.x - p[0], dz: item.z - p[1], start: p, moved: false };
        plan.setPointerCapture(event.pointerId); selectFurniture(id); return;
      }
      if (tab !== 'structure') return;
      if (tool === 'build') { event.preventDefault(); draft = { kind: 'build', a: snapToFaces(p), b: null }; plan.setPointerCapture(event.pointerId); renderPlan(); return; }
      if (!hit) { if (tool === 'select') { selected = null; renderStructurePanel(); renderPlan(); syncGhosts(); } return; }
      if (tool === 'move' || (tool === 'select' && event.altKey)) {
        event.preventDefault(); selected = hit; draft = { kind: 'move', target: hit, start: p, offset: 0, preview: null, label: p }; plan.setPointerCapture(event.pointerId); renderStructurePanel(); return;
      }
      if (hit.type === 'segment') { const seg = segments().find(s => s.id === hit.id); if (seg) segmentAction(seg); }
      else if (tool === 'demolish') removePartition(hit.id);
      else { selected = hit; renderStructurePanel(); renderPlan(); syncGhosts(); }
    });
    plan.addEventListener('pointermove', event => {
      if (!active) return;
      if (fnDrag) {
        const p = planPoint(event);
        if (!fnDrag.moved && Math.hypot(p[0] - fnDrag.start[0], p[1] - fnDrag.start[1]) < 0.03) return;
        if (!fnDrag.moved) { record(); fnDrag.moved = true; }
        fnApi().move(fnDrag.id, { x: Math.round((p[0] + fnDrag.dx) * 100) / 100, z: Math.round((p[1] + fnDrag.dz) * 100) / 100 }, false);
        renderPlan(); syncFurnitureGhost(); return;
      }
      if (tab === 'furniture') { const id = furnitureAt(event); if (id !== fnHover) { fnHover = id; renderPlan(); syncFurnitureGhost(); } return; }
      if (tab !== 'structure') return;
      const p = planPoint(event);
      if (tool === 'build' && !draft) { hoverPoint = snapToFaces(p); renderPlan(); return; }
      if (draft?.kind === 'build') {
        const end = snapPoint(draft.a, p, { free: event.shiftKey }), snapped = snapToFaces(end);
        // Face snapping must not break the orthogonal constraint.
        draft.b = Math.abs(end[0] - draft.a[0]) < 1e-6 ? [draft.a[0], snapped[1]] : Math.abs(end[1] - draft.a[1]) < 1e-6 ? [snapped[0], draft.a[1]] : end;
        renderPlan(); syncGhosts(); return;
      }
      if (draft?.kind === 'move') {
        const t = draft.target, seg = t.type === 'segment' ? segments().find(s => s.id === t.id) : null, part = t.type === 'partition' ? structure().partitions.find(x => x.id === t.id) : null;
        const normal = seg ? (seg.axis === 'x' ? [0, 1] : [1, 0]) : partitionFrame(part).normal;
        const delta = Math.round(((p[0] - draft.start[0]) * normal[0] + (p[1] - draft.start[1]) * normal[1]) / 0.05) * 0.05;
        draft.offset = +delta.toFixed(3);
        const base = seg ? (isRemoved(seg.id) ? null : segmentPolygon(seg)) : partitionPolygon(part);
        const poly = seg && !base ? null : (seg ? segmentPolygon(seg) : partitionPolygon(part));
        draft.preview = poly?.map(([x, z]) => [x + normal[0] * draft.offset, z + normal[1] * draft.offset]) ?? null;
        draft.label = p;
        renderPlan(); syncGhosts();
      }
    });
    const finish = event => {
      if (fnDrag) {
        const d = fnDrag; fnDrag = null;
        if (d.moved) { const item = fnItem(d.id); if (item) fnApi().move(d.id, { x: item.x, z: item.z }, true); status(`${eul(item?.title ?? '가구')} 옮겼어요.`); afterFurniture(); }
        return;
      }
      if (!draft) return;
      const d = draft; draft = null;
      if (d.kind === 'build' && d.b && Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) >= 0.05) addPartition(d.a, d.b);
      else if (d.kind === 'build') status('끌어서 길이를 정해 주세요. 30cm 이상부터 세울 수 있어요.');
      if (d.kind === 'move') { if (Math.abs(d.offset) >= 0.05) moveWall(d.target, d.offset); else if (d.target.type === 'segment') { selected = d.target; renderStructurePanel(); } }
      renderPlan(); syncGhosts();
      void event;
    };
    plan.addEventListener('pointerup', finish); plan.addEventListener('pointercancel', () => { if (fnDrag) { finish(); return; } draft = null; renderPlan(); syncGhosts(); });
    plan.addEventListener('pointerleave', () => { if (hoverPoint) { hoverPoint = null; renderPlan(); } if (fnHover && !fnDrag) { fnHover = null; renderPlan(); syncFurnitureGhost(); } });
  }
  function planMarkup() {
    // Standalone plan for the quote (inline styles, no app CSS).
    if (!planEl) return '';
    const clone = planEl.cloneNode(true);
    clone.querySelectorAll('.ix-snap,.ix-draft,.ix-dim,.ix-face-line,.ix-fn-label').forEach(n => n.remove());
    clone.setAttribute('xmlns', NS); clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const style = document.createElementNS(NS, 'style');
    style.textContent = '.plan-room polygon{fill:#efebe2;stroke:#d5cfc2;stroke-width:.02}.plan-room.balcony polygon{fill:#e8edf0}.ix-room-name{font:600 .2px sans-serif;fill:#3c4c43}.ix-room-area{font:.14px sans-serif;fill:#6b7a71}.plan-walls{fill:#3f423c}.plan-window{stroke:#7f9a9b;stroke-width:.05}.plan-door-leaf{stroke:#806648;stroke-width:.04}.ix-seg polygon{fill:transparent}.ix-seg.removed polygon{fill:url(#ix-hatch);stroke:#c0573a;stroke-width:.03;stroke-dasharray:.08 .05}.ix-seg-label{font:700 .13px sans-serif;fill:#c0573a}.ix-part polygon{fill:#2c3b33}.ix-part-glass polygon{fill:#9fc4d0}.ix-part-door{fill:#fff!important}.ix-face-applied{stroke-width:.07;stroke-linecap:round}.ix-fn polygon{fill:#d9c8a8;stroke:#8a7457;stroke-width:.02}.ix-fn.flat polygon{fill:#e9dfcd;stroke-dasharray:.05 .04}';
    clone.prepend(style);
    return clone.outerHTML;
  }

  // ---------------------------------------------------------------- 3D
  function syncGhosts() {
    if (!bound) return;
    const showStructure = active && tab === 'structure';
    const rectFor = t => {
      if (!t) return null;
      if (t.type === 'segment') { const seg = segments().find(s => s.id === t.id); return seg && !isRemoved(seg.id) ? segmentRect(seg) : null; }
      const p = structure().partitions.find(x => x.id === t.id); return p ? partitionRect(p) : null;
    };
    placeGhost(ghosts.hover, showStructure && hover && !(selected && hover.id === selected.id) ? rectFor(hover) : null, tool === 'demolish' ? 0xc0573a : 0x2f9e7f);
    placeGhost(ghosts.select, showStructure ? rectFor(selected) : null, 0xd27a3a);
    let draftRect = null;
    if (showStructure && draft?.kind === 'build' && draft.b) draftRect = partitionRect({ type: partitionType, a: draft.a, b: draft.b, thickness: PARTITION_TYPES[partitionType].thickness });
    if (showStructure && draft?.kind === 'move' && draft.preview) { const xs = draft.preview.map(p => p[0]), zs = draft.preview.map(p => p[1]); const t = draft.target.type === 'partition' ? structure().partitions.find(x => x.id === draft.target.id) : null; draftRect = t ? (() => { const r = partitionRect(t), { normal } = partitionFrame(t); return [r[0] + normal[0] * draft.offset, r[1] + normal[1] * draft.offset, r[2], r[3], r[4]]; })() : [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2, Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)]; }
    placeGhost(ghosts.draft, draftRect, 0x2b6cb0);
    hooks.invalidate(false);
  }
  // Furniture selection outline (3D) and hover outline.
  const outline = (color, opacity) => { const o = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false })); o.renderOrder = 12; o.visible = false; o.userData = { surfaceOverride: true, noBatch: true, collisionDisabled: true, surfaceHighlight: true }; return o; };
  const fnBoxes = { select: outline(0x1f8f6c, 1), hover: outline(0x7fc3a9, 0.7) };
  function syncFurnitureGhost() {
    if (!bound) return;
    const place = (box, item) => {
      if (!item || !active || tab !== 'furniture') { box.visible = false; return; }
      box.position.set(item.x, Math.max(0.02, item.height) / 2, item.z); box.scale.set(item.width + 0.04, Math.max(0.02, item.height) + 0.04, item.depth + 0.04); box.rotation.set(0, item.angle, 0);
      if (box.parent !== current().model) current().model.add(box);
      box.visible = true;
    };
    place(fnBoxes.select, fnItem(fnSelected)); place(fnBoxes.hover, fnHover && fnHover !== fnSelected ? fnItem(fnHover) : null);
    hooks.invalidate(false);
  }
  const ndc = event => { const r = renderer.domElement.getBoundingClientRect(); return new THREE.Vector2((event.clientX - r.left) / r.width * 2 - 1, -(event.clientY - r.top) / r.height * 2 + 1); };
  function pickStructure(event) {
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc(event), camera);
    const meshes = []; current().model.traverse(o => { if (!o.isMesh || o.userData.renderBatch || o.userData.surfaceOverride) return; for (let p = o; p && p !== current().model; p = p.parent) { if (p.userData.surfaceOverride) return; if (!p.visible && !p.userData.renderBatched) return; } meshes.push(o); });
    const hit = ray.intersectObjects(meshes, false).find(h => !renderer.clippingPlanes.some(p => p.distanceToPoint(h.point) < 0));
    if (!hit) return null;
    if (hit.object.userData.partitionId) return { type: 'partition', id: hit.object.userData.partitionId };
    const { x, z } = hit.point;
    const seg = segments().find(s => { const b = removalBox(s, undefined, 0.03); return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ; });
    if (seg && !isRemoved(seg.id)) return { type: 'segment', id: seg.id };
    return { type: 'none', component: hit.object.userData.component };
  }
  function pickFurniture(event) {
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc(event), camera);
    const hit = ray.intersectObjects(sceneMeshes(), false).find(h => !renderer.clippingPlanes.some(p => p.distanceToPoint(h.point) < 0));
    for (let o = hit?.object; o; o = o.parent) if (o.userData.stagingId) return fnItem(o.userData.stagingId) ? o.userData.stagingId : null;
    return null;
  }
  const floorPoint = event => { const ray = new THREE.Raycaster(); ray.setFromCamera(ndc(event), camera); return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3()); };
  let fn3d = null;
  // Capture phase: claim the drag before OrbitControls starts rotating.
  renderer.domElement.addEventListener('pointerdown', event => {
    if (!active || tab !== 'furniture' || event.button !== 0) return;
    const id = pickFurniture(event), point = id && floorPoint(event);
    if (!id || !point) return;
    const item = fnItem(id);
    orbit.enabled = false; fn3d = { id, dx: item.x - point.x, dz: item.z - point.z, start: [event.clientX, event.clientY], moved: false };
    renderer.domElement.setPointerCapture(event.pointerId); selectFurniture(id);
  }, { capture: true });
  let downAt = null, moveFrame = 0, lastMove = null;
  renderer.domElement.addEventListener('pointerdown', event => { if (active && event.button === 0) downAt = [event.clientX, event.clientY]; });
  renderer.domElement.addEventListener('pointermove', event => {
    if (!active) return;
    if (fn3d) {
      if (!fn3d.moved && Math.hypot(event.clientX - fn3d.start[0], event.clientY - fn3d.start[1]) < 4) return;
      const point = floorPoint(event); if (!point) return;
      if (!fn3d.moved) { record(); fn3d.moved = true; }
      fnApi().move(fn3d.id, { x: Math.round((point.x + fn3d.dx) * 100) / 100, z: Math.round((point.z + fn3d.dz) * 100) / 100 }, false);
      syncFurnitureGhost(); renderPlan(); return;
    }
    lastMove = event;
    if (moveFrame) return;
    moveFrame = requestAnimationFrame(() => {
      moveFrame = 0; const e = lastMove; if (!e || e.buttons) { showTooltip(''); return; }
      if (tab === 'structure') {
        const hit = pickStructure(e), next = hit && hit.type !== 'none' ? hit : null;
        if (next?.id !== hover?.id) { hover = next; syncGhosts(); renderPlan(); }
        const seg = next?.type === 'segment' ? segments().find(s => s.id === next.id) : null, part = next?.type === 'partition' ? structure().partitions.find(p => p.id === next.id) : null;
        showTooltip(seg ? `${seg.roomNames.join(' ↔ ')} · ${seg.length.toFixed(2)}m${tool === 'demolish' ? ' · 눌러서 허물기' : ''}` : part ? `${PARTITION_TYPES[part.type].label} · ${partitionFrame(part).length.toFixed(2)}m` : '', e.clientX, e.clientY);
        renderer.domElement.style.cursor = next ? 'pointer' : '';
      } else if (tab === 'furniture') {
        const id = pickFurniture(e);
        if (id !== fnHover) { fnHover = id; syncFurnitureGhost(); renderPlan(); }
        renderer.domElement.style.cursor = id ? 'grab' : '';
        const item = id ? fnItem(id) : null;
        showTooltip(item ? `${item.title} · 끌어서 옮기기` : '', e.clientX, e.clientY);
      } else if (tab === 'finish') {
        const hit = finishes.pick(camera, ndc(e), renderer.clippingPlanes);
        renderer.domElement.style.cursor = hit?.key ? (armed ? 'copy' : 'pointer') : '';
        if (armed && hit?.key) { const face = finishes.face(hit.key), f = finishById(armed); if (f.surfaces.includes(face.kind)) finishes.setPreview([hit.key], armed); }
        else if (armed) finishes.clearPreview();
        const face = hit?.key ? finishes.face(hit.key) : null;
        showTooltip(face ? `${face.roomName} ${face.label} · ${m2(face.area)}${finishes.assignment(face.key) ? ` · ${finishById(finishes.assignment(face.key).finishId).name}` : ''}` : '', e.clientX, e.clientY);
      }
    });
  });
  renderer.domElement.addEventListener('pointerleave', () => { showTooltip(''); if (armed) finishes.clearPreview(); if (hover) { hover = null; syncGhosts(); renderPlan(); } if (fnHover && !fn3d) { fnHover = null; syncFurnitureGhost(); renderPlan(); } });
  renderer.domElement.addEventListener('pointercancel', () => { if (fn3d) { fn3d = null; orbit.enabled = true; afterFurniture(); } });
  renderer.domElement.addEventListener('pointerup', event => {
    if (fn3d) {
      const d = fn3d; fn3d = null; orbit.enabled = true; downAt = null;
      if (d.moved) { const item = fnItem(d.id); if (item) fnApi().move(d.id, { x: item.x, z: item.z }, true); status(`${eul(item?.title ?? '가구')} 옮겼어요.`); afterFurniture(); }
      return;
    }
    if (!active || !downAt || Math.hypot(event.clientX - downAt[0], event.clientY - downAt[1]) > 5) { downAt = null; return; }
    downAt = null;
    if (tab === 'furniture') { const id = pickFurniture(event); fnSelected = id; afterFurniture({ estimate: false }); return; }
    if (tab === 'structure') {
      const hit = pickStructure(event);
      if (!hit || hit.type === 'none') { if (tool === 'demolish') status(hit?.component === 'wall' ? '세대 외벽이나 구조체는 허물 수 없어요. 빨간색으로 표시되는 내부 벽을 눌러 주세요.' : '벽을 눌러 주세요.', 'error'); selected = null; renderStructurePanel(); renderPlan(); syncGhosts(); return; }
      if (hit.type === 'segment') { const seg = segments().find(s => s.id === hit.id); if (tool === 'demolish') toggleDemolish(seg); else { selected = hit; renderStructurePanel(); renderPlan(); syncGhosts(); } }
      else if (tool === 'demolish') removePartition(hit.id);
      else { selected = hit; renderStructurePanel(); renderPlan(); syncGhosts(); }
      return;
    }
    if (tab === 'finish') {
      const hit = finishes.pick(camera, ndc(event), renderer.clippingPlanes);
      if (!hit) { status('벽이나 바닥을 눌러 주세요. 빈 공간은 선택할 수 없어요.'); return; }
      if (!hit.key) {
        const reasons = { ceiling: '천장 마감은 아직 바꿀 수 없어요. 벽이나 바닥을 선택해 주세요.', opening_frame: '문·창틀은 마감 대상이 아니에요. 옆의 벽면을 눌러 주세요.', door_leaf: '문짝은 마감 대상이 아니에요. 옆의 벽면을 눌러 주세요.', glass: '유리는 마감 대상이 아니에요.', furniture: '가구가 벽을 가리고 있어요. 화면을 돌리거나 평면에서 공간을 골라 주세요.', kitchen_fixture: '주방 가구는 마감 대상이 아니에요. 화면을 돌려 벽을 눌러 주세요.', storage_fixture: '붙박이장은 마감 대상이 아니에요. 화면을 돌려 벽을 눌러 주세요.', bathroom_fixture: '욕실 기구는 마감 대상이 아니에요. 주변 벽이나 바닥을 눌러 주세요.' };
        status(reasons[hit.blocked] ?? (hit.object?.userData.stagingId || hit.object?.parent?.userData?.stagingId ? reasons.furniture : '이 부분은 마감을 바꿀 수 없어요. 벽 한 면이나 바닥을 눌러 주세요.'), 'error'); return;
      }
      if (armed) {
        const f = finishById(armed), face = finishes.face(hit.key);
        if (!f.surfaces.includes(face.kind)) { status(`${face.kind === 'floor' ? '벽' : '바닥'} 전용 재질이에요.`, 'error'); return; }
        record(); finishes.apply([hit.key], armed); chooseFace(hit.key); status(`${face.roomName} ${face.label} · ${f.name}`); return;
      }
      chooseFace(hit.key);
    }
  });
  document.addEventListener('keydown', event => {
    if (!active || event.target.closest?.('input,select,textarea,dialog')) return;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
    if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
    if (event.key === 'Escape') { if (armed) { armed = null; finishes.clearPreview(); syncPaintChip(); renderGrid(); } draft = null; renderPlan(); syncGhosts(); return; }
    if (tab === 'structure' && (event.key === 'Delete' || event.key === 'Backspace') && selected) {
      event.preventDefault();
      if (selected.type === 'partition') removePartition(selected.id); else { const seg = segments().find(s => s.id === selected.id); if (seg && !isRemoved(seg.id)) toggleDemolish(seg); }
      return;
    }
    if (tab === 'structure' && !mod) { const map = { v: 'select', d: 'demolish', w: 'build', m: 'move' }; if (map[event.key]) setTool(map[event.key]); }
    if (tab === 'furniture' && fnSelected && !mod) {
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeFurniture(); return; }
      if (event.key === 'r' || event.key === 'R') { event.preventDefault(); rotateFurniture(); return; }
      const step = event.shiftKey ? 0.01 : 0.05, d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
      if (d) { event.preventDefault(); nudgeFurniture(...d); }
    }
  });

  // ---------------------------------------------------------------- views
  function setClip() {
    clip.constant = lowWalls ? 1.2 : ceiling() - 0.04;
    renderer.clippingPlanes = active && view !== 'inside' ? [clip] : [];
  }
  function setView(next, { focusKey = null } = {}) {
    view = next;
    for (const b of viewbar.querySelectorAll('[data-view]')) b.setAttribute('aria-checked', String(b.dataset.view === view));
    viewbar.querySelector('#ix-low').disabled = view === 'inside';
    const b = info().bounds_m ?? [0, 0, 14, 10], cx = (b[0] + b[2]) / 2, cz = (b[1] + b[3]) / 2, span = Math.max(b[2] - b[0], b[3] - b[1]);
    orbit.enabled = true; camera.up.set(0, 1, 0);
    // Interior photography framing: about 80 degrees across, clamped for tall viewports.
    const insideFov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(40)) / camera.aspect)), 55, 75);
    camera.far = view === 'inside' ? 350 : 80; camera.fov = view === 'inside' ? insideFov : 60; camera.updateProjectionMatrix();
    if (view === 'inside') {
      const room = rooms().find(r => r.id === (finishRoom ?? selectionRoom())) ?? rooms().find(r => r.id === info().defaultRoom) ?? rooms()[0];
      orbit.minDistance = 0.05; orbit.maxDistance = 7; orbit.maxPolarAngle = Math.PI * 0.92;
      placeInside(room, focusKey);
      hooks.exterior.group.visible = true;
    } else {
      orbit.minDistance = 2; orbit.maxDistance = 60; orbit.maxPolarAngle = Math.PI * 0.48; hooks.exterior.group.visible = false;
      if (view === 'top') hooks.frame(b, true);
      else {
        // Fit the unit's footprint sphere in the narrower of the two fields of view.
        const radius = Math.hypot(b[2] - b[0], b[3] - b[1]) / 2 * 0.92, vfov = THREE.MathUtils.degToRad(camera.fov);
        const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect), distance = radius / Math.sin(Math.min(vfov, hfov) / 2);
        const dir = new THREE.Vector3(0.28, 0.82, 0.62).normalize();
        orbit.target.set(cx, 0.3, cz); camera.position.copy(orbit.target).addScaledVector(dir, distance); camera.lookAt(orbit.target); orbit.update();
      }
      if (realistic()) hooks.realistic?.disable();
    }
    setClip(); hooks.invalidate(true); syncRealistic();
    document.body.dataset.interiorView = view;
  }
  function selectionRoom() {
    if (selected?.type === 'segment') return segments().find(s => s.id === selected.id)?.rooms[0];
    if (selected?.type === 'partition') { const p = structure().partitions.find(x => x.id === selected.id); return p && rooms().find(r => roomContains(r, p.a[0] + 0.3 * (p.b[0] - p.a[0]), p.a[1] + 0.3 * (p.b[1] - p.a[1])))?.id; }
    return null;
  }
  // Visible scene meshes for sightline tests (batched sources count as visible).
  function sceneMeshes() {
    const meshes = [], model = current().model;
    model.updateWorldMatrix(true, true);
    model.traverse(o => {
      if (!o.isMesh || o.userData.renderBatch) return;
      for (let p = o; p && p !== model; p = p.parent) { if (p.userData.surfaceOverride || p.userData.surfaceHighlight) return; if (!p.visible && !p.userData.renderBatched) return; }
      meshes.push(o);
    });
    return meshes;
  }
  function clearance(meshes, from, dir, max = 12) {
    const ray = new THREE.Raycaster(from, dir.clone().normalize(), 0.02, max);
    return ray.intersectObjects(meshes, false)[0]?.distance ?? max;
  }
  // Eye-level viewpoint with the longest clear sightline across the room
  // (built-in closets and furniture make plain corner rules unreliable).
  function placeInside(room, focusKey) {
    const face = focusKey ? finishes.face(focusKey) : null, eye = 1.45, meshes = sceneMeshes();
    const [x1, z1, x2, z2] = room.bounds_m, poly = room.polygon_m ?? [[x1, z1], [x2, z1], [x2, z2], [x1, z2]];
    const center = room.representative_point_m ?? [(x1 + x2) / 2, (z1 + z2) / 2];
    let position, target;
    if (face && face.kind === 'wall') {
      const c = face.tris.flatMap(t => t.points).reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(face.tris.length * 3);
      const n = new THREE.Vector3(face.normal.x, 0, face.normal.z).normalize();
      const free = clearance(meshes, new THREE.Vector3(c.x, eye, c.z).addScaledVector(n, 0.03), n, 6);
      let d = Math.min(3.4, free - 0.35); while (d > 0.8 && !roomContains(room, c.x + n.x * d, c.z + n.z * d)) d -= 0.2;
      position = new THREE.Vector3(c.x + n.x * Math.max(0.8, d), eye, c.z + n.z * Math.max(0.8, d)); target = new THREE.Vector3(c.x, 1.25, c.z);
    } else {
      const candidates = [];
      for (let i = 0; i < poly.length; i++) {
        const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
        candidates.push([ax, az], [(ax + bx) / 2, (az + bz) / 2]);
      }
      let best = null;
      for (const [px, pz] of candidates) {
        const dx = center[0] - px, dz = center[1] - pz, len = Math.hypot(dx, dz) || 1, inset = Math.min(0.55, len * 0.4);
        const x = px + dx / len * inset, z = pz + dz / len * inset;
        if (!roomContains(room, x, z)) continue;
        const from = new THREE.Vector3(x, eye, z), base = Math.atan2(dz, dx);
        // Inside a wardrobe or behind a column: the short back ray gives it away.
        const back = clearance(meshes, from, new THREE.Vector3(-dx, 0, -dz), 1);
        let score = Infinity;
        for (const a of [-0.35, 0, 0.35]) score = Math.min(score, clearance(meshes, from, new THREE.Vector3(Math.cos(base + a), -0.12, Math.sin(base + a))));
        if (back < 0.15) score *= 0.3;
        if (!best || score > best.score) best = { score, x, z, base };
      }
      best ??= { x: center[0], z: center[1], base: 0, score: 0 };
      position = new THREE.Vector3(best.x, eye, best.z);
      target = new THREE.Vector3(best.x + Math.cos(best.base) * 3, face?.kind === 'floor' ? 0.55 : 1.15, best.z + Math.sin(best.base) * 3);
    }
    const dir = target.clone().sub(position).normalize();
    orbit.target.copy(position.clone().addScaledVector(dir, 0.6)); camera.position.copy(position); camera.lookAt(target); orbit.update();
  }
  const realistic = () => hooks.realistic?.inspect().enabled ?? false;
  function syncRealistic() {
    const on = realistic(), button = viewbar.querySelector('#ix-render');
    button.setAttribute('aria-pressed', String(on)); button.disabled = !hooks.realistic;
    document.body.dataset.interiorRealistic = String(on);
  }
  viewbar.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  viewbar.querySelector('#ix-low').addEventListener('click', () => { lowWalls = !lowWalls; viewbar.querySelector('#ix-low').setAttribute('aria-pressed', String(lowWalls)); setClip(); syncGhosts(); hooks.invalidate(true); });
  viewbar.querySelector('#ix-render').addEventListener('click', () => {
    if (!hooks.realistic) return;
    if (realistic()) { hooks.realistic.disable(); status('실시간 화면으로 돌아왔어요.'); }
    else { if (view !== 'inside') setView('inside', { focusKey: selectedFace }); hooks.realistic.enable(); status('화면을 멈추면 빛과 반사가 점점 선명해져요. 움직이면 실시간 화면으로 바뀌어요.'); }
    setTimeout(syncRealistic, 50);
  });

  // ---------------------------------------------------------------- wiring
  panel.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  panel.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
  panel.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => { partitionType = b.dataset.type; renderStructurePanel(); }));
  $('#ix-door').addEventListener('change', e => { partitionDoor = e.target.checked; });
  $('#ix-undo').onclick = undo; $('#ix-redo').onclick = redo;
  $('#ix-save').onclick = () => { hooks.save?.(); };
  panel.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => { finishScope = b.dataset.scope; if (finishScope !== 'face') selectedFace = null; renderFinishPanel(); renderPlan(); }));
  $('#ix-room').addEventListener('change', e => chooseRoom(e.target.value || null));
  $('#ix-fn-room').addEventListener('change', e => { fnSelected = null; chooseRoom(e.target.value || null); syncFurnitureGhost(); });
  $('#ix-search').addEventListener('input', e => { query = e.target.value; renderGrid(); });
  $('#ix-rotate').onclick = () => { record(); finishes.rotate(targetKeys().filter(k => finishes.assignment(k))); status('결 방향을 90° 돌렸어요.'); };
  $('#ix-reset-finish').onclick = () => { record(); finishes.clear(targetKeys()); status('원래 마감으로 되돌렸어요.'); };
  $('#ix-look').onclick = () => setView('inside', { focusKey: selectedFace ?? targetKeys()[0] });
  $('#ix-tile-method').addEventListener('change', e => { tileMethod = e.target.value; scheduleEstimate(); });
  viewbar.querySelector('#ix-walk').addEventListener('click', () => {
    const item = fnItem(fnSelected), room = finishRoom ?? (item && fnApi()?.roomOf(item)) ?? selectionRoom() ?? info().defaultRoom ?? rooms()[0]?.id;
    if (realistic()) hooks.realistic.disable();
    hooks.walk?.(room);
  });
  $('#ix-quote-open').onclick = () => openQuote();
  $('#ix-quote-save').onclick = saveQuote;
  $('#ix-quote-csv').onclick = downloadCSV;
  $('#ix-prices').onclick = () => { renderPrices(); priceDialog.showModal(); };

  function setTab(next) {
    tab = next;
    panel.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    panel.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== tab; });
    draft = null; hover = null;
    if (tab !== 'finish') { finishes.setHighlight([]); finishes.clearPreview(); }
    if (tab === 'finish') { if (!finishRoom) chooseRoom(selectionRoom() ?? info().defaultRoom ?? rooms()[0]?.id); renderFinishPanel(); }
    if (tab === 'furniture') { if (!finishRoom) chooseRoom(info().defaultRoom ?? rooms()[0]?.id); renderFurniturePanel(); }
    else { fnHover = null; }
    if (tab === 'estimate') { updateEstimate(); renderQuotes(); }
    syncPaintChip(); renderPlan(); syncGhosts(); syncFurnitureGhost();
    document.body.dataset.interiorTab = tab;
    hooks.setTitle?.(TAB_TITLES[tab]);
  }

  function scopeKey() { return hooks.layoutScope ?? current().key; }
  function bind() {
    const next = current();
    if (bound === next && boundScope === scopeKey()) return;
    if (bound && boundScope) scopes.set(boundScope, { structure: structures.structure(bound), finishes: finishes.snapshot(), tileMethod });
    for (const g of Object.values(ghosts)) g.removeFromParent();
    bound = next; boundScope = scopeKey(); history.past = []; history.future = []; selected = hover = draft = null; armed = null;
    finishes.bind(next);
    let saved = scopes.get(boundScope);
    if (!saved) { try { saved = hooks.savedInterior?.() ?? null; } catch { saved = null; } }
    try {
      if (saved?.structure || structures.edited(next)) applyStructure(saved?.structure ?? { version: 1, removed: [], partitions: [] }, { record: false });
      finishes.restore(saved?.finishes ?? null);
    } catch (error) {
      console.warn('Interior restore skipped:', error);
      applyStructure({ version: 1, removed: [], partitions: [] }, { record: false }); finishes.restore(null);
      status('저장된 인테리어가 현재 평면과 맞지 않아 기본 상태로 열었어요.', 'error');
    }
    tileMethod = saved?.tileMethod ?? 'overlay';
    if (!scopes.has(boundScope)) hooks.furniture?.restoreSaved?.().then(done => { if (done && bound === next) { history.past = []; history.future = []; syncHistory(); afterFurniture(); } }).catch(() => {});
    for (const id of ['#ix-room', '#ix-fn-room']) $(id).replaceChildren(el('option', { value: '', text: id === '#ix-fn-room' ? '집 전체' : '공간 선택' }), ...rooms().map(r => el('option', { value: r.id, text: r.name_ko ?? r.name })));
    finishRoom = null; selectedFace = null; fnSelected = null; fnHover = null;
    for (const b of Object.values(fnBoxes)) b.removeFromParent();
    syncHistory(); scheduleEstimate();
  }

  return {
    panel,
    bindPlan,
    renderPlan: () => renderPlan(),
    get active() { return active; },
    get edited() { return Boolean(bound) && structures.edited(current()); },
    planWalls: () => planWalls({ changes: true }),
    hiddenOpenings: () => structures.hiddenOpenings(current()),
    ensureBound() { if (!bound || bound !== current() || boundScope !== scopeKey()) bind(); },
    get appearanceMode() { return active && view === 'inside' ? 'tour' : 'overview'; },
    get qualityMode() { return active && view === 'inside' ? 'tour' : 'interior'; },
    onMode(mode) {
      const was = active; active = mode === 'interior';
      panel.hidden = viewbar.hidden = !active;
      if (!active) {
        if (was) { finishes.clearPreview(); finishes.setHighlight([]); armed = null; draft = null; hover = null; fnHover = null; fnDrag = null; fn3d = null; showTooltip(''); renderer.domElement.style.cursor = ''; for (const g of [...Object.values(ghosts), ...Object.values(fnBoxes)]) g.visible = false; orbit.minDistance = 2; orbit.maxPolarAngle = Math.PI * 0.48; if (realistic()) hooks.realistic.disable(); }
        syncPaintChip(); delete document.body.dataset.interiorTab; return;
      }
      bind(); setTab(tab); renderStructurePanel();
      setView(view === 'inside' ? 'dollhouse' : view);
    },
    onVariant() { if (active) { bind(); setTab(tab); setView('dollhouse'); } else if (bound) bind(); },
    refreshLighting() { if (bound) finishes.refresh(); },
    snapshot() { if (!bound) return null; return { version: 1, structure: structures.structure(current()), finishes: finishes.snapshot(), tileMethod }; },
    restore(data) {
      if (!data) return;
      if (data.version !== 1) throw Error('저장된 인테리어 형식이 올바르지 않아요.');
      structures.normalize(current(), data.structure);
      if (bound !== current()) bind();
      record(); applyStructure(data.structure, { record: false }); finishes.restore(data.finishes ?? null); tileMethod = data.tileMethod ?? 'overlay';
      renderStructurePanel(); renderFinishPanel(); scheduleEstimate();
    },
    open(nextTab = 'structure', roomId = null) { tab = nextTab; hooks.setMode('interior'); if (roomId && rooms().some(r => r.id === roomId)) chooseRoom(roomId); },
    get tab() { return tab; },
    refreshFurniture() { if (active) afterFurniture(); else scheduleEstimate(); },
    // Test and automation surface (dev only).
    api: {
      segments: () => segments(), structure: () => structure(), apply: next => applyStructure(next), demolish: id => toggleDemolish(segments().find(s => s.id === id)),
      addPartition: (a, b, type = 'drywall', door = false) => { partitionType = type; partitionDoor = door; return addPartition(a, b); },
      move: (target, offset) => moveWall(target, offset), undo, redo, setTab, setTool, setView,
      faces: () => [...finishes.faces.values()].map(f => ({ key: f.key, kind: f.kind, roomId: f.roomId, label: f.label, area: f.area })),
      applyFinish: (keys, id) => { record(); return finishes.apply(keys, id); }, preview: (keys, id) => finishes.setPreview(keys, id), clearPreview: () => finishes.clearPreview(),
      chooseRoom, chooseFace, setScope: s => { finishScope = s; renderFinishPanel(); },
      furniture: () => fnItems().map(i => ({ id: i.id, kind: i.kind, title: i.title, x: i.x, z: i.z, angle: i.angle, room: fnApi().roomOf(i), price: productOf(i).price })),
      addFurniture: kind => addFurniture(kind), selectFurniture, rotateFurniture: id => rotateFurniture(id), removeFurniture: id => removeFurniture(id), moveFurniture: (id, x, z) => { record(); fnApi().move(id, { x, z }, true); afterFurniture(); },
      estimate: () => computeEstimate(), quantities: () => ({ structure: structures.quantities(current()), finishes: finishes.quantities() }), quote: () => makeQuote(), openQuote: () => openQuote(), library: () => library.inspect(), ready: id => library.load(id),
      inspect: () => ({ lastApply, tab, tool, view, selected, structure: structure(), structureState: structures.inspect(current()), finishes: finishes.inspect(), history: { past: history.past.length, future: history.future.length }, clip: renderer.clippingPlanes.map(p => p.constant) }),
    },
  };
}
