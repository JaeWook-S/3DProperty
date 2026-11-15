// Pure plan geometry for interior wall editing. Meter-valued X/Z, no three.js.
// Archisketch exports rooms as interior-face polygons, and walls as the solid
// gaps between them. An interior wall segment is the overlap of two facing room
// edges separated by a plausible wall thickness. Exterior walls never qualify.

const EPS = 1e-6;
export const WALL_LIMITS = Object.freeze({ minGap: 0.04, maxGap: 0.45, minOverlap: 0.3 });
export const PARTITION_TYPES = Object.freeze({
  drywall: { label: '경량 가벽', detail: '스터드 + 석고보드 2겹', thickness: 0.1, height: null, priceCode: 'PT-DRYWALL' },
  block: { label: '조적 벽', detail: '시멘트 벽돌 0.5B + 미장', thickness: 0.12, height: null, priceCode: 'PT-BLOCK' },
  glass: { label: '유리 파티션', detail: '강화유리 10T + 블랙 프레임', thickness: 0.05, height: null, priceCode: 'PT-GLASS' },
  half: { label: '반벽', detail: '높이 1.2m · 상부 원목 캡', thickness: 0.12, height: 1.2, priceCode: 'PT-HALF' },
});
export const DOOR_OPENING = Object.freeze({ width: 0.9, height: 2.1 });

const round = (n, step = 0.001) => Number((Math.round(n / step) * step).toFixed(6));
const cm = n => Math.round(n * 100);

export function pointInPolygon(polygon, x, z) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [x1, z1] = polygon[j], [x2, z2] = polygon[i];
    if ((z1 > z) !== (z2 > z) && x < (x2 - x1) * (z - z1) / (z2 - z1) + x1) inside = !inside;
  }
  return inside;
}
const roomPolygon = room => room.polygon_m?.length >= 3 ? room.polygon_m : (() => {
  const [a, b, c, d] = room.bounds_m; return [[a, b], [c, b], [c, d], [a, d]];
})();
export const roomContains = (room, x, z) => pointInPolygon(roomPolygon(room), x, z);

// Axis-aligned edges with the side on which the room lies.
export function roomEdges(room) {
  const polygon = roomPolygon(room), edges = [];
  for (let i = 0; i < polygon.length; i++) {
    const [x1, z1] = polygon[i], [x2, z2] = polygon[(i + 1) % polygon.length];
    const dx = x2 - x1, dz = z2 - z1;
    if (Math.hypot(dx, dz) < 0.02) continue;
    let axis;
    if (Math.abs(dz) < 1e-4) axis = 'x'; else if (Math.abs(dx) < 1e-4) axis = 'z'; else continue;
    const mid = [(x1 + x2) / 2, (z1 + z2) / 2], probe = 0.012;
    // Normal points away from the room: the wall, if any, lies on that side.
    const outward = axis === 'x'
      ? (pointInPolygon(polygon, mid[0], mid[1] + probe) ? -1 : 1)
      : (pointInPolygon(polygon, mid[0] + probe, mid[1]) ? -1 : 1);
    const line = axis === 'x' ? (z1 + z2) / 2 : (x1 + x2) / 2;
    const lo = axis === 'x' ? Math.min(x1, x2) : Math.min(z1, z2), hi = axis === 'x' ? Math.max(x1, x2) : Math.max(z1, z2);
    edges.push({ room: room.id, axis, line, lo, hi, outward });
  }
  // Collinear consecutive vertices split a straight edge; join them.
  const merged = [];
  for (const edge of edges.sort((a, b) => a.axis.localeCompare(b.axis) || a.line - b.line || a.outward - b.outward || a.lo - b.lo)) {
    const last = merged.at(-1);
    if (last && last.axis === edge.axis && Math.abs(last.line - edge.line) < 1e-4 && last.outward === edge.outward && edge.lo <= last.hi + 1e-4) last.hi = Math.max(last.hi, edge.hi);
    else merged.push({ ...edge });
  }
  return merged;
}

function overlapsOpening(opening, segment) {
  if (opening.axis !== segment.axis) return false;
  const [x, z] = opening.center_m, along = segment.axis === 'x' ? x : z, across = segment.axis === 'x' ? z : x;
  return Math.abs(across - segment.center) <= segment.thickness / 2 + 0.12 && along >= segment.s0 - 0.05 && along <= segment.s1 + 0.05;
}

