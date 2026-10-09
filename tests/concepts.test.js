import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Box3, Vector3 } from 'three';
import { CONCEPTS, PALETTES, HOUSEHOLDS, MOODS } from '../src/concepts/catalog.js';
import { FURNITURE } from '../src/concepts/furniture-spec.js';
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
  assert.equal(CONCEPTS.length, 4);
  for (const concept of CONCEPTS) {
    for (const item of concept.items) assert.ok(FURNITURE[item.kind], `${concept.id}: ${item.kind}`);
    for (const id of concept.palettes) assert.ok(PALETTES[id], id);
    for (const h of [...concept.households, ...(concept.also ?? [])]) assert.ok(HOUSEHOLDS.some((x) => x.id === h), h);
  }
  for (const palette of Object.values(PALETTES)) {
    assert.ok(MOODS.some((m) => m.id === palette.mood));
    assert.ok(['original', 'oak', 'stone'].includes(palette.finish));
    for (const slot of Object.keys(palette.colors)) assert.ok(MATERIALS[slot], slot);
  }
});

for (const variant of ['expanded', 'basic']) {
  test(`every concept fits the ${variant} plan without overlap, boundary or door-swing warnings`, () => {
    const doorAreas = doorFootprints(PLANS[variant].doors);
    for (const concept of CONCEPTS) {
      const result = plan(concept, variant);
      assert.deepEqual(result.skipped, [], `${concept.id} skipped ${JSON.stringify(result.skipped)}`);
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
  assert.deepEqual([...KIT_KINDS].sort(), Object.keys(FURNITURE).sort());
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
