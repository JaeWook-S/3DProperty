// X/Z meters in one simple room polygon. Boundary points count as inside.
// Accept a polygon array or {polygon_m}; never infer a polygon from a bbox.
export const ROOM_MEASUREMENT_BASIS = 'Model room polygon boundaries; furniture and doors are not considered. Not verified as-built dimensions or effective passage clearance.';

const EPSILON_M = 1e-7;
const common = () => ({valid: true, units: 'm', basis: ROOM_MEASUREMENT_BASIS});
const invalid = error => ({...common(), valid: false, error});
const pointValid = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const length = a => Math.hypot(...a);
const distance = (a, b) => length(subtract(a, b));
const clamp = value => Math.max(0, Math.min(1, value));
const interpolate = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function onEdge(p, a, b) {
  const edge = subtract(b, a), size = length(edge);
  if (size <= EPSILON_M) return distance(p, a) <= EPSILON_M;
  const t = clamp(dot(subtract(p, a), edge) / (size * size));
  return distance(p, interpolate(a, b, t)) <= EPSILON_M;
}

function location(polygon, p) {
  let inside = false;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if (onEdge(p, a, b)) return {inside: true, boundary: true};
    if ((a[1] > p[1]) !== (b[1] > p[1]) &&
        p[0] < a[0] + (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1])) inside = !inside;
  }
  return {inside, boundary: false};
}

// Parameters on AB where it touches CD; collinear overlap contributes both ends.
function intersectionParameters(a, b, c, d) {
  const r = subtract(b, a), s = subtract(d, c), q = subtract(c, a);
  const nr = length(r), ns = length(s), denominator = cross(r, s);
  if (nr <= EPSILON_M) return onEdge(a, c, d) ? [0] : [];
  const tolerance = EPSILON_M / nr;
  if (Math.abs(denominator) <= EPSILON_M * Math.max(nr, ns)) {
    if (Math.abs(cross(q, r)) > EPSILON_M * nr) return [];
    const t0 = dot(q, r) / (nr * nr), t1 = dot(subtract(d, a), r) / (nr * nr);
    const lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(1, Math.max(t0, t1));
    return hi < lo - tolerance ? [] : [clamp(lo), clamp(hi)];
  }
  const t = cross(q, s) / denominator, u = cross(q, r) / denominator;
  return t >= -tolerance && t <= 1 + tolerance && u >= -EPSILON_M / ns && u <= 1 + EPSILON_M / ns ? [clamp(t)] : [];
}

function readPolygon(roomOrPolygon) {
  const source = Array.isArray(roomOrPolygon) ? roomOrPolygon : roomOrPolygon?.polygon_m;
  if (!Array.isArray(source) || source.length < 3 || !source.every(pointValid)) return {error: 'invalid_polygon'};
  const polygon = [];
  for (const p of source) {
    if (!polygon.length || distance(p, polygon.at(-1)) > EPSILON_M) polygon.push([...p]);
  }
  if (polygon.length > 1 && distance(polygon[0], polygon.at(-1)) <= EPSILON_M) polygon.pop();
  if (polygon.length < 3) return {error: 'degenerate_polygon'};
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  let signedArea = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], c = polygon[(i + 2) % polygon.length];
    bounds[0] = Math.min(bounds[0], a[0]); bounds[1] = Math.min(bounds[1], a[1]);
    bounds[2] = Math.max(bounds[2], a[0]); bounds[3] = Math.max(bounds[3], a[1]);
    signedArea += cross(subtract(a, polygon[0]), subtract(b, polygon[0])) / 2;
    // Adjacent edges may be collinear, but must not double back over each other.
    if (onEdge(c, a, b) || onEdge(a, b, c)) return {error: 'non_simple_polygon'};
    for (let j = i + 2; j < polygon.length; j++) {
      if (i === 0 && j === polygon.length - 1) continue;
      if (intersectionParameters(a, b, polygon[j], polygon[(j + 1) % polygon.length]).length) return {error: 'non_simple_polygon'};
    }
  }
  const area = Math.abs(signedArea);
  if (!Number.isFinite(area) || area <= EPSILON_M ** 2 || !Number.isFinite(bounds[2] - bounds[0]) || !Number.isFinite(bounds[3] - bounds[1])) return {error: 'degenerate_polygon'};
  return {polygon, bounds, area};
}

function sortedUnique(values, tolerance) {
  const result = [];
  for (const value of values.sort((a, b) => a - b)) {
    if (!result.length || value - result.at(-1) > tolerance) result.push(value);
  }
  return result;
}