export function segmentId(axis, center, s0, s1) { return `iw-${axis}${cm(center)}-${cm(s0)}-${cm(s1)}`; }

export function interiorWallSegments(info, limits = WALL_LIMITS) {
  const rooms = (info.rooms ?? []).filter(r => r.polygon_m || r.bounds_m), edges = rooms.flatMap(roomEdges);
  const segments = [], seen = new Set();
  for (const a of edges) for (const b of edges) {
    if (a.room === b.room || a.axis !== b.axis || a.outward !== 1 || b.outward !== -1) continue;
    const gap = b.line - a.line;
    if (gap < limits.minGap || gap > limits.maxGap) continue;
    const s0 = Math.max(a.lo, b.lo), s1 = Math.min(a.hi, b.hi);
    if (s1 - s0 < limits.minOverlap) continue;
    const center = (a.line + b.line) / 2;
    // The gap must be solid wall, not another room or a balcony slot.
    const probes = [0.08, 0.5, 0.92].map(t => s0 + (s1 - s0) * t);
    if (probes.some(s => rooms.some(r => r.id !== a.room && r.id !== b.room && roomContains(r, a.axis === 'x' ? s : center, a.axis === 'x' ? center : s)))) continue;
    const id = segmentId(a.axis, center, s0, s1);
    if (seen.has(id)) continue; seen.add(id);
    const roomA = rooms.find(r => r.id === a.room), roomB = rooms.find(r => r.id === b.room);
    const segment = { id, axis: a.axis, center: round(center), s0: round(s0), s1: round(s1), thickness: round(gap), faces: [round(a.line), round(b.line)],
      rooms: [a.room, b.room], roomNames: [roomA?.name_ko ?? roomA?.name ?? a.room, roomB?.name_ko ?? roomB?.name ?? b.room], length: round(s1 - s0) };
    segment.openings = (info.openings ?? []).filter(o => overlapsOpening(o, segment)).map(o => ({ id: o.id, kind: o.kind, width: o.width_m, height: o.height_m, bottom: o.bottom_m ?? 0, center: o.center_m }));
    const kinds = [roomA?.kind, roomB?.kind];
    segment.caution = kinds.some(k => k === 'wet') ? 'wet' : kinds.some(k => k === 'balcony' || k === 'open_balcony') ? 'balcony' : null;
    segments.push(segment);
  }
  return segments.sort((p, q) => p.axis.localeCompare(q.axis) || p.center - q.center || p.s0 - q.s0);
}

// Removal box (X/Z) for a segment span, slightly beyond both faces so the
// complete thickness leaves without touching perpendicular walls at the ends.
export function removalBox(segment, span = [segment.s0, segment.s1], margin = 0.004) {
  const [f0, f1] = segment.faces, a = Math.min(f0, f1) - margin, b = Math.max(f0, f1) + margin;
  return segment.axis === 'x' ? { minX: span[0], maxX: span[1], minZ: a, maxZ: b } : { minX: a, maxX: b, minZ: span[0], maxZ: span[1] };
}
export function segmentLine(segment, offset = 0) {
  const c = segment.center + offset;
  return segment.axis === 'x' ? [[segment.s0, c], [segment.s1, c]] : [[c, segment.s0], [c, segment.s1]];
}
export function segmentPolygon(segment) {
  const box = removalBox(segment, undefined, 0);
  return [[box.minX, box.minZ], [box.maxX, box.minZ], [box.maxX, box.maxZ], [box.minX, box.maxZ]];
}

