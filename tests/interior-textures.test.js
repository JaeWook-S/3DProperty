import test from 'node:test';
import assert from 'node:assert/strict';
import { fbm, generateMaps, herringboneCell, recipeKinds } from '../src/interior/procedural-textures.js';
import { FINISHES } from '../src/interior/finish-catalog.js';

test('herringbone cells cover the tile without gaps', () => {
  const W = 16, n = 4 * W;
  for (let y = 0; y < n; y += 3) for (let x = 0; x < n; x += 3) {
    const cell = herringboneCell(x + 0.5, y + 0.5, W, n);
    assert.ok(cell && cell.u >= -1e-6 && cell.u <= 4 * W + 1e-6 && cell.v >= -1e-6 && cell.v <= W + 1e-6, `${x},${y}`);
  }
});

test('fbm stays finite and seamless', () => {
  const n = 64, f = fbm(n, { cellsX: 8, octaves: 7, seed: 3 });
  assert.ok(f.every(Number.isFinite));
  // Wrap-around neighbours differ no more than interior neighbours (tileable).
  let edge = 0, inner = 0;
  for (let y = 0; y < n; y++) { edge = Math.max(edge, Math.abs(f[y * n] - f[y * n + n - 1])); inner = Math.max(inner, Math.abs(f[y * n + 1] - f[y * n])); }
  assert.ok(edge < inner * 3 + 0.05);
});

test('every catalog recipe produces finite PBR maps', () => {
  const seen = new Set();
  for (const f of FINISHES) {
    if (seen.has(f.recipe.kind + (f.recipe.pattern ?? '') + (f.recipe.body ?? ''))) continue;
    seen.add(f.recipe.kind + (f.recipe.pattern ?? '') + (f.recipe.body ?? ''));
    const maps = generateMaps(f.recipe, 64);
    assert.equal(maps.albedo.length, 64 * 64 * 4, f.id);
    assert.equal(maps.normal.length, 64 * 64 * 4, f.id);
    for (const arr of [maps.albedo, maps.normal, maps.orm]) assert.ok(!arr.some(v => Number.isNaN(v)), f.id);
    // Normal maps point outward on average (blue channel dominant).
    let z = 0; for (let i = 2; i < maps.normal.length; i += 4) z += maps.normal[i];
    assert.ok(z / (64 * 64) > 180, `${f.id} normal z ${z / 4096}`);
    assert.ok(maps.size[0] > 0 && maps.size[1] > 0 && maps.average.length === 3, f.id);
  }
  assert.ok(recipeKinds.includes('tile') && recipeKinds.includes('wood'));
});
