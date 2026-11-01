const NS = 'http://www.w3.org/2000/svg';
const EPSILON = 1e-7;
const geometryCache = new WeakMap();

function segmentDistance(point, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length)) : 0;
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
}

function signedDistance(point, polygon) {
  let inside = false, distance = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    distance = Math.min(distance, segmentDistance(point, a, b));
  }
  return inside ? distance : -distance;
}

// Intersections use the same half-open vertex rule as point-in-polygon.
function horizontalRuns(polygon, y) {
  const crossings = [];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > y) !== (b[1] > y)) crossings.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
  }
  crossings.sort((a, b) => a - b);
  const runs = [];
  for (let i = 0; i + 1 < crossings.length; i += 2) runs.push([crossings[i], crossings[i + 1]]);
  return runs;
}

function prepareGeometry(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3 || polygon.some(p => !Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return null;
  if (geometryCache.has(polygon)) return geometryCache.get(polygon);
  const xs = polygon.map(p => p[0]), ys = polygon.map(p => p[1]);
  const bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const [left, top, right, bottom] = bounds;
  if (right - left < EPSILON || bottom - top < EPSILON) return null;
  const points = [], seen = new Set();
  function add(x, y) {
    const key = `${x.toFixed(6)},${y.toFixed(6)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const distance = signedDistance([x, y], polygon);
    if (distance > EPSILON) points.push({x, y, distance});
  }
  add((left + right) / 2, (top + bottom) / 2);
  // Thin corridors and balcony strips remain represented even when the main
  // room's largest inscribed circle lies elsewhere.
  const levels = [...new Set(ys)].sort((a, b) => a - b);
  for (let i = 1; i < levels.length; i++) {
    const y = (levels[i - 1] + levels[i]) / 2;
    for (const [a, b] of horizontalRuns(polygon, y)) add((a + b) / 2, y);
  }
  // A bounded polylabel-style search favors usable interior space over a
  // bounding-box center, which can be in a different room for concave plans.
  const size = Math.max(Math.min(right - left, bottom - top) / 2, Math.max(right - left, bottom - top) / 24);
  const queue = [];
  function cell(x, y, half) {
    const distance = signedDistance([x, y], polygon);
    queue.push({x, y, half, maximum: distance + half * Math.SQRT2});
    add(x, y);
  }
  for (let x = left; x < right; x += size) for (let y = top; y < bottom; y += size) cell(x + size / 2, y + size / 2, size / 2);
  let best = Math.max(0, ...points.map(p => p.distance));
  for (let count = 0; queue.length && count < 180; count++) {
    queue.sort((a, b) => b.maximum - a.maximum);
    const next = queue.shift();
    if (next.maximum - best <= .015 || next.half < .0075) continue;
    const half = next.half / 2;
    for (const dx of [-half, half]) for (const dy of [-half, half]) cell(next.x + dx, next.y + dy, half);
    best = Math.max(best, ...points.slice(-4).map(p => p.distance));
  }
  points.sort((a, b) => b.distance - a.distance);
  const geometry = {polygon, bounds, points: points.slice(0, 160), levels};
  geometryCache.set(polygon, geometry);
  return geometry;
}

function segmentTouchesBox(a, b, left, top, right, bottom) {
  let start = 0, end = 1;
  for (let axis = 0; axis < 2; axis++) {
    const delta = b[axis] - a[axis];
    const low = axis ? top : left, high = axis ? bottom : right;
    if (Math.abs(delta) < EPSILON) {
      if (a[axis] < low || a[axis] > high) return false;
    } else {
      let near = (low - a[axis]) / delta, far = (high - a[axis]) / delta;
      if (near > far) [near, far] = [far, near];
      start = Math.max(start, near); end = Math.min(end, far);
      if (start > end) return false;
    }
  }
  return true;
}

/** Check the entire text rectangle, including concave notches between corners. */
export function containsLabelBox(polygon, box, padding = 0) {
  if (!box || ![box.x, box.y, box.width, box.height, padding].every(Number.isFinite) || box.width <= 0 || box.height <= 0 || padding < 0) return false;
  const geometry = prepareGeometry(polygon);
  if (!geometry) return false;
  const left = box.x - padding, top = box.y - padding;
  const right = box.x + box.width + padding, bottom = box.y + box.height + padding;
  if (left < geometry.bounds[0] || top < geometry.bounds[1] || right > geometry.bounds[2] || bottom > geometry.bounds[3]) return false;
  if ([[left, top], [right, top], [right, bottom], [left, bottom]].some(p => signedDistance(p, polygon) <= EPSILON)) return false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (segmentTouchesBox(polygon[j], polygon[i], left, top, right, bottom)) return false;
  }
  return true;
}

const centeredBox = (x, y, width, height) => ({x: x - width / 2, y: y - height / 2, width, height});

/** Return a safe horizontal label center in the polygon's original meter space. */
export function findLabelAnchor(polygon, width, height, padding = .025) {
  if (![width, height, padding].every(Number.isFinite) || width <= 0 || height <= 0 || padding < 0) return null;
  const geometry = prepareGeometry(polygon);
  if (!geometry) return null;
  const [left, top, right, bottom] = geometry.bounds;
  if (width + 2 * padding >= right - left || height + 2 * padding >= bottom - top) return null;
  for (const point of geometry.points) {
    if (containsLabelBox(polygon, centeredBox(point.x, point.y, width, height), padding)) return [point.x, point.y];
  }
  // A long horizontal label may fit away from the largest interior circle.
  // Intersect horizontal interior runs over its full height, then verify the
  // resulting rectangle exactly. Vertex levels capture every orthogonal step.
  const halfWidth = width / 2 + padding, halfHeight = height / 2 + padding;
  const levels = [...new Set([top + halfHeight + 2 * EPSILON, bottom - halfHeight - 2 * EPSILON,
    ...geometry.levels.flatMap(y => [y - halfHeight - 2 * EPSILON, y + halfHeight + 2 * EPSILON]),
    ...geometry.points.slice(0, 24).map(p => p.y)])].filter(y => y > top + halfHeight && y < bottom - halfHeight);
  let best = null, clearance = -Infinity;
  for (const y of levels) {
    const from = y - halfHeight, to = y + halfHeight;
    const slices = [from, to, ...geometry.levels.filter(v => v > from && v < to).flatMap(v => [v - EPSILON, v + EPSILON])];
    let runs = [[left, right]];
    for (const slice of slices) {
      const next = [];
      for (const a of runs) for (const b of horizontalRuns(polygon, slice)) {
        const start = Math.max(a[0], b[0]), end = Math.min(a[1], b[1]);
        if (end - start > 2 * halfWidth + 2 * EPSILON) next.push([start, end]);
      }
      runs = next;
      if (!runs.length) break;
    }
    for (const [a, b] of runs) {
      const x = (a + b) / 2, distance = signedDistance([x, y], polygon);
      if (distance > clearance && containsLabelBox(polygon, centeredBox(x, y, width, height), padding)) {
        best = [x, y]; clearance = distance;
      }
    }
  }
  return best;
}

function nameLines(name) {
  const text = String(name || '').trim();
  if (!text) return [];
  const choices = [[text]], seen = new Set([text]);
  const separated = text.includes('·');
  const words = separated ? text.split(/\s*·\s*/) : text.split(/\s+/);
  const join = values => values.join(separated ? ' · ' : ' ');
  for (const count of [2, 3]) {
    const variants = [];
    for (let first = 1; first < words.length; first++) {
      if (count === 2) variants.push([join(words.slice(0, first)), join(words.slice(first))]);
      else for (let second = first + 1; second < words.length; second++) variants.push([join(words.slice(0, first)), join(words.slice(first, second)), join(words.slice(second))]);
    }
    variants.sort((a, b) => Math.max(...a.map(s => s.length)) - Math.max(...b.map(s => s.length)));
    for (const lines of variants.slice(0, 4)) {
      const key = lines.join('\n');
      if (!seen.has(key)) { choices.push(lines); seen.add(key); }
    }
  }
  return choices;
}

/** Pure layout. measureText(lines, fontSizeInMeters) supplies real font metrics. */
export function layoutRoomLabel({room, index = 0, pixelsPerMeter, measureText}) {
  const hidden = {mode: 'hidden', text: '', lines: [], anchor: null, bounds: null, fontSize: 0};
  if (!Number.isFinite(pixelsPerMeter) || pixelsPerMeter <= 0 || typeof measureText !== 'function' || !prepareGeometry(room?.polygon_m)) return hidden;
  const padding = Math.max(.015, .65 / pixelsPerMeter);
  function fit(lines, pixels, mode) {
    const fontSize = pixels / pixelsPerMeter;
    const metrics = measureText(lines, fontSize);
    if (!metrics || ![metrics.width, metrics.height].every(Number.isFinite) || metrics.width <= 0 || metrics.height <= 0) return null;
    const anchor = findLabelAnchor(room.polygon_m, metrics.width, metrics.height, padding);
    return anchor ? {mode, text: lines.join('\n'), lines, anchor, bounds: centeredBox(...anchor, metrics.width, metrics.height), fontSize, padding} : null;
  }
  const variants = nameLines(room.name);
  for (const pixels of [12, 11, 10]) for (const lines of variants) {
    const result = fit(lines, pixels, 'name');
    if (result) return result;
  }
  for (const pixels of [11, 10]) {
    const result = fit([String(index + 1)], pixels, 'number');
    if (result) return result;
  }
  return hidden;
}

/** Append after group is attached to svg so the browser can measure its font. */
export function appendPlanRoomLabel({svg, group, room, index = 0, pixelsPerMeter}) {
  const title = document.createElementNS(NS, 'title');
  title.textContent = room.name;
  group.append(title);
  const text = document.createElementNS(NS, 'text');
  text.setAttribute('class', 'plan-room-label');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('aria-hidden', 'true');
  text.setAttribute('visibility', 'hidden');
  group.append(text);
  const matrix = svg.getScreenCTM();
  const scale = pixelsPerMeter ?? (matrix ? Math.min(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d)) : 0);
  let measured = null;
  function renderLines(lines, fontSize) {
    text.replaceChildren();
    text.setAttribute('font-size', fontSize);
    lines.forEach((line, i) => {
      const span = document.createElementNS(NS, 'tspan');
      span.setAttribute('x', '0');
      span.setAttribute('y', i * fontSize * 1.25);
      span.textContent = line;
      text.append(span);
    });
    const box = text.getBBox();
    // Include advance widths as well as painted glyph bounds (e.g. fallback
    // fonts and whitespace). Placement still uses the actual bbox's center.
    const advance = Math.max(0, ...[...text.children].map(span => span.getComputedTextLength()));
    measured = {x: box.x, y: box.y, width: box.width, height: box.height};
    return {width: Math.max(box.width, advance), height: box.height};
  }
  let result;
  try {
    result = layoutRoomLabel({room, index, pixelsPerMeter: scale, measureText: renderLines});
    if (result.mode !== 'hidden') {
      // The successful candidate is already rendered and measured.
      const dx = result.anchor[0] - measured.x - measured.width / 2;
      const dy = result.anchor[1] - measured.y - measured.height / 2;
      [...text.children].forEach((span, i) => {
        span.setAttribute('x', dx);
        span.setAttribute('y', i * result.fontSize * 1.25 + dy);
      });
      const actual = text.getBBox();
      const bounds = {x: actual.x, y: actual.y, width: actual.width, height: actual.height};
      if (containsLabelBox(room.polygon_m, bounds, result.padding)) {
        text.removeAttribute('visibility');
        text.dataset.labelMode = result.mode;
        result = {...result, bounds};
      } else result = {...result, mode: 'hidden', text: '', bounds: null};
    }
  } catch {
    // An invisible SVG has no reliable font/viewport metrics. The room stays
    // selectable and a later visible layout pass can add its label.
    result = {mode: 'hidden', text: '', lines: [], anchor: null, bounds: null, fontSize: 0};
  }
  if (result.mode === 'hidden') text.remove();
  group.dataset.labelMode = result.mode;
  group.dataset.roomNumber = String(index + 1);
  return result;
}
