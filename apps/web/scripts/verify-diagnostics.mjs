// Read private S2 artifacts; write a new report only. Never run S2's historical writer.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFurniture } from '../src/furniture.js';

const [experimentRoot, outputFile] = process.argv.slice(2);
if (!experimentRoot || !outputFile) throw new Error('Usage: node scripts/verify-diagnostics.mjs <S2-experiment-root> <new-report.json>');
const root = resolve(experimentRoot), output = resolve(outputFile);
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const clone = value => structuredClone(value);
const proposal = resolve(root, 'contracts/diagnostics-v0-proposal-20260929');
const historicalPath = resolve(proposal, 'compatibility-results.json');
const historical = read(historicalPath);
const historicalCases = new Map(historical.cases.map(row => [row.id, row]));
const indexPath = resolve(root, 'runs/2026-09-29-abo6-cubercnn/furniture-packages/index.json');
const cubePaths = read(indexPath).map(row => resolve(root, row.path));
assert.equal(cubePaths.length, 6);
const sofaPath = resolve(root, 'runs/2026-09-29-moge3-sofa2-geometry/furniture-package/asset.json');
const examplesIndex = resolve(proposal, 'examples/index.json');
const examples = read(examplesIndex);
const manualPath = fileURLToPath(new URL('../public/examples/manual-table.json', import.meta.url));
const parserPath = fileURLToPath(new URL('../src/furniture.js', import.meta.url));
const sourcePaths = [historicalPath, indexPath, examplesIndex, sofaPath, ...cubePaths, ...examples.map(row => resolve(proposal, row.path)), manualPath, parserPath];
const before = Object.fromEntries(sourcePaths.map(path => [path, hash(path)]));
const sofa = read(sofaPath), cube = read(cubePaths[0]);
const cubeProposal = clone(cube);
cubeProposal.diagnostics = read(resolve(proposal, 'examples/cube-abo-dimensions-succeeded.json')).diagnostics;
const cases = [];
function check(id, value, expectedStatus, expectedReady) {
 const previous = historicalCases.get(id);
 assert.ok(previous, `Case not in historical 30: ${id}`);
 const text = JSON.stringify(value), result = parseFurniture(text);
 assert.equal(result.status, expectedStatus, id);
 assert.equal(result.metricReady, expectedReady, id);
 assert.equal(JSON.stringify(value), text, `${id}: input mutated`);
 if (expectedStatus !== 'invalid') assert.deepEqual(result.asset, value, `${id}: original data lost`);
 cases.push({ id, kind: previous.kind, previous: { status: previous.observed.status, metricReady: previous.observed.metricReady }, expected: { status: expectedStatus, metricReady: expectedReady }, observed: { status: result.status, metricReady: result.metricReady, errors: result.errors, review: result.review, diagnostics: result.asset?.diagnostics ?? null }, behavior_changed: result.status !== previous.observed.status || result.metricReady !== previous.observed.metricReady });
}
check('original-sofa2', sofa, 'review', false);
for (const path of cubePaths) { const value = read(path); check('original-' + value.asset_id, value, 'valid', true); }
for (const row of examples) {
 const value = read(resolve(proposal, row.path));
 const ready = value.diagnostics.dimensions_status === 'succeeded';
 check('proposal-' + row.name, value, ready ? 'valid' : 'review', ready);
}
for (const status of ['failed', 'unresolved', 'pending', 'not_run', 'future_status']) {
 const value = clone(cubeProposal); value.diagnostics.dimensions_status = status;
 check('numbers-retained-' + status, value, 'review', false);
}
for (const status of ['failed', 'unresolved', 'pending', 'not_run']) {
 const value = clone(cubeProposal);
 value.dimensions_m = { width: null, depth: null, height: null }; value.scale_status = 'unresolved';
 value.diagnostics.dimensions_status = status;
 value.diagnostics.code = status === 'failed' ? 'DIMENSIONS_INFERENCE_FAILED' : 'DIMENSIONS_UNRESOLVED';
 value.diagnostics.message = 'Compatibility fixture; not an actual model result.'; value.diagnostics.missing = ['object_local_axes'];
 check('null-dimensions-' + status, value, 'review', false);
}
const nullAxis = clone(cubeProposal); nullAxis.dimensions_m.depth = null;
check('succeeded-with-null-axis', nullAxis, 'review', false);
const unresolvedScale = clone(cubeProposal); unresolvedScale.scale_status = 'unresolved';
check('succeeded-with-unresolved-scale', unresolvedScale, 'review', false);
const manual = read(manualPath);
manual.diagnostics = { geometry_status: 'failed', dimensions_status: 'succeeded', code: 'GEOMETRY_INFERENCE_FAILED', message: 'Synthetic case: valid independent manual dimensions survive geometry failure.', missing: [] };
check('manual-dimensions-despite-geometry-failure', manual, 'valid', true);
const rootOnly = clone(cube);
Object.assign(rootOnly, { geometry_status: 'succeeded', dimensions_status: 'failed', code: 'DIMENSIONS_INFERENCE_FAILED', message: 'Incorrectly placed at root.', missing: ['object_local_axes'] });
check('misplaced-root-diagnostics', rootOnly, 'invalid', false);
const alias = clone(cubeProposal); alias.diagnostics.dimensions_status = 'success';
check('internal-success-is-not-succeeded', alias, 'review', false);
const empty = clone(cube); empty.diagnostics = {};
check('empty-diagnostics-accepted-as-legacy', empty, 'review', false);
const codeOnly = clone(cube); codeOnly.diagnostics = { code: 'DIMENSIONS_INFERENCE_FAILED', message: 'No dimensions_status supplied.' };
check('code-alone-does-not-block', codeOnly, 'review', false);
const noGT = clone(cubeProposal); noGT.diagnostics.missing = ['independent_dimensions_ground_truth'];
check('missing-gt-alone-does-not-invalidate-estimate', noGT, 'valid', true);
const malformed = clone(cubeProposal); malformed.diagnostics.missing = [null];
check('malformed-missing-list', malformed, 'invalid', false);
const absent = clone(cubeProposal); delete absent.dimensions_m.depth;
check('absent-axis-field', absent, 'invalid', false);
const zero = clone(cubeProposal); zero.dimensions_m.width = 0;
check('zero-axis', zero, 'invalid', false);
assert.equal(cases.length, 30);
assert.deepEqual(new Set(cases.map(row => row.id)), new Set(historicalCases.keys()));
const protectedSources = sourcePaths.map(path => ({ path, before_sha256: before[path], after_sha256: hash(path) }));
assert.ok(protectedSources.every(row => row.before_sha256 === row.after_sha256));
const changed = cases.filter(row => row.behavior_changed).map(row => row.id);
assert.deepEqual(changed, ['misplaced-root-diagnostics', 'empty-diagnostics-accepted-as-legacy', 'code-alone-does-not-block']);
const report = {
 checked_at_utc: new Date().toISOString(), runtime: process.version,
 script_sha256: hash(fileURLToPath(import.meta.url)), parser_path: parserPath, parser_sha256: hash(parserPath),
 contract: 'integration-contract-v0.md C.2/C.3, adopted 2026-09-29',
 historical_report: { path: historicalPath, sha256: hash(historicalPath), parser_sha256: historical.parser_sha256 },
 scope: 'Fresh Node verification of the historical 30 scenario IDs under C.3. Actual artifacts read in place; synthetic inputs constructed in memory. No source artifact rewrite, inference, or placement.',
 cases_passed: cases.length, cases_failed: 0, cases, changed_behavior_ids: changed,
 actual_original_compatibility_conflicts: [], protected_sources: protectedSources,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ passed: cases.length, changed_behavior_ids: changed, actual_original_compatibility_conflicts: [], output }, null, 2));
