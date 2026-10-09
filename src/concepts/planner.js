// Resolves concept layouts (catalog.js) onto a loaded plan and checks them with the
// studio's own advisory rules, so a concept never lands where the editor would warn.
// Pure functions: rooms, doors and kept furniture are passed in; fixed fittings that
// only exist in the GLB are checked by the browser tests.
import { FURNITURE, MODEL_FURNITURE, FACING, footprint } from './furniture-spec.js';
import { CONCEPTS, NEEDS, PALETTES } from './catalog.js';
import { placementWarnings, doorFootprints } from '../walkthrough/layout.js';

export const CLEARANCE_WARNING = '가구 사이 여유가 60cm 미만일 수 있어요.';

function along([mode, value = 0], low, high, extent) {
  if (mode === 'min') return low + value + extent / 2;
  if (mode === 'max') return high - value - extent / 2;
  if (mode === 'mid') return (low + high) / 2 + value;
  if (mode === 'at') return value;
  throw new Error(`Unknown placement mode: ${mode}`);
}

/** Center, angle and local size of one placement spec inside a room. */
export function resolveSpec(spec, room) {
  const size = FURNITURE[spec.kind];
  if (!size) throw new Error(`Unknown furniture kind: ${spec.kind}`);
  const extent = footprint(spec.kind, spec.face);
  const [x1, z1, x2, z2] = room.bounds_m;
  return { kind: spec.kind, x: along(spec.x, x1, x2, extent.x), z: along(spec.z, z1, z2, extent.z),
    angle: FACING[spec.face], width: size.w, depth: size.d, height: size.h };
}

/**
 * Places a concept on one plan. `existing` lists model furniture the concept keeps
 * (studio staging items), so new pieces keep their distance from it too.
 */
export function planConcept(concept, { variant, rooms, doors = [], existing = [] }) {
  const doorAreas = doorFootprints(doors);
  const placed = existing.map((item) => ({ ...item }));
  const placements = [], skipped = [], notes = [];
  concept.items.forEach((base, index) => {
    let spec = base;
    if (base.variants && Object.hasOwn(base.variants, variant)) {
      const override = base.variants[variant];
      if (override?.note) notes.push(override.note);
      if (override === null) { skipped.push({ kind: base.kind, room: base.room, reason: '이 평면에서는 생략해요.' }); return; }
      spec = { ...base, ...override };
    }
    const room = rooms.find((r) => r.id === spec.room);
    if (!room) { skipped.push({ kind: spec.kind, room: spec.room, reason: '이 평면에 없는 공간이에요.' }); return; }
    const options = [spec, ...(spec.candidates ?? []).map((candidate) => ({ ...spec, ...candidate }))];
    for (const option of options) {
      const item = { id: `${concept.id}-${index}`, ...resolveSpec(option, room) };
      const issues = placementWarnings(item, room, placed, [], doorAreas)
        .filter((message) => !(option.allowClose && message === CLEARANCE_WARNING));
      if (issues.length) continue;
      placed.push(item);
      placements.push({ ...item, room: room.id, face: option.face, title: FURNITURE[option.kind].title,
        allowClose: Boolean(option.allowClose), why: option.why });
      return;
    }
    if (!spec.optional) skipped.push({ kind: spec.kind, room: spec.room, reason: '이 평면에서는 공간이 부족해요.' });
  });
  return { placements, skipped, notes };
}

/** Sleeping places, desks, dining seats and play/storage pieces a layout provides. */
export function summarize(placements, keptKinds = []) {
  const total = { sleeps: 0, infant: 0, desks: 0, dining: 0, seats: 0, play: 0, storage: 0 };
  const add = (spec) => {
    for (const key of ['sleeps', 'infant', 'desks', 'dining', 'seats']) total[key] += spec[key] ?? 0;
    if (spec.play) total.play += 1;
    if (spec.storage) total.storage += 1;
  };
  for (const p of placements) add(FURNITURE[p.kind]);
  for (const kind of keptKinds) if (MODEL_FURNITURE[kind]) add(MODEL_FURNITURE[kind]);
  return total;
}

export function checkNeeds(summary, household) {
  return (NEEDS[household] ?? []).map((need) => ({ ...need, value: summary[need.key], ok: summary[need.key] >= need.min }));
}

export function pickPalette(concept, mood) {
  return concept.palettes.find((id) => PALETTES[id].mood === mood) ?? concept.palettes[0];
}

/**
 * Orders concepts for a household and mood. Household fit counts most, then the share
 * of that household's needs the laid-out furniture meets, then a palette in the mood.
 * Ties keep catalog order (Array#sort is stable).
 */
export function rankConcepts({ household = null, mood = null } = {}, summaries = new Map()) {
  return CONCEPTS.map((concept) => {
    let score = 0;
    const needs = household ? checkNeeds(summaries.get(concept.id) ?? summarize([]), household) : [];
    if (household) {
      if (concept.households.includes(household)) score += 3;
      else if (concept.also?.includes(household)) score += 1.5;
      score += 2 * needs.filter((n) => n.ok).length / Math.max(1, needs.length);
    }
    if (mood && concept.palettes.some((id) => PALETTES[id].mood === mood)) score += 1;
    const fit = !household ? null : concept.households.includes(household) ? 'best'
      : concept.also?.includes(household) ? 'good' : 'other';
    return { concept, score, fit, needs, palette: pickPalette(concept, mood) };
  }).sort((a, b) => b.score - a.score);
}
