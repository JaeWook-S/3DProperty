import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ROOM_MEASUREMENT_BASIS, measureRoomBounds, measureRoomAxes, measureRoomSegment} from '../src/walkthrough/space-measurements.js';

const rectangle = [[0, 0], [4, 0], [4, 3], [0, 3]];
const uRoom = [[0, 0], [4, 0], [4, 4], [3, 4], [3, 1], [1, 1], [1, 4], [0, 4]];
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, message ?? `${actual} ≠ ${expected}`);

test('maximum bounds and polygon area remain distinct for a concave room', () => {
  const result = measureRoomBounds({polygon_m: uRoom, bounds_m: [-100, -100, 100, 100]});
  assert.equal(result.valid, true);
  assert.deepEqual(result.bounds_m, [0, 0, 4, 4]);
  assert.equal(result.width_m, 4); assert.equal(result.depth_m, 4);
  assert.equal(result.polygon_area_m2, 10);
  assert.equal(result.basis, ROOM_MEASUREMENT_BASIS);
  assert.match(result.basis, /furniture and doors are not considered/);
  assert.match(result.basis, /Not verified as-built dimensions or effective passage clearance/);
});

test('local X/Z measurements return endpoints and distances in both directions', () => {
  const result = measureRoomAxes(rectangle, [1, 2]);
  assert.equal(result.inside, true); assert.equal(result.boundary, false);
  assert.deepEqual(result.x, {start_m: [0, 2], end_m: [4, 2], length_m: 4, negative_m: 1, positive_m: 3});
  assert.deepEqual(result.z, {start_m: [1, 0], end_m: [1, 3], length_m: 3, negative_m: 2, positive_m: 1});
});

test('concave scanlines choose the connected interval containing the selected point', () => {
  const left = measureRoomAxes(uRoom, [.5, 2]), right = measureRoomAxes(uRoom, [3.5, 2]);
  assert.deepEqual(left.x.start_m, [0, 2]); assert.deepEqual(left.x.end_m, [1, 2]);
  assert.deepEqual(right.x.start_m, [3, 2]); assert.deepEqual(right.x.end_m, [4, 2]);
  assert.equal(left.x.length_m, 1); assert.equal(left.z.length_m, 4);
  const outside = measureRoomAxes(uRoom, [2, 2]);
  assert.equal(outside.valid, true); assert.equal(outside.inside, false);
  assert.equal(outside.x, null); assert.equal(outside.z, null);
});

test('boundary spans include edges and handle a tangent vertex without invented width', () => {
  const corner = measureRoomAxes(rectangle, [0, 0]);
  assert.equal(corner.boundary, true); assert.equal(corner.x.negative_m, 0); assert.equal(corner.z.negative_m, 0);
  const tangent = measureRoomAxes([[0, 0], [2, 2], [0, 4]], [2, 2]);
  assert.equal(tangent.boundary, true); assert.equal(tangent.x.length_m, 2); assert.equal(tangent.z.length_m, 0);
  const innerEdge = measureRoomAxes(uRoom, [2, 1]);
  assert.equal(innerEdge.boundary, true); assert.equal(innerEdge.x.length_m, 4); assert.equal(innerEdge.z.length_m, 1);
});

test('a diagonal room uses line intersections rather than its bounding box', () => {
  const result = measureRoomAxes([[0, 0], [4, 0], [0, 4]], [1, 1]);
  assert.equal(result.x.length_m, 3); assert.equal(result.z.length_m, 3);
  assert.deepEqual(result.x.end_m, [3, 1]); assert.deepEqual(result.z.end_m, [1, 3]);
});

test('segment endpoints inside a concave room do not prove the whole segment is inside', () => {
  const result = measureRoomSegment(uRoom, [.5, 2], [3.5, 2]);
  assert.equal(result.start_inside, true); assert.equal(result.end_inside, true);
  assert.equal(result.inside, false); assert.equal(result.outside, true); assert.equal(result.length_m, 3);
  assert.equal(result.outside_intervals.length, 1);
  assert.deepEqual(result.outside_intervals[0].start_m, [1, 2]);
  assert.deepEqual(result.outside_intervals[0].end_m, [3, 2]);
  assert.equal(result.outside_intervals[0].length_m, 2);
  assert.deepEqual(measureRoomSegment(uRoom, [3.5, 2], [.5, 2]).outside_intervals[0].start_m, [3, 2]);
});

