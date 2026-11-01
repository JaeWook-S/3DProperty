import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPose, fitsCar, inspectRoute} from '../src/floor-access/transport.js';

const cargo = {width: 0.6, depth: 0.4, height: 1, x: 0, z: 0, yaw: 0, bottomY: 0};
const obstacle = (id, patch = {}) => ({...cargo, id, title: id, width: 1, depth: 1, height: 2, x: 10, ...patch});
const pose = (x, z = 0, yaw = 0, bottomY = 0) => ({x, z, yaw, bottomY});
const route = (shape, poses, obstacles, options = {}) => inspectRoute(shape, poses, obstacles, {clearance: 0, ...options});

test('a straight route is continuously certified with positive clearance', () => {
  const result = inspectRoute(cargo, [pose(-2), pose(2)], [obstacle('wall', {z: 4, x: 0})]);
  assert.equal(result.status, 'clear');
  assert.equal(result.valid, true);
  assert.equal(result.segments, 1);
  assert.ok(result.clearIntervals > 0);
  assert.deepEqual(result.hitIds, []);
});

test('a thin wall between clear endpoints blocks translation', () => {
  const wall = obstacle('thin-wall', {x: 0.37, width: 0.002, depth: 4});
  assert.equal(inspectPose({...cargo, x: -2}, [wall]).clear, true);
  assert.equal(inspectPose({...cargo, x: 2}, [wall]).clear, true);
  assert.equal(inspectPose(cargo, [wall]).clear, true);
  // Endpoints AND midpoint miss the wall. Without further subdivision there
  // must be no clear certificate for the unsampled part of the interval.
  const capped = route(cargo, [pose(-2), pose(2)], [wall], {maxDepth: 0});
  assert.equal(capped.status, 'unresolved');
  assert.deepEqual(capped.hitIds, []);
  const result = route(cargo, [pose(-2), pose(2)], [wall]);
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.hitIds, ['thin-wall']);
  assert.ok(result.firstCollision.t > 0 && result.firstCollision.t < 1);
});

test('rotation can collide at an intermediate pose with both endpoints clear', () => {
  const long = {...cargo, width: 2, depth: 0.1};
  const post = obstacle('post', {x: 0.7, z: -0.7, width: 0.1, depth: 0.1});
  assert.equal(inspectPose(long, [post]).clear, true);
  assert.equal(inspectPose({...long, yaw: Math.PI / 2}, [post]).clear, true);
  const result = route(long, [pose(0), pose(0, 0, Math.PI / 2)], [post]);
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.hitIds, ['post']);
});

test('a full unwrapped turn is checked even when endpoint orientations agree', () => {
  const long = {...cargo, width: 2, depth: 0.1};
  const post = obstacle('post', {x: 0, z: 0.8, width: 0.1, depth: 0.1});
  const result = route(long, [pose(0), pose(0, 0, 2 * Math.PI)], [post]);
  assert.equal(result.status, 'blocked');
});

test('an ambiguous envelope stays unresolved at the cap instead of claiming collision or clearance', () => {
  const small = {...cargo, width: 0.1, depth: 0.1};
  // The post touches only the padded sweep envelope, not the actual straight path.
  const post = obstacle('nearby', {x: 0, z: 0.4, width: 0.1, depth: 0.1});
  const capped = route(small, [pose(-1), pose(1)], [post], {maxDepth: 0});
  assert.equal(capped.status, 'unresolved');
  assert.deepEqual(capped.hitIds, []);
  assert.deepEqual(capped.potentialHitIds, ['nearby']);
  assert.equal(route(small, [pose(-1), pose(1)], [post]).status, 'clear');
  assert.equal(route(small, [pose(-1), pose(1)], [post], {minStep: 3}).status, 'unresolved');
});

test('height and vertical interpolation are checked independently of the footprint', () => {
  const beam = obstacle('beam', {x: 0, width: 3, depth: 3, height: 0.2, bottomY: 1.5});
  assert.equal(inspectPose(cargo, [beam]).clear, true);
  assert.equal(inspectPose({...cargo, height: 1.6}, [beam]).clear, false);
  const raised = route(cargo, [pose(0, 0, 0, -1), pose(0, 0, 0, 2)], [beam]);
  assert.equal(raised.status, 'blocked');
  const car = {x: 0, z: 0, width: 3, depth: 3, height: 1.5};
  assert.equal(fitsCar({...cargo, height: 1.6}, car).fits, false);
  assert.equal(fitsCar(cargo, car, {clearance: 0.02}).fits, true);
});

test('positive clearance expands cargo; touching faces are blocked', () => {
  const wall = obstacle('wall', {x: 0.82, width: 1});
  assert.equal(inspectPose(cargo, [wall]).clear, true);
  assert.equal(inspectPose(cargo, [wall], {clearance: 0.03}).clear, false);
  assert.equal(inspectPose(cargo, [obstacle('touch', {x: 0.8})]).clear, false);
  const car = {x: 0, z: 0, width: 0.64, depth: 1, height: 2};
  assert.equal(fitsCar(cargo, car).fits, true);
  assert.equal(fitsCar(cargo, car, {clearance: 0.03}).fits, false);
});

