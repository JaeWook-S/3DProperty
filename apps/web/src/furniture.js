export const SCHEMA = 'cortex.furniture.v0';
export const MAX_FILE_BYTES = 1024 * 1024;
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const string = (v) => typeof v === 'string' && v.trim().length > 0;
const nullableString = (v) => v === null || string(v);
const DIAGNOSTIC_FIELDS = ['geometry_status', 'dimensions_status', 'code', 'message', 'missing', 'scene_point_cloud_is_furniture_asset'];
// Contract C.2/C.3: exact dimensions codes only; geometry/dependency failures are separate.
const DIMENSION_CODE_STATUS = {
  DIMENSIONS_SUCCEEDED: 'succeeded',
  DIMENSIONS_UNRESOLVED: 'unresolved',
  DIMENSIONS_INFERENCE_FAILED: 'failed',
  INVALID_DIMENSIONS_OUTPUT: 'failed',
  OBJECT_NOT_DETECTED: 'failed',
};

export const BASIS_LABELS = { measured: '실측', catalog: '제품 규격', estimated: '모델 추정', manual: '직접 입력' };
export const SCALE_LABELS = { 'metric-estimated': '미터 단위 추정', 'reference-calibrated': '기준 길이로 보정', measured: '실측 기준', catalog: '제품 규격 기준', manual: '직접 입력한 규격', unresolved: '척도 미정' };

