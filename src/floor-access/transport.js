// Upright geometric review in meters, not a real-world delivery guarantee.
// X/Z and yaw follow Three.js: positive yaw turns local +X toward world -Z.
// Boxes include their whole transport envelope; no tilting, disassembly or humans.
// Supporting floors are excluded from obstacles. Other touching faces block.

const WORK_LIMIT = 32768;
const MAX_DEPTH = 20;
const finite = Number.isFinite;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function readBox(value, defaultYaw = false) {
  if (!record(value)) return null;
  const box = {
    width: value.width, depth: value.depth, height: value.height,
    x: value.x, z: value.z,
    yaw: value.yaw === undefined && defaultYaw ? 0 : value.yaw,
    bottomY: value.bottomY === undefined ? 0 : value.bottomY,
  };
  if (!Object.values(box).every(finite) ||
      !['width', 'depth', 'height'].every(key => box[key] > 0 && box[key] / 2 > 0)) return null;
  return box;
}

function readObstacles(values) {
  // An absent/empty environment is not evidence of an unobstructed route.
  if (!Array.isArray(values) || !values.length) return null;
  const obstacles = [], ids = new Set();
  for (const value of values) {
    const box = readBox(value);
    if (!box || typeof value.id !== 'string' || !value.id.trim() || ids.has(value.id)) return null;
    ids.add(value.id);
    obstacles.push({...box, id: value.id, title: typeof value.title === 'string' ? value.title : value.id});
  }
  return obstacles;
}

function readClearance(options, fallback) {
  if (!record(options)) return null;
  const value = options.clearance === undefined ? fallback : options.clearance;
  return finite(value) && value >= 0 ? value : null;
}

// Use relative coordinates for SAT, and an explicit numerical guard that grows
// with world-coordinate magnitude. Roundoff must not certify a marginal gap.
function guard(...values) {
  let magnitude = 1;
  for (const value of values) magnitude = Math.max(magnitude, Math.abs(value));
  return Number.EPSILON * 64 * magnitude;
}

function intersects(a, b, horizontalPad, verticalPad) {
  const dx = b.x - a.x, dz = b.z - a.z, dy = a.bottomY - b.bottomY;
  const aw = a.width / 2 + horizontalPad, ad = a.depth / 2 + horizontalPad;
  const bw = b.width / 2, bd = b.depth / 2;
  const low = dy - verticalPad, high = dy + a.height + verticalPad;
  if (![dx, dz, dy, aw, ad, low, high].every(finite)) return null;
  const epsilon = guard(a.x, a.z, a.bottomY, b.x, b.z, b.bottomY,
    aw, ad, bw, bd, a.height, b.height, horizontalPad, verticalPad);
  if (low > b.height + epsilon || high < -epsilon) return false;
  const ca = Math.cos(a.yaw), sa = Math.sin(a.yaw);
  const cb = Math.cos(b.yaw), sb = Math.sin(b.yaw);
  const c = Math.abs(ca * cb + sa * sb), s = Math.abs(sa * cb - ca * sb);
  const distances = [Math.abs(dx * ca - dz * sa), Math.abs(dx * sa + dz * ca),
    Math.abs(dx * cb - dz * sb), Math.abs(dx * sb + dz * cb)];
  const radii = [aw + c * bw + s * bd, ad + s * bw + c * bd,
    bw + c * aw + s * ad, bd + s * aw + c * ad];
  if (![...distances, ...radii].every(finite)) return null;
  return distances.every((distance, axis) => distance <= radii[axis] + epsilon);
}

function inspect(box, obstacles, horizontalPad, verticalPad) {
  const hits = [];
  for (const obstacle of obstacles) {
    const overlap = intersects(box, obstacle, horizontalPad, verticalPad);
    if (overlap === null) return {valid: false, clear: false, hits, reason: 'numeric-range'};
    if (overlap) hits.push({id: obstacle.id, title: obstacle.title});
  }
  return {valid: true, clear: hits.length === 0, hits};
}

/** Clearance expands each local cargo face in meters; it never shrinks a collider. */
export function inspectPose(cargo, obstacles, options = {}) {
  const box = readBox(cargo), environment = readObstacles(obstacles);
  const clearance = readClearance(options, 0);
  if (!box || !environment || clearance === null) {
    return {valid: false, clear: false, hits: [], reason: 'invalid-input'};
  }
  return inspect(box, environment, clearance, clearance);
}