// Partition geometry helpers --------------------------------------------------
export function partitionLength(p) { return Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]); }
export function partitionFrame(p) {
  const length = partitionLength(p), dir = length > EPS ? [(p.b[0] - p.a[0]) / length, (p.b[1] - p.a[1]) / length] : [1, 0];
  return { length, dir, normal: [-dir[1], dir[0]], angle: Math.atan2(-(p.b[1] - p.a[1]), p.b[0] - p.a[0]) };
}
export function partitionPolygon(p) {
  const { dir, normal } = partitionFrame(p), t = (p.thickness ?? PARTITION_TYPES[p.type]?.thickness ?? 0.1) / 2;
  const [ax, az] = p.a, [bx, bz] = p.b;
  return [[ax + normal[0] * t, az + normal[1] * t], [bx + normal[0] * t, bz + normal[1] * t], [bx - normal[0] * t, bz - normal[1] * t], [ax - normal[0] * t, az - normal[1] * t]]
    .map(([x, z]) => [round(x), round(z)]);
}
// Solid pieces along a partition (door opening splits it into left/right + head).
export function partitionPieces(p, ceiling = 2.6) {
  const { length } = partitionFrame(p), height = Math.min(ceiling, p.height ?? PARTITION_TYPES[p.type]?.height ?? ceiling);
  if (!p.door) return [{ from: 0, to: length, bottom: 0, top: height }];
  const width = Math.min(p.door.width ?? DOOR_OPENING.width, length - 0.2), doorTop = Math.min(height - 0.05, p.door.height ?? DOOR_OPENING.height);
  const center = Math.max(width / 2 + 0.1, Math.min(length - width / 2 - 0.1, p.door.offset ?? length / 2));
  const pieces = [{ from: 0, to: center - width / 2, bottom: 0, top: height }, { from: center + width / 2, to: length, bottom: 0, top: height }];
  if (height - doorTop > 0.02) pieces.push({ from: center - width / 2, to: center + width / 2, bottom: doorTop, top: height });
  return pieces.filter(piece => piece.to - piece.from > 0.01);
}

export function snapValue(value, step = 0.05) { return Math.round(value / step) * step; }
// Orthogonal by default; a free angle snaps to 15 degrees.
export function snapPoint(start, point, { step = 0.05, free = false } = {}) {
  if (!start) return [round(snapValue(point[0], step)), round(snapValue(point[1], step))];
  const dx = point[0] - start[0], dz = point[1] - start[1], length = Math.hypot(dx, dz);
  let angle = Math.atan2(dz, dx);
  angle = Math.round(angle / (free ? Math.PI / 12 : Math.PI / 2)) * (free ? Math.PI / 12 : Math.PI / 2);
  const snapped = snapValue(length, step);
  return [round(start[0] + Math.cos(angle) * snapped), round(start[1] + Math.sin(angle) * snapped)];
}

function segmentDistance(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], len2 = dx * dx + dz * dz;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}
// A partition must stand inside the unit: its centerline samples lie in rooms
// or in demolished wall gaps, and it may touch (not run inside) existing walls.
export function validatePartition(p, info, { removed = [], segments = [] } = {}) {
  const length = partitionLength(p);
  if (!(length >= 0.3)) return '가벽은 30cm 이상 길이로 그려 주세요.';
  if (length > 12) return '가벽은 12m 이하로 나눠 그려 주세요.';
  const rooms = info.rooms ?? [], { dir } = partitionFrame(p);
  const gaps = segments.filter(s => removed.includes(s.id)).map(s => removalBox(s, undefined, 0.01));
  const samples = Math.max(3, Math.ceil(length / 0.1));
  let outside = 0;
  for (let i = 0; i <= samples; i++) {
    const t = 0.06 + (length - 0.12) * i / samples, x = p.a[0] + dir[0] * t, z = p.a[1] + dir[1] * t;
    const inRoom = rooms.some(r => roomContains(r, x, z)), inGap = gaps.some(g => x >= g.minX && x <= g.maxX && z >= g.minZ && z <= g.maxZ);
    if (!inRoom && !inGap) outside++;
  }
  // Endpoints may stop inside an adjoining wall face; the run itself may not.
  if (outside > Math.max(1, samples * 0.08)) return '가벽이 기존 벽이나 세대 밖을 지나가요. 방 안쪽에서 벽면까지 그려 주세요.';
  if (p.door) {
    const opening = partitionPieces(p).length;
    if (length < (p.door.width ?? DOOR_OPENING.width) + 0.3) return '문을 넣으려면 가벽이 문 폭보다 30cm 이상 길어야 해요.';
    if (!opening) return '문 위치를 확인해 주세요.';
  }
  const doors = (info.openings ?? []).filter(o => o.kind === 'door' || o.kind === 'sliding');
  for (const o of doors) {
    const [x, z] = o.center_m;
    if (segmentDistance([x, z], p.a, p.b) < (o.width_m ?? 0.9) / 2 + 0.05 && !removed.some(id => segments.find(s => s.id === id)?.openings.some(op => op.id === o.id))) return '기존 문 앞을 막아요. 문에서 떨어진 위치에 그려 주세요.';
  }
  return null;
}

