import {lookupUnit} from './unit-catalog.js';

// The model is shared by type. Only small, cloneable layout snapshots belong here.
// A valid catalog address establishes the scope even if its type has no 3D model;
// deciding whether the viewer may open that model remains the caller's job.
export function layoutScope(selection, variant, revision = 1) {
  const unit = selection?.locationId === 'acro-river-park'
    ? lookupUnit(selection.building, selection.floor, selection.unit) : null;
  return unit
    ? `unit:acro-river-park:${unit.building}:${unit.floor}:${unit.unit}:${variant}:${revision}`
    : `sample:${variant}:${revision}`;
}

export function layoutStorageKey(selection, variant, revision = 1) {
  const scope = layoutScope(selection, variant, revision);
  // Preserve old sample saves without assigning them to a real household.
  return scope.startsWith('unit:')
    ? `cortex-layout-v4:${scope}`
    : `cortex-layout-v3:${variant}:${revision}`;
}

export function createUnitLayoutState() {
  let current = null, epoch = 0;
  const snapshots = new Map();
  return {
    get current() { return current; },
    get epoch() { return epoch; },
    switchTo(scope, {capture, restore}) {
      if (scope === current) return false;
      if (current !== null) snapshots.set(current, structuredClone(capture()));
      epoch++;
      current = scope;
      restore(snapshots.has(scope) ? structuredClone(snapshots.get(scope)) : null);
      return true;
    },
    token() { return {scope: current, epoch}; },
    isCurrent(token) {
      return token != null && token.scope === current && token.epoch === epoch;
    },
  };
}
