import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { applyLook, clampOffset, isTap, lookSensitivity, stickDirection, stickInput, STICK_DEAD_ZONE } from '../src/mobile/touch-input.js';
import { movementVector, moveWithCollisions, WALK_SPEED } from '../src/walkthrough/movement.js';

const close = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≉ ${expected}`);

test('stick maps up/right/down/left to forward/right and ignores the dead zone', () => {
  assert.deepEqual(stickInput(0, 0, 50), { forward: 0, right: 0 });
  assert.deepEqual(stickInput(0, -50 * STICK_DEAD_ZONE, 50), { forward: 0, right: 0 });
  assert.deepEqual(stickInput(0, -50, 50), { forward: 1, right: 0 });
  assert.deepEqual(stickInput(50, 0, 50), { forward: 0, right: 1 });
  assert.deepEqual(stickInput(0, 50, 50), { forward: -1, right: 0 });
  assert.deepEqual(stickInput(-50, 0, 50), { forward: 0, right: -1 });
  // Past the rim the push stays at full strength; invalid radii never produce motion.
  assert.deepEqual(stickInput(0, -500, 50), { forward: 1, right: 0 });
  assert.deepEqual(stickInput(10, 10, 0), { forward: 0, right: 0 });
  assert.deepEqual(stickInput(Number.NaN, 10, 50), { forward: 0, right: 0 });
});

test('stick is analog between the dead zone and the rim, including diagonals', () => {
  const half = stickInput(0, -25, 50);
  close(half.forward, (0.5 - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE));
  const diagonal = stickInput(40, -40, 50);
  close(Math.hypot(diagonal.forward, diagonal.right), 1);
  close(diagonal.forward, diagonal.right);
});

test('knob offset is limited to the stick radius without changing its direction', () => {
  assert.deepEqual(clampOffset(3, -4, 10), { x: 3, y: -4 });
  const clamped = clampOffset(30, -40, 10);
  close(clamped.x, 6); close(clamped.y, -8);
});

test('direction hint follows the dominant axis', () => {
  assert.equal(stickDirection({ forward: 0, right: 0 }), null);
  assert.equal(stickDirection({ forward: 0.8, right: 0.3 }), 'up');
  assert.equal(stickDirection({ forward: -0.6, right: 0.2 }), 'down');
  assert.equal(stickDirection({ forward: 0.2, right: -0.9 }), 'left');
  assert.equal(stickDirection({ forward: 0.1, right: 0.5 }), 'right');
});

test('a full stick walks at the keyboard speed, a half push slower, and combined input never faster', () => {
  const walk = (forward, right) => {
    const p = new Vector3(0, 1.6, 0);
    const open = { capsuleIntersect: () => false };
    for (let n = 0; n < 60; n++) moveWithCollisions(open, p, movementVector(forward, right, Math.PI, 1 / 60));
    return p;
  };
  const full = stickInput(0, -60, 50);
  const p = walk(full.forward, full.right);
  // Yaw π is the viewer's start heading: pushing up walks toward +Z, like the W key.
  close(p.z, WALK_SPEED, 1e-9); close(p.x, 0, 1e-9); assert.equal(p.y, 1.6);
  const half = stickInput(0, -25, 50);
  close(walk(half.forward, half.right).z, WALK_SPEED * half.forward, 1e-9);
  const both = walk(1 + full.forward, full.right);
  close(Math.hypot(both.x, both.z), WALK_SPEED, 1e-9);
});

test('look sensitivity scales with the shorter screen side', () => {
  close(lookSensitivity(390, 844), 2.4 / 390);
  close(lookSensitivity(844, 390), 2.4 / 390);
  close(lookSensitivity(1180, 820), 2.4 / 820);
  assert.ok(Number.isFinite(lookSensitivity(0, 0)));
});

test('look drag matches mouse look: right turns right, down looks down, pitch stays inside polar limits', () => {
  const k = 0.01, min = 0.2, max = Math.PI - 0.2;
  const turned = applyLook({ yaw: Math.PI, pitch: 0 }, 50, 0, k, min, max);
  close(turned.yaw, Math.PI - 0.5); close(turned.pitch, 0);
  close(applyLook({ yaw: 0, pitch: 0 }, 0, 30, k, min, max).pitch, -0.3);
  close(applyLook({ yaw: 0, pitch: 0 }, 0, -10000, k, min, max).pitch, Math.PI / 2 - min);
  close(applyLook({ yaw: 0, pitch: 0 }, 0, 10000, k, min, max).pitch, Math.PI / 2 - max);
  // Yaw is unbounded so the user can keep turning.
  close(applyLook({ yaw: 0, pitch: 0 }, -1000, 0, k, min, max).yaw, 10);
});

test('only short, still touches count as taps', () => {
  assert.equal(isTap(0, 120), true);
  assert.equal(isTap(10, 350), true);
  assert.equal(isTap(11, 100), false);
  assert.equal(isTap(2, 600), false);
});