/**
 * Static containment only: no assertion about the car door or approach route.
 * Clearance expands the cargo's local faces, exactly as inspectPose does. Its
 * horizontal projection onto the car axes grows when the cargo is rotated.
 * Floor contact is allowed: the supporting floor is not an obstacle.
 * margins_m reports original gaps in the car's axes; padding_m is the required
 * projected expansion on each face, and padded_margins_m is the remaining gap.
 */
export function fitsCar(cargo, car, options = {}) {
  const box = readBox(cargo), interior = readBox(car, true);
  const clearance = readClearance(options, 0);
  if (!box || !interior || clearance === null) return {valid: false, fits: false, reason: 'invalid-input'};
  const dx = box.x - interior.x, dz = box.z - interior.z;
  const c = Math.cos(interior.yaw), s = Math.sin(interior.yaw);
  const x = dx * c - dz * s, z = dx * s + dz * c;
  const cargoCos = Math.cos(box.yaw), cargoSin = Math.sin(box.yaw);
  const ca = Math.abs(cargoCos * c + cargoSin * s), sa = Math.abs(cargoSin * c - cargoCos * s);
  const ex = ca * box.width / 2 + sa * box.depth / 2;
  const ez = sa * box.width / 2 + ca * box.depth / 2;
  const floor = box.bottomY - interior.bottomY;
  const margins_m = {
    left: interior.width / 2 + x - ex, right: interior.width / 2 - x - ex,
    back: interior.depth / 2 + z - ez, front: interior.depth / 2 - z - ez,
    floor, ceiling: interior.height - floor - box.height,
  };
  const horizontalPadding = clearance * (ca + sa);
  const padding_m = {left: horizontalPadding, right: horizontalPadding,
    back: horizontalPadding, front: horizontalPadding, floor: 0, ceiling: clearance};
  const padded_margins_m = Object.fromEntries(Object.entries(margins_m)
    .map(([face, gap]) => [face, gap - padding_m[face]]));
  if (![dx, dz, ...Object.values(margins_m), ...Object.values(padding_m), ...Object.values(padded_margins_m)].every(finite)) {
    return {valid: false, fits: false, reason: 'numeric-range'};
  }
  const epsilon = guard(box.x, box.z, box.bottomY, interior.x, interior.z, interior.bottomY,
    box.width, box.depth, box.height, interior.width, interior.depth, interior.height, clearance);
  const insufficient = Object.entries(padded_margins_m)
    .filter(([face, gap]) => face === 'floor' ? gap < 0 : gap <= epsilon)
    .map(([face]) => face);
  return {valid: true, fits: insufficient.length === 0, margins_m, padding_m, padded_margins_m,
    insufficient, clearance_m: clearance, clearance_basis: 'cargo-local-face-expansion'};
}

/**
 * Certifies the supplied piecewise-linear upright path, not existence of every
 * possible route. Yaw is interpolated as supplied, without shortest-angle wrap:
 * 0 -> 2*PI describes a full turn. Unwrap input yaw for the intended motion.
 *
 * Every interval is enclosed by its midpoint OBB expanded horizontally by
 * |center translation|/2 + radius*|yaw change|/2. Radius includes clearance.
 * The bound follows the maximum point displacement, so clearance of the entire
 * envelope certifies the continuous interval, not merely its sampled poses.
 * Vertical interpolation is enclosed separately. A sample collision is blocked;
 * an overlapping envelope alone is never blocked and is subdivided instead.
 * Reaching minStep, maxDepth or a global work cap without proof is unresolved.
 *
 * samples counts inspected actual poses; segments counts input path segments.
 * checkedIntervals/clearIntervals/unresolvedIntervals describe the certificates.
 * Obstacles are fixed throughout the route, including the chosen door positions.
 */