test('segments along the polygon boundary and through a concave vertex are inclusive', () => {
  for (const [start, end] of [[[0, 0], [4, 0]], [[.5, 1], [3.5, 1]], [[.5, .5], [1, 1]]]) {
    const result = measureRoomSegment(uRoom, start, end);
    assert.equal(result.inside, true); assert.equal(result.outside, false);
    assert.deepEqual(result.outside_intervals, []);
  }
  const result = measureRoomSegment(rectangle, [0, 0], [4, 3]);
  assert.equal(result.length_m, 5); assert.equal(result.inside, true);
});

test('outside endpoints and zero-length measurements produce explicit containment results', () => {
  const across = measureRoomSegment(rectangle, [-1, 1], [5, 1]);
  assert.equal(across.start_inside, false); assert.equal(across.end_inside, false);
  assert.equal(across.outside_intervals.length, 2);
  close(across.outside_intervals[0].length_m, 1); close(across.outside_intervals[1].length_m, 1);
  for (const [point, inside] of [[[2, 2], true], [[0, 0], true], [[-1, -1], false]]) {
    const result = measureRoomSegment(rectangle, point, point);
    assert.equal(result.length_m, 0); assert.equal(result.inside, inside); assert.equal(result.outside, !inside);
  }
});

test('reversed winding, duplicate consecutive vertices and a closing vertex preserve measurements without mutation', () => {
  const polygon = [[0, 0], [0, 0], [2, 0], [4, 0], [4, 3], [0, 3], [0, 0]].reverse();
  const original = JSON.stringify(polygon);
  assert.equal(measureRoomBounds(polygon).polygon_area_m2, 12);
  assert.equal(measureRoomAxes(polygon, [1, 2]).x.length_m, 4);
  assert.equal(measureRoomSegment(polygon, [0, 0], [4, 3]).inside, true);
  assert.equal(JSON.stringify(polygon), original);
});

test('invalid, degenerate and self-intersecting polygons do not produce confident measurements', () => {
  const invalidPolygons = [null, {}, {bounds_m: [0, 0, 4, 3]}, [], [[0, 0], [1, 1]],
    [[0, 0], [1, 0], [2, 0]], [[0, 0], [NaN, 1], [2, 2]],
    [[0, 0], [4, 4], [0, 4], [4, 0]],
    [[0, 0], [4, 0], [2, 0], [2, 3], [0, 3]],
    [[[0, 0], [4, 0], [0, 4]]]];
  for (const polygon of invalidPolygons) {
    for (const result of [measureRoomBounds(polygon), measureRoomAxes(polygon, [0, 0]), measureRoomSegment(polygon, [0, 0], [1, 1])]) {
      assert.equal(result.valid, false, JSON.stringify(polygon)); assert.ok(result.error);
      assert.equal(result.length_m, undefined); assert.equal(result.basis, ROOM_MEASUREMENT_BASIS);
    }
  }
  for (const point of [null, [0], [0, Infinity], ['1', 0], [0, 0, 0]]) {
    assert.equal(measureRoomAxes(rectangle, point).error, 'invalid_point');
    assert.equal(measureRoomSegment(rectangle, [0, 0], point).error, 'invalid_point');
  }
});

test('168C expanded bedroom-2: maximum width 2.744m differs from the measured 2.310m notch span', () => {
  const model = JSON.parse(readFileSync(new URL('../assets/models/acro-river-park/168c/archisketch-kitchen-detail-v1/expanded/model-info.json', import.meta.url)));
  const room = model.rooms.find(r => r.id === 'bedroom-2');
  const bounds = measureRoomBounds(room), narrow = measureRoomAxes(room, [6, 6.8]), full = measureRoomAxes(room, [6, 8]);
  assert.equal(bounds.valid, true); close(bounds.width_m, 2.744); close(bounds.depth_m, 4.418);
  close(bounds.polygon_area_m2, 11.505410); close(narrow.x.length_m, 2.310);
  assert.deepEqual(narrow.x.start_m, [4.849, 6.8]); assert.deepEqual(narrow.x.end_m, [7.159, 6.8]);
  close(full.x.length_m, 2.744);
  assert.equal(measureRoomSegment(room, [4.415, 6.8], [7.159, 6.8]).outside, true);
  assert.equal(measureRoomSegment(room, narrow.x.start_m, narrow.x.end_m).inside, true);
});
