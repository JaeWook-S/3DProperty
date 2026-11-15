import catalog from './acro-unit-areas.json';
import './area-summary.css';

const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};

// Registered areas are metadata, not the mesh footprint or the sum of room polygons.
// Basic/expanded layouts share the same type's supply and exclusive areas.
export function renderAreaSummary(host, unitType) {
  const area = catalog.units[unitType];
  host.classList.add('area-summary');
  host.setAttribute('aria-label', `${unitType} 공급면적과 전용면적`);
  host.setAttribute('aria-live', 'polite');
  host.replaceChildren();
  if (!area) {
    host.append(node('p', '면적 확인 중'));
    return;
  }
  const list = node('dl', undefined, 'area-summary-values');
  for (const [label, value] of [['공급면적', area.supplyM2], ['전용면적', area.exclusiveM2]]) {
    const cell = node('div');
    const description = node('dd');
    description.append(node('strong', `${value.toFixed(2)}㎡`), node('span', `약 ${(value * 121 / 400).toFixed(2)}평`));
    cell.append(node('dt', label), description);
    list.append(cell);
  }
  host.append(list);
}
