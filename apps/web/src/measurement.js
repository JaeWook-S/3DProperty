import { formatDimension } from './furniture.js';

const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};

export function measurementDimensions(record) {
  const dimensions = { width: record?.width_m, depth: record?.depth_m, height: record?.height_m };
  if (record?.status !== 'ok' || !Object.values(dimensions).every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)) {
    return { width: null, depth: null, height: null };
  }
  return dimensions;
}

export function renderMeasurementResult(host, job, imageName) {
  const objects = Array.isArray(job.result?.objects) ? job.result.objects : [];
  host.replaceChildren();
  host.hidden = false;
  host.dataset.outcome = job.result?.outcome || 'unknown';
  host.append(node('h4', '이미지 측정 결과'), node('p', imageName, 'result-file'));
  host.append(node('p', '사진에서 보이는 표면을 기준으로 한 모델 추정값입니다. 실제 가구의 전체 치수와 다를 수 있습니다.', 'muted'));

  if (objects.length) {
    const unitLabel = node('label', '표시 단위 ', 'unit-label');
    unitLabel.htmlFor = 'measurement-unit';
    const select = node('select');
    select.id = 'measurement-unit';
    for (const unit of ['m', 'cm', 'mm']) {
      const option = node('option', unit);
      option.value = unit;
      select.append(option);
    }
    select.value = 'cm';
    select.disabled = !objects.some(record => measurementDimensions(record).width !== null);
    unitLabel.append(select);
    const cards = node('div', undefined, 'measurement-objects');
    const renderObjects = () => {
      cards.replaceChildren();
      objects.forEach((record, index) => {
        const card = node('article', undefined, 'measurement-object');
        card.append(node('h4', `가구 ${index + 1}${record?.label ? ` · ${record.label}` : ''}`));
        const dimensions = measurementDimensions(record);
        const values = node('div', undefined, 'dimensions');
        for (const [axis, label] of [['width', '너비'], ['depth', '깊이'], ['height', '높이']]) {
          const cell = node('div');
          cell.append(node('span', label), node('strong', formatDimension(dimensions[axis], select.value)));
          values.append(cell);
        }
        card.append(values);
        if (dimensions.width === null) card.append(node('p', record?.reason || '이 가구는 치수를 계산하지 못했습니다.', 'muted'));
        cards.append(card);
      });
    };
    select.addEventListener('change', renderObjects);
    renderObjects();
    host.append(unitLabel, cards);
  } else {
    host.append(node('p', '가구를 찾지 못했습니다. 가구 전체가 잘 보이는 사진을 선택해 주세요.', 'muted'));
  }
  const raw = node('details', undefined, 'raw-json');
  raw.append(node('summary', '서버 측정 결과 JSON 보기'), node('pre', JSON.stringify(job.result, null, 2)));
  host.append(raw);
}
