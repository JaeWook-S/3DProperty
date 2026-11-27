import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Box3, Vector3 } from 'three';
import { CONCEPTS, PALETTES, HOUSEHOLDS, MOODS } from '../src/concepts/catalog.js';
import { FURNITURE, PIECES, isSetKind, expandPlacement, expandSaved } from '../src/concepts/furniture-spec.js';
import { planConcept, summarize, checkNeeds, rankConcepts, pickPalette, CLEARANCE_WARNING } from '../src/concepts/planner.js';
import { buildFurniture, KIT_KINDS, MATERIALS, applyPalette } from '../src/concepts/kit.js';
import { navigationRooms } from '../src/walkthrough/minimap-geometry.js';
import { placementWarnings, placementError, doorFootprints } from '../src/walkthrough/layout.js';

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const PLANS = {
  expanded: { rooms: navigationRooms(json('../src/walkthrough/model-info.json')), doors: json('../src/walkthrough/doors.json') },
  basic: { rooms: navigationRooms(json('../src/walkthrough/basic-info.json')), doors: json('../src/walkthrough/basic-doors.json') },
};
// The 112A king bed every concept keeps (its staging footprint in the v3 model).
const KING = { id: 'king-bed', kind: 'king', x: 11.34, z: 6.32, width: 2.16, depth: 1.8, height: 1.14, angle: 0 };
const plan = (concept, variant) => planConcept(concept, { variant, ...PLANS[variant], existing: [KING] });

test('catalog references only known furniture, palettes, households and moods', () => {
  assert.equal(CONCEPTS.length, 8);
  for (const concept of CONCEPTS) {
    for (const item of concept.items) assert.ok(FURNITURE[item.kind], `${concept.id}: ${item.kind}`);
    for (const id of concept.palettes) assert.ok(PALETTES[id], id);
    for (const h of [...concept.households, ...(concept.also ?? [])]) assert.ok(HOUSEHOLDS.some((x) => x.id === h), h);
  }
  for (const palette of Object.values(PALETTES)) {
    assert.ok(MOODS.some((m) => m.id === palette.mood));
    assert.ok(['original', 'oak', 'stone', 'walnut'].includes(palette.finish));
    for (const slot of Object.keys(palette.colors)) assert.ok(MATERIALS[slot], slot);
  }
});

for (const variant of ['expanded', 'basic']) {
  test(`every concept fits the ${variant} plan without overlap, boundary or door-swing warnings`, () => {
    const doorAreas = doorFootprints(PLANS[variant].doors);
    for (const concept of CONCEPTS) {
      const result = plan(concept, variant);
      assert.deepEqual(result.skipped.filter((s) => !s.optional), [], `${concept.id} skipped ${JSON.stringify(result.skipped)}`);
      const placed = [KING, ...result.placements];
      for (const item of result.placements) {
        const room = PLANS[variant].rooms.find((r) => r.id === item.room);
        const issues = placementWarnings(item, room, placed, [], doorAreas)
          .filter((message) => !(item.allowClose && message === CLEARANCE_WARNING));
        assert.deepEqual(issues, [], `${concept.id} ${item.kind} in ${item.room}`);
      }
    }
  });
}

test('household needs: the expanded plan meets each concept\'s primary household, the basic plan explains its smaller table', () => {
  for (const concept of CONCEPTS) {
    const needs = checkNeeds(summarize(plan(concept, 'expanded').placements, concept.keep), concept.households[0]);
    assert.ok(needs.every((n) => n.ok), `${concept.id}: ${JSON.stringify(needs)}`);
  }
  const family = CONCEPTS.find((c) => c.id === 'family-lounge');
  const basic = plan(family, 'basic');
  assert.ok(basic.placements.some((p) => p.kind === 'dining2'));
  assert.ok(basic.notes.some((n) => n.includes('2인 식탁')));
  const dining = checkNeeds(summarize(basic.placements, family.keep), 'family4').find((n) => n.key === 'dining');
  assert.equal(dining.ok, false);
  const summary = summarize(plan(family, 'expanded').placements, family.keep);
  assert.equal(summary.sleeps, 4); assert.equal(summary.desks, 2); assert.equal(summary.dining, 6);
});