/** Maximum extents, not a rectangular usable area or placement clearance. */
export function measureRoomBounds(roomOrPolygon) {
  const data = readPolygon(roomOrPolygon);
  if (data.error) return invalid(data.error);
  const [minX, minZ, maxX, maxZ] = data.bounds;
  return {...common(), kind: 'maximum_extents', bounds_m: data.bounds,
    width_m: maxX - minX, depth_m: maxZ - minZ, polygon_area_m2: data.area};
}

function axisInterval(polygon, point, axis) {
  const fixed = 1 - axis, coordinates = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if (Math.abs(b[fixed] - a[fixed]) <= EPSILON_M) {
      if (Math.abs(point[fixed] - a[fixed]) <= EPSILON_M) coordinates.push(a[axis], b[axis]);
    } else {
      const t = (point[fixed] - a[fixed]) / (b[fixed] - a[fixed]);
      const tolerance = EPSILON_M / Math.abs(b[fixed] - a[fixed]);
      if (t >= -tolerance && t <= 1 + tolerance) coordinates.push(a[axis] + clamp(t) * (b[axis] - a[axis]));
    }
  }
  const cuts = sortedUnique(coordinates, EPSILON_M), intervals = [];
  const at = value => axis === 0 ? [value, point[1]] : [point[0], value];
  for (let i = 0; i < cuts.length - 1; i++) {
    const lo = cuts[i], hi = cuts[i + 1];
    if (!location(polygon, at((lo + hi) / 2)).inside) continue;
    const previous = intervals.at(-1);
    if (previous && lo - previous[1] <= EPSILON_M) previous[1] = hi;
    else intervals.push([lo, hi]);
  }
  // A line can touch a vertex without crossing a positive-length interior span.
  for (const value of cuts) {
    if (!intervals.some(([lo, hi]) => value >= lo - EPSILON_M && value <= hi + EPSILON_M)) intervals.push([value, value]);
  }
  const interval = intervals.find(([lo, hi]) => point[axis] >= lo - EPSILON_M && point[axis] <= hi + EPSILON_M);
  if (!interval) return null;
  const [lo, hi] = interval, center = Math.max(lo, Math.min(hi, point[axis]));
  return {start_m: at(lo), end_m: at(hi), length_m: hi - lo, negative_m: center - lo, positive_m: hi - center};
}

/** Axis-aligned boundary spans in the connected intervals containing point. */
export function measureRoomAxes(roomOrPolygon, point) {
  const data = readPolygon(roomOrPolygon);
  if (data.error) return invalid(data.error);
  if (!pointValid(point)) return invalid('invalid_point');
  const where = location(data.polygon, point);
  return {...common(), kind: 'local_axis_spans', point_m: [...point], ...where,
    x: where.inside ? axisInterval(data.polygon, point, 0) : null,
    z: where.inside ? axisInterval(data.polygon, point, 1) : null};
}

/** Entire segment containment, including boundary-following segments. */
export function measureRoomSegment(roomOrPolygon, start, end) {
  const data = readPolygon(roomOrPolygon);
  if (data.error) return invalid(data.error);
  if (!pointValid(start) || !pointValid(end)) return invalid('invalid_point');
  const size = distance(start, end);
  if (!Number.isFinite(size)) return invalid('invalid_point');
  const a = location(data.polygon, start), b = location(data.polygon, end), cuts = [0, 1];
  if (size > EPSILON_M) {
    for (let i = 0; i < data.polygon.length; i++) {
      cuts.push(...intersectionParameters(start, end, data.polygon[i], data.polygon[(i + 1) % data.polygon.length]));
    }
  }
  const parameters = sortedUnique(cuts, size > EPSILON_M ? EPSILON_M / size : 0), outside = [];
  for (let i = 0; i < parameters.length - 1; i++) {
    const lo = parameters[i], hi = parameters[i + 1];
    if (location(data.polygon, interpolate(start, end, (lo + hi) / 2)).inside) continue;
    const previous = outside.at(-1);
    if (previous && Math.abs(previous.end_t - lo) <= Number.EPSILON) previous.end_t = hi;
    else outside.push({start_t: lo, end_t: hi});
  }
  const inside = a.inside && b.inside && outside.length === 0;
  return {...common(), kind: 'point_to_point_segment', start_m: [...start], end_m: [...end], length_m: size,
    inside, outside: !inside, start_inside: a.inside, end_inside: b.inside,
    start_boundary: a.boundary, end_boundary: b.boundary,
    outside_intervals: outside.map(({start_t, end_t}) => ({start_t, end_t,
      start_m: interpolate(start, end, start_t), end_m: interpolate(start, end, end_t), length_m: size * (end_t - start_t)}))};
}