// Plan-level state ------------------------------------------------------------
export function emptyStructure() { return { version: 1, removed: [], partitions: [] }; }
export function normalizeStructure(data, segments) {
  if (!data) return emptyStructure();
  if (data.version !== 1 || !Array.isArray(data.removed) || !Array.isArray(data.partitions)) throw Error('저장된 구조 변경 형식이 올바르지 않아요.');
  const ids = new Set(segments.map(s => s.id));
  const removed = [...new Set(data.removed.filter(id => typeof id === 'string'))];
  if (removed.some(id => !ids.has(id))) throw Error('현재 평면과 맞지 않는 철거 벽이 있어 복원하지 않았어요.');
  const partitions = data.partitions.map((p, i) => {
    const a = p?.a?.map(Number), b = p?.b?.map(Number);
    if (!a || !b || ![...a, ...b].every(Number.isFinite) || !PARTITION_TYPES[p.type]) throw Error('저장된 가벽 정보가 올바르지 않아요.');
    return { id: typeof p.id === 'string' ? p.id : `pt-${i + 1}`, type: p.type, a, b, thickness: Number(p.thickness) || PARTITION_TYPES[p.type].thickness,
      height: p.height == null ? null : Number(p.height), door: p.door ? { offset: Number(p.door.offset), width: Number(p.door.width) || DOOR_OPENING.width, height: Number(p.door.height) || DOOR_OPENING.height } : null,
      movedFrom: typeof p.movedFrom === 'string' ? p.movedFrom : null };
  });
  return { version: 1, removed, partitions };
}

// A moved original wall becomes a removed segment plus a parallel partition of
// the original thickness, spanning the same perpendicular walls.
export function movedWall(segment, offset, existing = null) {
  const [[ax, az], [bx, bz]] = segmentLine(segment, offset);
  const extend = 0; // the line already ends on perpendicular wall faces
  return { id: existing?.id ?? `mv-${segment.id}`, type: existing?.type ?? 'block', a: [round(ax - (segment.axis === 'x' ? extend : 0)), round(az - (segment.axis === 'z' ? extend : 0))],
    b: [round(bx + (segment.axis === 'x' ? extend : 0)), round(bz + (segment.axis === 'z' ? extend : 0))], thickness: Math.max(0.1, Math.min(0.24, segment.thickness)), height: null,
    door: existing?.door ?? (segment.openings.some(o => o.kind === 'door') ? { offset: segment.length / 2, width: DOOR_OPENING.width, height: DOOR_OPENING.height } : null), movedFrom: segment.id };
}
export function movedOffset(segment, partition) {
  const mid = [(partition.a[0] + partition.b[0]) / 2, (partition.a[1] + partition.b[1]) / 2];
  return (segment.axis === 'x' ? mid[1] : mid[0]) - segment.center;
}

// Quantities consumed by the estimate. Areas in m², lengths in m, volume in m³.
export function structureQuantities(structure, segments, ceiling = 2.6) {
  const byId = new Map(segments.map(s => [s.id, s]));
  const demolition = structure.removed.map(id => byId.get(id)).filter(Boolean).map(s => {
    const openingArea = s.openings.reduce((sum, o) => sum + Math.min(o.width, s.length) * Math.min(o.height, ceiling), 0);
    const area = Math.max(0, s.length * ceiling - openingArea);
    return { id: s.id, label: `${s.roomNames.join(' ↔ ')} 벽`, length: s.length, thickness: s.thickness, area, volume: area * s.thickness,
      doors: s.openings.filter(o => o.kind === 'door').length, sashes: s.openings.filter(o => o.kind === 'sliding' || o.kind === 'window').length, caution: s.caution, rooms: s.rooms };
  });
  const partitions = structure.partitions.map(p => {
    const pieces = partitionPieces(p, ceiling), area = pieces.reduce((sum, q) => sum + (q.to - q.from) * (q.top - q.bottom), 0);
    return { id: p.id, type: p.type, label: PARTITION_TYPES[p.type].label, length: partitionLength(p), height: Math.max(...pieces.map(q => q.top)), area, door: Boolean(p.door), movedFrom: p.movedFrom };
  });
  return { demolition, partitions };
}