test('ranking puts the matching concept first and the mood picks the palette', () => {
  const summaries = new Map(CONCEPTS.map((c) => [c.id, summarize(plan(c, 'expanded').placements, c.keep)]));
  const expectations = { family4: 'family-lounge', baby: 'kids-play', couple: 'newlywed', solo: 'wfh-studio' };
  for (const [household, first] of Object.entries(expectations)) {
    const ranked = rankConcepts({ household }, summaries);
    assert.equal(ranked[0].concept.id, first, household);
    assert.equal(ranked[0].fit, 'best');
  }
  assert.deepEqual(rankConcepts({}, summaries).map((r) => r.concept.id), CONCEPTS.map((c) => c.id));
  const family = CONCEPTS.find((c) => c.id === 'family-lounge');
  assert.equal(pickPalette(family, 'classic'), 'walnut-navy');
  assert.equal(pickPalette(family, 'modern'), 'oat-oak');
});

test('kit pieces are built at their catalog sizes, centered, standing on the floor', () => {
  // 집들이 set pieces are GLBs; table/desk sets exist only in plans (staging holds their pieces).
  assert.deepEqual([...KIT_KINDS].sort(), Object.keys(FURNITURE).filter(kind => !FURNITURE[kind].set && !isSetKind(kind)).sort());
  for (const kind of KIT_KINDS) {
    const group = buildFurniture(kind);
    const box = new Box3().setFromObject(group), size = box.getSize(new Vector3()), center = box.getCenter(new Vector3());
    const spec = FURNITURE[kind];
    assert.ok(Math.abs(size.x - spec.w) < 0.035, `${kind} width ${size.x} vs ${spec.w}`);
    assert.ok(Math.abs(size.z - spec.d) < 0.035, `${kind} depth ${size.z} vs ${spec.d}`);
    // Small decor (vases, desk lamps, toys) may rise above the product height.
    assert.ok(size.y > spec.h - 0.06 && size.y < spec.h + 0.25, `${kind} height ${size.y} vs ${spec.h}`);
    assert.ok(Math.abs(center.x) < 1e-6 && Math.abs(center.z) < 1e-6 && Math.abs(box.min.y) < 1e-6, kind);
    assert.ok(group.children.length <= 12, `${kind} merges parts per material (${group.children.length} meshes)`);
  }
});

test('palettes recolor the shared kit materials', () => {
  applyPalette(PALETTES['charcoal-green'].colors);
  assert.equal(`#${MATERIALS.fabric.color.getHexString()}`, PALETTES['charcoal-green'].colors.fabric);
  applyPalette(PALETTES['oat-oak'].colors);
  assert.equal(`#${MATERIALS.accent.color.getHexString()}`, PALETTES['oat-oak'].colors.accent);
});

test('rugs and mats lie under furniture, and walls separate rooms for the 60 cm check', () => {
  const room = { bounds_m: [0, 0, 6, 6] };
  const rug = { id: 'rug', x: 3, z: 3, width: 2.4, depth: 1.7, height: 0.012, angle: 0 };
  const sofa = { id: 'sofa', x: 3, z: 3.2, width: 2.2, depth: 0.95, height: 0.8, angle: 0 };
  assert.deepEqual(placementWarnings(sofa, room, [rug], []), []);
  assert.deepEqual(placementWarnings(rug, room, [sofa], []), []);
  assert.equal(placementError(sofa, room, [rug], []), null);
  // A bookshelf 30 cm away but in the next room (behind a wall) is not a passage problem.
  const left = { bounds_m: [0, 0, 3, 6] };
  const shelf = { id: 'shelf', x: 2.8, z: 3, width: 0.33, depth: 0.8, height: 1.8, angle: 0 };
  const neighbour = { id: 'tv', x: 3.3, z: 3, width: 0.42, depth: 1.8, height: 1.3, angle: 0 };
  assert.deepEqual(placementWarnings(shelf, left, [neighbour], []), []);
  assert.ok(placementWarnings(shelf, room, [neighbour], []).includes(CLEARANCE_WARNING));
});

