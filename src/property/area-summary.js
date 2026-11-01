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
  const details = node('details');
  details.append(node('summary', '면적 기준 · 아키스케치'));
  details.append(node('p', '전용면적은 세대 내부, 공급면적은 전용면적에 주거 공용면적을 더한 값입니다. 발코니 확장 여부와 관계없이 같은 타입의 등록 면적을 표시합니다.'));
  const sources = node('p', '도면 출처: ');
  for (const [index, floorplan] of area.floorplans.entries()) {
    if (index) sources.append(' · ');
    const link = node('a', floorplan.label);
    link.href = `https://planner.archisketch.com/?mapId=${floorplan.id}&flip=0`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    sources.append(link);
  }
  sources.append(` (${catalog.source.checkedAt} 확인)`);
  details.append(sources);
  host.append(list, details);
}
