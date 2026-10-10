import test from 'node:test';
import assert from 'node:assert/strict';
import { measurementDimensions } from '../src/measurement.js';

test('measurement dimensions retain successful meter values', () => {
  assert.deepEqual(measurementDimensions({ status: 'ok', width_m: 0.8, depth_m: 0.6, height_m: 0.75 }), { width: 0.8, depth: 0.6, height: 0.75 });
});

test('failed or missing measurements never display stale dimensions', () => {
  for (const record of [undefined, null, { status: 'insufficient_geometry', width_m: 0.8, depth_m: 0.6, height_m: 0.75 }]) {
    assert.deepEqual(measurementDimensions(record), { width: null, depth: null, height: null });
  }
});

test('invalid or incomplete measurements are all unresolved', () => {
  for (const width_m of [null, undefined, 0, -1, '0.8', NaN, Infinity]) {
    assert.deepEqual(measurementDimensions({ status: 'ok', width_m, depth_m: 0.6, height_m: 0.75 }), { width: null, depth: null, height: null });
  }
});