test('tables and desks land apart from their chairs, inside the planned set footprint', () => {
  const kitSets = Object.keys(PIECES).filter(kind => !FURNITURE[kind].set);
  assert.deepEqual(kitSets.sort(), ['deskPro', 'deskSet', 'deskWide', 'dining2', 'dining4', 'dining6', 'dresser', 'kidsTable', 'loftBed']);
  for (const set of kitSets) {
    const spec = FURNITURE[set], [[table], ...chairs] = PIECES[set];
    assert.ok(FURNITURE[table].table && KIT_KINDS.includes(table), `${set}: ${table}`);
    assert.ok(chairs.length && chairs.every(([kind]) => FURNITURE[kind].chair && KIT_KINDS.includes(kind)), set);
    for (const [kind, x, z, facing] of PIECES[set]) {
      const turned = Math.abs(Math.sin(facing)) > 0.5, w = turned ? FURNITURE[kind].d : FURNITURE[kind].w, d = turned ? FURNITURE[kind].w : FURNITURE[kind].d;
      assert.ok(Math.abs(x) + w / 2 <= spec.w / 2 + 0.01 && Math.abs(z) + d / 2 <= spec.d / 2 + 0.01, `${set}: ${kind} at ${x}, ${z}`);
    }
  }
  // Only the loft bed is both a plan kind and a piece; a set kind never has its own template.
  assert.equal(isSetKind('loftBed'), false);
  assert.equal(isSetKind('dining6'), true);
  assert.deepEqual(expandPlacement({ kind: 'sofa3', x: 1, z: 2, angle: Math.PI }, 'added-a-0'), [{ kind: 'sofa3', id: 'added-a-0', x: 1, z: 2, angle: Math.PI }]);
  // A chair that faced north (+π) in a north-facing set turns all the way round to 0, not 2π.
  assert.deepEqual(expandPlacement({ kind: 'dining4', x: 0, z: 0, angle: Math.PI }, 'a').filter(p => p.kind === 'sideChair').map(p => p.angle), [Math.PI, 0, Math.PI, 0]);
  // Layouts saved before the split come back as pieces, in the same room.
  const saved = expandSaved([{ id: 'added-c-3', kind: 'deskSet', title: '책상 세트', x: 2, z: 3, angle: 0, deleted: false, roomId: 'r1' }, { id: 'sofa', kind: 'sofa', x: 1, z: 1, angle: 0 }]);
  assert.deepEqual(saved.map(p => [p.id, p.kind, p.title, p.roomId]), [['added-c-3', 'studyDesk', '책상', 'r1'], ['added-c-3-1', 'officeChair', '사무용 의자', 'r1'], ['sofa', 'sofa', undefined, undefined]]);
});

test('a chair may stand under or beside its table and next to other chairs without overlap or passage warnings', () => {
  const room = { bounds_m: [0, 0, 6, 6] };
  const table = { id: 't', x: 3, z: 3, width: 1.4, depth: 0.8, height: 0.8, angle: 0, table: true };
  const chair = { id: 'c1', x: 2.65, z: 3.6, width: 0.44, depth: 0.43, height: 0.88, angle: Math.PI, chair: true };
  const next = { ...chair, id: 'c2', x: 3.35 };
  assert.deepEqual(placementWarnings(chair, room, [table, next], []), []);
  assert.deepEqual(placementWarnings(table, room, [chair, next], []), []);
  assert.equal(placementError(chair, room, [table], []), null);
  // Two chairs on the same spot still overlap, and a chair still keeps clear of other furniture.
  assert.equal(placementError({ ...next, x: 2.7 }, room, [chair], []), '다른 가구와 겹쳐요.');
  const sofa = { id: 's', x: 2.65, z: 4.1, width: 2.2, depth: 0.95, height: 0.8, angle: 0 };
  assert.equal(placementError(chair, room, [sofa], []), '다른 가구와 겹쳐요.');
  assert.ok(placementWarnings({ ...chair, z: 3.2 }, room, [{ ...sofa, z: 4.4 }], []).includes(CLEARANCE_WARNING));
});

test('searched placements retain fallback option and plan override metadata for house-tour comparisons', () => {
  const room = { id: 'room', bounds_m: [0, 0, 4, 4] };
  const obstacle = { id: 'fixed', x: 2, z: 2, width: 0.5, depth: 0.5, height: 1, angle: 0 };
  const concept = { id: 'search-provenance', items: [{ kind: 'plant', room: ['missing', 'room'], face: 'south',
    x: ['at', 2], z: ['at', 2], candidates: [{ x: ['at', -1] }],
    variants: { basic: { note: 'Use the available floor area.' } } }] };
  const result = planConcept(concept, { variant: 'basic', rooms: [room], obstacles: [obstacle], search: true });
  assert.equal(result.placements.length, 1);
  const [placement] = result.placements;
  assert.equal(placement.index, 0);
  assert.equal(placement.option, 0);
  assert.equal(placement.overridden, true);
  assert.equal(placement.note, 'Use the available floor area.');
  assert.equal(placement.room, 'room');
  assert.notDeepEqual([placement.x, placement.z], [2, 2]);
  assert.equal(placementError(placement, room, [], [obstacle]), null);
});
