import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BoxGeometry, Matrix4 } from 'three';
import { interiorWallSegments, removalBox, partitionFrame, partitionPieces, snapPoint, validatePartition, normalizeStructure, movedWall, movedOffset, structureQuantities, roomContains } from '../src/interior/wall-plan.js';
import { clipGeometryOutsideBoxes, solidIntervals, intersectIntervals, horizontalTriangles } from '../src/interior/wall-geometry.js';

const PLANS = {
  '168c-basic': 'assets/models/acro-river-park/168c/archisketch-details-v2/basic/model-info.json',
  '168c-expanded': 'assets/models/acro-river-park/168c/archisketch-metric-v1/expanded/model-info.json',
  '112a-basic': 'assets/models/acro-river-park/112a/archisketch-metric-v1/basic/model-info.json',
  '112a-expanded': 'assets/models/acro-river-park/112a/archisketch-metric-v1/expanded/model-info.json',
};
const info = key => JSON.parse(readFileSync(new URL(`../${PLANS[key]}`, import.meta.url)));

test('every plan exposes interior wall segments between two rooms', () => {
  for (const key of Object.keys(PLANS)) {
    const segments = interiorWallSegments(info(key));
    assert.ok(segments.length >= 15, `${key}: ${segments.length} segments`);
    const ids = new Set(segments.map(s => s.id));
    assert.equal(ids.size, segments.length, `${key}: unique ids`);
    for (const s of segments) {
      assert.ok(s.thickness >= 0.04 && s.thickness <= 0.45, `${key} ${s.id} thickness ${s.thickness}`);
      assert.ok(s.length >= 0.3, `${key} ${s.id} length`);
      assert.equal(s.rooms.length, 2);
      assert.notEqual(s.rooms[0], s.rooms[1]);
      // The two faces bound the wall: the lower-coordinate room is on face a.
      assert.ok(s.faces[0] < s.faces[1]);
    }
  }
});

test('removal box spans the wall core and ignores neighbours', () => {
  const [s] = interiorWallSegments(info('112a-basic'));
  const b = removalBox(s);
  const across = s.axis === 'x' ? [b.minZ, b.maxZ] : [b.minX, b.maxX], along = s.axis === 'x' ? [b.minX, b.maxX] : [b.minZ, b.maxZ];
  assert.ok(across[0] <= s.faces[0] && across[1] >= s.faces[1]);
  assert.ok(along[0] <= s.s0 && along[1] >= s.s1);
  assert.ok(along[1] - along[0] < s.length + 0.02);
});

test('partitions snap, validate and split around a door', () => {
  const plan = info('112a-expanded');
  const room = plan.rooms.find(r => (r.bounds_m[2] - r.bounds_m[0]) > 3 && (r.bounds_m[3] - r.bounds_m[1]) > 3) ?? plan.rooms[0];
  const [x1, z1, x2, z2] = room.bounds_m, cz = (z1 + z2) / 2;
  const a = [x1 + 0.4, cz], end = snapPoint(a, [x1 + 2.43, cz + 0.07]);
  assert.equal(end[1], a[1], 'orthogonal snap keeps the line horizontal');
  assert.ok(Math.abs((end[0] - a[0]) / 0.05 - Math.round((end[0] - a[0]) / 0.05)) < 1e-6);
  const p = { id: 'pt-1', type: 'drywall', a, b: end, thickness: 0.1, door: { offset: 1, width: 0.9, height: 2.1 } };
  assert.equal(validatePartition(p, plan, { segments: interiorWallSegments(plan) }), null);
  const pieces = partitionPieces(p, 2.6);
  assert.equal(pieces.length, 3, 'left, right and head piece');
  const { length } = partitionFrame(p);
  assert.ok(Math.abs(pieces.reduce((s, q) => s + (q.bottom === 0 ? q.to - q.from : 0), 0) - (length - 0.9)) < 1e-6);
  assert.match(validatePartition({ ...p, b: [a[0] + 0.1, a[1]], door: null }, plan) ?? '', /30cm/);
  assert.ok(roomContains(room, ...a));
});

test('moved wall keeps length and records the offset', () => {
  const plan = info('168c-expanded'), [s] = interiorWallSegments(plan);
  const p = movedWall(s, 0.35);
  assert.equal(p.movedFrom, s.id);
  assert.ok(Math.abs(partitionFrame(p).length - s.length) < 1e-6);
  assert.ok(Math.abs(movedOffset(s, p) - 0.35) < 1e-6);
  assert.throws(() => normalizeStructure({ version: 1, removed: [s.id, 'missing'], partitions: [p] }, interiorWallSegments(plan)), /맞지 않는/);
  const normalized = normalizeStructure({ version: 1, removed: [s.id, s.id], partitions: [p] }, interiorWallSegments(plan));
  assert.deepEqual(normalized.removed, [s.id]);
  const q = structureQuantities(normalized, interiorWallSegments(plan), 2.6);
  assert.equal(q.demolition.length, 1);
  assert.equal(q.partitions.length, 1);
  assert.ok(q.demolition[0].area > 0 && q.partitions[0].area > 0);
});

test('box clipping removes the wall core and keeps attributes', () => {
  const geometry = new BoxGeometry(4, 2.6, 0.2).translate(0, 1.3, 0);
  const clipped = clipGeometryOutsideBoxes(geometry, new Matrix4(), [{ minX: -0.5, maxX: 0.5, minZ: -0.2, maxZ: 0.2 }]);
  assert.ok(clipped, 'geometry changed');
  const pos = clipped.attributes.position;
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    assert.ok(cx <= -0.5 + 1e-6 || cx >= 0.5 - 1e-6, `triangle centre ${cx} outside the box`);
  }
  assert.ok(clipped.attributes.normal && clipped.attributes.uv);
  assert.equal(clipGeometryOutsideBoxes(geometry, new Matrix4(), [{ minX: 5, maxX: 6, minZ: -1, maxZ: 1 }]), null, 'untouched geometry returns null');
});

test('solid intervals find stacked wall layers', () => {
  const low = new BoxGeometry(1, 1, 0.2).translate(0, 0.5, 0), high = new BoxGeometry(1, 0.6, 0.2).translate(0, 2, 0);
  const meshes = [low, high].map(g => ({ geometry: g, matrixWorld: new Matrix4(), updateWorldMatrix() {} }));
  const triangles = horizontalTriangles(meshes);
  const intervals = solidIntervals(triangles, 0, 0);
  assert.equal(intervals.length, 2);
  assert.ok(Math.abs(intervals[0][0]) < 1e-6 && Math.abs(intervals[0][1] - 1) < 1e-6);
  assert.ok(Math.abs(intervals[1][0] - 1.7) < 1e-6 && Math.abs(intervals[1][1] - 2.3) < 1e-6);
  assert.deepEqual(intersectIntervals([[0, 2]], [[1, 3]]), [[1, 2]]);
});