test('45-degree cargo has the same 2cm local-face clearance in car containment and collision', () => {
  const turned = {...cargo, width: 1, depth: 1, yaw: Math.PI / 4};
  const clearance = 0.02, paddedWidth = Math.SQRT2 * (1 + 2 * clearance);
  for (const [width, fits] of [[1.46, false], [paddedWidth, false], [paddedWidth + 0.002, true]]) {
    const car = {x: 0, z: 0, width, depth: 2.1, height: 2.3};
    const walls = [-1, 1].map(side => obstacle(`side-${side}`, {
      x: side * (width / 2 + 0.1), width: 0.2, depth: car.depth, height: car.height,
    }));
    const containment = fitsCar(turned, car, {clearance});
    assert.equal(containment.fits, fits);
    assert.equal(inspectPose(turned, walls, {clearance}).clear, fits);
    assert.ok(Math.abs(containment.padding_m.right - clearance * Math.SQRT2) < 1e-12);
    assert.ok(Math.abs(containment.margins_m.right - (width / 2 - Math.SQRT1_2)) < 1e-12);
    assert.ok(Math.abs(containment.padded_margins_m.right -
      (containment.margins_m.right - containment.padding_m.right)) < 1e-12);
    assert.equal(containment.padding_m.floor, 0);
    assert.equal(containment.clearance_basis, 'cargo-local-face-expansion');
  }
});

test('static car containment does not establish passage through its narrower door', () => {
  const wide = {...cargo, width: 1, depth: 0.8};
  const car = {x: 0, z: 2, width: 2, depth: 2, height: 2.4};
  assert.equal(fitsCar({...wide, z: 2}, car, {clearance: 0.02}).fits, true);
  const jambs = [obstacle('left-jamb', {x: -0.9, z: 0, width: 1, depth: 0.1}),
    obstacle('right-jamb', {x: 0.9, z: 0, width: 1, depth: 0.1})];
  assert.equal(route(wide, [pose(0, -2), pose(0, 2)], jambs).status, 'blocked');
});

test('arbitrary yaw uses the Three.js sign convention and respects rotated car axes', () => {
  const angle = Math.PI / 6, long = {...cargo, width: 2, depth: 0.1, yaw: angle};
  const onAxis = obstacle('on-axis', {x: Math.cos(angle) * 0.7, z: -Math.sin(angle) * 0.7, width: 0.03, depth: 0.03});
  assert.equal(inspectPose(long, [onAxis]).clear, false);
  assert.equal(inspectPose(long, [{...onAxis, id: 'opposite', z: -onAxis.z}]).clear, true);
  const car = {x: 0, z: 0, width: 2.2, depth: 0.3, height: 2, yaw: angle};
  assert.equal(fitsCar(long, car).fits, true);
  assert.equal(fitsCar({...long, yaw: -angle}, car).fits, false);
});

test('large translated coordinates preserve a clear route and detect a thin obstacle', () => {
  const offset = 1e12;
  const farWall = obstacle('far-wall', {x: offset, z: offset + 4});
  assert.equal(route(cargo, [pose(offset - 2, offset), pose(offset + 2, offset)], [farWall]).status, 'clear');
  const thin = obstacle('thin', {x: offset + 0.37, z: offset, width: 0.002, depth: 4});
  assert.equal(route(cargo, [pose(offset - 2, offset), pose(offset + 2, offset)], [thin]).status, 'blocked');
});

test('invalid or incomplete geometry cannot produce a clear result', () => {
  const wall = obstacle('wall'), poses = [pose(0), pose(1)];
  for (const shape of [null, {}, {...cargo, width: 0}, {...cargo, depth: -1}, {...cargo, height: NaN}]) {
    assert.equal(inspectPose(shape, [wall]).clear, false);
    assert.equal(fitsCar(shape, {x: 0, z: 0, width: 3, depth: 3, height: 3}).fits, false);
    assert.equal(route(shape, poses, [wall]).status, 'unresolved');
  }
  for (const path of [null, [], [pose(0)], [pose(0), pose(NaN)], [pose(0), {...pose(1), yaw: Infinity}]]) {
    const result = route(cargo, path, [wall]);
    assert.equal(result.status, 'unresolved');
    assert.equal(result.valid, false);
  }
  for (const obstacles of [null, [], [null], [{...wall, height: 0}], [wall, wall]]) {
    assert.equal(inspectPose(cargo, obstacles).clear, false);
    assert.equal(route(cargo, poses, obstacles).status, 'unresolved');
  }
  for (const options of [{clearance: -1}, {clearance: NaN}, {maxDepth: -1}, {maxDepth: 99}, {minStep: 0}]) {
    assert.equal(inspectRoute(cargo, poses, [wall], options).status, 'unresolved');
  }
  assert.equal(inspectRoute(cargo, poses, [wall], null).status, 'unresolved');
  assert.equal(inspectPose({...cargo, x: -1e308}, [obstacle('overflow', {x: 1e308})]).clear, false);
});
