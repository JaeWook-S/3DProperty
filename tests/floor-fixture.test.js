import test from 'node:test';
import assert from 'node:assert/strict';
import {ShapeUtils, Vector2} from 'three';
import chair from '../assets/furniture/cc0/dining-chair-02/manifest.json' with {type: 'json'};
import {buildFloor, checkedConfig, DEFAULTS, LIMITS, UNIT_SOURCE, transformPoint} from '../src/floor-access/fixture.js';
import {fitsCar, inspectPose, inspectRoute} from '../src/floor-access/transport.js';

// Independent polygon-area audit: triangulate the actual concave source rooms,
// then clip triangle pairs. Bounding boxes alone would falsely report overlap.
const signedArea = points => points.reduce((sum, p, i) => {
  const q = points[(i + 1) % points.length];
  return sum + p[0] * q[1] - q[0] * p[1];
}, 0) / 2;
const area = points => points.length < 3 ? 0 : Math.abs(signedArea(points));
function triangles(points) {
  const clean = points.filter((p, i) => !i || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 1e-10);
  return ShapeUtils.triangulateShape(clean.map(p => new Vector2(...p)), []).map(indices => indices.map(i => clean[i]));
}
function clip(polygon, boundary) {
  let current = polygon;
  const sign = signedArea(boundary) >= 0 ? 1 : -1;
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i], b = boundary[(i + 1) % boundary.length];
    const distance = p => sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
    const next = [];
    for (let j = 0; j < current.length; j++) {
      const from = current[j], to = current[(j + 1) % current.length];
      const d0 = distance(from), d1 = distance(to), inside0 = d0 >= -1e-10, inside1 = d1 >= -1e-10;
      if (inside0 !== inside1) {
        const t = d0 / (d0 - d1);
        next.push([from[0] + t * (to[0] - from[0]), from[1] + t * (to[1] - from[1])]);
      }
      if (inside1) next.push(to);
    }
    current = next;
    if (!current.length) break;
  }
  return current;
}
const overlapArea = (first, second) => first.reduce((sum, a) => sum + second.reduce((n, b) => n + area(clip(a, b)), 0), 0);
const rectangle = (x, z, width, depth) => triangles([
  [x - width / 2, z - depth / 2], [x + width / 2, z - depth / 2],
  [x + width / 2, z + depth / 2], [x - width / 2, z + depth / 2],
]);
function unitRooms(unit) {
  return UNIT_SOURCE.rooms.map(room => ({id: room.id, triangles: triangles(room.polygon_m.map(([x, z]) => [
    unit.x + Math.cos(unit.yaw) * x + Math.sin(unit.yaw) * z,
    unit.z - Math.sin(unit.yaw) * x + Math.cos(unit.yaw) * z,
  ]))}));
}
const configurations = [
  ['default', {}],
  ['small core', {hallWidth: 3, hallDepth: 5, carWidth: 1, carDepth: 1, carHeight: 1.8, doorWidth: 0.5, doorHeight: 1.6, clearance: 0}],
  ['aisle width boundary', {hallWidth: 4.6, hallDepth: 5, carWidth: 3, carDepth: 2.5, carHeight: 2.5, doorWidth: 2.8, doorHeight: 2.5, clearance: 0.15}],
  ['large core', {hallWidth: 8, hallDepth: 10, carWidth: 3, carDepth: 2.5}],
  ['deep narrow hall', {hallWidth: 3, hallDepth: 10, carWidth: 1, carDepth: 2.5, doorWidth: 0.8}],
  ['wide short hall', {hallWidth: 8, hallDepth: 5, carWidth: 1, carDepth: 1, doorWidth: 0.8}],
];

test('polygon audit handles a concave room without filling its recess', () => {
  const concave = triangles([[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3]]);
  assert.ok(Math.abs(concave.reduce((sum, p) => sum + area(p), 0) - 5) < 1e-9);
  assert.equal(overlapArea(concave, rectangle(2, 2, 1, 1)), 0);
  assert.ok(Math.abs(overlapArea(concave, rectangle(0.5, 2, 1, 1)) - 1) < 1e-9);
  for (const room of UNIT_SOURCE.rooms) {
    assert.ok(Math.abs(triangles(room.polygon_m).reduce((sum, p) => sum + area(p), 0) - area(room.polygon_m)) < 1e-8, room.id);
  }
});

