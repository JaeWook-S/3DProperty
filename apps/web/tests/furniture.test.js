import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateFurniture, parseFurniture, formatDimension, isSafeModelUri, MAX_FILE_BYTES } from '../src/furniture.js';
import { buildViewerUrl } from '../src/viewer-url.js';
const fixture = () => JSON.parse(readFileSync(new URL('../public/examples/manual-table.json', import.meta.url), 'utf8'));
const codes = (asset) => validateFurniture(asset).errors.map((x) => x.code);
test('manual metric box without GLB or invented confidence remains valid', () => {
 const a = fixture(), result = validateFurniture(a); assert.equal(result.status, 'valid'); assert.equal(result.metricReady, true); assert.equal(result.asset.confidence, null); assert.equal(result.asset.model_uri, null);
});
test('all local dimensions remain meters while presentation converts cm/mm', () => {
 const a = fixture(); assert.equal(formatDimension(a.dimensions_m.width, 'cm'), '120 cm'); assert.equal(formatDimension(a.dimensions_m.depth, 'mm'), '600 mm'); assert.equal(a.dimensions_m.depth, .6);
});
test('wrong units, unsupported schema and missing provenance are distinct errors', () => {
 const a=fixture(); a.units='cm'; a.schema_version='other.v1'; delete a.provenance;
 assert.deepEqual(codes(a), ['schema', 'units', 'provenance']);
});
test('missing, zero, negative, string and infinite dimensions are invalid', () => {
 for (const value of [undefined,0,-1,'1.2',NaN,Infinity]) { const a=fixture(); if(value===undefined) delete a.dimensions_m.width; else a.dimensions_m.width=value; assert.equal(validateFurniture(a).status,'invalid'); }
});
test('null or unresolved scale remains review only even with positive numbers', () => {
 const a=fixture(); a.dimensions_m.height=null; assert.equal(validateFurniture(a).status,'review'); assert.equal(validateFurniture(a).metricReady,false);
 a.dimensions_m.height=.75; a.scale_status='unresolved'; assert.equal(validateFurniture(a).metricReady,false); assert.equal(validateFurniture(a).status,'review');
});
test('scale provenance must match basis and reference calibration must document input', () => {
 const a=fixture();a.scale_status='metric-estimated'; assert.ok(codes(a).includes('basis_scale_mismatch'));
 a.dimension_basis='estimated';a.scale_status='reference-calibrated';a.provenance.method='candidate-model'; assert.ok(codes(a).includes('reference'));
 a.provenance.scale_reference_used=true;a.provenance.scale_reference_description='independent reference target 1m'; assert.equal(validateFurniture(a).status,'valid');
});
test('estimated results require method; confidence may be null but not fabricated by parser', () => {
 const a=fixture();a.dimension_basis='estimated';a.scale_status='metric-estimated';assert.ok(codes(a).includes('method'));
 a.provenance.method='candidate-model';assert.equal(validateFurniture(a).asset.confidence,null);
 a.confidence=1.3;assert.ok(codes(a).includes('confidence'));
});
test('paths cannot execute schemes; valid GLB paths are accepted without fetching them', () => {
 for(const s of ['javascript:alert(1)','data:text/html,hi','file:///tmp/test','//host/a.glb','https://user:pass@host/a.glb']) assert.equal(isSafeModelUri(s),false);
 for(const s of ['./furniture.glb','https://example.org/furniture.glb']) assert.equal(isSafeModelUri(s),true);
 const a=fixture();a.geometry_kind='glb';assert.ok(codes(a).includes('missing_model'));a.model_uri='./furniture.glb';assert.equal(validateFurniture(a).status,'valid');
});
test('broken JSON, huge JSON, arrays and empty root report parse/shape errors', () => {
 assert.equal(parseFurniture('{oops').errors[0].code,'json'); assert.equal(parseFurniture(' '.repeat(MAX_FILE_BYTES+1)).errors[0].code,'file_size');
 for(const t of ['[]','null','2']) assert.equal(parseFurniture(t).errors[0].code,'root');
 assert.equal(parseFurniture('\uFEFF'+JSON.stringify(fixture())).status,'valid');
});
test('viewer URL preserves configured base path and fixes only supported defaults', () => {
 const a = new URL(buildViewerUrl('https://example.org/viewer/?old=1#anchor','basic'));
 assert.equal(a.pathname,'/viewer/');assert.equal(a.searchParams.get('variant'),'basic');assert.equal(a.searchParams.get('quality'),'high');assert.equal(a.hash,'');
 assert.throws(()=>buildViewerUrl('javascript:alert(1)','basic'));assert.throws(()=>buildViewerUrl('http://localhost:5173/','unknown'));
});