export function inspectRoute(cargoShape, poses, obstacles, options = {}) {
  const result = {
    valid: true, status: 'unresolved', samples: 0,
    segments: Array.isArray(poses) ? Math.max(0, poses.length - 1) : 0,
    checkedIntervals: 0, clearIntervals: 0, unresolvedIntervals: 0,
    hitIds: [], hits: [], potentialHitIds: [],
  };
  const invalid = reason => ({...result, valid: false, status: 'unresolved', reason});
  const clearance = readClearance(options, 0.02);
  if (!record(cargoShape) || !Array.isArray(poses) || poses.length < 2 || clearance === null) return invalid('invalid-input');
  const maxDepth = options.maxDepth === undefined ? 12 : options.maxDepth;
  const minStep = options.minStep === undefined ? 0.005 : options.minStep;
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > MAX_DEPTH || !finite(minStep) || minStep <= 0) return invalid('invalid-options');
  const environment = readObstacles(obstacles);
  if (!environment) return invalid('invalid-input');
  const path = [];
  for (const pose of poses) {
    if (!record(pose)) return invalid('invalid-input');
    const box = readBox({width: cargoShape.width, depth: cargoShape.depth, height: cargoShape.height,
      x: pose.x, z: pose.z, yaw: pose.yaw, bottomY: pose.bottomY});
    if (!box) return invalid('invalid-input');
    path.push(box);
  }
  const radius = Math.hypot(cargoShape.width / 2 + clearance, cargoShape.depth / 2 + clearance);
  if (!finite(radius)) return invalid('numeric-range');
  const hitMap = new Map(), potentialIds = new Set();
  let numericFailure = false, limited = false;
  function sample(box, segment, t) {
    if (result.samples >= WORK_LIMIT) { limited = true; return null; }
    result.samples++;
    const checked = inspect(box, environment, clearance, clearance);
    if (!checked.valid) { numericFailure = true; return null; }
    for (const hit of checked.hits) hitMap.set(hit.id, hit);
    if (!checked.clear && !result.firstCollision) result.firstCollision = {segment, t, pose: {...box}};
    return checked.clear;
  }
  function finish(status, reason) {
    return {...result, status, ...(reason ? {reason} : {}),
      hitIds: [...hitMap.keys()], hits: [...hitMap.values()], potentialHitIds: [...potentialIds]};
  }
  // Check all stated poses before issuing any route certificate.
  for (let i = 0; i < path.length; i++) {
    sample(path[i], Math.max(0, i - 1), i === 0 ? 0 : 1);
    if (numericFailure) return invalid('numeric-range');
    if (limited) return finish('unresolved', 'work-limit');
  }
  if (hitMap.size) return finish('blocked', 'pose-collision');

  function interval(a, b, segment, t0, t1, depth) {
    if (result.checkedIntervals >= WORK_LIMIT) { limited = true; return false; }
    result.checkedIntervals++;
    const dx = b.x - a.x, dz = b.z - a.z, dy = b.bottomY - a.bottomY, da = b.yaw - a.yaw;
    const horizontal = Math.hypot(dx, dz) / 2 + radius * Math.abs(da) / 2;
    const vertical = Math.abs(dy) / 2;
    const mid = {...a, x: a.x + dx / 2, z: a.z + dz / 2,
      yaw: a.yaw + da / 2, bottomY: a.bottomY + dy / 2};
    if (![horizontal, vertical, mid.x, mid.z, mid.yaw, mid.bottomY].every(finite)) { numericFailure = true; return false; }
    const t = (t0 + t1) / 2;
    if (sample(mid, segment, t) !== true) return false;
    const envelope = inspect(mid, environment, clearance + horizontal, clearance + vertical);
    if (!envelope.valid) { numericFailure = true; return false; }
    if (envelope.clear) { result.clearIntervals++; return true; }
    if (depth >= maxDepth || 2 * Math.max(horizontal, vertical) <= minStep) {
      result.unresolvedIntervals++;
      for (const hit of envelope.hits) potentialIds.add(hit.id);
      return false;
    }
    const left = interval(a, mid, segment, t0, t, depth + 1);
    if (hitMap.size || numericFailure || limited) return false;
    const right = interval(mid, b, segment, t, t1, depth + 1);
    return left && right;
  }
  let clear = true;
  for (let i = 0; i < path.length - 1; i++) {
    if (!interval(path[i], path[i + 1], i, 0, 1, 0)) clear = false;
    if (numericFailure) return invalid('numeric-range');
    if (hitMap.size) return finish('blocked', 'pose-collision');
    if (limited) return finish('unresolved', 'work-limit');
  }
  return finish(clear ? 'clear' : 'unresolved', clear ? undefined : 'subdivision-limit');
}