for (const [name, config] of configurations) {
  test(`${name}: rigid entrance alignment and source floor polygons do not intersect the core or another unit`, () => {
    const floor = buildFloor(config), rooms = floor.units.map(unitRooms);
    const hall = rectangle(0, 0, floor.config.hallWidth, floor.config.hallDepth);
    const car = rectangle(floor.car.x, floor.car.z, floor.car.width, floor.car.depth);
    const carWalls = rectangle(floor.car.x, floor.car.z, floor.car.width + 0.4, floor.car.depth + 0.4);
    floor.units.forEach((unit, index) => {
      assert.equal(unit.scale, 1);
      const point = transformPoint(floor.sourceEntrance.center_m, unit);
      const door = floor.obstacles.find(o => o.id === `unit-door-${index === 0 ? 1 : -1}`);
      assert.ok(Math.hypot(point[0] - unit.anchor[0], point[1] - unit.anchor[1]) < 1e-10);
      assert.ok(Math.hypot(point[0] - door.x, point[1] - door.z) < 1e-10);
      const a = transformPoint([0, 0], unit), b = transformPoint([21.482, 12.351], unit);
      assert.ok(Math.abs(Math.hypot(b[0] - a[0], b[1] - a[1]) - Math.hypot(21.482, 12.351)) < 1e-10);
      for (const room of rooms[index]) {
        for (const [zone, polygon] of [['hall', hall], ['car', car], ['car exterior walls', carWalls]]) {
          assert.ok(overlapArea(room.triangles, polygon) < 1e-8, `${unit.id}/${room.id} intersects ${zone}`);
        }
      }
    });
    for (const first of rooms[0]) for (const second of rooms[1]) {
      assert.ok(overlapArea(first.triangles, second.triangles) < 1e-8, `units overlap at ${first.id}/${second.id}`);
    }
    const outerCarHalfWidth = floor.car.width / 2 + 0.2;
    assert.ok(floor.config.hallWidth / 2 - outerCarHalfWidth >= 0.6 - 1e-10);
  });
}

const pose = (x, z, yaw = 0) => ({x, z, yaw, bottomY: 0});
function exampleRoute(floor) {
  const target = floor.destinations[0];
  return [pose(floor.car.x, floor.car.z), pose(0, 0), pose(0, 0, Math.PI / 2),
    pose(target.x, 0, Math.PI / 2), pose(target.x, target.z, Math.PI / 2)];
}

test('actual dining-chair dimensions clear the default recorded route and are blocked by a closed lift door', () => {
  const open = buildFloor(), closed = buildFloor({doorOpen: false});
  const cargo = {...chair.dimensions_m, ...pose(open.car.x, open.car.z)};
  assert.equal(fitsCar(cargo, open.car, {clearance: DEFAULTS.clearance}).fits, true);
  const clear = inspectRoute(cargo, exampleRoute(open), open.obstacles, {clearance: DEFAULTS.clearance});
  assert.equal(clear.status, 'clear');
  assert.equal(clear.segments, 4);
  const blocked = inspectRoute(cargo, exampleRoute(closed), closed.obstacles, {clearance: DEFAULTS.clearance});
  assert.equal(blocked.status, 'blocked');
  assert.ok(blocked.hitIds.includes('lift-door'));
});

test('static car fit remains distinct from a narrow door and a low doorway', () => {
  const narrow = buildFloor({doorWidth: 0.5});
  const cargo = {width: 0.7, depth: 0.5, height: 1, ...pose(narrow.car.x, narrow.car.z)};
  assert.equal(fitsCar(cargo, narrow.car, {clearance: 0.02}).fits, true);
  const blocked = inspectRoute(cargo, exampleRoute(narrow), narrow.obstacles, {clearance: 0.02});
  assert.equal(blocked.status, 'blocked');
  assert.ok(blocked.hitIds.some(id => id.startsWith('lift-front-')));
  const floor = buildFloor(), tall = {...cargo, width: 0.3, height: 2.12};
  assert.equal(fitsCar(tall, floor.car, {clearance: 0.02}).fits, true);
  assert.ok(inspectRoute(tall, exampleRoute(floor), floor.obstacles, {clearance: 0.02}).hitIds.includes('lift-lintel'));
});

test('the ceiling and 2cm doorway clearance are physical collision constraints', () => {
  const floor = buildFloor();
  const tall = {width: 0.3, depth: 0.3, height: 2.4, ...pose(floor.car.x, floor.car.z)};
  assert.equal(fitsCar(tall, floor.car, {clearance: 0.02}).fits, false);
  assert.ok(inspectPose(tall, floor.obstacles, {clearance: 0.02}).hits.some(hit => hit.id === 'car-ceiling'));
  const doorway = {width: floor.config.doorWidth - 0.04, depth: 0.1, height: 1, ...pose(0, floor.doorZ)};
  assert.equal(inspectPose(doorway, floor.obstacles, {clearance: 0.02}).clear, false);
  assert.equal(inspectPose({...doorway, width: doorway.width - 0.002}, floor.obstacles, {clearance: 0.02}).clear, true);
});

test('the 0.84m source opening retains its unverified passage basis', () => {
  const floor = buildFloor();
  assert.equal(floor.sourceEntrance.width_m, 0.84);
  assert.equal(floor.sourceEntrance.clear_passage_verified, false);
  assert.equal(floor.provenance.entryClearPassageVerified, false);
  assert.match(floor.sourceEntrance.dimension_basis, /provisional_frame/);
});

test('invalid dimensions and incompatible core constraints are rejected', () => {
  for (const [key, [low, high]] of Object.entries(LIMITS)) {
    for (const value of [NaN, Infinity, low - 0.001, high + 0.001]) {
      assert.throws(() => checkedConfig({[key]: value}), undefined, `${key}=${value}`);
    }
  }
  for (const invalid of [{hallWidth: 3, carWidth: 1.5}, {carWidth: 1, doorWidth: 0.95},
    {carHeight: 2, doorHeight: 2.1}, {carHeight: 2.51}, {doorOpen: 'true'}]) {
    assert.throws(() => checkedConfig(invalid));
  }
});