export function isSafeModelUri(value) {
  if (!string(value) || /[\u0000-\u0020\\]/u.test(value) || value.startsWith('//')) return false;
  try {
    const url = new URL(value, 'https://local.invalid/assets/');
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

export function validateFurniture(asset) {
  const errors = [], review = [];
  const add = (code, path, message) => errors.push({ code, path, message });
  if (!object(asset)) return { status: 'invalid', errors: [{ code: 'root', path: '$', message: '가구 한 개를 담은 JSON 객체가 필요합니다.' }], review, asset: null, metricReady: false };
  for (const key of DIAGNOSTIC_FIELDS) {
    if (Object.hasOwn(asset, key)) add('diagnostics_location', key, `진단 필드 위치가 잘못되었습니다. ${key}는 diagnostics.${key} 안에 기록하세요. 자동으로 이동하지 않습니다.`);
  }
  if (asset.schema_version !== SCHEMA) add('schema', 'schema_version', `지원 형식은 ${SCHEMA}입니다.`);
  for (const key of ['asset_id', 'revision']) if (!string(asset[key])) add('required', key, '비어 있지 않은 식별자가 필요합니다.');
  if (asset.units !== 'm') add('units', 'units', '저장 단위는 m이어야 합니다. cm/mm 값을 미터로 바꾼 후 가져오세요.');
  for (const [key, expected] of Object.entries({ coordinate_space: 'gltf-y-up', front_axis: '+Z', pivot: 'bottom-center' })) {
    if (asset[key] !== expected) add('coordinates', key, `현재 연동 형식은 ${expected}입니다.`);
  }
  if (!object(asset.dimensions_m)) add('dimensions', 'dimensions_m', '폭·깊이·높이 객체가 필요합니다.');
  else for (const axis of ['width', 'depth', 'height']) {
    const value = asset.dimensions_m[axis];
    if (!Object.hasOwn(asset.dimensions_m, axis)) add('missing_dimension', `dimensions_m.${axis}`, '치수 필드가 없습니다. 미정인 경우 null로 명시하세요.');
    else if (value === null) review.push(`${axis}: 치수가 미정입니다.`);
    else if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) add('invalid_dimension', `dimensions_m.${axis}`, '유한한 양수 또는 미정(null)만 허용합니다.');
  }
  if (!Object.hasOwn(BASIS_LABELS, asset.dimension_basis)) add('basis', 'dimension_basis', '실측·제품 규격·모델 추정·직접 입력 중 치수 근거를 지정하세요.');
  if (!Object.hasOwn(SCALE_LABELS, asset.scale_status)) add('scale', 'scale_status', '지원하지 않는 척도 상태입니다.');
  else if (asset.scale_status === 'unresolved') review.push('척도가 정해지지 않아 실제 길이나 배치 규격으로 사용할 수 없습니다.');
  else {
    const compatible = { estimated: ['metric-estimated', 'reference-calibrated'], measured: ['measured'], catalog: ['catalog'], manual: ['manual'] };
    if (compatible[asset.dimension_basis] && !compatible[asset.dimension_basis].includes(asset.scale_status)) add('basis_scale_mismatch', 'scale_status', '치수 근거와 척도 상태가 일치하지 않습니다.');
  }
  if (!(asset.confidence === null || (typeof asset.confidence === 'number' && Number.isFinite(asset.confidence) && asset.confidence >= 0 && asset.confidence <= 1))) add('confidence', 'confidence', '신뢰도는 null 또는 0~1 사이의 모델 출력값이어야 합니다.');
  if (!['box-proxy', 'glb'].includes(asset.geometry_kind)) add('geometry', 'geometry_kind', '현재 지원 형상은 box-proxy 또는 glb입니다.');
  if (asset.model_uri !== null && !isSafeModelUri(asset.model_uri)) add('uri', 'model_uri', '모델 경로는 null, 상대 경로 또는 HTTP(S) URL이어야 합니다.');
  if (asset.geometry_kind === 'glb' && asset.model_uri === null) add('missing_model', 'model_uri', 'glb 형식에는 모델 경로가 필요합니다. 모델이 없으면 box-proxy를 사용하세요.');
  if (!(asset.model_sha256 === null || (typeof asset.model_sha256 === 'string' && /^[0-9a-f]{64}$/i.test(asset.model_sha256)))) add('hash', 'model_sha256', '모델 해시는 null 또는 64자리 SHA256 문자열이어야 합니다.');
  if (!object(asset.provenance)) add('provenance', 'provenance', '입력과 추정 방법의 출처가 필요합니다.');
  else {
    const p = asset.provenance;
    if (!string(p.sample_id)) add('provenance', 'provenance.sample_id', '입력 표본 식별자가 필요합니다.');
    for (const key of ['method', 'implementation_revision', 'weights_id', 'scale_reference_description']) if (!nullableString(p[key])) add('provenance', `provenance.${key}`, '문자열 또는 null로 명시하세요.');
    if (typeof p.scale_reference_used !== 'boolean') add('provenance', 'provenance.scale_reference_used', '기준 길이 사용 여부를 true/false로 지정하세요.');
    if (p.scale_reference_used === true && !string(p.scale_reference_description)) add('reference', 'provenance.scale_reference_description', '척도 보정에 사용한 기준 길이의 출처를 적어 주세요.');
    if (asset.scale_status === 'reference-calibrated' && p.scale_reference_used !== true) add('reference', 'provenance.scale_reference_used', '기준 길이 보정 상태에는 기준 사용 기록이 필요합니다.');
    if (asset.dimension_basis === 'estimated' && !string(p.method)) add('method', 'provenance.method', '모델 추정에는 추정 방법의 이름이 필요합니다.');
  }
  // Optional S2 diagnostics never turn scene geometry into usable furniture dimensions.
  if (Object.hasOwn(asset, 'diagnostics')) {
    const diagnostics = asset.diagnostics;
    if (!object(diagnostics)) add('diagnostics', 'diagnostics', '처리 상태와 사유는 객체로 제공해야 합니다.');
    else {
      for (const key of ['geometry_status', 'dimensions_status', 'code', 'message']) {
        if (Object.hasOwn(diagnostics, key) && !string(diagnostics[key])) add('diagnostics', `diagnostics.${key}`, '비어 있지 않은 상태 또는 사유 문자열이 필요합니다.');
      }
      if (Object.hasOwn(diagnostics, 'missing') && (!Array.isArray(diagnostics.missing) || !diagnostics.missing.every(string))) add('diagnostics', 'diagnostics.missing', '부족한 근거는 문자열 목록으로 제공해야 합니다.');
      if (Object.hasOwn(diagnostics, 'scene_point_cloud_is_furniture_asset') && typeof diagnostics.scene_point_cloud_is_furniture_asset !== 'boolean') add('diagnostics', 'diagnostics.scene_point_cloud_is_furniture_asset', '장면 점군의 가구 자산 여부는 true/false로 지정하세요.');
      if (!Object.hasOwn(diagnostics, 'dimensions_status')) review.push('치수 처리 상태가 없습니다. diagnostics.dimensions_status를 확인하기 전에는 배치 규격으로 사용할 수 없습니다.');
      if (string(diagnostics.dimensions_status) && diagnostics.dimensions_status !== 'succeeded') review.push('치수 처리 결과가 성공으로 보고되지 않아 배치 규격으로 사용할 수 없습니다.');
      if (string(diagnostics.code) && string(diagnostics.dimensions_status) && Object.hasOwn(DIMENSION_CODE_STATUS, diagnostics.code)) {
        const expected = DIMENSION_CODE_STATUS[diagnostics.code];
        if (diagnostics.dimensions_status !== expected) review.push(`진단 코드 ${diagnostics.code}와 치수 상태 ${diagnostics.dimensions_status}가 일치하지 않습니다. 이 코드의 치수 상태는 ${expected}여야 합니다. 원본을 확인하세요.`);
      }

    }
  }
  return { status: errors.length ? 'invalid' : review.length ? 'review' : 'valid', errors, review, asset: errors.length ? null : asset, metricReady: !errors.length && !review.length };
}

export function parseFurniture(text) {
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) return { status: 'invalid', errors: [{ code: 'file_size', path: '$', message: 'JSON 파일은 1MB 이하로 가져오세요.' }], review: [], asset: null, metricReady: false };
  try { return validateFurniture(JSON.parse(text.replace(/^\uFEFF/, ''))); }
  catch { return { status: 'invalid', errors: [{ code: 'json', path: '$', message: 'JSON 문법을 읽을 수 없습니다. 쉼표와 따옴표를 확인하세요.' }], review: [], asset: null, metricReady: false }; }
}

export function formatDimension(meters, unit) {
  if (meters === null) return '미정';
  const factor = { m: 1, cm: 100, mm: 1000 }[unit];
  if (!factor) throw new Error('Unsupported display unit');
  return `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 }).format(meters * factor)} ${unit}`;
}
