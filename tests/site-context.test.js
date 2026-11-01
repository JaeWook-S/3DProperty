import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const site = JSON.parse(readFileSync(new URL('../assets/location/acro-river-park/site-context.json', import.meta.url)));

test('site context keeps the actual 100–114 OSM building ids and metre frame', () => {
  assert.equal(site.schema, 'cortex.site-context.v1');
  assert.deepEqual(site.coordinate_frame, { unit: 'm', x: 'east', z: 'south' });
  assert.deepEqual(site.buildings.map(({ id }) => id), Array.from({ length: 15 }, (_, index) => String(100 + index)));
  assert.ok(site.site_boundary_m.length >= 4);
  assert.equal(site.provenance.osm_license, 'ODbL 1.0');
});

test('OSM levels and heights replace the old fixed two-metre floor spacing', () => {
  const expected = new Map([
    ['100', [21, 74]], ['102', [22, 77]], ['103', [35, 122]],
    ['109', [38, 132]], ['112', [19, 68]], ['114', [38, 132]],
  ]);
  for (const building of site.buildings) {
    assert.ok(building.parts.length >= 1);
    assert.ok(building.nominal_storey_height_m > 3);
    assert.notEqual(building.nominal_storey_height_m, 2);
    for (const part of building.parts) {
      assert.ok(part.footprint_m.length >= 3);
      assert.ok(part.height_m > 0 && part.height_m <= building.height_m);
    }
    if (expected.has(building.id)) assert.deepEqual([building.levels, building.height_m], expected.get(building.id));
  }
});

test('site context carries the named surrounding roads and the three OSM gates', () => {
  assert.deepEqual(new Set(site.roads.map(({ name }) => name)), new Set(['올림픽대로', '신반포로', '신반포로15길']));
  assert.deepEqual(site.gates.map(({ name }) => name).sort(), [
    '아크로리버파크 GATE 1', '아크로리버파크 GATE 2', '아크로리버파크 GATE 3',
  ]);
});

test('conflicting OSM part levels stay traceable without exceeding the building height', () => {
  const building = site.buildings.find(({ id }) => id === '111');
  assert.equal(building.levels, 21);
  assert.equal(building.height_m, 79);
  assert.ok(building.data_warnings.some((warning) => warning.includes('levels 22 exceeds building levels 21')));
  assert.ok(building.parts.every(({ height_m }) => height_m <= building.height_m));
});
