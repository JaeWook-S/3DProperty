import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {
  getBuildingUnits, getFloorUnits, lookupUnit, getUnitModelVariants, variantForUnit,
  UNIT_CATALOG_SOURCE,
} from '../src/property/unit-catalog.js';

// Compare the public lookup with the retained user CSV, not the generator's
// intermediate JSON. This reviewed snapshot has no quoted CSV fields.
const csvPath = process.env.CORTEX_UNIT_SOURCE_CSV || new URL('../../AisideProject/datasets/acro-river-park/raw/naver/unit-mapping/2026-10-25/acroriverpark_units.csv', import.meta.url);
// Raw intake is retained separately; a standalone clone still runs all public
// catalogue behavior checks. Only independent source-parity checks need it.
const csvBytes = existsSync(csvPath) ? readFileSync(csvPath) : null;
const sourceOptions = {skip: csvBytes ? false : 'Set CORTEX_UNIT_SOURCE_CSV to the retained source CSV for independent parity checks'};
const csvText = (csvBytes?.toString('utf8') || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trimEnd();
assert.equal(csvText.includes('"'), false, 'Review the CSV parser if a future intake adds quoted fields');
const [header, ...csvLines] = csvText.split('\n');
const columns = header.split(',');
const sourceRows = csvLines.map(line => {
  const values = line.split(',');
  assert.equal(values.length, columns.length);
  return Object.fromEntries(columns.map((column, index) => [column, values[index]]));
});
const residential = sourceRows.filter(row => row['구분'] === '세대');
const otherCells = sourceRows.filter(row => row['구분'] !== '세대');
const buildingIds = Array.from({length: 15}, (_, index) => String(index + 100));
const allUnits = () => buildingIds.flatMap(getBuildingUnits);
const key = row => `${row.building}/${row.floor}/${row.unit}`;
const expectedRecord = row => ({
  building: row['동'], floor: Number(row['층']), unit: row['호'], line: Number(row['라인']),
  type: row['평형타입'], supplyM2: Number(row['공급면적㎡']), exclusiveM2: Number(row['전용면적㎡']),
});
const project = ({building, floor, unit, line, type, supplyM2, exclusiveM2}) => ({building, floor, unit, line, type, supplyM2, exclusiveM2});
const sorted = records => records.map(project).sort((a, b) => key(a).localeCompare(key(b)));
const countBy = (rows, field) => rows.reduce((counts, row) => {
  counts[row[field]] = (counts[row[field]] || 0) + 1;
  return counts;
}, {});
const variants = {
  '112A': ['112a-basic-archisketch', '112a-expanded-archisketch'],
  '168C': ['168c-basic-archisketch', '168c-expanded-archisketch'],
};

test('public catalogue retains 1,612 unique units across 15 buildings', () => {
  const records = allUnits();
  assert.equal(records.length, 1612);
  assert.equal(new Set(records.map(key)).size, 1612);
  assert.equal(UNIT_CATALOG_SOURCE.renovationState, 'unknown');
});

test('all 1,612 residential records match the retained CSV exactly across 15 buildings', sourceOptions, () => {
  assert.equal(sourceRows.length, 1723);
  assert.equal(residential.length, 1612);
  assert.deepEqual([...new Set(sourceRows.map(row => row['동']))].sort(), buildingIds);
  const records = allUnits();
  assert.equal(records.length, 1612);
  assert.equal(new Set(records.map(key)).size, 1612);
  assert.deepEqual(sorted(records), sorted(residential.map(expectedRecord)));
  assert.equal(UNIT_CATALOG_SOURCE.csvSha256, createHash('sha256').update(csvBytes).digest('hex'));
  assert.equal(UNIT_CATALOG_SOURCE.renovationState, 'unknown');
});

test('all 111 piloti and other-space cells are excluded from unit and floor lookup', sourceOptions, () => {
  assert.equal(otherCells.length, 111);
  assert.deepEqual(countBy(otherCells, '구분'), {'기타공간': 41, '필로티': 70});
  for (const row of otherCells) {
    assert.equal(lookupUnit(row['동'], Number(row['층']), row['호']), null, JSON.stringify(row));
    assert.ok(!getFloorUnits(row['동'], row['층']).some(unit => unit.unit === row['호']));
  }
});

test('model availability is limited to the reviewed exact type and two-area matches', () => {
  const counts = {};
  for (const record of allUnits()) {
    const tuple = `${record.type}/${record.supplyM2}/${record.exclusiveM2}`;
    const expected = tuple === '112.74A/112.74/84.97' ? '112A'
      : tuple === '168.95C/168.95/129.96' ? '168C' : null;
    assert.equal(record.modelType, expected, key(record));
    assert.deepEqual([...getUnitModelVariants(record)].sort(), [...(variants[expected] || [])].sort());
    if (expected) counts[expected] = (counts[expected] || 0) + 1;
  }
  assert.deepEqual(counts, {'168C': 19, '112A': 190});
});

test('building 101 retains its 110 actual catalog units while reporting no prepared 3D model', () => {
  const records = getBuildingUnits('101');
  assert.equal(records.length, 110);
  assert.deepEqual(countBy(records, 'type'), {'79.24E': 18, '78.68D': 20, '110.68E': 46, '110.66G': 26});
  assert.deepEqual(getFloorUnits('101', 26).map(row => row.unit).sort(), ['2604', '2605']);
  assert.equal(lookupUnit('101', 1, '103'), null);
  assert.equal(lookupUnit('101', 4, '401'), null);
  for (const record of records) {
    assert.equal(record.modelType, null);
    assert.deepEqual(getUnitModelVariants(record), []);
    assert.equal(variantForUnit(record, '112a-expanded-archisketch'), null);
  }
});

test('floor lookup agrees with every source unit and accepts only exact floor values', () => {
  for (const building of buildingIds) {
    for (const floor of new Set(getBuildingUnits(building).map(row => row.floor))) {
      const expected = csvBytes
        ? residential.filter(row => row['동'] === building && Number(row['층']) === floor).map(expectedRecord)
        : getBuildingUnits(building).filter(row => row.floor === floor);
      assert.deepEqual(sorted(getFloorUnits(building, floor)), sorted(expected));
      assert.deepEqual(getFloorUnits(building, String(floor)), getFloorUnits(building, floor));
    }
  }
  const record = lookupUnit('100', 3, '305');
  assert.equal(record.type, '168.95C');
  assert.strictEqual(lookupUnit('100', '3', '305'), record);
  assert.equal(lookupUnit('100', 4, '305'), null);
  assert.equal(lookupUnit('100', 3, '9999'), null);
  assert.equal(lookupUnit('101', 3, '305').type, '110.66G');
  assert.deepEqual(getFloorUnits('100', 99), []);
});

test('invalid building, floor and raw unit inputs do not coerce into real selections', () => {
  for (const building of [undefined, null, 100, true, ['100'], {toString: () => '100'}, '', '0100', '100동', ' 100', '100 ', '115', '__proto__']) {
    assert.deepEqual(getBuildingUnits(building), []);
    assert.deepEqual(getFloorUnits(building, 3), []);
    assert.equal(lookupUnit(building, 3, '305'), null);
  }
  for (const floor of [undefined, null, false, [], ['3'], {}, '', '0', 0, -1, 3.5, NaN, Infinity, 3n, '03', '+3', '3.0', '3e0', ' 3', '3 ', '0x3', '3/305']) {
    assert.deepEqual(getFloorUnits('100', floor), []);
    assert.equal(lookupUnit('100', floor, '305'), null);
  }
  for (const unit of [undefined, null, 305, true, ['305'], {toString: () => '305'}, '', '0305', '305호', ' 305', '305 ', '3/305']) {
    assert.equal(lookupUnit('100', 3, unit), null);
  }
});

test('the same 318.75 square metre supply area keeps B-2 and B-3 as different literal types', () => {
  const records = ['318.75B-2', '318.75B-3'].map(type => {
    const source = allUnits().find(row => row.type === type);
    assert.ok(source);
    return lookupUnit(source.building, source.floor, source.unit);
  });
  assert.deepEqual(records.map(row => row.type), ['318.75B-2', '318.75B-3']);
  assert.equal(records[0].supplyM2, 318.75);
  assert.equal(records[1].supplyM2, 318.75);
  assert.notEqual(records[0].building, records[1].building);
  records.forEach(record => assert.deepEqual(getUnitModelVariants(record), []));
});

test('variant selection preserves a valid choice and carries basic preference across prepared types', () => {
  const records = Object.fromEntries(Object.keys(variants).map(type => [type, allUnits().find(row => row.modelType === type)]));
  for (const [type, record] of Object.entries(records)) {
    const [basic, expanded] = variants[type];
    assert.equal(variantForUnit(record, basic), basic);
    assert.equal(variantForUnit(record, expanded), expanded);
    assert.equal(variantForUnit(record, 'basic'), basic);
    for (const requested of [undefined, null, '', 'unrecognized', {}, 1]) {
      assert.equal(variantForUnit(record, requested), expanded);
    }
  }
  assert.equal(variantForUnit(records['112A'], variants['168C'][0]), variants['112A'][0]);
  assert.equal(variantForUnit(records['168C'], variants['112A'][0]), variants['168C'][0]);
  assert.equal(variantForUnit(records['112A'], variants['168C'][1]), variants['112A'][1]);
  assert.equal(variantForUnit(records['168C'], variants['112A'][1]), variants['168C'][1]);
});

test('model helpers reject copied, forged and otherwise invalid catalog records', () => {
  const supported = lookupUnit('100', 3, '305');
  const unsupported = lookupUnit('101', 3, '305');
  for (const record of [undefined, null, false, '168C', {}, {modelType: '168C'}, {...supported},
    {...unsupported, modelType: '168C'}, {...supported, building: '999'}, {...supported, floor: 4}]) {
    assert.deepEqual(getUnitModelVariants(record), []);
    assert.equal(variantForUnit(record, '168c-basic-archisketch'), null);
  }
});

test('readonly results prevent callers from changing future selections or supported variants', () => {
  const building = getBuildingUnits('100'), floor = getFloorUnits('100', 3);
  const record = lookupUnit('100', 3, '305'), allowed = getUnitModelVariants(record);
  const before = JSON.stringify(building);
  for (const result of [building, floor, record, allowed, getBuildingUnits('invalid')]) {
    assert.ok(Object.isFrozen(result));
  }
  assert.throws(() => { record.type = '112.74A'; }, TypeError);
  assert.throws(() => { record.modelType = '112A'; }, TypeError);
  assert.throws(() => building.pop(), TypeError);
  assert.throws(() => floor.push(record), TypeError);
  assert.throws(() => allowed.push('unreviewed-model'), TypeError);
  assert.equal(JSON.stringify(getBuildingUnits('100')), before);
  assert.strictEqual(lookupUnit('100', 3, '305'), record);
  assert.equal(variantForUnit(record, variants['168C'][0]), variants['168C'][0]);
});