test('geometry success cannot promote unresolved, failed or unknown dimensions to metric-ready', () => {
 for (const status of ['unresolved', 'failed', 'pending', 'future-status']) {
  const a = fixture();
  a.diagnostics = { geometry_status: 'succeeded', dimensions_status: status, code: 'DIMENSIONS_UNRESOLVED', message: 'Object extent is unavailable.' };
  const result = validateFurniture(a);
  assert.equal(result.status, 'review'); assert.equal(result.metricReady, false);
  assert.equal(result.asset.diagnostics.message, a.diagnostics.message);
 }
 const a = fixture(); a.dimensions_m = { width: null, depth: null, height: null };
 a.diagnostics = { geometry_status: 'succeeded', dimensions_status: 'succeeded' };
 assert.equal(validateFurniture(a).metricReady, false);
});
test('optional diagnostics retain compatibility and validate supplied field shapes', () => {
 const a = fixture();
 a.diagnostics = { geometry_status: 'failed', dimensions_status: 'succeeded', missing: [], scene_point_cloud_is_furniture_asset: false };
 assert.equal(validateFurniture(a).metricReady, true); // A valid box needs dimensions, not a scene reconstruction.
 for (const diagnostics of [null, [], { message: {} }, { dimensions_status: null }, { missing: ['mask', 2] }, { missing: 'mask' }, { scene_point_cloud_is_furniture_asset: 'false' }]) {
  a.diagnostics = diagnostics;
  assert.ok(codes(a).includes('diagnostics'));
 }
});

test('all six misplaced diagnostic fields are invalid, including alongside valid nested diagnostics', () => {
 const misplaced = { geometry_status: 'succeeded', dimensions_status: 'failed', code: 'DIMENSIONS_INFERENCE_FAILED', message: 'Failure at the wrong location.', missing: [], scene_point_cloud_is_furniture_asset: false };
 for (const [key, value] of Object.entries(misplaced)) {
  const a = fixture(); a[key] = value;
  a.diagnostics = { dimensions_status: 'succeeded', code: 'DIMENSIONS_SUCCEEDED' };
  const before = structuredClone(a), result = validateFurniture(a);
  assert.equal(result.status, 'invalid'); assert.equal(result.metricReady, false); assert.equal(result.asset, null);
  assert.ok(result.errors.some(error => error.code === 'diagnostics_location' && error.path === key && error.message.includes(`diagnostics.${key}`)));
  assert.deepEqual(a, before); // No silent relocation or normalization.
 }
});
test('present diagnostics without dimensions status stays review-only with original data', () => {
 for (const diagnostics of [{}, { code: 'DIMENSIONS_INFERENCE_FAILED' }, { code: 'DIMENSIONS_SUCCEEDED', message: 'Missing stage status.' }, { geometry_status: 'succeeded' }]) {
  const a = fixture(); a.diagnostics = diagnostics;
  const result = parseFurniture(JSON.stringify(a));
  assert.equal(result.status, 'review'); assert.equal(result.metricReady, false);
  assert.ok(result.review.some(reason => reason.includes('치수 처리 상태가 없습니다')));
  assert.deepEqual(result.asset, a);
 }
});
test('five exact dimensions codes report contradictions without overwriting raw code or status', () => {
 const expectedStatuses = { DIMENSIONS_SUCCEEDED: 'succeeded', DIMENSIONS_UNRESOLVED: 'unresolved', DIMENSIONS_INFERENCE_FAILED: 'failed', INVALID_DIMENSIONS_OUTPUT: 'failed', OBJECT_NOT_DETECTED: 'failed' };
 for (const [code, expected] of Object.entries(expectedStatuses)) {
  for (const dimensions_status of ['succeeded', 'unresolved', 'failed', 'pending', 'not_run']) {
   const a = fixture(); a.diagnostics = { code, dimensions_status };
   const before = structuredClone(a), result = validateFurniture(a);
   const ready = expected === 'succeeded' && dimensions_status === 'succeeded';
   assert.equal(result.status, ready ? 'valid' : 'review', `${code}/${dimensions_status}`);
   assert.equal(result.metricReady, ready);
   assert.equal(result.review.some(reason => reason.includes('진단 코드')), dimensions_status !== expected);
   assert.deepEqual(result.asset, before); assert.deepEqual(a, before);
  }
 }
});
test('unknown states and success aliases are preserved without case or whitespace normalization', () => {
 for (const dimensions_status of ['success', 'SUCCEEDED', ' succeeded ', 'future_status']) {
  const a = fixture(); a.diagnostics = { dimensions_status, code: 'FUTURE_CODE' };
  const result = parseFurniture(JSON.stringify(a));
  assert.equal(result.status, 'review'); assert.equal(result.metricReady, false);
  assert.deepEqual(result.asset, a);
 }
});
test('geometry/dependency/unknown failure codes and missing GT do not reject independent successful dimensions', () => {
 for (const code of ['GEOMETRY_INFERENCE_FAILED', 'MODEL_ACCESS_DENIED', 'PROCESSING_PENDING', 'PROCESSING_NOT_RUN', 'FUTURE_STAGE_FAILED', 'dimensions_inference_failed', ' DIMENSIONS_INFERENCE_FAILED ', 'constructor']) {
  const a = fixture(); a.diagnostics = { geometry_status: 'failed', dimensions_status: 'succeeded', code, message: 'Independent manual dimensions.' };
  const result = validateFurniture(a);
  assert.equal(result.status, 'valid', code); assert.equal(result.metricReady, true); assert.equal(result.asset.diagnostics.code, code);
 }
 const a = fixture(); a.dimension_basis = 'estimated'; a.scale_status = 'metric-estimated'; a.provenance.method = 'synthetic estimate';
 a.diagnostics = { geometry_status: 'succeeded', dimensions_status: 'succeeded', code: 'DIMENSIONS_SUCCEEDED', missing: ['independent_dimensions_ground_truth'] };
 const result = validateFurniture(a);
 assert.equal(result.status, 'valid'); assert.equal(result.metricReady, true); assert.deepEqual(result.asset, a);
});
