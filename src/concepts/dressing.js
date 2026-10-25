// Styling props for a laid-out concept: art above sofas, beds, sideboards and pianos,
// curtains on window walls, a pendant over the dining table, lamps beside sofas, beds and
// lounge chairs, and shelves above desks. Decoration only — they are not staging items, colliders or plan
// furniture. planDressing() is pure; createDressing() builds and swaps the props on a model.
import { Group } from 'three';
import { FURNITURE, FACING } from './furniture-spec.js';
import { buildDressing } from './kit.js';
import { doorFootprints, corners } from '../walkthrough/layout.js';

const SOFAS = new Set(['sofa4', 'sofa3', 'loveseat', 'sofaLow']);
const BEDS = new Set(['singleBed', 'queenBed']);
const DESKS = new Set(['deskSet', 'deskWide', 'deskPro']);
const DINING = new Set(['dining6', 'dining4', 'dining2']);
const WINDOW_ROOMS = ['Living front', 'Bedroom west', 'Bedroom center', 'Master bedroom']; // glazing on the south wall

const front = (angle) => [Math.round(Math.sin(angle)), Math.round(Math.cos(angle))];
const extent = (p) => { const turned = Math.abs(Math.sin(p.angle)) > 0.5; return { x: turned ? p.depth : p.width, z: turned ? p.width : p.depth }; };
const rect = (x, z, w, d) => ({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
const overlaps = (a, b, gap = 0) => a.x0 < b.x1 + gap && a.x1 > b.x0 - gap && a.z0 < b.z1 + gap && a.z1 > b.z0 - gap;
const footprintRect = (p) => { const e = extent(p); return rect(p.x, p.z, e.x, e.z); };
const cornersRect = (item) => { const c = corners(item), xs = c.map((v) => v[0]), zs = c.map((v) => v[1]); return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) }; };

/**
 * placements: the concept's planned pieces (planner output) on this plan; kept: model
 * furniture the concept keeps (the king bed, headboard on the west). Returns props as
 * { kind, x, y, z, angle, options }.
 */
