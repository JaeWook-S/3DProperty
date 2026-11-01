import {viewerBaseForPage} from '../../../src/property/service-endpoints.js';
import './style.css';
import { parseFurniture, MAX_FILE_BYTES, formatDimension, BASIS_LABELS, SCALE_LABELS } from './furniture.js';
import { VARIANTS, DEFAULT_VARIANT, buildViewerUrl } from './viewer-url.js';
import { createMapService } from './map-service.js';
import { setupFurnitureImageRegistration } from '../../../src/walkthrough/furniture-registration.js';
let measurementModule;
const measurement=()=>import('./measurement.js').then(module=>(measurementModule=module));
const $ = (id) => document.getElementById(id);
const node = (tag, text, className) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };
const viewerBase = viewerBaseForPage(location.href, import.meta.env.VITE_VIEWER_BASE_URL).href;
const serviceHome = new URL(new URL(viewerBase).searchParams.get('serviceUrl'));
const homeURL=new URL(viewerBase);homeURL.searchParams.set('studio','1');
document.querySelector('.brand').href = homeURL.href;
const homeNav=document.createElement('nav');homeNav.setAttribute('aria-label','주요 메뉴');homeNav.className='service-home-nav';
for(const [label,tours] of [['홈',false],['집들이',true]]){const link=document.createElement('a'),url=new URL(homeURL);if(tours)url.searchParams.set('tours','all');link.href=url.href;link.textContent=label;homeNav.append(link);}
document.querySelector('.site-header').append(homeNav);
let currentResult = null, currentSource = '', unit = 'cm', loadSequence = 0;
const mapService=createMapService({host:$('map-service'),viewerBase});
const initialQuery=new URLSearchParams(location.search).get('query');
if(initialQuery)mapService.ready.then(()=>{const input=$('place-query');if(input){input.value=initialQuery;$('place-search').requestSubmit();}});
function showPanel(panel) {
  for (const id of ['space', 'furniture']) { const active = id === panel; $(`${id}-panel`).hidden = !active; $(`${id}-tab`).classList.toggle('active', active); if (active) $(`${id}-tab`).setAttribute('aria-current', 'page'); else $(`${id}-tab`).removeAttribute('aria-current'); }
}
$('space-tab').addEventListener('click', () => {showPanel('space');mapService.resize();});
$('furniture-tab').addEventListener('click', () => showPanel('furniture'));
setupFurnitureImageRegistration({
  button: $('register-furniture'), input: $('furniture-image-file'), panel: $('furniture-image-preview'),
  preview: $('furniture-image-preview').querySelector('img'), name: $('furniture-image-name'),
  metadata: $('furniture-image-metadata'), status: $('furniture-image-status'),
  onMeasurementStart() {
    measurementModule?.disposeMeasurementResult($('image-measurement-result'));
    $('image-measurement-result').replaceChildren();
    $('image-measurement-result').hidden = true;
  },
  async onMeasurementComplete(job, file) {
    const module=await measurement();
    module.renderMeasurementResult($('image-measurement-result'), job, file.name, { viewerBase,
      variant: mapService.selection().sampleVariant || DEFAULT_VARIANT });
  },
});
window.addEventListener('pagehide', () => measurementModule?.disposeMeasurementResult($('image-measurement-result')), { once: true });
function pair(list, label, value) { list.append(node('dt', label), node('dd', value)); }
const PROCESS_LABELS = { succeeded: '성공', failed: '실패', unresolved: '미정', pending: '진행 대기', not_run: '실행 안 됨' };
const MISSING_LABELS = {
  object_segmentation_mask: '가구 객체 분할 마스크',
  object_local_axes: '가구의 폭·깊이·높이 방향',
  full_object_extent_validation: '가려진 부분을 포함한 전체 크기 검증',
  independent_dimensions_ground_truth: '비교할 독립 정답 치수',
};
function renderDiagnostics(diagnostics) {
  const section = node('section', undefined, 'diagnostics');
  section.setAttribute('aria-label', '처리 상태와 미정·실패 사유');
  section.append(node('h4', '처리 상태와 사유'));
  const statuses = node('dl', undefined, 'provenance');
  for (const [key, label] of [['geometry_status', '기하 처리'], ['dimensions_status', '가구 치수']]) {
    if (diagnostics[key]) pair(statuses, label, Object.hasOwn(PROCESS_LABELS, diagnostics[key]) ? PROCESS_LABELS[diagnostics[key]] : `확인 필요 (${diagnostics[key]})`);
  }
  section.append(statuses);
  if (diagnostics.geometry_status === 'succeeded') section.append(node('p', '기하 처리 성공은 가구 치수 확정이나 배치 완료를 뜻하지 않습니다.'));
  if (diagnostics.scene_point_cloud_is_furniture_asset === false) section.append(node('p', '장면 점군은 배치용 가구 모델이 아닙니다.'));
  if (diagnostics.code) section.append(node('p', `결과 코드: ${diagnostics.code}`));
  if (diagnostics.message) section.append(node('p', diagnostics.message));
  if (diagnostics.missing?.length) {
    section.append(node('p', '추가로 필요한 근거'));
    const list = node('ul');
    for (const item of diagnostics.missing) list.append(node('li', Object.hasOwn(MISSING_LABELS, item) ? MISSING_LABELS[item] : item));
    section.append(list);
  }
  return section;
}

