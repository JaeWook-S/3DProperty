import { SURFACE_MATERIALS } from './surface-material-library.js';
import './material-dock.css';

export function createMaterialDock({ editor, renderer, camera, onOpen, onSave, onRestore }) {
  const toggle = document.createElement('button');
  toggle.id = 'material-toggle'; toggle.type = 'button'; toggle.textContent = '마감 바꾸기';
  toggle.setAttribute('aria-controls', 'material-dock'); toggle.setAttribute('aria-expanded', 'false');
  renderer.domElement.parentElement.append(toggle);
  const dock = document.createElement('section'); dock.id = 'material-dock'; dock.hidden = true;
  dock.setAttribute('aria-label', '선택한 표면의 마감');
  dock.innerHTML = `<div class="material-heading"><div><span class="material-eyebrow">SURFACE</span><strong id="material-target-label">벽이나 바닥을 선택하세요</strong></div><button id="material-close" type="button" aria-label="마감 편집 닫기">닫기 ×</button></div>
    <div id="material-cards" role="group" aria-label="선택한 면의 재질"></div>
    <div class="material-footer"><p id="material-status" role="status" aria-live="polite"></p><div class="material-actions"><button id="material-pick-center" type="button">가운데 면 선택</button><button id="material-restore" type="button">저장 불러오기</button><button id="material-save" type="button">마감·배치 저장</button></div></div>`;
  document.body.append(dock);
  const el = id => dock.querySelector(`#${id}`), cards = new Map();
  for (const preset of SURFACE_MATERIALS) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.material = preset.id;
    button.className = 'material-card'; button.setAttribute('aria-pressed', 'false');
    const swatch = document.createElement('span'); swatch.className = `material-swatch material-swatch-${preset.swatch}`; swatch.setAttribute('aria-hidden', 'true');
    const name = document.createElement('strong'); name.textContent = preset.name;
    const detail = document.createElement('small'); detail.textContent = preset.detail;
    button.append(swatch, name, detail); button.onclick = () => editor.apply(preset.id);
    cards.set(preset.id, button); el('material-cards').append(button);
  }
  let savedNotice = '', pointer;
  const allowed = () => document.body.dataset.loadState === 'ready' && document.body.dataset.studioMode !== 'complex';
  function setOpen(value) { savedNotice = ''; if (value) onOpen(); editor.setEditing(value); if (!value) toggle.focus({ preventScroll: true }); }
  toggle.onclick = () => setOpen(!editor.editing);
  el('material-close').onclick = () => setOpen(false);
  el('material-pick-center').onclick = () => { savedNotice = ''; editor.pick(camera, { x: 0, y: 0 }, renderer.clippingPlanes); };
  el('material-save').onclick = () => { savedNotice = onSave() || ''; sync(); };
  el('material-restore').onclick = async () => { savedNotice = ''; savedNotice = await onRestore() || ''; sync(); };
  renderer.domElement.addEventListener('pointerdown', event => { if (editor.editing && event.button === 0) pointer = { x: event.clientX, y: event.clientY, id: event.pointerId }; });
  renderer.domElement.addEventListener('pointercancel', () => { pointer = null; });
  renderer.domElement.addEventListener('pointerup', event => {
    const start = pointer; pointer = null;
    if (!editor.editing || !start || start.id !== event.pointerId || Math.hypot(start.x - event.clientX, start.y - event.clientY) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect(); savedNotice = '';
    editor.pick(camera, { x: (event.clientX - rect.left) / rect.width * 2 - 1, y: -(event.clientY - rect.top) / rect.height * 2 + 1 }, renderer.clippingPlanes);
  });
  document.addEventListener('keydown', event => { if (editor.editing && event.key === 'Escape') { event.preventDefault(); setOpen(false); } });
  function sync() {
    const state = editor.state();
    if (!allowed() && state.editing) { editor.setEditing(false); return; }
    toggle.hidden = !allowed() || state.loading;
    toggle.setAttribute('aria-expanded', String(state.editing));
    document.body.dataset.materialEditing = String(state.editing);
    document.body.dataset.materialState = state.pending ? 'loading' : state.error ? 'error' : 'ready';
    dock.hidden = !state.editing;
    el('material-target-label').textContent = state.selected?.label || '벽이나 바닥을 선택하세요';
    for (const [id, button] of cards) {
      button.disabled = !state.selected || state.loading;
      button.setAttribute('aria-pressed', String(Boolean(state.selected) && state.material === id));
    }
    el('material-save').disabled = el('material-restore').disabled = state.pending || state.loading;
    el('material-status').textContent = state.error || (state.pending ? '재질을 불러오는 중…' : savedNotice || (state.selected ? '선택한 면에만 적용합니다. 변경한 마감은 저장 버튼으로 이 브라우저에 보관하세요.' : '3D 화면의 벽 한쪽 면 또는 바닥을 선택하세요. 가구와 상판은 아직 지원하지 않아요.'));
  }
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['data-studio-mode', 'data-load-state'] });
  sync(); return { sync };
}
