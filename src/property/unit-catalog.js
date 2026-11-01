import catalog from './acro-unit-catalog.json' with { type: 'json' };

// This is a small metadata lookup, not a set of Three.js scenes or GLB models.
const EMPTY = Object.freeze([]);
const VARIANTS = Object.freeze({
  '112A': Object.freeze(['112a-basic-archisketch', '112a-expanded-archisketch']),
  '168C': Object.freeze(['168c-basic-archisketch', '168c-expanded-archisketch']),
});
export const UNIT_CATALOG_SOURCE = Object.freeze({ ...catalog.source });
const buildings = new Map(), byUnit = new Map(), byFloor = new Map();
for (const [building, rows] of Object.entries(catalog.buildings)) {
  const records = rows.map(([floor, line, unit, typeIndex]) => Object.freeze({
    building, floor, line, unit, ...catalog.types[typeIndex],
  }));
  buildings.set(building, Object.freeze(records));
  for (const record of records) {
    byUnit.set(`${building}/${record.floor}/${record.unit}`, record);
    const key = `${building}/${record.floor}`;
    if (!byFloor.has(key)) byFloor.set(key, []);
    byFloor.get(key).push(record);
  }
}
for (const [key, rows] of byFloor) byFloor.set(key, Object.freeze(rows));

function validBuilding(value) {
  return typeof value === 'string' && buildings.has(value);
}
function floorNumber(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^[1-9]\d*$/.test(value))) return null;
  const floor = Number(value);
  return Number.isInteger(floor) && floor > 0 && floor <= 100 ? floor : null;
}
export function getBuildingUnits(building) {
  return validBuilding(building) ? buildings.get(building) : EMPTY;
}
export function getFloorUnits(building, floor) {
  floor = floorNumber(floor);
  return validBuilding(building) && floor !== null ? byFloor.get(`${building}/${floor}`) || EMPTY : EMPTY;
}
export function lookupUnit(building, floor, unit) {
  floor = floorNumber(floor);
  if (!validBuilding(building) || floor === null || typeof unit !== 'string') return null;
  return byUnit.get(`${building}/${floor}/${unit}`) || null;
}
export function getUnitModelVariants(record) {
  // Verify the record comes from this catalog, including its model/type fields.
  if (!record || lookupUnit(record.building, record.floor, record.unit) !== record) return EMPTY;
  return VARIANTS[record.modelType] || EMPTY;
}
export function variantForUnit(record, requested) {
  const allowed = getUnitModelVariants(record);
  if (!allowed.length) return null;
  if (allowed.includes(requested)) return requested;
  return typeof requested === 'string' && (requested === 'basic' || /-basic(?:-archisketch)?$/.test(requested)) ? allowed[0] : allowed[1];
}
