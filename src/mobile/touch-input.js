// Touch input math for the on-screen walking controls. Pure functions (no DOM)
// so the same rules run in the browser and in node tests.
// Screen pixels in (y grows downward); walk input in [-1, 1] and radians out.

/** Stick travel below this fraction of the radius is ignored so a resting thumb does not drift. */
export const STICK_DEAD_ZONE = 0.12;
/** Dragging across the screen's shorter side turns the view this far (2.4 rad ≈ 138°). */
export const LOOK_RADIANS_PER_SHORT_SIDE = 2.4;
/** A touch that moves less than this (px) and ends sooner than this (ms) is a tap, not a look drag. */
export const TAP_MAX_DISTANCE = 10;
export const TAP_MAX_DURATION = 350;

/** Knob display offset: the thumb offset, limited to the stick radius. */
export function clampOffset(dx, dy, radius) {
  const distance = Math.hypot(dx, dy);
  if (distance <= radius || distance === 0) return { x: dx, y: dy };
  const scale = radius / distance;
  return { x: dx * scale, y: dy * scale };
}

/**
 * Thumb offset from the stick centre → walk input for movementVector().
 * Up is forward and right is right. The magnitude ramps from 0 at the dead zone
 * to 1 at the rim, so a full push walks at the same speed as a held W key.
 */
export function stickInput(dx, dy, radius, deadZone = STICK_DEAD_ZONE) {
  const distance = Math.hypot(dx, dy);
  if (!(radius > 0) || !Number.isFinite(distance) || distance === 0) return { forward: 0, right: 0 };
  const travel = Math.min(distance / radius, 1);
  if (travel <= deadZone) return { forward: 0, right: 0 };
  const magnitude = (travel - deadZone) / (1 - deadZone);
  // `|| 0` turns -0 into 0 so callers and tests see a plain zero.
  return { forward: (-dy / distance) * magnitude || 0, right: (dx / distance) * magnitude || 0 };
}

/** Dominant arrow for the stick's direction hints; null while inside the dead zone. */
export function stickDirection({ forward, right }) {
  if (!forward && !right) return null;
  if (Math.abs(forward) >= Math.abs(right)) return forward > 0 ? 'up' : 'down';
  return right > 0 ? 'right' : 'left';
}

/** Radians per CSS pixel of drag for a look surface of the given size. */
export function lookSensitivity(width, height, radiansPerShortSide = LOOK_RADIANS_PER_SHORT_SIDE) {
  return radiansPerShortSide / Math.max(1, Math.min(width, height));
}

/**
 * Applies a look drag the way PointerLockControls applies mouse movement:
 * dragging right turns right, dragging down looks down, and pitch stays inside
 * the same polar limits. Yaw/pitch are the camera's YXZ Euler y/x.
 */
export function applyLook({ yaw, pitch }, dx, dy, radiansPerPixel, minPolarAngle = 0, maxPolarAngle = Math.PI) {
  const halfPi = Math.PI / 2;
  return {
    yaw: yaw - dx * radiansPerPixel,
    pitch: Math.max(halfPi - maxPolarAngle, Math.min(halfPi - minPolarAngle, pitch - dy * radiansPerPixel)),
  };
}

export function isTap(distance, duration, maxDistance = TAP_MAX_DISTANCE, maxDuration = TAP_MAX_DURATION) {
  return distance <= maxDistance && duration <= maxDuration;
}