export function planDressing(placements, rooms, { kept = [], doors = [], seed = 1 } = {}) {
  const props = [];
  const roomOf = (id) => rooms.find((r) => r.id === id);
  const blockers = [...kept.map(footprintRect), ...placements.filter((p) => !FURNITURE[p.kind]?.flat).map(footprintRect)];
  const doorRects = doorFootprints(doors).map(cornersRect);
  const free = (r, room) => {
    const [x1, z1, x2, z2] = room.bounds_m;
    return r.x0 >= x1 + 0.02 && r.x1 <= x2 - 0.02 && r.z0 >= z1 + 0.02 && r.z1 <= z2 - 0.02
      && !blockers.some((b) => overlaps(r, b, 0.04)) && !doorRects.some((d) => overlaps(r, d, 0.02));
  };
  const take = (r) => blockers.push(r);
  let art = seed;

  // The wall behind a piece, if the piece stands against it: [x, z, angle facing the room].
  function wallBehind(p, room) {
    const [fx, fz] = front(p.angle), e = extent(p), [x1, z1, x2, z2] = room.bounds_m;
    const gap = fz < 0 ? z2 - (p.z + e.z / 2) : fz > 0 ? (p.z - e.z / 2) - z1 : fx < 0 ? x2 - (p.x + e.x / 2) : (p.x - e.x / 2) - x1;
    if (gap > 0.3) return null;
    if (fz > 0) return [p.x, z1 + 0.03, p.angle];
    if (fz < 0) return [p.x, z2 - 0.03, p.angle];
    if (fx > 0) return [x1 + 0.03, p.z, p.angle];
    return [x2 - 0.03, p.z, p.angle];
  }
  // Beside a piece along its width, level with its back: tries both ends.
  function beside(p, room, size, inset = 0.04) {
    const [fx, fz] = front(p.angle), e = extent(p), lateral = [fz, -fx];
    const along = (fx ? e.z : e.x) / 2 + inset + size / 2;
    const backShift = ((fx ? e.x : e.z) - size) / 2; // align the prop's back with the piece's back
    for (const side of [1, -1]) {
      const x = p.x + lateral[0] * along * side - fx * backShift, z = p.z + lateral[1] * along * side - fz * backShift;
      const r = rect(x, z, size, size);
      if (free(r, room)) { take(r); return [x, z]; }
    }
    return null;
  }
  const addArt = (spot, y, w, h) => spot && props.push({ kind: 'art', x: spot[0], y, z: spot[1], angle: spot[2], options: { w, h, seed: art++ } });

  for (const p of placements) {
    const room = roomOf(p.room);
    if (!room) continue;
    if (SOFAS.has(p.kind)) {
      addArt(wallBehind(p, room), 1.5, p.width >= 2.2 ? 1.2 : 0.9, p.width >= 2.2 ? 0.8 : 0.65);
      const spot = beside(p, room, 0.46);
      if (spot) props.push({ kind: 'sideLamp', x: spot[0], y: 0, z: spot[1], angle: p.angle });
    } else if (p.kind === 'armchair') {
      const spot = beside(p, room, 0.46);
      if (spot) props.push({ kind: 'sideLamp', x: spot[0], y: 0, z: spot[1], angle: p.angle });
    } else if (BEDS.has(p.kind)) {
      addArt(wallBehind(p, room), 1.5, p.width > 1.4 ? 1.0 : 0.7, p.width > 1.4 ? 0.65 : 0.5);
      const spot = beside(p, room, 0.44);
      if (spot) props.push({ kind: 'nightLamp', x: spot[0], y: 0, z: spot[1], angle: p.angle });
    } else if (p.kind === 'sideboard' || p.kind === 'piano' || p.kind === 'toyShelf' || p.kind === 'dresser') {
      const tall = p.kind === 'piano' ? 1.7 : p.kind === 'dresser' ? null : 1.4;
      if (tall) addArt(wallBehind(p, room), tall, p.kind === 'sideboard' ? 1.0 : 0.7, p.kind === 'sideboard' ? 0.7 : 0.5);
    } else if (DESKS.has(p.kind)) {
      const spot = wallBehind(p, room);
      if (spot) props.push({ kind: 'wallShelf', x: spot[0], y: 1.5, z: spot[1], angle: spot[2], options: { w: Math.min(0.9, p.width * 0.6) } });
    } else if (DINING.has(p.kind)) {
      props.push({ kind: 'pendant', x: p.x, y: 0, z: p.z, angle: 0 });
    }
  }
  // The kept king bed: headboard on the west wall, art above it and a nightstand on each side.
  for (const k of kept.filter((item) => item.kind === 'king')) {
    const room = rooms.find((r) => k.x > r.bounds_m[0] && k.x < r.bounds_m[2] && k.z > r.bounds_m[1] && k.z < r.bounds_m[3]);
    if (!room) continue;
    props.push({ kind: 'art', x: room.bounds_m[0] + 0.03, y: 1.55, z: k.z, angle: FACING.east, options: { w: 1.1, h: 0.7, seed: art++ } });
    for (const side of [-1, 1]) {
      const z = k.z + side * (k.depth / 2 + 0.27), x = k.x - k.width / 2 + 0.22, r = rect(x, z, 0.44, 0.44);
      if (free(r, room)) { take(r); props.push({ kind: 'nightLamp', x, y: 0, z, angle: FACING.east }); }
    }
  }
  // Curtains at both ends of each south window wall, with a rod across.
  for (const id of WINDOW_ROOMS) {
    const room = roomOf(id);
    if (!room) continue;
    const [x1, , x2, z2] = room.bounds_m;
    let hung = 0;
    for (const xs of [[x1 + 0.3, x1 + 0.62], [x2 - 0.3, x2 - 0.62]]) {
      for (const x of xs) {
        const r = rect(x, z2 - 0.1, 0.54, 0.16);
        if (!free(r, room)) continue;
        take(r); hung += 1;
        props.push({ kind: 'curtain', x, y: 0, z: z2 - 0.1, angle: FACING.north });
        break;
      }
    }
    if (hung) props.push({ kind: 'rod', x: (x1 + x2) / 2, y: 2.45, z: z2 - 0.1, angle: 0, options: { length: x2 - x1 - 0.2 } });
  }
  return props;
}

/** Keeps one group of props on the active model; build() replaces whatever was there. */
export function createDressing() {
  const groups = new WeakMap();
  function clear(model) {
    const group = groups.get(model);
    if (!group) return;
    model.remove(group);
    group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); if (o.material.map) { o.material.map.dispose(); o.material.dispose(); } } });
    groups.delete(model);
  }
  return {
    clear,
    build(model, props, colors) {
      clear(model);
      const group = new Group();
      group.name = 'Concept styling';
      for (const prop of props) {
        const piece = buildDressing(prop.kind, { ...prop.options, colors });
        piece.position.set(prop.x, prop.y, prop.z);
        piece.rotation.y = prop.angle;
        piece.traverse((o) => { if (o.isMesh) { o.castShadow = prop.kind !== 'rod'; o.receiveShadow = true; } });
        group.add(piece);
      }
      model.add(group);
      groups.set(model, group);
      return group;
    },
  };
}