function renderResult() {
  const result = currentResult;
  const host = $('result'); host.replaceChildren(); host.dataset.status = result.status;
  host.append(node('p', currentSource, 'result-file'));
  if (result.status === 'invalid') {
    host.append(node('span', '파일 확인 필요', 'badge error'), node('h3', '가구 결과를 읽지 못했어요.'));
    const list = node('ul', undefined, 'error-list');
    for (const item of result.errors) list.append(node('li', `${item.message} (${item.path})`));
    host.append(list, node('p', '파일을 수정한 후 다시 선택해 주세요. 이전 결과를 배치하거나 저장하지 않았습니다.', 'muted')); return;
  }
  const asset = result.asset;
  host.append(node('span', result.metricReady ? '치수 형식 확인' : '검토 필요 · 배치 규격 미정', `badge ${result.metricReady ? '' : 'review'}`));
  host.append(node('h3', asset.asset_id), node('p', `${BASIS_LABELS[asset.dimension_basis]} · ${SCALE_LABELS[asset.scale_status]}`, 'basis-line'));
  if (asset.revision === 'example-only') host.append(node('p', '로컬 형식 확인용 예제입니다. 모델 추론이나 실제 가구 실측 결과가 아닙니다.', 'example-banner'));
  const label = node('label', '표시 단위 ', 'unit-label'); label.htmlFor = 'display-unit';
  const select = node('select'); select.id = 'display-unit';
  for (const v of ['m', 'cm', 'mm']) { const o = node('option', v); o.value = v; o.selected = v === unit; select.append(o); }
  select.disabled = !result.metricReady;
  select.addEventListener('change', () => { unit = select.value; renderResult(); }); label.append(select); host.append(label);
  const dims = node('div', undefined, 'dimensions');
  for (const [axis, title] of [['width', '폭'], ['depth', '깊이'], ['height', '높이']]) { const cell = node('div'); cell.append(node('span', title), node('strong', result.metricReady ? formatDimension(asset.dimensions_m[axis], unit) : '미정')); dims.append(cell); }
  host.append(dims);
  if (result.review.length) { const list = node('ul', undefined, 'review-list'); for (const reason of result.review) list.append(node('li', reason)); host.append(list); }
  if (asset.diagnostics) host.append(renderDiagnostics(asset.diagnostics));
  const details = node('dl', undefined, 'provenance');
  pair(details, '형상', asset.geometry_kind === 'box-proxy' ? (result.metricReady ? '치수 박스 규격 · 가구 모델 없음' : '박스 규격 미정 · 가구 모델 없음') : 'GLB 경로 제공 · 모델은 아직 불러오지 않음');
  pair(details, '모델 신뢰도', asset.confidence === null ? '제공되지 않음' : `${asset.confidence} · 모델 출력값, 치수 정확도 보증 아님`);
  pair(details, '입력 표본', asset.provenance.sample_id);
  pair(details, '추정 방법', asset.provenance.method || '해당 없음');
  pair(details, '구현 버전', asset.provenance.implementation_revision || '제공되지 않음');
  pair(details, '모델 가중치', asset.provenance.weights_id || '해당 없음');
  pair(details, '결과 버전', asset.revision);
  pair(details, '척도 기준', asset.provenance.scale_reference_used ? asset.provenance.scale_reference_description : '별도 기준 길이 사용 기록 없음');
  if (asset.model_uri) pair(details, '모델 경로', asset.model_uri);
  host.append(details, node('p', '공간 배치는 준비 중입니다. 확인한 치수는 아직 공간 뷰어에 전달되지 않습니다.', 'next-stage'));
  const raw = node('details', undefined, 'raw-json'); raw.append(node('summary', '원본 결과와 출처 보기'), node('pre', JSON.stringify(asset, null, 2))); host.append(raw);
}
function useText(text, source) { currentSource = source; currentResult = parseFurniture(text); renderResult(); }
function fileError(message, source) { currentSource = source; currentResult = { status: 'invalid', errors: [{ path: '$', message }] }; renderResult(); }
$('asset-file').addEventListener('change', async (event) => {
  const file = event.target.files[0]; if (!file) return;
  const seq = ++loadSequence;
  if (file.size > MAX_FILE_BYTES) { fileError('JSON 파일은 1MB 이하로 가져오세요.', file.name); event.target.value = ''; return; }
  try { const text = await file.text(); if (seq === loadSequence) useText(text, file.name); }
  catch { if (seq === loadSequence) fileError('파일을 읽지 못했습니다. 다시 선택해 주세요.', file.name); }
  event.target.value = '';
});
async function example(name, title) {
  const seq = ++loadSequence;
  try { const response = await fetch(`${import.meta.env.BASE_URL}examples/${name}.json`); if (!response.ok) throw new Error('example'); const text = await response.text(); if (seq === loadSequence) useText(text, title); }
  catch { if (seq === loadSequence) fileError('예제 파일을 열지 못했습니다. 새로고침해 주세요.', title); }
}
$('load-example').addEventListener('click', () => example('manual-table', '직접 입력한 형식 예제 · 추론 결과 아님'));
$('load-unresolved').addEventListener('click', () => example('unresolved', '척도 미정 형식 예제 · 추론 결과 아님'));
