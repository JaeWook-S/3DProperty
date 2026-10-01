import { Vector3 } from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';

export const WALK_SPEED = 1.2;
export const BODY_RADIUS = 0.22;
export const DEFAULT_EYE_HEIGHT = 1.6;
export const SPAWN = Object.freeze({ x: 7.808262348175049, z: 5.193963527679443 });

// The apartment has one level. Feet remain above floor finishes; no jumping,
// stair climbing or artificial camera bob. Model coordinates stay in meters.
export function bodyAt(position, eyeHeight = DEFAULT_EYE_HEIGHT) {
  return new Capsule(
    new Vector3(position.x, 0.06 + BODY_RADIUS, position.z),
    new Vector3(position.x, eyeHeight + 0.12 - BODY_RADIUS, position.z),
    BODY_RADIUS,
  );
}

export function movementVector(forwardInput, rightInput, yaw, dt) {
  const input = new Vector3(rightInput, 0, -forwardInput);
  if (input.lengthSq() > 1) input.normalize();
  return input.applyAxisAngle(new Vector3(0, 1, 0), yaw)
    .multiplyScalar(WALK_SPEED * Math.min(Math.max(dt, 0), 0.05));
}

export function canStand(world, position, eyeHeight = DEFAULT_EYE_HEIGHT) {
  const hit = world.capsuleIntersect(bodyAt(position, eyeHeight));
  return !hit || hit.depth < 0.0001;
}

export function moveWithCollisions(world, position, delta, eyeHeight = DEFAULT_EYE_HEIGHT) {
  // Max 2cm per substep prevents crossing a thin door on a slow frame.
  const steps = Math.max(1, Math.ceil(delta.length() / 0.02));
  const step = delta.clone().divideScalar(steps);
  for (let i = 0; i < steps; i++) {
    const previous = position.clone();
    position.add(step);
    const body = bodyAt(position, eyeHeight);
    for (let pass = 0; pass < 5; pass++) {
      const hit = world.capsuleIntersect(body);
      if (!hit || hit.depth < 0.00001) break;
      // Solve only in the floor plane. Do not let collisions lift the camera.
      const horizontal = new Vector3(hit.normal.x, 0, hit.normal.z);
      const lengthSq = horizontal.lengthSq();
      if (lengthSq < 0.001) break;
      horizontal.multiplyScalar((hit.depth + 0.00001) / lengthSq);
      body.translate(horizontal);
      position.add(horizontal);
    }
    if (!canStand(world, position, eyeHeight)) position.copy(previous);
  }
  return position;
}
