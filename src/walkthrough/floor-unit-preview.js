import {getBuildingUnits, getFloorUnits, getUnitModelVariants, variantForUnit} from '../property/unit-catalog.js';

const IMAGES = {
  '112a-basic-archisketch': '112a-archisketch-basic.png',
  '112a-expanded-archisketch': '112a-archisketch-expanded.png',
  '168c-basic-archisketch': '168c-archisketch-basic.png',
  '168c-expanded-archisketch': '168c-archisketch-expanded.png',
};
const variantLabel = key => key.includes('-basic-') ? '기본형' : '확장형';
export function previewFloorCounts(building) {
  const counts = new Map();
  for (const row of getBuildingUnits(building)) if (getUnitModelVariants(row).length) counts.set(row.floor, (counts.get(row.floor) || 0) + 1);
  return counts;
}

// A catalog list beside the cutaway, never a spatial arrangement on its floor plate.
// Only the existing PNG previews are requested here. Models load on explicit navigation.
export function installFloorUnitPreview({host, serviceBase, onChooseUnit, onChooseFloor, onOpen}) {
  host.innerHTML = `<div class="floor-units-heading"><p>FLOOR PREVIEW</p><h2 id="floor-units-title">층별 호수 미리보기</h2><span id="floor-units-count" role="status"></span></div><label class="floor-preview-jump" for="floor-preview-jump">미리보기 있는 층 <select id="floor-preview-jump" disabled><option value="">동을 먼저 선택하세요</option></select></label><p class="floor-units-basis">호수순 목록입니다. 실제 배치·방향·확장 여부는 미확인입니다.</p><div id="floor-unit-list" role="list" aria-label="선택층 등록 호수"></div><p id="floor-units-empty">동과 층을 고르면 등록된 호수와 준비된 평면을 볼 수 있어요.</p>`;
  const list = host.querySelector('#floor-unit-list'), jump = host.querySelector('#floor-preview-jump');
  let lastKey = '', lastBuilding, lastFloorKey = '';
  jump.onchange = () => { if (jump.value) onChooseFloor(Number(jump.value)); };
  host.addEventListener('click', event => {
    const button = event.target.closest('button[data-unit]');
    if (!button || !host.contains(button)) return;
    onChooseUnit(button.dataset.unit, button.dataset.variant);
    if (button.dataset.open) onOpen(button.dataset.open);
  });
  function button(text, row, action, variant) {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = text;
    node.dataset.unit = row.unit; node.dataset.focusKey = `${row.unit}:${action}:${variant || ''}`;
    if (variant) node.dataset.variant = variant;
    if (action === 'plan' || action === '3d') node.dataset.open = action;
    return node;
  }
  return {render(selection) {
    const counts = previewFloorCounts(selection.building);
    if (lastBuilding !== selection.building) {
      lastBuilding = selection.building; jump.replaceChildren();
      const option = document.createElement('option'); option.value = ''; option.textContent = !selection.building ? '동을 먼저 선택하세요' : counts.size ? '표시된 층으로 이동' : '이 동은 실내 준비 중'; jump.append(option);
      for (const [floor, count] of [...counts].sort((a,b) => a[0]-b[0])) { const o = document.createElement('option'); o.value = floor; o.textContent = `${floor}층 · ${count}호 평면`; jump.append(o); }
      jump.disabled = !counts.size;
    }
    jump.value = counts.has(selection.floor) ? String(selection.floor) : '';
    const key = JSON.stringify([selection.building, selection.floor, selection.unit, selection.sampleVariant]);
    if (key === lastKey) return;
    lastKey = key;
    const focused = host.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
    const floorKey = `${selection.building}/${selection.floor}`;
    const scrollTop = floorKey === lastFloorKey ? host.scrollTop : 0; lastFloorKey = floorKey;
    const rows = getFloorUnits(selection.building, selection.floor), ready = rows.filter(row => getUnitModelVariants(row).length);
    host.querySelector('#floor-units-title').textContent = selection.building && selection.floor ? `${selection.building}동 · ${selection.floor}층` : '층별 호수 미리보기';
    host.querySelector('#floor-units-count').textContent = rows.length ? `${rows.length}호 중 ${ready.length}호 평면 준비` : '';
    const empty = host.querySelector('#floor-units-empty'); empty.hidden = !!rows.length;
    empty.textContent = selection.floor ? '이 층에 등록된 세대가 없습니다. 다른 층을 선택해 주세요.' : '동과 층을 고르면 등록된 호수와 준비된 평면을 볼 수 있어요.';
    list.replaceChildren();
    for (const row of [...rows].sort((a,b) => a.unit.localeCompare(b.unit, 'ko', {numeric:true}))) {
      const allowed = getUnitModelVariants(row), variant = variantForUnit(row, selection.sampleVariant), selected = row.unit === selection.unit;
      const card = document.createElement('article'); card.className = `floor-unit-card${allowed.length ? ' ready' : ' pending'}`; card.role = 'listitem'; card.dataset.unit = row.unit; card.dataset.selected = String(selected);
      const select = button('', row, 'select', variant); select.className = 'floor-unit-select'; select.setAttribute('aria-pressed', String(selected)); select.setAttribute('aria-label', `${row.unit}호 · ${row.type} · ${allowed.length ? row.modelType+' 평면 선택' : '실내 준비 중'}`);
      if (allowed.length) {
        const image = document.createElement('img'); image.src = new URL(`previews/${IMAGES[variant]}`, serviceBase).href; image.alt = `${row.modelType} ${variantLabel(variant)} 비교 평면`; image.loading = 'lazy'; image.decoding = 'async'; image.width = 124; image.height = 94;
        image.onerror = () => { image.hidden = true; const note = document.createElement('small'); note.className = 'floor-preview-error'; note.textContent = '이미지 로딩 실패 · 2D 평면으로 확인'; select.prepend(note); };
        select.append(image);
      }
      const caption = document.createElement('span'); caption.className = 'floor-unit-caption';
      const name = document.createElement('strong'); name.textContent = `${row.unit}호`; const type = document.createElement('span'); type.textContent = row.type;
      const state = document.createElement('small'); state.textContent = allowed.length ? `${row.modelType} 비교 평면` : '실내 준비 중'; caption.append(name,type,state); select.append(caption); card.append(select);
      if (allowed.length) {
        const choices = document.createElement('div'); choices.className = 'floor-unit-variants'; choices.role = 'group'; choices.setAttribute('aria-label', `${row.unit}호 비교할 평면`);
        for (const key of allowed) { const choice = button(variantLabel(key), row, 'variant', key); choice.setAttribute('aria-pressed', String(variant === key)); choices.append(choice); }
        card.append(choices);
        if (selected) { const links = document.createElement('div'); links.className = 'floor-unit-actions'; links.append(button('2D 평면',row,'plan',variant),button('실내 3D →',row,'3d',variant)); card.append(links); }
      }
      list.append(card);
    }
    host.scrollTop = scrollTop;
    // Keep newly selected actions visible in the desktop panel; never move the mobile page.
    if (matchMedia('(min-width:651px)').matches && selection.unit) list.querySelector('[data-selected="true"]')?.scrollIntoView({block:'nearest'});
    if (focused) [...host.querySelectorAll('button')].find(node => node.dataset.focusKey === focused)?.focus({preventScroll:true});
  }};
}
